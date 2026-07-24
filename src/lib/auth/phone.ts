import { AppError } from "@/lib/errors";

const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;
const INTERNAL_AUTH_DOMAIN = "staff.khanabanao.internal";

function invalidPhoneError(): AppError {
  return new AppError("VALIDATION_FAILED", {
    message: "Enter a valid 10-digit Indian mobile number.",
  });
}

/**
 * Normalizes supported Indian mobile formats to E.164.
 *
 * Accepted examples:
 * 98765 43210, +91-98765-43210, 919876543210 and 09876543210.
 */
export function normalizeIndianPhone(value: string): string {
  const trimmed = value.trim();

  if (!trimmed || /[A-Za-z]/.test(trimmed)) {
    throw invalidPhoneError();
  }

  let digits = trimmed.replace(/\D/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  if (!INDIAN_MOBILE_PATTERN.test(digits)) {
    throw invalidPhoneError();
  }

  return `+91${digits}`;
}

export function isValidIndianPhone(value: string): boolean {
  try {
    normalizeIndianPhone(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Supabase Auth uses this address internally for phone/password staff login.
 * It must never be rendered in the application UI.
 */
export function phoneToInternalAuthEmail(phone: string): string {
  const phoneE164 = normalizeIndianPhone(phone);
  return `${phoneE164.replace(/\D/g, "")}@${INTERNAL_AUTH_DOMAIN}`;
}
