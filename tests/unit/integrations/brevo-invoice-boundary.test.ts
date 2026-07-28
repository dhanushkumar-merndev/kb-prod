import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Brevo and invoice boundaries", () => {
  it("ships all required Edge Functions", () => {
    for (const name of [
      "brevo-test-connection",
      "process-email-outbox",
      "brevo-webhook",
      "generate-booking-invoice",
    ]) {
      expect(() =>
        readFileSync(resolve(root, `supabase/functions/${name}/index.ts`), "utf8"),
      ).not.toThrow();
    }
  });

  it("keeps Brevo credentials in Edge environment variables", () => {
    const helper = readFileSync(resolve(root, "supabase/functions/_shared/brevo.ts"), "utf8");
    expect(helper).toContain('environment("BREVO_API_KEY")');
    expect(helper).not.toMatch(/NEXT_PUBLIC_.*BREVO/u);
  });

  it("uses private Storage and immutable replacement invoices", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/202607280001_email_invoice_lead_automation.sql"),
      "utf8",
    );
    expect(migration).toContain("'invoices',\n  'invoices',\n  false");
    expect(migration).toContain("function public.void_and_reissue_invoice");
    expect(migration).toContain("invoice_sequences_org_year_unique");
    expect(migration).toContain("p_expected_version");
    expect(migration).toContain("manual-resend:");
  });

  it("limits provider-confirmed delivery to webhook handling", () => {
    const processor = readFileSync(
      resolve(root, "supabase/functions/process-email-outbox/index.ts"),
      "utf8",
    );
    const webhook = readFileSync(
      resolve(root, "supabase/functions/brevo-webhook/index.ts"),
      "utf8",
    );
    expect(processor).not.toContain('status: "delivered"');
    expect(webhook).toContain('status: "delivered"');
  });
});
