import { z } from "zod";
import { getAdminClient, requireActiveActor } from "../_shared/auth.ts";
import { AppError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import { createSuperfoneProvider } from "../_shared/superfone/adapter.ts";
import { runLeadSync } from "../_shared/superfone/sync.ts";

const schema = z.object({
  cursor: z.string().trim().max(2000).nullable().optional(),
});

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const input = await parseJson(request, schema);
    const actor = await requireActiveActor(request);
    if (actor.profile.role !== "director") throw new AppError("PERMISSION_DENIED");

    return await runLeadSync(getAdminClient(), actor, createSuperfoneProvider(), {
      cursor: input.cursor ?? null,
      updatedAfter: null,
      syncType: "historical_import",
    });
  }),
);
