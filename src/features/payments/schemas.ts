import { z } from "zod";

export const paymentFormSchema = z.object({
  bookingId: z.string().uuid(),
  paymentStage: z.enum(["advance", "partial", "final", "full", "refund"]),
  amount: z.coerce.number().positive().max(9999999999),
  paymentMethod: z.string().trim().min(2).max(100),
  transactionReference: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === "" ? undefined : value)),
});

export const reviewPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  decision: z.enum(["verified", "rejected"]),
  rejectionReason: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => (value === "" ? undefined : value)),
});
