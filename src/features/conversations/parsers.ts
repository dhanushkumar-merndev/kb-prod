import { z } from "zod";

import {
  CONVERSATION_STATUSES,
  type ConversationInboxRecord,
  type ConversationTimelineEvent,
} from "./types";

const countSchema = z.union([z.number(), z.string()]).transform((value) => Number(value));

const inboxRowSchema = z.object({
  id: z.string().uuid(),
  lead_id: z.string().uuid(),
  contact_name: z.string().nullable(),
  contact_phone_e164: z.string(),
  channel: z.string(),
  status: z.enum(CONVERSATION_STATUSES),
  last_message_at: z.string().nullable(),
  last_message_preview: z.string().nullable(),
  assigned_sales_profile_id: z.string().uuid().nullable(),
  assigned_sales_name: z.string().nullable(),
  unread_count: countSchema,
  failed_count: countSchema,
  version: z.number().int().positive(),
});

const timelineRowSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string(),
  direction: z.string(),
  body: z.string().nullable(),
  status: z.string().nullable(),
  occurred_at: z.string(),
  actor_profile_id: z.string().uuid().nullable(),
  actor_name: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export function parseConversationInbox(value: unknown): ConversationInboxRecord[] {
  return z
    .array(inboxRowSchema)
    .parse(value ?? [])
    .map((row) => ({
      id: row.id,
      leadId: row.lead_id,
      contactName: row.contact_name,
      contactPhoneE164: row.contact_phone_e164,
      channel: row.channel,
      status: row.status,
      lastMessageAt: row.last_message_at,
      lastMessagePreview: row.last_message_preview,
      assignedSalesProfileId: row.assigned_sales_profile_id,
      assignedSalesName: row.assigned_sales_name,
      unreadCount: row.unread_count,
      failedCount: row.failed_count,
      version: row.version,
    }));
}

export function parseConversationTimeline(value: unknown): ConversationTimelineEvent[] {
  return z
    .array(timelineRowSchema)
    .parse(value ?? [])
    .map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      direction: row.direction,
      body: row.body,
      status: row.status,
      occurredAt: row.occurred_at,
      actorProfileId: row.actor_profile_id,
      actorName: row.actor_name,
      metadata: row.metadata ?? {},
    }));
}
