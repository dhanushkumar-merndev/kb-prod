export const SUPERFONE_CAPABILITIES = [
  "testConnection",
  "fetchLeads",
  "fetchConversations",
  "fetchMessages",
  "fetchCalls",
  "sendMessage",
  "sendMedia",
  "verifyWebhook",
] as const;

export type SuperfoneCapability = (typeof SUPERFONE_CAPABILITIES)[number];

export interface SuperfoneCapabilityMap {
  testConnection: boolean;
  fetchLeads: boolean;
  fetchConversations: boolean;
  fetchMessages: boolean;
  fetchCalls: boolean;
  sendMessage: boolean;
  sendMedia: boolean;
  verifyWebhook: boolean;
}

export interface ConnectionResult {
  connected: true;
  accountIdentifierSafe: string | null;
  capabilities: SuperfoneCapabilityMap;
}

export interface NormalizedLead {
  providerLeadId: string | null;
  source: string | null;
  campaignName: string | null;
  clientName: string;
  phoneE164: string;
  requirement: string | null;
  eventDate: string | null;
  guestCount: number | null;
  quoteAmount: number | null;
  providerCreatedAt: string | null;
  providerUpdatedAt: string | null;
}

export interface LeadPage {
  items: NormalizedLead[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface NormalizedConversation {
  providerConversationId: string;
  providerLeadId: string | null;
  contactName: string | null;
  contactPhoneE164: string;
  channel: string;
  status: "open" | "pending" | "resolved" | "closed";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface ConversationPage {
  items: NormalizedConversation[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface NormalizedMessage {
  providerMessageId: string;
  providerEventId: string | null;
  providerConversationId: string;
  providerLeadId: string | null;
  contactName: string | null;
  contactPhoneE164: string;
  direction: "inbound" | "outbound";
  channel: string;
  messageType: string;
  body: string | null;
  attachmentExternalUrl: string | null;
  recipientPhoneE164: string | null;
  status: "received" | "queued" | "sending" | "sent" | "delivered" | "read" | "failed";
  providerCreatedAt: string;
  failureCode: string | null;
  failureMessageSafe: string | null;
}

export interface MessagePage {
  items: NormalizedMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface NormalizedCall {
  providerCallId: string;
  providerConversationId: string | null;
  providerLeadId: string | null;
  direction: "inbound" | "outbound";
  fromPhoneE164: string;
  toPhoneE164: string;
  status: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingExternalUrl: string | null;
}

export interface CallPage {
  items: NormalizedCall[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SendMessageInput {
  conversationExternalId: string;
  recipientPhoneE164: string;
  body: string;
  idempotencyKey: string;
}

export interface SendMediaInput {
  conversationExternalId: string;
  recipientPhoneE164: string;
  mediaUrl: string;
  caption: string | null;
  idempotencyKey: string;
}

export interface SendResult {
  providerMessageId: string;
  acceptedAt: string;
  status: "queued" | "sending" | "sent";
  providerResponseSafe: Record<string, unknown>;
}

export type NormalizedProviderEvent =
  | {
      kind: "lead";
      lead: NormalizedLead;
    }
  | {
      kind: "conversation";
      conversation: NormalizedConversation;
    }
  | {
      kind: "message";
      message: NormalizedMessage;
    }
  | {
      kind: "call";
      call: NormalizedCall;
    }
  | {
      kind: "message_status";
      providerMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      occurredAt: string;
      failureCode: string | null;
      failureMessageSafe: string | null;
    };

export interface VerifiedProviderEvent {
  accountIdentifierSafe: string;
  providerEventId: string;
  eventType: string;
  normalizedEvent: NormalizedProviderEvent;
  payloadSafe: Record<string, unknown>;
}

export interface SuperfoneProvider {
  readonly capabilities: SuperfoneCapabilityMap;
  testConnection(): Promise<ConnectionResult>;
  fetchLeads(input: { cursor?: string; updatedAfter?: string }): Promise<LeadPage>;
  fetchConversations?(input: { cursor?: string; updatedAfter?: string }): Promise<ConversationPage>;
  fetchMessages?(input: { conversationExternalId: string; cursor?: string }): Promise<MessagePage>;
  fetchCalls?(input: { cursor?: string; updatedAfter?: string }): Promise<CallPage>;
  sendMessage?(input: SendMessageInput): Promise<SendResult>;
  sendMedia?(input: SendMediaInput): Promise<SendResult>;
  verifyWebhook(request: Request): Promise<VerifiedProviderEvent>;
  mapStoredEvent?(payload: Record<string, unknown>): Promise<VerifiedProviderEvent>;
}
