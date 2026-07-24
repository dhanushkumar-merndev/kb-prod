export const APP_ERROR_CODES = [
  "AUTH_REQUIRED",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_RATE_LIMITED",
  "ACCOUNT_INACTIVE",
  "ACCOUNT_BLOCKED",
  "ACCOUNT_PAYMENT_PENDING",
  "ACCOUNT_LEFT_ORGANIZATION",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "CONFLICT_STALE_VERSION",
  "DUPLICATE_PHONE",
  "PAYMENT_PROOF_REQUIRED",
  "ATTENDANCE_NOT_ASSIGNED",
  "ATTENDANCE_ALREADY_OPEN",
  "SUPERFONE_NOT_CONFIGURED",
  "SUPERFONE_CAPABILITY_UNAVAILABLE",
  "SUPERFONE_RATE_LIMITED",
  "SUPERFONE_AUTH_FAILED",
  "STORAGE_UPLOAD_FAILED",
  "INTERNAL_ERROR",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export const APP_ERROR_MESSAGES: Record<AppErrorCode, string> = {
  AUTH_REQUIRED: "Please log in to continue.",
  AUTH_INVALID_CREDENTIALS: "The phone number or password is incorrect.",
  AUTH_RATE_LIMITED: "Too many login attempts. Please wait a few minutes and try again.",
  ACCOUNT_INACTIVE: "Your account has been deactivated. Please contact HR or your Manager.",
  ACCOUNT_BLOCKED: "Your account has been blocked. Please contact HR or your Manager.",
  ACCOUNT_PAYMENT_PENDING: "Your access is pending payment confirmation. Please contact HR.",
  ACCOUNT_LEFT_ORGANIZATION: "This account is no longer active in this organization.",
  SESSION_EXPIRED: "Your session has expired. Please log in again.",
  SESSION_REVOKED: "Your session ended because your account access changed. Please log in again.",
  PERMISSION_DENIED: "You do not have permission to perform this action.",
  VALIDATION_FAILED: "Check the highlighted fields and try again.",
  CONFLICT_STALE_VERSION: "This record changed while you were working. Refresh it and try again.",
  DUPLICATE_PHONE: "That phone number is already in use.",
  PAYMENT_PROOF_REQUIRED: "Upload a payment proof before continuing.",
  ATTENDANCE_NOT_ASSIGNED: "Attendance is not available because no eligible work is assigned.",
  ATTENDANCE_ALREADY_OPEN: "You already have an open shift.",
  SUPERFONE_NOT_CONFIGURED: "Superfone is not configured. Ask the Director to connect it.",
  SUPERFONE_CAPABILITY_UNAVAILABLE:
    "Superfone does not currently support this action for your connection.",
  SUPERFONE_RATE_LIMITED: "Superfone is temporarily rate limited. Please try again shortly.",
  SUPERFONE_AUTH_FAILED:
    "Superfone authentication failed. Ask the Director to check the connection.",
  STORAGE_UPLOAD_FAILED: "The file could not be uploaded. Please try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again. If it continues, contact support.",
};

interface AppErrorOptions {
  message?: string;
  requestId?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly requestId?: string;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? APP_ERROR_MESSAGES[code], {
      cause: options.cause,
    });
    this.name = "AppError";
    this.code = code;

    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function getSafeErrorMessage(error: unknown): string {
  return isAppError(error) ? error.message : APP_ERROR_MESSAGES.INTERNAL_ERROR;
}
