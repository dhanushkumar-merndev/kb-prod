import { APP_ERROR_MESSAGES, type AppErrorCode } from "@/lib/errors";

import type { AccountStatus } from "./types";

const ACCOUNT_STATUS_ERROR_CODES: Record<Exclude<AccountStatus, "active">, AppErrorCode> = {
  inactive: "ACCOUNT_INACTIVE",
  blocked: "ACCOUNT_BLOCKED",
  payment_pending: "ACCOUNT_PAYMENT_PENDING",
  left_organization: "ACCOUNT_LEFT_ORGANIZATION",
};

export function getAccountStatusErrorCode(status: AccountStatus): AppErrorCode | null {
  return status === "active" ? null : ACCOUNT_STATUS_ERROR_CODES[status];
}

export function getAccountStatusMessage(status: AccountStatus): string | null {
  const code = getAccountStatusErrorCode(status);
  return code ? APP_ERROR_MESSAGES[code] : null;
}

export type LoginNoticeTone = "error" | "info";

export interface LoginNotice {
  message: string;
  tone: LoginNoticeTone;
}

const LOGIN_NOTICES: Record<string, LoginNotice> = {
  inactive: {
    message: APP_ERROR_MESSAGES.ACCOUNT_INACTIVE,
    tone: "error",
  },
  blocked: {
    message: APP_ERROR_MESSAGES.ACCOUNT_BLOCKED,
    tone: "error",
  },
  payment_pending: {
    message: APP_ERROR_MESSAGES.ACCOUNT_PAYMENT_PENDING,
    tone: "error",
  },
  left_organization: {
    message: APP_ERROR_MESSAGES.ACCOUNT_LEFT_ORGANIZATION,
    tone: "error",
  },
  auth_required: {
    message: APP_ERROR_MESSAGES.AUTH_REQUIRED,
    tone: "info",
  },
  session_expired: {
    message: APP_ERROR_MESSAGES.SESSION_EXPIRED,
    tone: "error",
  },
  session_revoked: {
    message: APP_ERROR_MESSAGES.SESSION_REVOKED,
    tone: "error",
  },
  session_check_failed: {
    message: "We could not verify your session. Check your connection and log in again.",
    tone: "error",
  },
  logged_out: {
    message: "You have been logged out.",
    tone: "info",
  },
  logged_out_all: {
    message: "You have been logged out from all devices.",
    tone: "info",
  },
};

export function getLoginNotice(status: string | string[] | undefined): LoginNotice | null {
  const value = Array.isArray(status) ? status[0] : status;
  return value ? (LOGIN_NOTICES[value] ?? null) : null;
}
