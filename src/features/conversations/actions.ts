"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import type { Role } from "@/lib/constants/roles";
import { APP_ERROR_MESSAGES } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { CrudActionState } from "../core-crud/types";
import {
  conversationAssignmentSchema,
  conversationStatusSchema,
  internalNoteSchema,
  sendMessageSchema,
} from "./schemas";

const SALES_ROLES: readonly Role[] = ["director", "franchise", "manager", "sales_manager", "sales"];
const ASSIGNMENT_ROLES: readonly Role[] = ["director", "franchise", "manager", "sales_manager"];
const CONVERSATION_PATHS = [
  "/director/conversations",
  "/franchise/conversations",
  "/manager/conversations",
  "/sales-manager/conversations",
  "/sales/conversations",
] as const;

function revalidateConversations(): void {
  CONVERSATION_PATHS.forEach((path) => revalidatePath(path));
}

function input(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function success(message: string): CrudActionState {
  return { status: "success", message, mutationId: crypto.randomUUID() };
}

function failure(message: string, requestId?: string): CrudActionState {
  return {
    status: "error",
    message,
    mutationId: crypto.randomUUID(),
    ...(requestId ? { requestId } : {}),
  };
}

function validationFailure(error: z.ZodError): CrudActionState {
  const fieldErrors: Record<string, string> = {};
  error.issues.forEach((issue) => {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) fieldErrors[field] = issue.message;
  });
  return { ...failure(APP_ERROR_MESSAGES.VALIDATION_FAILED), fieldErrors };
}

function operationFailure(operation: string, error: unknown): CrudActionState {
  const requestId = crypto.randomUUID();
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
  console.error("[conversations]", { operation, requestId, code });

  if (message.includes("CONFLICT_STALE_VERSION")) {
    return failure(APP_ERROR_MESSAGES.CONFLICT_STALE_VERSION);
  }
  if (message.includes("PERMISSION_DENIED") || code === "42501") {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }
  if (
    message.includes("SUPERFONE_CAPABILITY_UNAVAILABLE") ||
    message.toLowerCase().includes("capability")
  ) {
    return failure("Superfone messaging is waiting for the official provider API configuration.");
  }
  if (
    message.includes("SUPERFONE_NOT_CONFIGURED") ||
    message.toLowerCase().includes("not configured")
  ) {
    return failure("Superfone is not connected. Ask the Director to configure the integration.");
  }
  return failure("We could not save this conversation change. Try again.", requestId);
}

async function hasRole(roles: readonly Role[]): Promise<boolean> {
  const session = await requireActiveSession();
  return roles.includes(session.profile.role);
}

export async function addInternalNoteAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  if (!(await hasRole(SALES_ROLES))) return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  const parsed = internalNoteSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("add_conversation_internal_note", {
    p_conversation_id: parsed.data.conversationId,
    p_note: parsed.data.note,
  });
  if (result.error) return operationFailure("add-note", result.error);
  revalidateConversations();
  return success("Internal note added.");
}

export async function assignConversationAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  if (!(await hasRole(ASSIGNMENT_ROLES))) return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  const parsed = conversationAssignmentSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("assign_conversation", {
    p_conversation_id: parsed.data.conversationId,
    p_assigned_sales_profile_id: parsed.data.assignedSalesProfileId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
  });
  if (result.error) return operationFailure("assign", result.error);
  revalidateConversations();
  return success("Conversation assignment updated.");
}

export async function updateConversationStatusAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  if (!(await hasRole(SALES_ROLES))) return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  const parsed = conversationStatusSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("set_conversation_status", {
    p_conversation_id: parsed.data.conversationId,
    p_expected_version: parsed.data.expectedVersion,
    p_status: parsed.data.status,
  });
  if (result.error) return operationFailure("status", result.error);
  revalidateConversations();
  return success(`Conversation marked ${parsed.data.status}.`);
}

export async function sendSuperfoneMessageAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  if (!(await hasRole(SALES_ROLES))) return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  const parsed = sendMessageSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.functions.invoke("superfone-send-message", {
    body: {
      body: parsed.data.body,
      conversationId: parsed.data.conversationId,
      idempotencyKey: parsed.data.idempotencyKey,
      retryOfMessageId: parsed.data.retryOfMessageId,
    },
  });
  if (result.error) return operationFailure("send-message", result.error);

  const response = result.data as unknown;
  if (
    typeof response === "object" &&
    response !== null &&
    "ok" in response &&
    response.ok === false
  ) {
    return operationFailure("send-message", response);
  }

  revalidateConversations();
  return success("Message queued with Superfone.");
}
