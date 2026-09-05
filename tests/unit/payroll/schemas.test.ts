import { describe, expect, it } from "vitest";

import {
  salaryStructureSchema,
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

it("rejects impossible dates and mismatched payroll months", () => {
  expect(
    generatePayrollSchema.safeParse({ periodStart: "2026-02-01", periodEnd: "2026-02-31" }).success,
  ).toBe(false);
  expect(
    generatePayrollSchema.safeParse({
      payrollMonth: "2026-08",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    }).success,
  ).toBe(false);
});
it("validates saved salary amounts, effective month and explicit paid-leave choice", () => {
  const input = {
    profileId: payrollPeriodId,
    effectiveFrom: "2026-09-01",
    paidLeave: "false",
    expectedVersion: "0",
    hra: "0",
    allowances: "0",
    incentives: "0",
    pf: "0",
    esic: "0",
    professional_tax: "0",
    tds: "0",
    other_deductions: "0",
    employer_pf: "0",
    employer_esic: "0",
  };
  expect(salaryStructureSchema.parse(input).paidLeave).toBe(false);
  expect(salaryStructureSchema.parse({ ...input, paidLeave: "true" }).paidLeave).toBe(true);
  expect(salaryStructureSchema.safeParse({ ...input, effectiveFrom: "2026-09-15" }).success).toBe(
    false,
  );
  expect(salaryStructureSchema.safeParse({ ...input, pf: "-10" }).success).toBe(false);
});
