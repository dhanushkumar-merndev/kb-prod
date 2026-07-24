import type { AccountStatus, AuthContext } from "@/lib/auth/types";
import type { AppErrorCode } from "@/lib/errors";

export interface LoginActionFailure {
  ok: false;
  code: AppErrorCode;
  message: string;
  requestId?: string;
  fieldErrors?: Partial<Record<"phone" | "password", string>>;
}

export type SessionCheckResult =
  | {
      valid: true;
      profile: AuthContext;
    }
  | {
      valid: false;
      reason:
        | "auth_required"
        | "session_expired"
        | "session_revoked"
        | "session_check_failed"
        | AccountStatus;
      shouldLogout: boolean;
    };
