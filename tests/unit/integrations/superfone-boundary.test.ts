import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Superfone integration boundary", () => {
  it("routes provider phone and identifier values through strict mapping helpers", () => {
    const mapper = readFileSync(
      resolve(root, "supabase/functions/_shared/superfone/mapper.ts"),
      "utf8",
    );
    expect(mapper).toContain("normalizeIndianPhone");
    expect(mapper).toContain("safeProviderIdentifier");
    expect(mapper).toContain("/[\\u0000-\\u001f\\u007f]/u");
  });

  it("does not invent a provider endpoint in the pending adapter", () => {
    const adapter = readFileSync(
      resolve(root, "supabase/functions/_shared/superfone/adapter.ts"),
      "utf8",
    );
    expect(adapter).toContain("SUPERFONE_CAPABILITY_UNAVAILABLE");
    expect(adapter).not.toMatch(/fetch\s*\(\s*["'`]/);
  });

  it("provides every required Superfone Edge Function", () => {
    const names = [
      "superfone-test-connection",
      "superfone-webhook",
      "superfone-sync",
      "superfone-import-existing-leads",
      "superfone-send-message",
      "superfone-send-media",
      "superfone-replay-event",
    ];

    for (const name of names) {
      expect(() =>
        readFileSync(resolve(root, `supabase/functions/${name}/index.ts`), "utf8"),
      ).not.toThrow();
    }
  });

  it("ships atomic lead assignment and conversation RPCs in migration 011", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/202607230011_sales_conversation_workflows.sql"),
      "utf8",
    );
    expect(migration).toContain("function public.assign_lead");
    expect(migration).toContain("function public.reassign_lead");
    expect(migration).toContain("function public.assign_conversation");
    expect(migration).toContain("CONFLICT_STALE_VERSION");
    expect(migration).toContain("lead_assignment_history");
  });
});
