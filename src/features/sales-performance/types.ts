import type { CrudActionState } from "@/features/core-crud";

export const SALES_COMPLIANCE_CRITERIA = [
  {
    key: "leadStageScore",
    label: "Lead stage updated",
    description: "Assigned leads carry a current stage update for the selected day.",
    maxMarks: 20,
  },
  {
    key: "tagsScore",
    label: "Tags applied",
    description: "Relevant tags such as New, Hot, Warm, or Follow-up are applied.",
    maxMarks: 15,
  },
  {
    key: "customerDetailsScore",
    label: "Customer details complete",
    description: "Name, phone, event date, guests, quote, and requirement are captured.",
    maxMarks: 15,
  },
  {
    key: "callLogsScore",
    label: "Call logs updated",
    description: "Customer call attempts for the day are recorded in the CRM.",
    maxMarks: 20,
  },
  {
    key: "followUpScore",
    label: "Follow-up date set",
    description: "Every active lead has a next action or recorded follow-up.",
    maxMarks: 10,
  },
  {
    key: "communicationScore",
    label: "WhatsApp / email updated",
    description: "Supported outbound communication or customer email is recorded.",
    maxMarks: 5,
  },
  {
    key: "responseSlaScore",
    label: "Response time (SLA)",
    description: "The first recorded response is within 15 minutes of lead receipt.",
    maxMarks: 10,
  },
  {
    key: "managerScore",
    label: "Manager remarks",
    description: "Communication quality, professionalism, and accuracy review.",
    maxMarks: 5,
  },
] as const;

export type SalesComplianceCriterionKey = (typeof SALES_COMPLIANCE_CRITERIA)[number]["key"];

export interface SalesComplianceRow {
  salesProfileId: string;
  fullName: string;
  assignedLeads: number;
  leadStageScore: number;
  tagsScore: number;
  customerDetailsScore: number;
  callLogsScore: number;
  followUpScore: number;
  communicationScore: number;
  responseSlaScore: number;
  managerScore: number;
  managerRemarks: string | null;
  reviewedAt: string | null;
  totalScore: number;
  rank: number;
}

export interface SalesComplianceData {
  scoreDate: string;
  canReview: boolean;
  rows: SalesComplianceRow[];
}

export type SalesComplianceLoadState =
  | { ok: true; data: SalesComplianceData }
  | { ok: false; message: string; requestId: string };

export type SalesComplianceActionState = CrudActionState;

export interface SalesRating {
  label: "Excellent" | "Very good" | "Good" | "Needs improvement" | "Poor";
  stars: 1 | 2 | 3 | 4 | 5;
  guidance:
    | "Incentive + appreciation"
    | "Normal incentive"
    | "Coaching & guidance"
    | "Written warning + daily review"
    | "Performance improvement plan";
  tone: "excellent" | "veryGood" | "good" | "needsImprovement" | "poor";
}
