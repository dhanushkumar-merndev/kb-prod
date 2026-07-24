import { describe, expect, it } from "vitest";

import {
  assignLeadSchema,
  createFollowUpSchema,
  updateFollowUpSchema,
} from "@/features/sales-operations/schemas";

describe("sales workflow validation", () => {
  it("requires an expected version and an assignment reason", () => {
    const invalid = assignLeadSchema.safeParse({
      leadId: "96a3cf8b-6277-43ee-a5d9-593c4cb240e6",
      assignedSalesProfileId: "cbd4c1cb-07ed-4bef-bec4-c197ef24bf3a",
      expectedVersion: "4",
      reason: " ",
    });
    expect(invalid.success).toBe(false);

    const valid = assignLeadSchema.parse({
      leadId: "96a3cf8b-6277-43ee-a5d9-593c4cb240e6",
      assignedSalesProfileId: "",
      expectedVersion: "4",
      reason: "Return to the unassigned queue",
    });
    expect(valid.assignedSalesProfileId).toBeNull();
    expect(valid.expectedVersion).toBe(4);
  });

  it("requires a completed follow-up outcome", () => {
    const result = updateFollowUpSchema.safeParse({
      followUpId: "96a3cf8b-6277-43ee-a5d9-593c4cb240e6",
      expectedUpdatedAt: "2026-07-23T10:00:00.000Z",
      dueAt: "2026-07-24T12:30",
      status: "completed",
      outcome: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a schedulable follow-up for the lead owner", () => {
    const result = createFollowUpSchema.parse({
      leadId: "96a3cf8b-6277-43ee-a5d9-593c4cb240e6",
      assignedProfileId: "",
      dueAt: "2026-07-24T12:30",
    });
    expect(result.assignedProfileId).toBeNull();
  });
});
