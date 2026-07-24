import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, fromDatabaseError } from "../errors.ts";
import type {
  NormalizedConversation,
  NormalizedLead,
  NormalizedMessage,
  NormalizedProviderEvent,
  VerifiedProviderEvent,
} from "./types.ts";

interface EntityResult {
  entityId: string;
  entityType: "lead" | "conversation" | "message" | "superfone_call";
}

function rowId(data: unknown): string {
  if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "string") {
    throw new AppError("DATABASE_OPERATION_FAILED");
  }
  return data.id;
}

async function findLead(
  admin: SupabaseClient,
  organizationId: string,
  providerLeadId: string | null,
  phoneE164: string,
): Promise<Record<string, unknown> | null> {
  if (providerLeadId) {
    const providerMatch = await admin
      .from("leads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("provider", "superfone")
      .eq("provider_lead_id", providerLeadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (providerMatch.error) throw fromDatabaseError(providerMatch.error);
    if (providerMatch.data) return providerMatch.data as Record<string, unknown>;
  }

  const phoneMatch = await admin
    .from("leads")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("phone_normalized", phoneE164)
    .is("deleted_at", null)
    .maybeSingle();
  if (phoneMatch.error) throw fromDatabaseError(phoneMatch.error);
  return phoneMatch.data ? (phoneMatch.data as Record<string, unknown>) : null;
}

export async function mergeProviderLead(
  admin: SupabaseClient,
  organizationId: string,
  lead: NormalizedLead,
): Promise<{ duplicate: boolean; inserted: boolean; leadId: string; updated: boolean }> {
  const existing = await findLead(admin, organizationId, lead.providerLeadId, lead.phoneE164);

  if (!existing) {
    const inserted = await admin
      .from("leads")
      .insert({
        organization_id: organizationId,
        provider: "superfone",
        provider_lead_id: lead.providerLeadId,
        source: lead.source,
        campaign_name: lead.campaignName,
        client_name: lead.clientName,
        phone_e164: lead.phoneE164,
        phone_normalized: lead.phoneE164,
        requirement: lead.requirement,
        event_date: lead.eventDate,
        guest_count: lead.guestCount,
        quote_amount: lead.quoteAmount,
        first_received_at: lead.providerCreatedAt ?? new Date().toISOString(),
        last_activity_at: lead.providerUpdatedAt ?? new Date().toISOString(),
      })
      .select("id")
      .single();
    if (inserted.error) throw fromDatabaseError(inserted.error);
    const leadId = rowId(inserted.data);
    const activity = await admin.from("lead_activities").insert({
      organization_id: organizationId,
      lead_id: leadId,
      actor_profile_id: null,
      activity_type: "provider_received",
      summary: "Lead received from Superfone",
      metadata: { providerLeadId: lead.providerLeadId },
      occurred_at: lead.providerCreatedAt ?? new Date().toISOString(),
    });
    if (activity.error) throw fromDatabaseError(activity.error);

    const salesManager = await admin
      .from("profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("role", "sales_manager")
      .eq("account_status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    if (salesManager.error) throw fromDatabaseError(salesManager.error);
    if (salesManager.data) {
      const notification = await admin.from("notifications").insert({
        organization_id: organizationId,
        recipient_profile_id: rowId(salesManager.data),
        notification_type: "lead_assignment",
        title: "New Superfone lead",
        body: `${lead.clientName} entered the unassigned sales queue.`,
        entity_type: "lead",
        entity_id: leadId,
      });
      if (notification.error) throw fromDatabaseError(notification.error);
    }

    return { duplicate: false, inserted: true, leadId, updated: false };
  }

  const existingId = rowId(existing);
  const patch: Record<string, unknown> = {
    last_activity_at: lead.providerUpdatedAt ?? new Date().toISOString(),
  };

  if (!existing.provider_lead_id && lead.providerLeadId)
    patch.provider_lead_id = lead.providerLeadId;
  if (!existing.source && lead.source) patch.source = lead.source;
  if (!existing.campaign_name && lead.campaignName) patch.campaign_name = lead.campaignName;
  if (!existing.requirement && lead.requirement) patch.requirement = lead.requirement;
  if (!existing.event_date && lead.eventDate) patch.event_date = lead.eventDate;
  if (!existing.guest_count && lead.guestCount) patch.guest_count = lead.guestCount;
  if (!existing.quote_amount && lead.quoteAmount !== null) patch.quote_amount = lead.quoteAmount;

  const updated = await admin
    .from("leads")
    .update(patch)
    .eq("id", existingId)
    .eq("organization_id", organizationId);
  if (updated.error) throw fromDatabaseError(updated.error);

  const activity = await admin.from("lead_activities").insert({
    organization_id: organizationId,
    lead_id: existingId,
    actor_profile_id: null,
    activity_type: "provider_sync",
    summary: "Superfone data merged into the existing lead",
    metadata: {
      providerLeadId: lead.providerLeadId,
      preservedAssignment: true,
      preservedHumanNotes: true,
    },
  });
  if (activity.error) throw fromDatabaseError(activity.error);

  return { duplicate: true, inserted: false, leadId: existingId, updated: true };
}

async function upsertConversation(
  admin: SupabaseClient,
  organizationId: string,
  conversation: NormalizedConversation,
): Promise<string> {
  let lead = await findLead(
    admin,
    organizationId,
    conversation.providerLeadId,
    conversation.contactPhoneE164,
  );

  if (!lead) {
    const merged = await mergeProviderLead(admin, organizationId, {
      providerLeadId: conversation.providerLeadId,
      source: "superfone",
      campaignName: null,
      clientName: conversation.contactName ?? conversation.contactPhoneE164,
      phoneE164: conversation.contactPhoneE164,
      requirement: null,
      eventDate: null,
      guestCount: null,
      quoteAmount: null,
      providerCreatedAt: conversation.lastMessageAt,
      providerUpdatedAt: conversation.lastMessageAt,
    });
    lead = { id: merged.leadId };
  }

  const leadId = rowId(lead);
  const result = await admin
    .from("conversations")
    .upsert(
      {
        organization_id: organizationId,
        lead_id: leadId,
        provider: "superfone",
        provider_conversation_id: conversation.providerConversationId,
        channel: conversation.channel,
        contact_name: conversation.contactName,
        contact_phone_e164: conversation.contactPhoneE164,
        status: conversation.status,
        last_message_at: conversation.lastMessageAt,
        last_message_preview: conversation.lastMessagePreview,
      },
      {
        onConflict: "organization_id,provider,provider_conversation_id",
      },
    )
    .select("id")
    .single();
  if (result.error) throw fromDatabaseError(result.error);
  return rowId(result.data);
}

async function insertMessage(
  admin: SupabaseClient,
  organizationId: string,
  message: NormalizedMessage,
): Promise<string> {
  const conversationId = await upsertConversation(admin, organizationId, {
    providerConversationId: message.providerConversationId,
    providerLeadId: message.providerLeadId,
    contactName: message.contactName,
    contactPhoneE164: message.contactPhoneE164,
    channel: message.channel,
    status: "open",
    lastMessageAt: message.providerCreatedAt,
    lastMessagePreview: message.body,
  });

  const conversation = await admin
    .from("conversations")
    .select("lead_id,assigned_sales_profile_id")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .single();
  if (conversation.error || !conversation.data) throw fromDatabaseError(conversation.error);
  const leadId = (conversation.data as Record<string, unknown>).lead_id;
  if (typeof leadId !== "string") throw new AppError("DATABASE_OPERATION_FAILED");
  const assignedProfileId = (conversation.data as Record<string, unknown>)
    .assigned_sales_profile_id;

  const result = await admin
    .from("messages")
    .upsert(
      {
        organization_id: organizationId,
        conversation_id: conversationId,
        lead_id: leadId,
        provider: "superfone",
        provider_message_id: message.providerMessageId,
        provider_event_id: message.providerEventId,
        direction: message.direction,
        channel: message.channel,
        message_type: message.messageType,
        body: message.body ?? (message.attachmentExternalUrl ? "Media received" : null),
        recipient_phone_e164: message.recipientPhoneE164,
        status: message.status,
        provider_created_at: message.providerCreatedAt,
        sent_at: ["sent", "delivered", "read"].includes(message.status)
          ? message.providerCreatedAt
          : null,
        delivered_at: ["delivered", "read"].includes(message.status)
          ? message.providerCreatedAt
          : null,
        read_at: message.status === "read" ? message.providerCreatedAt : null,
        failed_at: message.status === "failed" ? message.providerCreatedAt : null,
        failure_code: message.failureCode,
        failure_message_safe: message.failureMessageSafe,
      },
      { onConflict: "organization_id,provider,provider_message_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (result.error) throw fromDatabaseError(result.error);

  if (result.data) {
    const insertedMessageId = rowId(result.data);
    const activityUpdate =
      message.direction === "inbound"
        ? { last_inbound_at: message.providerCreatedAt }
        : { last_outbound_at: message.providerCreatedAt };
    const timestampUpdate = await admin
      .from("conversations")
      .update(activityUpdate)
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
    if (timestampUpdate.error) throw fromDatabaseError(timestampUpdate.error);

    if (message.direction === "inbound" && typeof assignedProfileId === "string") {
      const notification = await admin.from("notifications").insert({
        organization_id: organizationId,
        recipient_profile_id: assignedProfileId,
        notification_type: "customer_message",
        title: "New customer message",
        body: message.body?.slice(0, 240) ?? "A customer sent an attachment.",
        entity_type: "conversation",
        entity_id: conversationId,
      });
      if (notification.error) throw fromDatabaseError(notification.error);
    }

    return insertedMessageId;
  }

  const existing = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", "superfone")
    .eq("provider_message_id", message.providerMessageId)
    .single();
  if (existing.error) throw fromDatabaseError(existing.error);
  return rowId(existing.data);
}

export async function applyVerifiedProviderEvent(
  admin: SupabaseClient,
  organizationId: string,
  verified: VerifiedProviderEvent,
): Promise<EntityResult> {
  const event: NormalizedProviderEvent = verified.normalizedEvent;

  if (event.kind === "lead") {
    const result = await mergeProviderLead(admin, organizationId, event.lead);
    return { entityId: result.leadId, entityType: "lead" };
  }

  if (event.kind === "conversation") {
    const id = await upsertConversation(admin, organizationId, event.conversation);
    return { entityId: id, entityType: "conversation" };
  }

  if (event.kind === "message") {
    const id = await insertMessage(admin, organizationId, event.message);
    return { entityId: id, entityType: "message" };
  }

  if (event.kind === "message_status") {
    const message = await admin
      .from("messages")
      .select("id,status")
      .eq("organization_id", organizationId)
      .eq("provider", "superfone")
      .eq("provider_message_id", event.providerMessageId)
      .single();
    if (message.error || !message.data) throw fromDatabaseError(message.error);
    const id = rowId(message.data);
    const patch: Record<string, unknown> = { status: event.status };
    if (event.status === "sent") patch.sent_at = event.occurredAt;
    if (event.status === "delivered") patch.delivered_at = event.occurredAt;
    if (event.status === "read") patch.read_at = event.occurredAt;
    if (event.status === "failed") {
      patch.failed_at = event.occurredAt;
      patch.failure_code = event.failureCode;
      patch.failure_message_safe = event.failureMessageSafe;
    }
    const update = await admin
      .from("messages")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (update.error) throw fromDatabaseError(update.error);
    return { entityId: id, entityType: "message" };
  }

  const lead = await findLead(
    admin,
    organizationId,
    event.call.providerLeadId,
    event.call.direction === "inbound" ? event.call.fromPhoneE164 : event.call.toPhoneE164,
  );
  if (!lead) throw new AppError("VALIDATION_FAILED");
  const leadId = rowId(lead);
  let conversationId: string | null = null;
  if (event.call.providerConversationId) {
    const conversation = await admin
      .from("conversations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider", "superfone")
      .eq("provider_conversation_id", event.call.providerConversationId)
      .maybeSingle();
    if (conversation.error) throw fromDatabaseError(conversation.error);
    conversationId = conversation.data ? rowId(conversation.data) : null;
  }
  const inserted = await admin
    .from("superfone_calls")
    .upsert(
      {
        organization_id: organizationId,
        conversation_id: conversationId,
        lead_id: leadId,
        provider_call_id: event.call.providerCallId,
        direction: event.call.direction,
        from_phone_e164: event.call.fromPhoneE164,
        to_phone_e164: event.call.toPhoneE164,
        status: event.call.status,
        started_at: event.call.startedAt,
        answered_at: event.call.answeredAt,
        ended_at: event.call.endedAt,
        duration_seconds: event.call.durationSeconds,
        recording_external_url: event.call.recordingExternalUrl,
      },
      { onConflict: "organization_id,provider_call_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (inserted.error) throw fromDatabaseError(inserted.error);
  if (inserted.data) return { entityId: rowId(inserted.data), entityType: "superfone_call" };

  const existing = await admin
    .from("superfone_calls")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider_call_id", event.call.providerCallId)
    .single();
  if (existing.error) throw fromDatabaseError(existing.error);
  return { entityId: rowId(existing.data), entityType: "superfone_call" };
}
