import { describe, expect, it } from "vitest";

import { calculatePayrollNetPaise } from "@/features/payroll/calculation";

describe("calculatePayrollNetPaise", () => {
  it("adds earnings and subtracts deductions and advances without floating-point money", () => {
    expect(
      calculatePayrollNetPaise({
        base: 300_000,
        attendance: 50_000,
        bookings: 75_000,
        overtime: 12_500,
        reimbursements: 8_000,
        allowances: 5_000,
        deductions: 10_000,
        advances: 20_000,
      }),
    ).toBe(420_500);
  });

  it("accepts a zero-value payroll entry", () => {
    expect(
      calculatePayrollNetPaise({
        base: 0,
        attendance: 0,
        bookings: 0,
        overtime: 0,
        reimbursements: 0,
        allowances: 0,
        deductions: 0,
        advances: 0,
      }),
    ).toBe(0);
  });

  it("rejects negative, fractional, unsafe or over-deducted paise values", () => {
    const valid = {
      base: 1_000,
      attendance: 0,
      bookings: 0,
      overtime: 0,
      reimbursements: 0,
      allowances: 0,
      deductions: 0,
      advances: 0,
    };

    expect(() => calculatePayrollNetPaise({ ...valid, base: -1 })).toThrow(
      "non-negative integer paise",
    );
    expect(() => calculatePayrollNetPaise({ ...valid, base: 1.5 })).toThrow(
      "non-negative integer paise",
    );
    expect(() => calculatePayrollNetPaise({ ...valid, base: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      "non-negative integer paise",
    );
    expect(() => calculatePayrollNetPaise({ ...valid, deductions: 1_001 })).toThrow(
      "cannot exceed earnings",
    );
  });
});
