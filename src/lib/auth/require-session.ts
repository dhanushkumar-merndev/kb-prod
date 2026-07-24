import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAccountStatusErrorCode } from "./account-status";
import { getMyAuthContext } from "./context";
import { LOGIN_SESSION_COOKIE, validateLoginSession } from "./session";
import type { AuthenticatedSession } from "./types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function redirectToLogin(status: string): never {
  redirect(`/login?status=${encodeURIComponent(status)}`);
}

export async function requireActiveSession(): Promise<AuthenticatedSession> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirectToLogin("auth_required");
  }

  let profile;

  try {
    profile = await getMyAuthContext(supabase);
  } catch {
    redirectToLogin("session_check_failed");
  }

  if (!profile) {
    redirectToLogin("auth_required");
  }

  const statusError = getAccountStatusErrorCode(profile.account_status);

  if (statusError) {
    redirectToLogin(profile.account_status);
  }

  const sessionCode = (await cookies()).get(LOGIN_SESSION_COOKIE)?.value;

  if (!sessionCode) {
    redirectToLogin("session_expired");
  }

  const validation = await validateLoginSession(supabase, sessionCode, profile.session_version);

  if (!validation.valid) {
    redirectToLogin(
      validation.reason === "unavailable" ? "session_check_failed" : "session_revoked",
    );
  }

  return {
    userId: user.id,
    profile,
    sessionCode,
  };
}
