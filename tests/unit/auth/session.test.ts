import { describe, expect, it } from "vitest";

import { createLoginSessionCode, sanitizeUserAgent } from "@/lib/auth/session";

describe("application login session helpers", () => {
  it("creates opaque fixed-length session codes", () => {
    const first = createLoginSessionCode();
    const second = createLoginSessionCode();

    expect(first).toMatch(/^[A-F0-9]{32}$/);
    expect(second).not.toBe(first);
  });

  it("sanitizes and bounds user-agent metadata", () => {
    const input = `Browser\u0000\nAgent ${"x".repeat(400)}`;
    const sanitized = sanitizeUserAgent(input);

    expect(sanitized).toHaveLength(255);
    expect(sanitized).not.toMatch(/[\u0000-\u001F\u007F]/);
  });

  it("omits empty user-agent metadata", () => {
    expect(sanitizeUserAgent(null)).toBeUndefined();
    expect(sanitizeUserAgent(" \n ")).toBeUndefined();
  });
});
