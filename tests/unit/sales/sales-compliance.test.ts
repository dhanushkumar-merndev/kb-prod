import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getSalesRating } from "@/features/sales-performance/rating";
import { SALES_COMPLIANCE_CRITERIA } from "@/features/sales-performance/types";

describe("daily sales compliance", () => {
  it("defines an exact 100-mark scorecard", () => {
    expect(SALES_COMPLIANCE_CRITERIA).toHaveLength(8);
    expect(SALES_COMPLIANCE_CRITERIA.reduce((total, item) => total + item.maxMarks, 0)).toBe(100);
  });

  it.each([
    [100, "Excellent", 5],
    [95, "Excellent", 5],
    [94, "Very good", 4],
    [85, "Very good", 4],
    [84, "Good", 3],
    [75, "Good", 3],
    [74, "Needs improvement", 2],
    [60, "Needs improvement", 2],
    [59, "Poor", 1],
    [0, "Poor", 1],
  ] as const)("maps %i to %s", (score, label, stars) => {
    expect(getSalesRating(score)).toMatchObject({ label, stars });
  });

  it("authorizes manual lead capture for every sales-domain role in the database", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase",
        "migrations",
        "202608110001_sales_compliance_and_manual_leads.sql",
      ),
      "utf8",
    );

    expect(sql).toContain(
      "v_actor.role not in ('director', 'franchise', 'manager', 'sales_manager', 'sales')",
    );
    expect(sql).toContain("v_assignee_id := v_actor.id");
    expect(sql).toContain("FRANCHISE_SCOPE_VIOLATION");
    expect(sql).toContain("'lead.created'");
  });
});
