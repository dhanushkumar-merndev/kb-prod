import "server-only";

import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import type { Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  CALL_DIRECTIONS,
  FOLLOW_UP_STATUSES,
  type FollowUpRecord,
  type SalesCallRecord,
  type SalesLeadSummary,
  type SalesOperationsLoadState,
  type SalesProfileOption,
} from "./types";

const SALES_ROLES: readonly Role[] = ["director", "manager", "sales_manager", "sales"];

const leadSchema = z.object({
  id: z.string().uuid(),
  client_name: z.string(),
  phone_e164: z.string(),
  status: z.string(),
  assigned_sales_profile_id: z.string().uuid().nullable(),
  version: z.number().int().positive(),
});

const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
});

const followUpSchema = z.object({
  id: z.string().uuid(),
  lead_id: z.string().uuid(),
  assigned_profile_id: z.string().uuid(),
  due_at: z.string(),
  status: z.enum(FOLLOW_UP_STATUSES),
  outcome: z.string().nullable(),
  completed_at: z.string().nullable(),
  updated_at: z.string(),
});

const callSchema = z.object({
  id: z.string().uuid(),
  lead_id: z.string().uuid(),
  direction: z.enum(CALL_DIRECTIONS),
  status: z.string(),
  started_at: z.string(),
  duration_seconds: z.number().int().nullable(),
  agent_profile_id: z.string().uuid().nullable(),
});

const salesOperationsSnapshotSchema = z.object({
  leads: z.array(leadSchema),
  sales_profiles: z.array(profileSchema),
  follow_ups: z.array(followUpSchema),
  calls: z.array(callSchema),
});

function failure(operation: string, error: unknown): SalesOperationsLoadState {
  const requestId = crypto.randomUUID();
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
  console.error("[sales-operations]", { operation, requestId, code });
  return {
    ok: false,
    message: "We could not load sales operations. Refresh the page and try again.",
    requestId,
  };
}

export async function loadSalesOperationsData(): Promise<SalesOperationsLoadState> {
  const session = await requireActiveSession();

  if (!SALES_ROLES.includes(session.profile.role)) {
    return {
      ok: false,
      message: "You do not have permission to view sales operations.",
      requestId: crypto.randomUUID(),
    };
  }

  const supabase = await createServerSupabaseClient();
  const snapshotResult = await supabase.rpc("get_sales_operations_snapshot");

  if (snapshotResult.error) {
    return failure("load", snapshotResult.error);
  }

  try {
    const snapshot = salesOperationsSnapshotSchema.parse(snapshotResult.data);
    const leads: SalesLeadSummary[] = snapshot.leads.map((row) => ({
      id: row.id,
      clientName: row.client_name,
      phoneE164: row.phone_e164,
      status: row.status,
      assignedSalesProfileId: row.assigned_sales_profile_id,
      version: row.version,
    }));
    const salesProfiles: SalesProfileOption[] = snapshot.sales_profiles.map((row) => ({
      id: row.id,
      fullName: row.full_name,
    }));
    const followUps: FollowUpRecord[] = snapshot.follow_ups.map((row) => ({
      id: row.id,
      leadId: row.lead_id,
      assignedProfileId: row.assigned_profile_id,
      dueAt: row.due_at,
      status: row.status,
      outcome: row.outcome,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
      isOverdue:
        (row.status === "open" || row.status === "overdue") &&
        new Date(row.due_at).getTime() < Date.now(),
    }));
    const calls: SalesCallRecord[] = snapshot.calls.map((row) => ({
      id: row.id,
      leadId: row.lead_id,
      direction: row.direction,
      status: row.status,
      startedAt: row.started_at,
      durationSeconds: row.duration_seconds,
      agentProfileId: row.agent_profile_id,
    }));

    return {
      ok: true,
      data: {
        viewerId: session.userId,
        viewerRole: session.profile.role,
        organizationId: session.profile.organization_id,
        leads,
        salesProfiles,
        followUps,
        calls,
      },
    };
  } catch (error) {
    return failure("parse", error);
  }
}
