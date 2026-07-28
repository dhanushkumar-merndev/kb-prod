import { describe, expect, it } from "vitest";

import { allowedManualLeadStages, leadStageNeedsReason } from "@/lib/leads/transition-rules";

describe("lead stage transition rules", () => {
  it("keeps contact and follow-up milestones automated", () => {
    expect(allowedManualLeadStages("new", "sales")).toEqual(["lost", "unreachable"]);
    expect(allowedManualLeadStages("contacted", "sales")).toEqual([
      "qualified",
      "lost",
      "unreachable",
    ]);
  });

  it("locks booking-derived and won stages", () => {
    for (const stage of ["booking_payment_pending", "booking_in_process", "won"] as const) {
      expect(allowedManualLeadStages(stage, "director")).toEqual([]);
    }
  });

  it("allows an upper role to reopen a terminal lead with a reason", () => {
    expect(allowedManualLeadStages("lost", "sales")).toEqual([]);
    expect(allowedManualLeadStages("unreachable", "sales_manager")).toEqual([
      "contacted",
      "follow_up",
    ]);
    expect(leadStageNeedsReason("contacted", "lost")).toBe(true);
    expect(leadStageNeedsReason("lost", "contacted")).toBe(true);
  });
});
