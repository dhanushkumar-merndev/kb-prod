"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { CREATABLE_ROLES } from "./permissions";

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(10).max(32),
  password: z.string().min(8).max(128),
  role: z.enum(["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"]),
  joiningDate: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value)),
  paymentType: z.enum(["monthly", "daily", "hourly", "per_booking"]).optional(),
  paymentAmount: z.coerce.number().nonnegative().optional(),
});

const statusSchema = z.object({
  targetProfileId: z.string().uuid(),
  accountStatus: z.enum(["active", "inactive", "blocked", "payment_pending", "left_organization"]),
  reason: z.string().trim().min(3).max(500),
});

function actionState(status: "success" | "error", message: string): CrudActionState {
  return {
    status,
    message,
    mutationId: crypto.randomUUID(),
  };
}

async function edgeMessage(data: unknown, error?: unknown): Promise<string | null> {
  const messageFromPayload = (payload: unknown): string | null => {
    if (typeof payload !== "object" || payload === null) {
      return null;
    }

    const payloadError = (payload as Record<string, unknown>).error;
    if (typeof payloadError !== "object" || payloadError === null) {
      return null;
    }

    const message = (payloadError as Record<string, unknown>).message;
    return typeof message === "string" ? message : null;
  };

  const directMessage = messageFromPayload(data);
  if (directMessage) {
    return directMessage;
  }

  // Supabase Functions returns non-2xx responses through an error whose
  // response body is stored in `context`, rather than in `data`.
  if (typeof error === "object" && error !== null && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        return messageFromPayload(await context.clone().json());
      } catch {
        return null;
      }
    }
  }

  return null;
}

function revalidateTeam(): void {
  [
    "/director/team",
    "/director/sales-team",
    "/director/workforce",
    "/manager/team",
    "/manager/workforce",
    "/hr/chefs",
    "/hr/employee-records",
    "/sales-manager/team",
  ].forEach((path) => revalidatePath(path));
}

export async function createTeamMemberAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const raw = Object.fromEntries(formData.entries());
  const parsed = createSchema.safeParse({
    ...raw,
    paymentType: raw.paymentType || undefined,
    paymentAmount: raw.paymentAmount || undefined,
  });

  if (!parsed.success) {
    return actionState("error", "Check the team member details and try again.");
  }

  if (!CREATABLE_ROLES[session.profile.role].includes(parsed.data.role)) {
    return actionState("error", "You do not have permission to create this role.");
  }

  const isWorkforce = ["chef", "part_time_chef"].includes(parsed.data.role);
  if (isWorkforce && (!parsed.data.paymentType || parsed.data.paymentAmount === undefined)) {
    return actionState("error", "Payment type and amount are required for Chef accounts.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.functions.invoke("create-team-member", {
    body: {
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      password: parsed.data.password,
      role: parsed.data.role,
      accountStatus: "active",
      ...(parsed.data.joiningDate ? { joiningDate: parsed.data.joiningDate } : {}),
      ...(parsed.data.paymentType ? { paymentType: parsed.data.paymentType } : {}),
      ...(parsed.data.paymentAmount !== undefined
        ? { paymentAmount: parsed.data.paymentAmount }
        : {}),
    },
  });

  if (error) {
    return actionState(
      "error",
      (await edgeMessage(data, error)) ?? "The team member could not be created. Try again.",
    );
  }

  revalidateTeam();
  return actionState(
    "success",
    parsed.data.role === "part_time_chef"
      ? "Part-time Chef created. Activation may require payment proof."
      : "Team member created.",
  );
}

export async function updateTeamMemberStatusAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success || parsed.data.targetProfileId === session.profile.id) {
    return actionState("error", "Check the account status change and reason.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.functions.invoke("update-account-status", {
    body: parsed.data,
  });

  if (error) {
    return actionState(
      "error",
      (await edgeMessage(data, error)) ?? "The account status could not be changed. Try again.",
    );
  }

  revalidateTeam();
  return actionState("success", "Account status updated and active sessions closed.");
}
