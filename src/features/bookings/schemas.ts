import { z } from "zod";

const optionalTime = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .refine((value) => value === undefined || /^\d{2}:\d{2}$/.test(value), "Enter a valid time.");

export const bookingFormSchema = z.object({
  leadId: z.string().uuid(),
  eventType: z.string().trim().min(2).max(120),
  eventDate: z.iso.date(),
  eventStartTime: optionalTime,
  reportingTime: optionalTime,
  venue: z.string().trim().min(2).max(500),
  guestCount: z.coerce.number().int().min(1).max(100000),
  menu: z.string().trim().min(2).max(10000),
  instructions: z
    .string()
    .trim()
    .max(10000)
    .transform((value) => (value === "" ? undefined : value)),
  totalValue: z.coerce.number().min(0).max(9999999999),
});

export const updateBookingFormSchema = bookingFormSchema.omit({ leadId: true }).extend({
  bookingId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
});
