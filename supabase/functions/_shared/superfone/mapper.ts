import { AppError } from "../errors.ts";
import { normalizeIndianPhone } from "../phone.ts";

export function normalizeProviderPhone(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_FAILED");
  }

  return normalizeIndianPhone(value);
}

export function safeProviderIdentifier(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_FAILED");
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new AppError("VALIDATION_FAILED");
  }

  return normalized;
}

export function safeProviderText(
  value: unknown,
  maxLength: number,
  fallback: string | null = null,
): string | null {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new AppError("VALIDATION_FAILED");
  }

  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

export function safeProviderPayload(
  value: unknown,
  maxSerializedBytes = 256_000,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("VALIDATION_FAILED");
  }

  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > maxSerializedBytes) {
    throw new AppError("VALIDATION_FAILED");
  }

  return JSON.parse(serialized) as Record<string, unknown>;
}
