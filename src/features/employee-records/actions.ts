"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireRoleSession } from "@/lib/auth/require-role-session";
import { APP_ERROR_MESSAGES } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const documentSchema = z.object({
  profileId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  documentType: z.enum(["aadhaar", "part-time-payment-proof"]),
  paymentAmount: z.coerce.number().min(0).max(99_999_999_999.99).optional(),
});

const compensationSchema = z.object({
  profileId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentType: z.enum(["monthly", "daily", "hourly", "per_booking"]),
  paymentAmount: z.coerce.number().min(0).max(99_999_999_999.99),
});

function state(status: "success" | "error", message: string): CrudActionState {
  return { status, message, mutationId: crypto.randomUUID() };
}

function safeFailure(error: unknown): CrudActionState {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "";

  if (code === "42501" || message === "PERMISSION_DENIED") {
    return state("error", APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  if (code === "40001" || message === "CONFLICT_STALE_VERSION") {
    return state("error", APP_ERROR_MESSAGES.CONFLICT_STALE_VERSION);
  }

  return state("error", "The employee record could not be saved. Refresh and try again.");
}

function revalidateEmployeeRecords(): void {
  [
    "/hr/employee-records",
    "/hr/chefs",
    "/manager/workforce",
    "/director/workforce",
  ].forEach((path) => revalidatePath(path));
}

export async function uploadEmployeeDocumentAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireRoleSession(["director", "franchise", "manager", "hr"]);
  const parsed = documentSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", parsed.error.issues[0]?.message ?? APP_ERROR_MESSAGES.VALIDATION_FAILED);
  }

  if (
    parsed.data.documentType === "part-time-payment-proof" &&
    parsed.data.paymentAmount === undefined
  ) {
    return state("error", "Enter the Part-time Chef payment amount.");
  }

  const file = formData.get("document");
  const extension =
    file instanceof File && file.size > 0 ? MIME_EXTENSIONS[file.type] : undefined;

  if (!(file instanceof File) || file.size === 0) {
    return state("error", "Choose a document to upload.");
  }

  if (!extension) {
    return state("error", "Upload a JPG, PNG, WebP, or PDF document.");
  }

  if (file.size > MAX_FILE_BYTES) {
    return state("error", "The document must be 8 MB or smaller.");
  }

  const supabase = await createServerSupabaseClient();
  const currentResult = await supabase
    .from("profiles")
    .select("aadhaar_storage_path,part_time_payment_proof_path")
    .eq("id", parsed.data.profileId)
    .single();

  if (currentResult.error) {
    return safeFailure(currentResult.error);
  }

  const storagePath = [
    session.profile.organization_id,
    parsed.data.profileId,
    parsed.data.documentType,
    `${crypto.randomUUID()}.${extension}`,
  ].join("/");
  const uploadResult = await supabase.storage
    .from("employee-private")
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

  if (uploadResult.error) {
    return state("error", APP_ERROR_MESSAGES.STORAGE_UPLOAD_FAILED);
  }

  const { error } = await supabase.rpc("update_employee_private_record", {
    p_profile_id: parsed.data.profileId,
    p_document_type: parsed.data.documentType,
    p_storage_path: storagePath,
    p_part_time_payment_amount: parsed.data.paymentAmount ?? null,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
  });

  if (error) {
    await supabase.storage.from("employee-private").remove([storagePath]);
    return safeFailure(error);
  }

  const oldPath =
    parsed.data.documentType === "aadhaar"
      ? currentResult.data.aadhaar_storage_path
      : currentResult.data.part_time_payment_proof_path;

  if (typeof oldPath === "string" && oldPath !== storagePath) {
    await supabase.storage.from("employee-private").remove([oldPath]);
  }

  revalidateEmployeeRecords();
  return state(
    "success",
    parsed.data.documentType === "aadhaar"
      ? "Aadhaar document saved."
      : "Part-time Chef payment proof saved.",
  );
}

export async function updateWorkforceCompensationAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  await requireRoleSession(["director", "franchise", "manager", "hr"]);
  const parsed = compensationSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", parsed.error.issues[0]?.message ?? APP_ERROR_MESSAGES.VALIDATION_FAILED);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("update_workforce_compensation", {
    p_profile_id: parsed.data.profileId,
    p_joining_date: parsed.data.joiningDate,
    p_payment_type: parsed.data.paymentType,
    p_payment_amount: parsed.data.paymentAmount,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
  });

  if (error) {
    return safeFailure(error);
  }

  revalidateEmployeeRecords();
  return state("success", "Employee pay structure updated.");
}
