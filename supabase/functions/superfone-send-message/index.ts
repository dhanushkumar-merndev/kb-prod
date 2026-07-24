import { z } from "zod";
import { getAdminClient, requireActiveActor } from "../_shared/auth.ts";
import { AppError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import { createSuperfoneProvider } from "../_shared/superfone/adapter.ts";
import { sendOutboundMessage } from "../_shared/superfone/outbound.ts";

const schema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
  idempotencyKey: z.string().uuid(),
  retryOfMessageId: z.string().uuid().nullable().optional(),
});

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const input = await parseJson(request, schema);
    const actor = await requireActiveActor(request);
    if (!["director", "manager", "sales_manager", "sales"].includes(actor.profile.role)) {
      throw new AppError("PERMISSION_DENIED");
    }

    const admin = getAdminClient();
    const recent = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", actor.profile.organization_id)
      .eq("sender_profile_id", actor.profile.id)
      .eq("direction", "outbound")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if (recent.error) throw new AppError("DATABASE_OPERATION_FAILED", { cause: recent.error });
    if ((recent.count ?? 0) >= 30) throw new AppError("SUPERFONE_RATE_LIMITED");

    return await sendOutboundMessage(admin, actor, createSuperfoneProvider(), {
      conversationId: input.conversationId,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      retryOfMessageId: input.retryOfMessageId ?? null,
    });
  }),
);
