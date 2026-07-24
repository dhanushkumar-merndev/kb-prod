import { z } from "zod";

import { CONVERSATION_STATUSES } from "./types";

const uuid = z.string().uuid("Choose a valid conversation.");
const optionalUuid = z.preprocess((value) => (value === "" ? null : value), uuid.nullable());

export const internalNoteSchema = z.object({
  conversationId: uuid,
  note: z.string().trim().min(1, "Enter an internal note.").max(4000),
});

export const conversationAssignmentSchema = z.object({
  conversationId: uuid,
  assignedSalesProfileId: optionalUuid,
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3, "Add a short assignment reason.").max(500),
});

export const conversationStatusSchema = z.object({
  conversationId: uuid,
  expectedVersion: z.coerce.number().int().positive(),
  status: z.enum(CONVERSATION_STATUSES),
});

export const sendMessageSchema = z.object({
  conversationId: uuid,
  body: z.string().trim().min(1, "Enter a message.").max(4000),
  idempotencyKey: z.string().uuid(),
  retryOfMessageId: optionalUuid,
});
