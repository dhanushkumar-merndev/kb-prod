import type { Role } from "@/lib/constants/roles";

export type LeadStage =
  | "new"
  | "contacted"
  | "follow_up"
  | "qualified"
  | "booking_payment_pending"
  | "booking_in_process"
  | "won"
  | "lost"
  | "unreachable";

const TERMINAL_STAGES: readonly LeadStage[] = ["lost", "unreachable"];

export function allowedManualLeadStages(current: LeadStage, role: Role): LeadStage[] {
  if (TERMINAL_STAGES.includes(current)) {
    return ["director", "manager", "sales_manager"].includes(role)
      ? ["contacted", "follow_up"]
      : [];
  }

  if (["booking_payment_pending", "booking_in_process", "won"].includes(current)) {
    return [];
  }

  const stages: LeadStage[] = ["lost", "unreachable"];
  if (current === "contacted" || current === "follow_up") {
    stages.unshift("qualified");
  }
  return stages;
}

export function leadStageNeedsReason(stage: LeadStage, current: LeadStage): boolean {
  return stage === "lost" || stage === "unreachable" || TERMINAL_STAGES.includes(current);
}
