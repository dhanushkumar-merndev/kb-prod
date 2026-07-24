import { z } from "zod";

import { CALL_DIRECTIONS, CALL_STATUSES, FOLLOW_UP_STATUSES } from "./types";

const uuid = z.string().uuid("Choose a valid record.");
const optionalUuid = z.preprocess((value) => (value === "" ? null : value), uuid.nullable());
const localDateTime = z
  .string()
  .min(1, "Choose a date and time.")
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a valid date and time.");

export const assignLeadSchema = z.object({
  leadId: uuid,
  assignedSalesProfileId: optionalUuid,
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3, "Add a short assignment reason.").max(500),
});

export const createFollowUpSchema = z.object({
  leadId: uuid,
  assignedProfileId: optionalUuid,
  dueAt: localDateTime,
});

export const updateFollowUpSchema = z
  .object({
    followUpId: uuid,
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    dueAt: localDateTime,
    status: z.enum(FOLLOW_UP_STATUSES),
    outcome: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.string().trim().max(2000).nullable(),
    ),
  })
  .superRefine((value, context) => {
    if (value.status === "completed" && !value.outcome) {
      context.addIssue({
        code: "custom",
        message: "Add the follow-up outcome before completing it.",
        path: ["outcome"],
      });
    }
  });

export const addLeadNoteSchema = z.object({
  leadId: uuid,
  note: z.string().trim().min(1, "Enter an internal note.").max(4000),
});

export const logSalesCallSchema = z.object({
  leadId: uuid,
  conversationId: optionalUuid,
  direction: z.enum(CALL_DIRECTIONS),
  status: z.enum(CALL_STATUSES),
  startedAt: localDateTime,
  durationSeconds: z.coerce.number().int("Enter a whole number of seconds.").min(0).max(86400),
  outcome: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(2000).nullable(),
  ),
});
