import "server-only";

import { cache } from "react";
import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { EmailIntegrationData } from "./types";

const settingsSchema = z.object({
  customer_email_sender_email: z.string().nullable(),
  customer_email_sender_name: z.string(),
  email_automation_enabled: z.boolean(),
  email_daily_send_cap: z.number().int(),
  invoice_payment_instructions: z.string().nullable(),
  invoice_prefix: z.string(),
  invoice_terms: z.string(),
});

const connectionSchema = z.object({
  account_identifier_safe: z.string().nullable(),
  last_error_safe: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_tested_at: z.string().nullable(),
  status: z.string(),
});

export type EmailIntegrationResult =
  { data: EmailIntegrationData; ok: true } | { message: string; ok: false };

export const loadEmailIntegration = cache(async (): Promise<EmailIntegrationResult> => {
  const session = await requireRoleSession(["director"]);
  const supabase = await createServerSupabaseClient();
  const [settingsResult, connectionResult, queuedResult, failedResult] = await Promise.all([
    supabase
      .from("organization_settings")
      .select(
        "customer_email_sender_email,customer_email_sender_name,email_automation_enabled,email_daily_send_cap,invoice_payment_instructions,invoice_prefix,invoice_terms",
      )
      .eq("organization_id", session.profile.organization_id)
      .single(),
    supabase
      .from("integration_connections")
      .select("account_identifier_safe,last_error_safe,last_success_at,last_tested_at,status")
      .eq("organization_id", session.profile.organization_id)
      .eq("provider", "brevo")
      .maybeSingle(),
    supabase
      .from("email_outbox")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.profile.organization_id)
      .in("status", ["queued", "processing"]),
    supabase
      .from("email_outbox")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.profile.organization_id)
      .eq("status", "failed"),
  ]);

  if (settingsResult.error || connectionResult.error || queuedResult.error || failedResult.error) {
    return { message: "Email integration health could not be loaded.", ok: false };
  }

  const settings = settingsSchema.safeParse(settingsResult.data);
  const connection = connectionResult.data
    ? connectionSchema.safeParse(connectionResult.data)
    : null;
  if (!settings.success || (connection && !connection.success)) {
    return { message: "Email integration returned an unexpected format.", ok: false };
  }

  return {
    data: {
      automationEnabled: settings.data.email_automation_enabled,
      connection: connection?.success
        ? {
            account: connection.data.account_identifier_safe,
            lastError: connection.data.last_error_safe,
            lastSuccessAt: connection.data.last_success_at,
            lastTestedAt: connection.data.last_tested_at,
            status: connection.data.status,
          }
        : null,
      dailySendCap: settings.data.email_daily_send_cap,
      failedCount: failedResult.count ?? 0,
      invoicePaymentInstructions: settings.data.invoice_payment_instructions ?? "",
      invoicePrefix: settings.data.invoice_prefix,
      invoiceTerms: settings.data.invoice_terms,
      queuedCount: queuedResult.count ?? 0,
      senderEmail: settings.data.customer_email_sender_email ?? "",
      senderName: settings.data.customer_email_sender_name,
    },
    ok: true,
  };
});
