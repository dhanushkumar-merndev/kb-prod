import { z } from "zod";

import { EXPENSE_STATUSES, LEAD_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "./types";

const blankToUndefined = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
};

const optionalText = (maximum: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(maximum).optional());

const optionalUuid = z.preprocess(blankToUndefined, z.string().uuid().optional());
const optionalDate = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .optional(),
);
const optionalDateTime = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time.")
    .optional(),
);
const optionalPositiveInteger = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().positive().max(1_000_000).optional(),
);
const optionalMoney = z.preprocess(
  blankToUndefined,
  z.coerce.number().min(0).max(99_999_999_999.99).optional(),
);

const leadFields = {
  clientName: z.string().trim().min(2, "Enter the customer name.").max(160),
  customerEmail: z.preprocess(
    blankToUndefined,
    z.string().trim().toLowerCase().email("Enter a valid email address.").max(254).optional(),
  ),
  phone: z.string().trim().min(10, "Enter a valid phone number.").max(32),
  requirement: optionalText(4_000),
  eventDate: optionalDate,
  guestCount: optionalPositiveInteger,
  quoteAmount: optionalMoney,
  notes: optionalText(4_000),
};

export const createLeadSchema = z.object({
  ...leadFields,
  source: optionalText(120),
  assignedSalesProfileId: optionalUuid,
});

export const updateLeadSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  ...leadFields,
});

export const updateLeadStatusSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  status: z.enum(LEAD_STATUSES),
  reason: optionalText(1_000),
});

export const createExpenseSchema = z.object({
  bookingId: optionalUuid,
  category: z.string().trim().min(2, "Enter an expense category.").max(120),
  amount: z.coerce.number().positive("Amount must be greater than zero.").max(99_999_999_999.99),
  reason: z.string().trim().min(3, "Explain the expense.").max(2_000),
});

export const updateExpenseSchema = createExpenseSchema.extend({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

export const reviewExpenseSchema = z
  .object({
    id: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    status: z.enum(EXPENSE_STATUSES).exclude(["pending"]),
    rejectionReason: optionalText(1_000),
  })
  .superRefine((value, context) => {
    if (value.status === "rejected" && !value.rejectionReason) {
      context.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "Enter a rejection reason.",
      });
    }
  });

const leaveFields = {
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid start date."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid end date."),
  reason: z.string().trim().min(3, "Enter a leave reason.").max(2_000),
};

export const createLeaveRequestSchema = z
  .object(leaveFields)
  .refine((value) => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "End date must be on or after the start date.",
  });

export const updateLeaveRequestSchema = z
  .object({
    id: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    ...leaveFields,
  })
  .refine((value) => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "End date must be on or after the start date.",
  });

export const cancelLeaveRequestSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

const taskFields = {
  title: z.string().trim().min(2, "Enter a task title.").max(200),
  description: optionalText(4_000),
  assignedToProfileId: z.string().uuid("Choose an assignee."),
  bookingId: optionalUuid,
  leadId: optionalUuid,
  dueAt: optionalDateTime,
  priority: z.enum(TASK_PRIORITIES),
};

export const createTaskSchema = z.object(taskFields);

export const updateTaskSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  ...taskFields,
});

export const updateTaskStatusSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  status: z.enum(TASK_STATUSES),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;
export type UpdateLeaveRequestInput = z.infer<typeof updateLeaveRequestSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
