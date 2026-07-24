import { AppError } from "./errors.ts";

const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

/**
 * Converts accepted Indian mobile formats to the one canonical profile value.
 * The function deliberately rejects ambiguous international numbers rather than
 * silently assigning the +91 country code to them.
 */
export function normalizeIndianPhone(input: string): string {
  if (/\p{L}/u.test(input)) {
    throw invalidPhoneError();
  }

  let digits = input.replace(/\D/g, "");

  if (digits.length === 14 && digits.startsWith("0091")) {
    digits = digits.slice(4);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  if (!INDIAN_MOBILE_PATTERN.test(digits)) {
    throw invalidPhoneError();
  }

  return `+91${digits}`;
}

function invalidPhoneError(): AppError {
  const message = "Enter a valid 10-digit Indian mobile number.";
  return new AppError("VALIDATION_FAILED", {
    details: {
      fields: [
        {
          path: "phone",
          message,
        },
      ],
    },
    message,
  });
}

/**
 * Supabase Auth requires an email for password sign-in. This deterministic,
 * non-routable address is an internal implementation detail and is never
 * returned by the Edge Functions.
 */
export function phoneToInternalAuthEmail(phoneE164: string): string {
  return `${phoneE164.replace(/\D/g, "")}@staff.khanabanao.internal`;
}
