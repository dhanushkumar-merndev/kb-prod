"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import type { Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { SalesComplianceActionState } from "./types";

const REVIEW_ROLES: readonly Role[] = ["director", "franchise", "manager", "sales_manager"];
const reviewSchema = z.object({
  salesProfileId: z.string().uuid(),
  scoreDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  managerScore: z.coerce.number().int().min(0).max(5),
  remarks: z.string().trim().min(3, "Enter a useful review remark.").max(1000),
});

function state(
  status: "error" | "success",
  message: string,
  fieldErrors?: Record<string, string>,
): SalesComplianceActionState {
  return { status, message, mutationId: crypto.randomUUID(), ...(fieldErrors ? { fieldErrors } : {}) };
}

export async function reviewSalesComplianceAction(
  _previous: SalesComplianceActionState,
  formData: FormData,
): Promise<SalesComplianceActionState> {
  const session = await requireActiveSession();
  if (!REVIEW_ROLES.includes(session.profile.role)) {
    return state("error", "You do not have permission to review sales performance.");
  }

  const parsed = reviewSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return state("error", "Check the highlighted fields.", fieldErrors);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("review_daily_sales_compliance", {
    p_manager_score: parsed.data.managerScore,
    p_remarks: parsed.data.remarks,
    p_sales_profile_id: parsed.data.salesProfileId,
    p_score_date: parsed.data.scoreDate,
  });

  if (result.error) {
    const requestId = crypto.randomUUID();
    console.error("[sales-performance]", {
      operation: "review",
      requestId,
      code: result.error.code,
    });
    return {
      ...state("error", "The review could not be saved. Refresh the page and try again."),
      requestId,
    };
  }

  ["/director/reports", "/franchise/reports", "/sales-manager/performance", "/sales/performance"].forEach(
    (path) => revalidatePath(path),
  );
  return state("success", "Daily sales review saved.");
}
