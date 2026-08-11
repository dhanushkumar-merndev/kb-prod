import "server-only";

import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import type { Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { SalesComplianceLoadState } from "./types";

const SALES_ROLES: readonly Role[] = ["director", "franchise", "manager", "sales_manager", "sales"];

const rowSchema = z.object({
  sales_profile_id: z.string().uuid(),
  full_name: z.string(),
  assigned_leads: z.coerce.number().int().nonnegative(),
  lead_stage_score: z.coerce.number().int().min(0).max(20),
  tags_score: z.coerce.number().int().min(0).max(15),
  customer_details_score: z.coerce.number().int().min(0).max(15),
  call_logs_score: z.coerce.number().int().min(0).max(20),
  follow_up_score: z.coerce.number().int().min(0).max(10),
  communication_score: z.coerce.number().int().min(0).max(5),
  response_sla_score: z.coerce.number().int().min(0).max(10),
  manager_score: z.coerce.number().int().min(0).max(5),
  manager_remarks: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  total_score: z.coerce.number().int().min(0).max(100),
  rank: z.coerce.number().int().positive(),
});

const responseSchema = z.object({
  score_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  can_review: z.boolean(),
  rows: z.array(rowSchema),
});

function failure(operation: string, error: unknown): SalesComplianceLoadState {
  const requestId = crypto.randomUUID();
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
  console.error("[sales-performance]", { operation, requestId, code });
  return {
    ok: false,
    message: "We could not load the daily sales ranking. Refresh the page and try again.",
    requestId,
  };
}

export async function loadSalesComplianceData(): Promise<SalesComplianceLoadState> {
  const session = await requireActiveSession();
  if (!SALES_ROLES.includes(session.profile.role)) {
    return {
      ok: false,
      message: "You do not have permission to view sales performance.",
      requestId: crypto.randomUUID(),
    };
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("get_daily_sales_compliance", {});
  if (result.error) return failure("load", result.error);

  try {
    const parsed = responseSchema.parse(result.data);
    return {
      ok: true,
      data: {
        scoreDate: parsed.score_date,
        canReview: parsed.can_review,
        rows: parsed.rows.map((row) => ({
          salesProfileId: row.sales_profile_id,
          fullName: row.full_name,
          assignedLeads: row.assigned_leads,
          leadStageScore: row.lead_stage_score,
          tagsScore: row.tags_score,
          customerDetailsScore: row.customer_details_score,
          callLogsScore: row.call_logs_score,
          followUpScore: row.follow_up_score,
          communicationScore: row.communication_score,
          responseSlaScore: row.response_sla_score,
          managerScore: row.manager_score,
          managerRemarks: row.manager_remarks,
          reviewedAt: row.reviewed_at,
          totalScore: row.total_score,
          rank: row.rank,
        })),
      },
    };
  } catch (error) {
    return failure("parse", error);
  }
}
