"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { normalizeIndianPhone } from "@/lib/auth/phone";
import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, "Use 2-16 letters, digits, hyphen or underscore."),
  city: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  contactPhone: z
    .string()
    .trim()
    .max(32)
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
});

const updateSchema = z.object({
  franchiseId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().max(120),
  contactPhone: z.string().trim().max(32),
  notes: z.string().trim().max(2000),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
  reason: z.string().trim().min(3).max(500),
});

function actionState(
  status: "success" | "error",
  message: string,
  requestId?: string,
): CrudActionState {
  return { status, message, mutationId: crypto.randomUUID(), ...(requestId ? { requestId } : {}) };
}

function logFranchiseAction(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console[level]("[franchises]", { event, ...details });
}

const DATABASE_MESSAGES: Record<string, string> = {
  DUPLICATE_FRANCHISE: "A franchise with that name or code already exists.",
  FRANCHISE_NOT_FOUND: "That franchise no longer exists.",
  FRANCHISE_HAS_ACTIVE_STAFF:
    "Deactivate or move the franchise's staff accounts before closing the franchise.",
  PERMISSION_DENIED: "Only the Director can manage franchises.",
  VALIDATION_FAILED: "Check the franchise details and try again.",
};

function friendlyMessage(error: { message?: string } | null, fallback: string): string {
  const raw = error?.message ?? "";
  for (const [code, message] of Object.entries(DATABASE_MESSAGES)) {
    if (raw.includes(code)) {
      return message;
    }
  }
  return fallback;
}

function normalizeOptionalContactPhone(value: string | undefined): string | null {
  return value ? normalizeIndianPhone(value) : null;
}

function revalidateFranchises(): void {
  ["/director/franchises", "/director/team", "/director/dashboard"].forEach((path) =>
    revalidatePath(path),
  );
}

export async function createFranchiseAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const requestId = crypto.randomUUID();
  const session = await requireActiveSession();

  if (session.profile.role !== "director") {
    logFranchiseAction("warn", "create.denied", {
      requestId,
      actorRole: session.profile.role,
    });
    return actionState("error", "Only the Director can create a franchise.", requestId);
  }

  const raw = Object.fromEntries(formData.entries());
  logFranchiseAction("info", "create.received", {
    requestId,
    actorRole: session.profile.role,
    fields: Object.keys(raw).sort(),
    hasName: typeof raw.name === "string" && raw.name.trim().length > 0,
    hasCode: typeof raw.code === "string" && raw.code.trim().length > 0,
  });

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    logFranchiseAction("warn", "create.validation_failed", {
      requestId,
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return actionState(
      "error",
      parsed.error.issues[0]?.message ?? "Check the franchise details and try again.",
      requestId,
    );
  }

  let contactPhone: string | null;
  try {
    contactPhone = normalizeOptionalContactPhone(parsed.data.contactPhone);
  } catch {
    return actionState(
      "error",
      "Enter a valid contact number, for example 98765 43210 or +91 98765 43210.",
      requestId,
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("create_franchise", {
    p_name: parsed.data.name,
    p_code: parsed.data.code,
    p_city: parsed.data.city ?? null,
    p_contact_phone_e164: contactPhone,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    logFranchiseAction("error", "create.rpc_failed", {
      requestId,
      code: error.code ?? null,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
    return actionState("error", friendlyMessage(error, "The franchise could not be created."), requestId);
  }

  revalidateFranchises();
  logFranchiseAction("info", "create.succeeded", { requestId });
  return actionState(
    "success",
    `Franchise ${parsed.data.name} created. Add its Franchise Owner from Team & Access.`,
    requestId,
  );
}

export async function updateFranchiseAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (session.profile.role !== "director") {
    return actionState("error", "Only the Director can update a franchise.");
  }

  const parsed = updateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return actionState("error", "Check the franchise details and reason, then try again.");
  }

  let contactPhone: string | null;
  try {
    contactPhone = normalizeOptionalContactPhone(parsed.data.contactPhone || undefined);
  } catch {
    return actionState(
      "error",
      "Enter a valid contact number, for example 98765 43210 or +91 98765 43210.",
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("update_franchise", {
    p_franchise_id: parsed.data.franchiseId,
    p_name: parsed.data.name,
    p_city: parsed.data.city,
    p_contact_phone_e164: contactPhone,
    p_notes: parsed.data.notes,
    p_is_active: parsed.data.isActive,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return actionState("error", friendlyMessage(error, "The franchise could not be updated."));
  }

  revalidateFranchises();
  return actionState("success", "Franchise updated.");
}
