import { z } from "zod";

import { MEETING_STATUSES, TEMPORARY_WORKER_PAYMENT_TYPES, TEMPORARY_WORKER_TYPES } from "./types";

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalText = (maximum: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(maximum).optional());

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time.");

const optionalHttpUrl = z.preprocess(
  blankToUndefined,
  z
    .url("Enter a valid meeting URL.")
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "https:" || protocol === "http:";
    }, "Meeting URL must start with http:// or https://.")
    .optional(),
);

const attendeeIds = z
  .array(z.string().uuid())
  .max(100, "Choose no more than 100 attendees.")
  .refine((values) => new Set(values).size === values.length, "An attendee was selected twice.");

const meetingFields = {
  title: z.string().trim().min(2, "Enter a meeting title.").max(200),
  reason: optionalText(4_000),
  startsAt: localDateTime,
  endsAt: localDateTime,
  location: optionalText(300),
  meetingUrl: optionalHttpUrl,
  attendeeProfileIds: attendeeIds,
};

function meetingDatesAreValid(value: { startsAt: string; endsAt: string }): boolean {
  return value.endsAt > value.startsAt;
}

export const createMeetingSchema = z.object(meetingFields).refine(meetingDatesAreValid, {
  path: ["endsAt"],
  message: "End time must be after the start time.",
});

export const updateMeetingSchema = z
  .object({
    id: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    ...meetingFields,
  })
  .refine(meetingDatesAreValid, {
    path: ["endsAt"],
    message: "End time must be after the start time.",
  });

export const updateMeetingStatusSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  status: z.enum(MEETING_STATUSES),
});

export const deleteMeetingSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

const temporaryWorkerFields = {
  fullName: z.string().trim().min(2, "Enter the worker's full name.").max(160),
  phone: optionalText(32),
  workerType: z.enum(TEMPORARY_WORKER_TYPES),
  paymentType: z.enum(TEMPORARY_WORKER_PAYMENT_TYPES),
  paymentAmount: z.coerce
    .number()
    .min(0, "Payment amount cannot be negative.")
    .max(99_999_999_999.99),
  notes: optionalText(2_000),
};

export const createTemporaryWorkerSchema = z.object(temporaryWorkerFields);

export const updateTemporaryWorkerSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  ...temporaryWorkerFields,
});

export const updateTemporaryWorkerStatusSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const assignTemporaryWorkerSchema = z.object({
  temporaryWorkerId: z.string().uuid(),
  bookingId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reportingTime: z.preprocess(
    blankToUndefined,
    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  ),
  agreedPayment: z.coerce.number().min(0).max(99_999_999_999.99),
  notes: optionalText(2_000),
});
