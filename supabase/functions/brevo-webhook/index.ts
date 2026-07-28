import { getAdminClient } from "../_shared/auth.ts";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import { withEdgeRequest } from "../_shared/http.ts";

interface WebhookEvent {
  errorSafe: string | null;
  eventType:
    | "blocked"
    | "deferred"
    | "delivered"
    | "error"
    | "hard_bounce"
    | "invalid"
    | "sent"
    | "soft_bounce"
    | "spam";
  messageId: string;
  occurredAt: string;
  providerEventId: string;
}

function constantTimeEqual(left: string, right: string): boolean {
  const maximum = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maximum; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function authenticate(request: Request): void {
  const expected = Deno.env.get("BREVO_WEBHOOK_SECRET")?.trim() ?? "";
  const url = new URL(request.url);
  const supplied =
    request.headers.get("x-brevo-webhook-secret")?.trim() ?? url.searchParams.get("token") ?? "";
  if (!expected || !supplied || !constantTimeEqual(expected, supplied)) {
    throw new AppError("BREVO_WEBHOOK_INVALID");
  }
}

function parseEvent(value: unknown): WebhookEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const providerType = typeof row.event === "string" ? row.event : "";
  const mapping: Record<string, WebhookEvent["eventType"] | undefined> = {
    blocked: "blocked",
    deferred: "deferred",
    delivered: "delivered",
    error: "error",
    hard_bounce: "hard_bounce",
    invalid_email: "invalid",
    request: "sent",
    soft_bounce: "soft_bounce",
    spam: "spam",
  };
  const eventType = mapping[providerType];
  const messageId = typeof row["message-id"] === "string" ? row["message-id"] : "";
  const timestamp =
    typeof row.ts_event === "number"
      ? row.ts_event
      : typeof row.ts === "number"
        ? row.ts
        : Math.floor(Date.now() / 1000);
  if (!eventType || !messageId) return null;

  return {
    errorSafe: typeof row.reason === "string" ? row.reason.slice(0, 500) : null,
    eventType,
    messageId,
    occurredAt: new Date(timestamp * 1000).toISOString(),
    providerEventId: `${messageId}:${providerType}:${timestamp}`,
  };
}

Deno.serve((request) =>
  withEdgeRequest(
    request,
    async () => {
      authenticate(request);
      let body: unknown;
      try {
        body = await request.json();
      } catch (error) {
        throw new AppError("INVALID_JSON", { cause: error });
      }

      const values = Array.isArray(body) ? body.slice(0, 100) : [body];
      const events = values.flatMap((value) => {
        const parsed = parseEvent(value);
        return parsed ? [parsed] : [];
      });
      const admin = getAdminClient();
      let accepted = 0;

      for (const event of events) {
        const outboxResult = await admin
          .from("email_outbox")
          .select("id,organization_id,status")
          .eq("provider_message_id", event.messageId)
          .maybeSingle();
        if (outboxResult.error) throw fromDatabaseError(outboxResult.error);
        if (!outboxResult.data) continue;

        const outbox = outboxResult.data as Record<string, unknown>;
        const id = typeof outbox.id === "string" ? outbox.id : null;
        const organizationId =
          typeof outbox.organization_id === "string" ? outbox.organization_id : null;
        const currentStatus = typeof outbox.status === "string" ? outbox.status : null;
        if (!id || !organizationId) throw new AppError("DATABASE_OPERATION_FAILED");

        const inserted = await admin.from("email_delivery_events").insert({
          email_outbox_id: id,
          error_safe: event.errorSafe,
          event_type: event.eventType,
          occurred_at: event.occurredAt,
          organization_id: organizationId,
          provider_event_id: event.providerEventId,
        });
        if (inserted.error?.code === "23505") continue;
        if (inserted.error) throw fromDatabaseError(inserted.error);

        const failureEvents = new Set([
          "blocked",
          "error",
          "hard_bounce",
          "invalid",
          "soft_bounce",
          "spam",
        ]);
        const patch =
          currentStatus === "delivered" && event.eventType !== "delivered"
            ? {}
            : event.eventType === "delivered"
              ? { delivered_at: event.occurredAt, status: "delivered" }
              : failureEvents.has(event.eventType)
                ? {
                    attempt_count: 5,
                    failed_at: event.occurredAt,
                    last_error_safe: event.errorSafe ?? "Brevo reported a delivery failure.",
                    next_attempt_at: null,
                    status: "failed",
                  }
                : event.eventType === "sent"
                  ? { sent_at: event.occurredAt, status: "sent" }
                  : {};
        const update = await admin
          .from("email_outbox")
          .update(patch)
          .eq("id", id)
          .eq("organization_id", organizationId);
        if (update.error) throw fromDatabaseError(update.error);
        accepted += 1;
      }

      return { accepted, received: events.length };
    },
    { allowedMethods: ["POST"] },
  ),
);
