export type AppErrorCode =
  | "AUTH_REQUIRED"
  | "ACCOUNT_INACTIVE"
  | "ACCOUNT_BLOCKED"
  | "ACCOUNT_PAYMENT_PENDING"
  | "ACCOUNT_LEFT_ORGANIZATION"
  | "PERMISSION_DENIED"
  | "VALIDATION_FAILED"
  | "CONFLICT_STALE_VERSION"
  | "DUPLICATE_PHONE"
  | "ROLE_HOLDER_CONFLICT"
  | "ROLE_HOLDER_REQUIRED"
  | "PAYMENT_PROOF_REQUIRED"
  | "SUPERFONE_NOT_CONFIGURED"
  | "SUPERFONE_CAPABILITY_UNAVAILABLE"
  | "SUPERFONE_RATE_LIMITED"
  | "SUPERFONE_AUTH_FAILED"
  | "SUPERFONE_WEBHOOK_INVALID"
  | "SUPERFONE_PROVIDER_FAILED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INVALID_JSON"
  | "CORS_ORIGIN_DENIED"
  | "CONFIGURATION_ERROR"
  | "BOOTSTRAP_FORBIDDEN"
  | "BOOTSTRAP_ALREADY_COMPLETED"
  | "AUTH_USER_CREATE_FAILED"
  | "DATABASE_OPERATION_FAILED"
  | "INTERNAL_ERROR";

interface ValidationFieldError {
  path: string;
  message: string;
}

export interface PublicErrorDetails {
  fields?: ValidationFieldError[];
}

interface AppErrorOptions {
  cause?: unknown;
  details?: PublicErrorDetails;
  message?: string;
  status?: number;
}

const DEFAULTS: Record<AppErrorCode, { message: string; status: number }> = {
  AUTH_REQUIRED: {
    message: "Please log in to continue.",
    status: 401,
  },
  ACCOUNT_INACTIVE: {
    message: "Your account has been deactivated. Please contact HR or your Manager.",
    status: 403,
  },
  ACCOUNT_BLOCKED: {
    message: "Your account has been blocked. Please contact HR or your Manager.",
    status: 403,
  },
  ACCOUNT_PAYMENT_PENDING: {
    message: "Your access is pending payment confirmation. Please contact HR.",
    status: 403,
  },
  ACCOUNT_LEFT_ORGANIZATION: {
    message: "This account is no longer active in this organization.",
    status: 403,
  },
  PERMISSION_DENIED: {
    message: "You do not have permission to perform this action.",
    status: 403,
  },
  VALIDATION_FAILED: {
    message: "Check the highlighted information and try again.",
    status: 400,
  },
  CONFLICT_STALE_VERSION: {
    message: "This record changed while you were working. Refresh and try again.",
    status: 409,
  },
  DUPLICATE_PHONE: {
    message: "That phone number already has an account.",
    status: 409,
  },
  ROLE_HOLDER_CONFLICT: {
    message: "This role already has an active account. Use the replace role holder action.",
    status: 409,
  },
  ROLE_HOLDER_REQUIRED: {
    message: "Create or activate the required reporting role before adding this team member.",
    status: 409,
  },
  PAYMENT_PROOF_REQUIRED: {
    message: "Payment proof is required before this account can be activated.",
    status: 409,
  },
  SUPERFONE_NOT_CONFIGURED: {
    message: "Superfone is not configured. Ask the Director to check the connection.",
    status: 503,
  },
  SUPERFONE_CAPABILITY_UNAVAILABLE: {
    message: "This Superfone capability is not available with the current provider configuration.",
    status: 501,
  },
  SUPERFONE_RATE_LIMITED: {
    message: "Superfone is rate limiting requests. Wait a moment and try again.",
    status: 429,
  },
  SUPERFONE_AUTH_FAILED: {
    message: "Superfone rejected the configured credentials. Ask the Director to reconnect.",
    status: 502,
  },
  SUPERFONE_WEBHOOK_INVALID: {
    message: "The Superfone webhook could not be authenticated.",
    status: 401,
  },
  SUPERFONE_PROVIDER_FAILED: {
    message: "Superfone could not complete the request. Try again.",
    status: 502,
  },
  NOT_FOUND: {
    message: "The requested record could not be found.",
    status: 404,
  },
  METHOD_NOT_ALLOWED: {
    message: "This request method is not supported.",
    status: 405,
  },
  INVALID_JSON: {
    message: "The request body is not valid JSON.",
    status: 400,
  },
  CORS_ORIGIN_DENIED: {
    message: "This application origin is not allowed.",
    status: 403,
  },
  CONFIGURATION_ERROR: {
    message: "The service is not configured. Contact the administrator.",
    status: 503,
  },
  BOOTSTRAP_FORBIDDEN: {
    message: "The organization bootstrap credential is invalid.",
    status: 403,
  },
  BOOTSTRAP_ALREADY_COMPLETED: {
    message: "Organization bootstrap has already been completed.",
    status: 409,
  },
  AUTH_USER_CREATE_FAILED: {
    message: "The team member account could not be created. Try again.",
    status: 502,
  },
  DATABASE_OPERATION_FAILED: {
    message: "The change could not be saved. Try again.",
    status: 500,
  },
  INTERNAL_ERROR: {
    message: "Something went wrong. Try again.",
    status: 500,
  },
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: PublicErrorDetails | undefined;
  readonly status: number;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    const fallback = DEFAULTS[code];
    super(options.message ?? fallback.message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? fallback.status;
    this.details = options.details;
  }
}

interface ErrorLike {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
  status?: unknown;
}

function asErrorLike(value: unknown): ErrorLike {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  return value as ErrorLike;
}

const DATABASE_CODES: readonly AppErrorCode[] = [
  "AUTH_REQUIRED",
  "ACCOUNT_INACTIVE",
  "ACCOUNT_BLOCKED",
  "ACCOUNT_PAYMENT_PENDING",
  "ACCOUNT_LEFT_ORGANIZATION",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "CONFLICT_STALE_VERSION",
  "DUPLICATE_PHONE",
  "ROLE_HOLDER_CONFLICT",
  "ROLE_HOLDER_REQUIRED",
  "PAYMENT_PROOF_REQUIRED",
  "NOT_FOUND",
  "BOOTSTRAP_ALREADY_COMPLETED",
];

/**
 * PostgreSQL RPCs raise stable application codes. Only those allow-listed
 * codes are reflected to callers; raw database text is never exposed.
 */
export function fromDatabaseError(
  error: unknown,
  fallbackCode: AppErrorCode = "DATABASE_OPERATION_FAILED",
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const source = asErrorLike(error);
  const searchable = [source.message, source.details, source.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  for (const code of DATABASE_CODES) {
    if (searchable.includes(code)) {
      return new AppError(code, { cause: error });
    }
  }

  if (
    searchable.includes("REPORTING_MANAGER_REQUIRED") ||
    searchable.includes("INVALID_REPORTING_HIERARCHY")
  ) {
    return new AppError("ROLE_HOLDER_REQUIRED", { cause: error });
  }

  if (searchable.includes("ORGANIZATION_ALREADY_BOOTSTRAPPED")) {
    return new AppError("BOOTSTRAP_ALREADY_COMPLETED", { cause: error });
  }

  if (
    searchable.includes("REASON_REQUIRED") ||
    searchable.includes("ROLE_CANDIDATE_MISMATCH") ||
    searchable.includes("ROLE_CANDIDATE_NOT_INACTIVE")
  ) {
    return new AppError("VALIDATION_FAILED", { cause: error });
  }

  if (source.code === "42501") {
    return new AppError("PERMISSION_DENIED", { cause: error });
  }

  if (source.code === "P0002") {
    return new AppError("NOT_FOUND", { cause: error });
  }

  if (source.code === "23505") {
    return new AppError(fallbackCode, {
      cause: error,
      status: 409,
    });
  }

  return new AppError(fallbackCode, { cause: error });
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError("INTERNAL_ERROR", { cause: error });
}

export function logSafeError(error: unknown, requestId: string): void {
  const appError = toAppError(error);
  console.error(
    JSON.stringify({
      code: appError.code,
      errorName: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
      requestId,
      status: appError.status,
    }),
  );
}
