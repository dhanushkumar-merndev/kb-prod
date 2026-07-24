import { z } from "zod";

import { isValidIndianPhone } from "@/lib/auth/phone";

export const loginSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, "Enter your phone number.")
    .refine(isValidIndianPhone, "Enter a valid 10-digit Indian mobile number."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginFormInput = z.input<typeof loginSchema>;
