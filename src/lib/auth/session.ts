import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/lib/errors";

export const LOGIN_SESSION_COOKIE = "kb_login_session";
export const LOGIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

interface OpenLoginSessionInput {
  sessionCode: string;
  userAgentSafe?: string;
  ipHash?: string;
}

export type SessionValidation =
  { valid: true } | { valid: false; reason: "invalid" | "unavailable" };

export function createLoginSessionCode(): string {
  return crypto.randomUUID().replaceAll("-", "").toUpperCase();
}

export function sanitizeUserAgent(userAgent: string | null): string | undefined {
  if (!userAgent) {
    return undefined;
  }

  const sanitized = userAgent
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);

  return sanitized || undefined;
}

export async function openLoginSession(
  supabase: SupabaseClient,
  input: OpenLoginSessionInput,
): Promise<void> {
  const { error } = await supabase.rpc("open_login_session", {
    p_session_code: input.sessionCode,
    p_user_agent_safe: input.userAgentSafe ?? null,
    p_ip_hash: input.ipHash ?? null,
  });

  if (error) {
    throw new AppError("INTERNAL_ERROR", { cause: error });
  }
}

export async function validateLoginSession(
  supabase: SupabaseClient,
  sessionCode: string,
  sessionVersion: number,
): Promise<SessionValidation> {
  const { data, error } = await supabase.rpc("validate_login_session", {
    p_session_code: sessionCode,
    p_session_version: sessionVersion,
  });

  if (error) {
    return { valid: false, reason: "unavailable" };
  }

  return data === true ? { valid: true } : { valid: false, reason: "invalid" };
}

export async function touchLoginSession(
  supabase: SupabaseClient,
  sessionCode: string,
): Promise<SessionValidation> {
  const { data, error } = await supabase.rpc("touch_login_session", {
    p_session_code: sessionCode,
  });

  if (error) {
    return { valid: false, reason: "unavailable" };
  }

  return data === true ? { valid: true } : { valid: false, reason: "invalid" };
}

export async function closeLoginSession(
  supabase: SupabaseClient,
  sessionCode: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("close_login_session", {
    p_session_code: sessionCode,
    p_reason: reason,
  });

  if (error) {
    throw new AppError("INTERNAL_ERROR", { cause: error });
  }
}
