import { z } from "zod";
import { ACCOUNT_STATUSES, PAYMENT_TYPES, PROFILE_ROLES } from "./types.ts";

const trimmedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

const optionalStoragePath = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.endsWith("/") &&
      !path.includes("..") &&
      !path.includes("\\") &&
      !path.includes("//") &&
      !/[\u0000-\u001f\u007f]/.test(path),
    "Enter a valid private Storage path.",
  )
  .optional();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "Enter a valid date.");

const accountPassword = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.");

export const bootstrapOrganizationSchema = z
  .object({
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/)
      .default("INR"),
    directorFullName: trimmedText(2, 120),
    directorPassword: accountPassword,
    directorPhone: trimmedText(10, 32),
    organizationName: trimmedText(2, 120),
    organizationSlug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.")
      .optional(),
    timezone: z.string().trim().min(3).max(80).default("Asia/Kolkata"),
  })
  .strict();

const creatableRoleSchema = z.enum(PROFILE_ROLES).exclude(["director"]);
const initialAccountStatusSchema = z
  .enum(ACCOUNT_STATUSES)
  .exclude(["blocked", "left_organization"]);

export const createTeamMemberSchema = z
  .object({
    aadhaarStoragePath: optionalStoragePath,
    accountStatus: initialAccountStatusSchema.default("active"),
    // Honoured only for a Director actor; the database pins every other actor
    // to their own franchise regardless of what is submitted here.
    franchiseId: z.string().uuid().optional(),
    fullName: trimmedText(2, 120),
    joiningDate: isoDate.optional(),
    partTimePaymentAmount: z.number().finite().nonnegative().optional(),
    partTimePaymentProofPath: optionalStoragePath,
    password: accountPassword,
    paymentAmount: z.number().finite().nonnegative().optional(),
    paymentType: z.enum(PAYMENT_TYPES).optional(),
    phone: trimmedText(10, 32),
    role: creatableRoleSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const isWorkforce = value.role === "chef" || value.role === "part_time_chef";

    if (isWorkforce && !value.paymentType) {
      context.addIssue({
        code: "custom",
        message: "Payment type is required for Chef accounts.",
        path: ["paymentType"],
      });
    }

    if (isWorkforce && value.paymentAmount === undefined) {
      context.addIssue({
        code: "custom",
        message: "Payment amount is required for Chef accounts.",
        path: ["paymentAmount"],
      });
    }

    if (
      value.role !== "part_time_chef" &&
      (value.partTimePaymentAmount !== undefined ||
        value.partTimePaymentProofPath !== undefined ||
        value.accountStatus === "payment_pending")
    ) {
      context.addIssue({
        code: "custom",
        message: "Part-time payment details are only valid for Part-time Chef accounts.",
        path: ["partTimePaymentProofPath"],
      });
    }
  });

export const updateAccountStatusSchema = z
  .object({
    accountStatus: z.enum(ACCOUNT_STATUSES),
    reason: trimmedText(3, 500),
    targetProfileId: z.string().uuid(),
  })
  .strict();

export const replaceRoleHolderSchema = z
  .object({
    expectedCurrentHolderId: z.string().uuid().optional(),
    reason: trimmedText(3, 500),
    role: z.enum(["manager", "hr", "sales_manager"]),
    targetProfileId: z.string().uuid(),
  })
  .strict();
