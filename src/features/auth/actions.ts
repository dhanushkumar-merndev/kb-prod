"use server";

import { cookies, headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import { getAccountStatusErrorCode, getAccountStatusMessage } from "@/lib/auth/account-status";
import { getMyAuthContext } from "@/lib/auth/context";
import { normalizeIndianPhone, phoneToInternalAuthEmail } from "@/lib/auth/phone";
import { getRoleHomePath } from "@/lib/auth/routes";
import {
  closeLoginSession,
  createLoginSessionCode,
  LOGIN_SESSION_COOKIE,
  LOGIN_SESSION_MAX_AGE_SECONDS,
  openLoginSession,
  sanitizeUserAgent,
  touchLoginSession,
  validateLoginSession,
} from "@/lib/auth/session";
import {
  APP_ERROR_MESSAGES,
  AppError,
  getSafeErrorMessage,
  isAppError,
  type AppErrorCode,
} from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { loginSchema, type LoginFormInput } from "./schema";
import type { LoginActionFailure, SessionCheckResult } from "./types";

function failure(
  code: AppErrorCode,
  options: {
    message?: string;
    requestId?: string;
    fieldErrors?: LoginActionFailure["fieldErrors"];
  } = {},
): LoginActionFailure {
  return {
    ok: false,
    code,
    message: options.message ?? APP_ERROR_MESSAGES[code],
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
  };
}

function logSafeAuthError(requestId: string, operation: string, code: AppErrorCode): void {
  console.error("[auth]", { requestId, operation, code });
}

async function clearLocalAuthSession(reason: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const cookieStore = await cookies();
  const sessionCode = cookieStore.get(LOGIN_SESSION_COOKIE)?.value;

  if (sessionCode) {
    try {
      await closeLoginSession(supabase, sessionCode, reason);
    } catch {
      const requestId = crypto.randomUUID();
      logSafeAuthError(requestId, "close-session", "INTERNAL_ERROR");
    }
  }

  await supabase.auth.signOut({ scope: "local" });
  cookieStore.delete(LOGIN_SESSION_COOKIE);
}

export async function loginAction(input: LoginFormInput): Promise<LoginActionFailure> {
  const requestId = crypto.randomUUID();
  const parsed = loginSchema.safeParse(input);

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: LoginActionFailure["fieldErrors"] = {};

    if (flattened.phone?.[0]) {
      fieldErrors.phone = flattened.phone[0];
    }

    if (flattened.password?.[0]) {
      fieldErrors.password = flattened.password[0];
    }

    return failure("VALIDATION_FAILED", {
      fieldErrors,
    });
  }

  const phoneE164 = normalizeIndianPhone(parsed.data.phone);
  const email = phoneToInternalAuthEmail(phoneE164);
  const supabase = await createServerSupabaseClient();
  const signInResult = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  if (signInResult.error) {
    const isRateLimited =
      signInResult.error.status === 429 || signInResult.error.code === "over_request_rate_limit";
    const code: AppErrorCode = isRateLimited ? "AUTH_RATE_LIMITED" : "AUTH_INVALID_CREDENTIALS";

    if (isRateLimited) {
      logSafeAuthError(requestId, "sign-in", code);
    }

    return failure(code);
  }

  try {
    const profile = await getMyAuthContext(supabase);

    if (!profile) {
      await supabase.auth.signOut({ scope: "local" });
      logSafeAuthError(requestId, "load-profile", "AUTH_REQUIRED");
      return failure("AUTH_REQUIRED", { requestId });
    }

    const accountStatusError = getAccountStatusErrorCode(profile.account_status);

    if (accountStatusError) {
      await supabase.auth.signOut({ scope: "local" });
      return failure(accountStatusError, {
        message:
          getAccountStatusMessage(profile.account_status) ?? APP_ERROR_MESSAGES[accountStatusError],
      });
    }

    const sessionCode = createLoginSessionCode();
    const requestHeaders = await headers();
    const userAgentSafe = sanitizeUserAgent(requestHeaders.get("user-agent"));

    await openLoginSession(supabase, {
      sessionCode,
      ...(userAgentSafe ? { userAgentSafe } : {}),
    });

    const cookieStore = await cookies();
    cookieStore.set(LOGIN_SESSION_COOKIE, sessionCode, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: LOGIN_SESSION_MAX_AGE_SECONDS,
    });

    const destination = getRoleHomePath(profile.role);

    redirect(destination);
  } catch (error) {
    unstable_rethrow(error);

    await supabase.auth.signOut({ scope: "local" });
    const appError = isAppError(error) ? error : new AppError("INTERNAL_ERROR", { cause: error });

    logSafeAuthError(requestId, "start-session", appError.code);

    return failure(appError.code, {
      message: getSafeErrorMessage(appError),
      requestId,
    });
  }
}

export async function checkCurrentSessionAction(): Promise<SessionCheckResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      valid: false,
      reason: "auth_required",
      shouldLogout: true,
    };
  }

  let profile;

  try {
    profile = await getMyAuthContext(supabase);
  } catch {
    return {
      valid: false,
      reason: "session_check_failed",
      shouldLogout: false,
    };
  }

  if (!profile) {
    return {
      valid: false,
      reason: "auth_required",
      shouldLogout: true,
    };
  }

  if (profile.account_status !== "active") {
    return {
      valid: false,
      reason: profile.account_status,
      shouldLogout: true,
    };
  }

  const sessionCode = (await cookies()).get(LOGIN_SESSION_COOKIE)?.value;

  if (!sessionCode) {
    return {
      valid: false,
      reason: "session_expired",
      shouldLogout: true,
    };
  }

  const validation = await validateLoginSession(supabase, sessionCode, profile.session_version);

  if (!validation.valid) {
    return {
      valid: false,
      reason: validation.reason === "unavailable" ? "session_check_failed" : "session_revoked",
      shouldLogout: validation.reason !== "unavailable",
    };
  }

  const heartbeat = await touchLoginSession(supabase, sessionCode);

  if (!heartbeat.valid && heartbeat.reason === "invalid") {
    return {
      valid: false,
      reason: "session_revoked",
      shouldLogout: true,
    };
  }

  return { valid: true, profile };
}

export async function terminateCurrentSessionAction(reason: string): Promise<void> {
  const safeReason = [
    "user_logout",
    "session_revoked",
    "session_expired",
    "account_status_changed",
  ].includes(reason)
    ? reason
    : "session_revoked";

  await clearLocalAuthSession(safeReason);
}

export async function logoutAction(): Promise<never> {
  await clearLocalAuthSession("user_logout");
  redirect("/login?status=logged_out");
}

export async function logoutAllDevicesAction(): Promise<never> {
  const requestId = crypto.randomUUID();
  const supabase = await createServerSupabaseClient();
  const cookieStore = await cookies();

  const { error: applicationSessionError } = await supabase.rpc("close_all_my_login_sessions", {
    p_reason: "user_logout_all_devices",
  });

  if (applicationSessionError) {
    logSafeAuthError(requestId, "close-all-application-sessions", "INTERNAL_ERROR");
  }

  const { error: authError } = await supabase.auth.signOut({ scope: "global" });

  if (authError) {
    logSafeAuthError(requestId, "global-sign-out", "INTERNAL_ERROR");
  }

  cookieStore.delete(LOGIN_SESSION_COOKIE);
  redirect("/login?status=logged_out_all");
}
