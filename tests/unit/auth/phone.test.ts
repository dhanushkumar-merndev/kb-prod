import { describe, expect, it } from "vitest";

import {
  isValidIndianPhone,
  normalizeIndianPhone,
  phoneToInternalAuthEmail,
} from "@/lib/auth/phone";

describe("Indian phone normalization", () => {
  it.each(["98765 43210", "+91-98765-43210", "919876543210", "09876543210", "0091 98765 43210"])(
    "normalizes %s to a canonical E.164 value",
    (input) => {
      expect(normalizeIndianPhone(input)).toBe("+919876543210");
    },
  );

  it.each(["", "12345", "+1 9876543210", "5123456789", "phone 9876543210"])(
    "rejects invalid staff phone input %s",
    (input) => {
      expect(() => normalizeIndianPhone(input)).toThrow(
        "Enter a valid 10-digit Indian mobile number.",
      );
      expect(isValidIndianPhone(input)).toBe(false);
    },
  );

  it("derives the hidden Auth email deterministically", () => {
    expect(phoneToInternalAuthEmail("+91 98765 43210")).toBe(
      "919876543210@staff.khanabanao.internal",
    );
  });
});
