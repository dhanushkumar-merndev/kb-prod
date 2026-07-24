import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, toAppError } from "../errors.ts";
import type { ActorContext } from "../types.ts";
import { requireSuperfoneCapability } from "./adapter.ts";
import { mergeProviderLead } from "./operations.ts";
import type { LeadPage, SuperfoneProvider } from "./types.ts";

interface SyncInput {
  cursor: string | null;
  updatedAfter: string | null;
  syncType: "historical_import" | "incremental";
}

interface SyncResult {
  runId: string;
  status: string;
  cursor: string | null;
  fetched: number;
  inserted: number;
  updated: number;
  duplicates: number;
  failed: number;
}

function idFrom(data: unknown): string {
  if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "string") {
    throw new AppError("DATABASE_OPERATION_FAILED");
  }
  return data.id;
}

async function fetchLeadPageWithRetry(
  provider: SuperfoneProvider,
  input: { cursor?: string; updatedAfter?: string },
): Promise<LeadPage> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await provider.fetchLeads(input);
    } catch (error) {
      const retryable =
        error instanceof AppError &&
        (error.code === "SUPERFONE_RATE_LIMITED" || error.code === "SUPERFONE_PROVIDER_FAILED");
      if (!retryable || attempt === 3) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }

  throw new AppError("SUPERFONE_PROVIDER_FAILED");
}

export async function runLeadSync(
  admin: SupabaseClient,
  actor: ActorContext,
  provider: SuperfoneProvider,
  input: SyncInput,
): Promise<SyncResult> {
  requireSuperfoneCapability(provider, "fetchLeads");

  const run = await admin
    .from("integration_sync_runs")
    .insert({
      organization_id: actor.profile.organization_id,
      provider: "superfone",
      sync_type: input.syncType,
      status: "running",
      cursor_before: input.cursor,
      cursor_after: input.cursor,
      started_by_profile_id: actor.profile.id,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (run.error) throw new AppError("DATABASE_OPERATION_FAILED", { cause: run.error });
  const runId = idFrom(run.data);

  let cursor = input.cursor;
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let duplicates = 0;
  let failed = 0;
  let pages = 0;
  let moreRemaining = false;

  try {
    while (pages < 100) {
      const page = await fetchLeadPageWithRetry(provider, {
        ...(cursor ? { cursor } : {}),
        ...(input.updatedAfter ? { updatedAfter: input.updatedAfter } : {}),
      });
      pages += 1;
      moreRemaining = page.hasMore;
      fetched += page.items.length;

      for (const [itemIndex, lead] of page.items.entries()) {
        try {
          const result = await mergeProviderLead(admin, actor.profile.organization_id, lead);
          if (result.inserted) inserted += 1;
          if (result.updated) updated += 1;
          if (result.duplicate) duplicates += 1;
        } catch (error) {
          failed += 1;
          await admin.from("integration_events").insert({
            organization_id: actor.profile.organization_id,
            provider: "superfone",
            provider_event_id: `sync:${runId}:${pages}:${itemIndex}`,
            event_type: "lead_import_failed",
            payload: {
              providerLeadId: lead.providerLeadId,
              phoneE164: lead.phoneE164,
            },
            status: "failed",
            attempt_count: 1,
            processed_at: new Date().toISOString(),
            last_error_safe: toAppError(error).message,
          });
        }
      }

      cursor = page.nextCursor;
      await admin
        .from("integration_sync_runs")
        .update({
          cursor_after: cursor,
          fetched_count: fetched,
          inserted_count: inserted,
          updated_count: updated,
          duplicate_count: duplicates,
          failed_count: failed,
        })
        .eq("id", runId)
        .eq("organization_id", actor.profile.organization_id);

      if (!page.hasMore || !cursor) {
        moreRemaining = false;
        break;
      }
    }

    const status = failed > 0 || moreRemaining ? "partially_completed" : "completed";
    await admin
      .from("integration_sync_runs")
      .update({
        status,
        cursor_after: cursor,
        fetched_count: fetched,
        inserted_count: inserted,
        updated_count: updated,
        duplicate_count: duplicates,
        failed_count: failed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("organization_id", actor.profile.organization_id);

    return { runId, status, cursor, fetched, inserted, updated, duplicates, failed };
  } catch (error) {
    const appError = toAppError(error);
    await admin
      .from("integration_sync_runs")
      .update({
        status: "failed",
        cursor_after: cursor,
        fetched_count: fetched,
        inserted_count: inserted,
        updated_count: updated,
        duplicate_count: duplicates,
        failed_count: failed,
        completed_at: new Date().toISOString(),
        error_summary_safe: appError.message,
      })
      .eq("id", runId)
      .eq("organization_id", actor.profile.organization_id);
    throw error;
  }
}
