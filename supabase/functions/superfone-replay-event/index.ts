import { z } from "zod";
import { getAdminClient, requireActiveActor } from "../_shared/auth.ts";
import { AppError, fromDatabaseError, toAppError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import { createSuperfoneProvider } from "../_shared/superfone/adapter.ts";
import { applyVerifiedProviderEvent } from "../_shared/superfone/operations.ts";
import { safeProviderPayload } from "../_shared/superfone/mapper.ts";

const schema = z.object({
  integrationEventId: z.string().uuid(),
});

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const input = await parseJson(request, schema);
    const actor = await requireActiveActor(request);
    if (actor.profile.role !== "director") throw new AppError("PERMISSION_DENIED");

    const admin = getAdminClient();
    const stored = await admin
      .from("integration_events")
      .select("id,organization_id,payload,attempt_count")
      .eq("id", input.integrationEventId)
      .eq("organization_id", actor.profile.organization_id)
      .eq("provider", "superfone")
      .single();
    if (stored.error || !stored.data) throw fromDatabaseError(stored.error);

    const row = stored.data as Record<string, unknown>;
    const provider = createSuperfoneProvider();
    if (!provider.mapStoredEvent) throw new AppError("SUPERFONE_CAPABILITY_UNAVAILABLE");
    const verified = await provider.mapStoredEvent(safeProviderPayload(row.payload));
    const attemptCount =
      typeof row.attempt_count === "number" ? Math.max(0, row.attempt_count) + 1 : 1;

    await admin
      .from("integration_events")
      .update({ status: "processing", attempt_count: attemptCount })
      .eq("id", input.integrationEventId)
      .eq("organization_id", actor.profile.organization_id);

    try {
      const entity = await applyVerifiedProviderEvent(
        admin,
        actor.profile.organization_id,
        verified,
      );
      await admin
        .from("integration_events")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          last_error_safe: null,
        })
        .eq("id", input.integrationEventId)
        .eq("organization_id", actor.profile.organization_id);
      return { replayed: true, entity };
    } catch (error) {
      await admin
        .from("integration_events")
        .update({
          status: "failed",
          processed_at: new Date().toISOString(),
          last_error_safe: toAppError(error).message,
        })
        .eq("id", input.integrationEventId)
        .eq("organization_id", actor.profile.organization_id);
      throw error;
    }
  }),
);
