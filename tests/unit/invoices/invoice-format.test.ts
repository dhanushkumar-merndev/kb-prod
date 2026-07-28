import { describe, expect, it } from "vitest";

import {
  formatInrAmount,
  wrapInvoiceText,
} from "../../../supabase/functions/_shared/invoice-format";

describe("invoice formatting", () => {
  it("formats Indian currency values deterministically", () => {
    expect(formatInrAmount(125000.5)).toBe("INR 1,25,000.50");
    expect(formatInrAmount(0)).toBe("INR 0.00");
  });

  it("wraps long content without losing text", () => {
    const value =
      "Large wedding catering service with breakfast lunch snacks dinner and special dietary requirements";
    const lines = wrapInvoiceText(value, 22);

    expect(lines.length).toBeGreaterThan(3);
    expect(lines.join(" ")).toBe(value);
    expect(lines.every((line) => line.length <= 22)).toBe(true);
  });

  it("splits a single oversized token safely", () => {
    expect(wrapInvoiceText("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 8)).toEqual([
      "ABCDEFGH",
      "IJKLMNOP",
      "QRSTUVWX",
      "YZ",
    ]);
  });
});
