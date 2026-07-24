import { z } from "zod";
import { requireActiveActor } from "../_shared/auth.ts";
import { AppError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import {
  createSuperfoneProvider,
  requireSuperfoneCapability,
} from "../_shared/superfone/adapter.ts";

const schema = z.object({
  conversationId: z.string().uuid(),
  attachmentStoragePath: z.string().trim().min(20).max(1000),
  caption: z.string().trim().max(2000).nullable().optional(),
  idempotencyKey: z.string().uuid(),
});

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const input = await parseJson(request, schema);
    const actor = await requireActiveActor(request);
    if (!["director", "manager", "sales_manager", "sales"].includes(actor.profile.role)) {
      throw new AppError("PERMISSION_DENIED");
    }

    const expectedPrefix = `${actor.profile.organization_id}/${input.conversationId}/${actor.profile.id}/`;
    if (!input.attachmentStoragePath.startsWith(expectedPrefix)) {
      throw new AppError("PERMISSION_DENIED");
    }

    const provider = createSuperfoneProvider();
    requireSuperfoneCapability(provider, "sendMedia");

    // The official media endpoint and request contract have not been supplied.
    // Reaching this point requires that the future official adapter explicitly
    // enables sendMedia and replaces this typed boundary.
    throw new AppError("SUPERFONE_CAPABILITY_UNAVAILABLE");
  }),
);
