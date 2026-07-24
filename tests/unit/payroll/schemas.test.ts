import { describe, expect, it } from "vitest";

import {
  adjustPayrollEntrySchema,
  generatePayrollSchema,
  lockPayrollSchema,
  markPayrollPaidSchema,
  reversePayrollEntrySchema,
} from "@/features/payroll/schemas";

const payrollPeriodId = "7bb40539-22fe-49f5-8dfa-ebfe4f154666";

describe("payroll input validation", () => {
  it("accepts a calendar-month payroll range", () => {
    expect(
      generatePayrollSchema.safeParse({
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }).success,
    ).toBe(true);
  });

  it("rejects reversed and cross-month payroll ranges", () => {
    expect(
      generatePayrollSchema.safeParse({
        periodStart: "2026-07-31",
        periodEnd: "2026-07-01",
      }).success,
    ).toBe(false);
    expect(
      generatePayrollSchema.safeParse({
        periodStart: "2026-07-15",
        periodEnd: "2026-08-14",
      }).success,
    ).toBe(false);
  });

  it("requires bounded non-negative corrections and an audit reason", () => {
    expect(
      adjustPayrollEntrySchema.safeParse({
        payrollEntryId: payrollPeriodId,
        allowances: "100.50",
        deductions: "20",
        advances: "0",
        reason: "Approved travel allowance.",
      }).success,
    ).toBe(true);
    expect(
      adjustPayrollEntrySchema.safeParse({
        payrollEntryId: payrollPeriodId,
        allowances: "-1",
        deductions: "0",
        advances: "0",
        reason: "",
      }).success,
    ).toBe(false);
  });

  it("requires traceable payment and reversal references", () => {
    expect(
      markPayrollPaidSchema.safeParse({
        payrollPeriodId,
        paymentReference: "UTR-2026-00042",
      }).success,
    ).toBe(true);
    expect(
      markPayrollPaidSchema.safeParse({
        payrollPeriodId,
        paymentReference: "",
      }).success,
    ).toBe(false);
    expect(
      reversePayrollEntrySchema.safeParse({
        payrollEntryId: payrollPeriodId,
        reason: "Bank transfer was returned.",
        confirmation: "yes",
      }).success,
    ).toBe(true);
    expect(
      lockPayrollSchema.safeParse({
        payrollPeriodId,
        confirmation: "yes",
      }).success,
    ).toBe(true);
    expect(
      lockPayrollSchema.safeParse({
        payrollPeriodId,
      }).success,
    ).toBe(false);
  });
});
