import { z } from "zod";

const dateSchema = z.iso.date("Enter a valid date.");

const moneySchema = z.coerce
  .number()
  .finite()
  .min(0, "Amount cannot be negative.")
  .max(999_999_999.99, "Amount is too large.");

export const generatePayrollSchema = z
  .object({
    franchiseId: z.union([z.string().uuid(), z.literal("")]).optional(),
    payrollMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    periodStart: dateSchema,
    periodEnd: dateSchema,
  })
  .refine((value) => !value.payrollMonth || value.periodStart.startsWith(value.payrollMonth), {
    message: "Dates must match the payroll month.",
    path: ["payrollMonth"],
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "End date must be on or after the start date.",
    path: ["periodEnd"],
  })
  .refine((value) => value.periodStart.slice(0, 7) === value.periodEnd.slice(0, 7), {
    message: "A payroll period must stay within one calendar month.",
    path: ["periodEnd"],
  });

export const payrollPeriodActionSchema = z.object({
  payrollPeriodId: z.string().uuid(),
});

export const markPayrollPaidSchema = payrollPeriodActionSchema.extend({
  paymentReference: z.string().trim().min(2).max(160),
});

export const lockPayrollSchema = payrollPeriodActionSchema.extend({
  confirmation: z.literal("yes"),
});

export const adjustPayrollEntrySchema = z.object({
  payrollEntryId: z.string().uuid(),
  allowances: moneySchema,
  deductions: moneySchema,
  advances: moneySchema,
  reason: z.string().trim().min(3, "Add a correction reason.").max(1000),
});

export const reversePayrollEntrySchema = z.object({
  payrollEntryId: z.string().uuid(),
  reason: z.string().trim().min(3, "Add a reversal reason.").max(1000),
  confirmation: z.literal("yes"),
});

export const salaryStructureSchema = z.object({
  profileId: z.string().uuid(),
  effectiveFrom: dateSchema.refine(
    (date) => date.endsWith("-01"),
    "Choose the first day of a month.",
  ),
  paidLeave: z.preprocess((value) => value === true || value === "true", z.boolean()),
  expectedVersion: z.coerce.number().int().min(0),
  hra: moneySchema,
  allowances: moneySchema,
  incentives: moneySchema,
  pf: moneySchema,
  esic: moneySchema,
  professional_tax: moneySchema,
  tds: moneySchema,
  other_deductions: moneySchema,
  employer_pf: moneySchema,
  employer_esic: moneySchema,
});
