import type { Role } from "@/lib/constants/roles";

export type SalesOperationsMode = "activity" | "assignment" | "calls" | "follow_ups" | "overview";

export const FOLLOW_UP_STATUSES = ["open", "completed", "cancelled", "overdue"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const CALL_DIRECTIONS = ["outbound", "inbound"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATUSES = ["completed", "no_answer", "busy", "failed", "missed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export interface SalesLeadSummary {
  id: string;
  clientName: string;
  phoneE164: string;
  status: string;
  assignedSalesProfileId: string | null;
  version: number;
}

export interface SalesProfileOption {
  id: string;
  fullName: string;
}

export interface FollowUpRecord {
  id: string;
  leadId: string;
  assignedProfileId: string;
  dueAt: string;
  status: FollowUpStatus;
  outcome: string | null;
  completedAt: string | null;
  updatedAt: string;
  isOverdue: boolean;
}

export interface SalesCallRecord {
  id: string;
  leadId: string;
  direction: CallDirection;
  status: string;
  startedAt: string;
  durationSeconds: number | null;
  agentProfileId: string | null;
}

export interface SalesOperationsData {
  viewerId: string;
  viewerRole: Role;
  organizationId: string;
  leads: SalesLeadSummary[];
  salesProfiles: SalesProfileOption[];
  followUps: FollowUpRecord[];
  calls: SalesCallRecord[];
}

export type SalesOperationsLoadState =
  { ok: true; data: SalesOperationsData } | { ok: false; message: string; requestId: string };
