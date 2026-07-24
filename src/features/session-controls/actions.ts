"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { SessionControlActionState } from "./types";

const BREAK_ELIGIBLE_ROLES = ["sales", "chef", "part_time_chef"] as const;

const startSchema = z.object({
  breakType: z.enum(["lunch", "break", "superfone"]),
});

const endSchema = z.object({
  breakSessionId: z.string().uuid(),
});

function state(
  status: "success" | "error",
  message: string,
): SessionControlActionState {
  return {
    status,
    message,
    mutationId: crypto.randomUUID(),
  };
}

function safeFailure(error: unknown): SessionControlActionState {
  const code =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "UNKNOWN";
  const messages: Record<string, string> = {
    BREAK_ALREADY_OPEN: "End your current break before starting another.",
    BREAK_ALREADY_ENDED: "This break has already ended.",
    PERMISSION_DENIED: "You do not have permission to change this break.",
    AUTH_REQUIRED: "Your session has expired. Log in again.",
  };

  return state(
    "error",
    messages[code] ?? "The break could not be updated. Refresh and try again.",
  );
}

export async function startBreakAction(
  _previousState: SessionControlActionState,
  formData: FormData,
): Promise<SessionControlActionState> {
  const session = await requireActiveSession();
  if (!BREAK_ELIGIBLE_ROLES.some((role) => role === session.profile.role)) {
    return state("error", "Break tracking is not available for your role.");
  }
  const parsed = startSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", "Choose a valid break type.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("start_break_session", {
    p_break_type: parsed.data.breakType,
  });

  if (error) {
    return safeFailure(error);
  }

  revalidatePath("/", "layout");
  return state("success", "Break started.");
}

export async function endBreakAction(
  _previousState: SessionControlActionState,
  formData: FormData,
): Promise<SessionControlActionState> {
  const session = await requireActiveSession();
  if (!BREAK_ELIGIBLE_ROLES.some((role) => role === session.profile.role)) {
    return state("error", "Break tracking is not available for your role.");
  }
  const parsed = endSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", "The active break could not be identified.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("end_break_session", {
    p_break_session_id: parsed.data.breakSessionId,
  });

  if (error) {
    return safeFailure(error);
  }

  revalidatePath("/", "layout");
  return state("success", "Break ended.");
}
