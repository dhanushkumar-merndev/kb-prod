"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { paymentFormSchema, reviewPaymentSchema } from "./schemas";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function failure(message: string, fieldErrors?: Record<string, string>): CrudActionState {
  return {
    status: "error",
    message,
    mutationId: crypto.randomUUID(),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

function validationFailure(error: z.ZodError): CrudActionState {
  const fieldErrors: Record<string, string> = {};

  error.issues.forEach((issue) => {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  });

  return failure("Check the highlighted fields and try again.", fieldErrors);
}

function databaseMessage(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : "UNKNOWN";
}

function revalidatePayments(): void {
  [
    "/director/dashboard",
    "/director/payments",
    "/franchise/dashboard",
    "/franchise/payments",
    "/franchise/bookings",
    "/manager/dashboard",
    "/manager/payments",
    "/sales-manager/dashboard",
    "/sales-manager/payments",
    "/sales/dashboard",
    "/sales/payments",
    "/director/bookings",
    "/manager/bookings",
    "/sales-manager/bookings",
    "/sales/bookings",
  ].forEach((path) => revalidatePath(path));
}

function extensionFor(file: File): string {
  const fromMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return fromMime[file.type] ?? "bin";
}

export async function submitPaymentAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["sales", "sales_manager"].includes(session.profile.role)) {
    return failure("You do not have permission to submit a payment.");
  }

  const parsed = paymentFormSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const proof = formData.get("proof");

  if (!(proof instanceof File) || proof.size === 0) {
    return failure("Upload the customer payment proof.", {
      proof: "Payment proof is required.",
    });
  }

  if (!ALLOWED_MIME_TYPES.has(proof.type) || proof.size > MAX_FILE_BYTES) {
    return failure("Upload a JPG, PNG, WebP or PDF file up to 8 MB.", {
      proof: "This proof file is not supported.",
    });
  }

  const supabase = await createServerSupabaseClient();
  const path = `${session.profile.organization_id}/${session.profile.id}/${parsed.data.bookingId}/${crypto.randomUUID()}.${extensionFor(proof)}`;
  const upload = await supabase.storage.from("payment-proofs").upload(path, proof, {
    contentType: proof.type,
    upsert: false,
  });

  if (upload.error) {
    return failure("Payment proof upload failed. Check the file and try again.");
  }

  const insert = await supabase.rpc("submit_booking_payment", {
    p_booking_id: parsed.data.bookingId,
    p_payment_stage: parsed.data.paymentStage,
    p_amount: parsed.data.amount,
    p_payment_method: parsed.data.paymentMethod,
    p_transaction_reference: parsed.data.transactionReference ?? null,
    p_proof_storage_path: path,
  });

  if (insert.error) {
    await supabase.storage.from("payment-proofs").remove([path]);
    const messages: Record<string, string> = {
      PAYMENT_REFERENCE_DUPLICATE: "This transaction reference has already been submitted.",
      INVALID_STORAGE_PATH: "The payment proof path is invalid. Upload the proof again.",
      PERMISSION_DENIED: "You do not have permission to submit payment for this booking.",
      AUTH_REQUIRED: "Your session has expired. Log in again.",
    };
    return failure(
      messages[databaseMessage(insert.error)] ??
        "Payment could not be submitted. Refresh and try again.",
    );
  }

  revalidatePayments();
  return {
    status: "success",
    message: "Payment proof uploaded.",
    mutationId: crypto.randomUUID(),
  };
}

export async function attachPaymentProofAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["sales", "sales_manager"].includes(session.profile.role)) {
    return failure("You do not have permission to upload this payment proof.");
  }

  const paymentId = formData.get("paymentId");
  const bookingId = formData.get("bookingId");
  const proof = formData.get("proof");

  if (
    typeof paymentId !== "string" ||
    typeof bookingId !== "string" ||
    !z.string().uuid().safeParse(paymentId).success ||
    !z.string().uuid().safeParse(bookingId).success
  ) {
    return failure("This payment record is invalid. Refresh and try again.");
  }

  if (!(proof instanceof File) || proof.size === 0) {
    return failure("Choose the customer payment proof.", { proof: "A proof file is required." });
  }

  if (!ALLOWED_MIME_TYPES.has(proof.type) || proof.size > MAX_FILE_BYTES) {
    return failure("Upload a JPG, PNG, WebP or PDF file up to 8 MB.", {
      proof: "This proof file is not supported.",
    });
  }

  const supabase = await createServerSupabaseClient();
  const path = `${session.profile.organization_id}/${session.profile.id}/${bookingId}/${crypto.randomUUID()}.${extensionFor(proof)}`;
  const upload = await supabase.storage.from("payment-proofs").upload(path, proof, {
    contentType: proof.type,
    upsert: false,
  });

  if (upload.error) {
    return failure("Payment proof upload failed. Check the file and try again.");
  }

  const { error } = await supabase.rpc("attach_booking_payment_proof", {
    p_payment_id: paymentId,
    p_proof_storage_path: path,
  });

  if (error) {
    await supabase.storage.from("payment-proofs").remove([path]);
    return failure(
      databaseMessage(error) === "PAYMENT_PROOF_ALREADY_ATTACHED"
        ? "A proof is already attached to this payment. Refresh to view it."
        : "The proof could not be attached. Refresh and try again.",
    );
  }

  revalidatePayments();
  return {
    status: "success",
    message: "Payment proof uploaded.",
    mutationId: crypto.randomUUID(),
  };
}

export async function reviewPaymentAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["director", "franchise", "manager", "sales_manager"].includes(session.profile.role)) {
    return failure("You do not have permission to review payments.");
  }

  const parsed = reviewPaymentSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  if (parsed.data.decision === "rejected" && !parsed.data.rejectionReason) {
    return failure("Add a reason before rejecting this proof.", {
      rejectionReason: "A rejection reason is required.",
    });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("review_booking_payment", {
    p_payment_id: parsed.data.paymentId,
    p_decision: parsed.data.decision,
    p_rejection_reason: parsed.data.rejectionReason ?? null,
  });

  if (error) {
    const messages: Record<string, string> = {
      PAYMENT_ALREADY_REVIEWED: "This payment has already been reviewed.",
      PERMISSION_DENIED: "You do not have permission to review this payment.",
    };
    return failure(
      messages[databaseMessage(error)] ??
        "The payment decision could not be saved. Refresh and try again.",
    );
  }

  revalidatePayments();
  return {
    status: "success",
    message: parsed.data.decision === "verified" ? "Payment verified." : "Payment proof rejected.",
    mutationId: crypto.randomUUID(),
  };
}
