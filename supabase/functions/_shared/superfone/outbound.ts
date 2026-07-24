import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, fromDatabaseError, toAppError } from "../errors.ts";
import type { ActorContext } from "../types.ts";
import { requireSuperfoneCapability } from "./adapter.ts";
import type { SuperfoneProvider } from "./types.ts";

interface OutboundMessageInput {
  conversationId: string;
  body: string;
  idempotencyKey: string;
  retryOfMessageId: string | null;
}

interface OutboundMessageResult {
  duplicate: boolean;
  messageId: string;
  providerMessageId: string | null;
  status: string;
}

function valueAsString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new AppError("DATABASE_OPERATION_FAILED");
  return value;
}

function valueAsNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new AppError("DATABASE_OPERATION_FAILED");
  return value;
}

export async function sendOutboundMessage(
  admin: SupabaseClient,
  actor: ActorContext,
  provider: SuperfoneProvider,
  input: OutboundMessageInput,
): Promise<OutboundMessageResult> {
  requireSuperfoneCapability(provider, "sendMessage");
  if (!provider.sendMessage) throw new AppError("SUPERFONE_CAPABILITY_UNAVAILABLE");

  const existing = await admin
    .from("messages")
    .select("id,provider_message_id,status,conversation_id,sender_profile_id")
    .eq("organization_id", actor.profile.organization_id)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw fromDatabaseError(existing.error);
  if (existing.data) {
    const row = existing.data as Record<string, unknown>;
    if (
      row.conversation_id !== input.conversationId ||
      row.sender_profile_id !== actor.profile.id
    ) {
      throw new AppError("PERMISSION_DENIED");
    }
    return {
      duplicate: true,
      messageId: valueAsString(row, "id"),
      providerMessageId: valueAsNullableString(row, "provider_message_id"),
      status: valueAsString(row, "status"),
    };
  }

  const conversationResult = await admin
    .from("conversations")
    .select(
      "id,organization_id,lead_id,provider_conversation_id,contact_phone_e164,channel,assigned_sales_profile_id",
    )
    .eq("id", input.conversationId)
    .eq("organization_id", actor.profile.organization_id)
    .single();
  if (conversationResult.error || !conversationResult.data) {
    throw fromDatabaseError(conversationResult.error);
  }
  const conversation = conversationResult.data as Record<string, unknown>;

  if (
    actor.profile.role === "sales" &&
    conversation.assigned_sales_profile_id !== actor.profile.id
  ) {
    throw new AppError("PERMISSION_DENIED");
  }
  if (
    actor.profile.role !== "sales" &&
    !["director", "manager", "sales_manager"].includes(actor.profile.role)
  ) {
    throw new AppError("PERMISSION_DENIED");
  }

  const providerConversationId = valueAsNullableString(conversation, "provider_conversation_id");
  if (!providerConversationId) {
    throw new AppError("SUPERFONE_CAPABILITY_UNAVAILABLE", {
      message: "This conversation is not linked to a Superfone conversation.",
    });
  }
  const phone = valueAsString(conversation, "contact_phone_e164");
  const leadId = valueAsString(conversation, "lead_id");
  const channel = valueAsString(conversation, "channel");

  if (input.retryOfMessageId) {
    const retryMessage = await admin
      .from("messages")
      .select("id")
      .eq("id", input.retryOfMessageId)
      .eq("organization_id", actor.profile.organization_id)
      .eq("conversation_id", input.conversationId)
      .eq("direction", "outbound")
      .eq("status", "failed")
      .maybeSingle();
    if (retryMessage.error) throw fromDatabaseError(retryMessage.error);
    if (!retryMessage.data) throw new AppError("VALIDATION_FAILED");
  }

  const queued = await admin
    .from("messages")
    .insert({
      organization_id: actor.profile.organization_id,
      conversation_id: input.conversationId,
      lead_id: leadId,
      provider: "superfone",
      direction: "outbound",
      channel,
      message_type: "text",
      body: input.body,
      sender_profile_id: actor.profile.id,
      recipient_phone_e164: phone,
      status: "queued",
      reply_to_message_id: input.retryOfMessageId,
      idempotency_key: input.idempotencyKey,
    })
    .select("id")
    .single();
  if (queued.error) throw fromDatabaseError(queued.error);
  const messageId = valueAsString(queued.data as Record<string, unknown>, "id");

  const audit = await admin.rpc("write_audit_log", {
    p_organization_id: actor.profile.organization_id,
    p_actor_profile_id: actor.profile.id,
    p_action: "message.queued",
    p_entity_type: "message",
    p_entity_id: messageId,
    p_before_data: null,
    p_after_data: {
      conversation_id: input.conversationId,
      direction: "outbound",
      status: "queued",
    },
    p_reason: input.retryOfMessageId ? "Retry failed outbound message" : null,
    p_request_id: null,
  });
  if (audit.error) throw fromDatabaseError(audit.error);

  const attempt = await admin.from("message_attempts").insert({
    organization_id: actor.profile.organization_id,
    message_id: messageId,
    attempt_number: 1,
    started_at: new Date().toISOString(),
  });
  if (attempt.error) throw fromDatabaseError(attempt.error);

  try {
    const sent = await provider.sendMessage({
      conversationExternalId: providerConversationId,
      recipientPhoneE164: phone,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
    });
    const updated = await admin
      .from("messages")
      .update({
        provider_message_id: sent.providerMessageId,
        status: sent.status,
        sent_at: sent.status === "sent" ? sent.acceptedAt : null,
      })
      .eq("id", messageId)
      .eq("organization_id", actor.profile.organization_id);
    if (updated.error) throw fromDatabaseError(updated.error);

    const completedAttempt = await admin
      .from("message_attempts")
      .update({
        provider_response_safe: sent.providerResponseSafe,
        completed_at: new Date().toISOString(),
      })
      .eq("message_id", messageId)
      .eq("attempt_number", 1);
    if (completedAttempt.error) throw fromDatabaseError(completedAttempt.error);

    const conversationUpdate = await admin
      .from("conversations")
      .update({
        last_message_at: sent.acceptedAt,
        last_message_preview: input.body.slice(0, 180),
        last_outbound_at: sent.acceptedAt,
      })
      .eq("id", input.conversationId)
      .eq("organization_id", actor.profile.organization_id);
    if (conversationUpdate.error) throw fromDatabaseError(conversationUpdate.error);

    return {
      duplicate: false,
      messageId,
      providerMessageId: sent.providerMessageId,
      status: sent.status,
    };
  } catch (error) {
    const appError = toAppError(error);
    const failedMessage = await admin
      .from("messages")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_code: appError.code,
        failure_message_safe: appError.message,
      })
      .eq("id", messageId)
      .eq("organization_id", actor.profile.organization_id);
    const failedAttempt = await admin
      .from("message_attempts")
      .update({
        completed_at: new Date().toISOString(),
      })
      .eq("message_id", messageId)
      .eq("attempt_number", 1);
    if (failedMessage.error || failedAttempt.error) {
      console.error(
        JSON.stringify({
          code: "OUTBOUND_FAILURE_PERSISTENCE_FAILED",
          messageId,
        }),
      );
    }
    throw error;
  }
}
