import type { Role } from "@/lib/constants/roles";

export const CONVERSATION_FILTERS = [
  "all",
  "unread",
  "unassigned",
  "mine",
  "open",
  "pending",
  "resolved",
  "failed",
] as const;
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];

export const CONVERSATION_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export interface ConversationInboxRecord {
  id: string;
  leadId: string;
  contactName: string | null;
  contactPhoneE164: string;
  channel: string;
  status: ConversationStatus;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  assignedSalesProfileId: string | null;
  assignedSalesName: string | null;
  unreadCount: number;
  failedCount: number;
  version: number;
}

export interface ConversationLead {
  id: string;
  clientName: string;
  phoneE164: string;
  status: string;
  requirement: string | null;
  eventDate: string | null;
  guestCount: number | null;
  quoteAmount: string | null;
}

export interface ConversationTimelineEvent {
  eventId: string;
  eventType: string;
  direction: string;
  body: string | null;
  status: string | null;
  occurredAt: string;
  actorProfileId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown>;
}

export interface ConversationProfileOption {
  id: string;
  fullName: string;
}

export interface SuperfonePublicCapabilities {
  connectionStatus: string;
  messagingAvailable: boolean;
  mediaAvailable: boolean;
  callsAvailable: boolean;
  unavailableReason: string | null;
}

export interface ConversationWorkspaceData {
  viewerId: string;
  viewerRole: Role;
  organizationId: string;
  inbox: ConversationInboxRecord[];
  initialTimeline: ConversationTimelineEvent[];
  initialConversationId: string | null;
  leads: ConversationLead[];
  salesProfiles: ConversationProfileOption[];
  capabilities: SuperfonePublicCapabilities;
}

export type ConversationLoadState =
  { ok: true; data: ConversationWorkspaceData } | { ok: false; message: string; requestId: string };
