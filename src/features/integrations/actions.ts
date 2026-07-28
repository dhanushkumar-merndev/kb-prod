"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const settingsSchema = z.object({
  automationEnabled: z.enum(["on"]).optional(),
  dailySendCap: z.coerce.number().int().min(1).max(300),
  invoicePaymentInstructions: z.string().trim().max(2000),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,8}$/u),
  invoiceTerms: z.string().trim().min(5).max(2000),
  senderEmail: z.string().trim().toLowerCase().email().max(254),
  senderName: z.string().trim().min(2).max(100),
});

function result(status: "error" | "success", message: string): CrudActionState {
  return { message, mutationId: crypto.randomUUID(), status };
}

export async function saveEmailIntegrationAction(
  _state: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireRoleSession(["director"]);
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return result("error", "Check the sender and invoice settings.");

  const supabase = await createServerSupabaseClient();
  const update = await supabase
    .from("organization_settings")
    .update({
      customer_email_sender_email: parsed.data.senderEmail,
      customer_email_sender_name: parsed.data.senderName,
      email_automation_enabled: parsed.data.automationEnabled === "on",
      email_daily_send_cap: parsed.data.dailySendCap,
      invoice_payment_instructions: parsed.data.invoicePaymentInstructions || null,
      invoice_prefix: parsed.data.invoicePrefix,
      invoice_terms: parsed.data.invoiceTerms,
    })
    .eq("organization_id", session.profile.organization_id);
  if (update.error) return result("error", "Email settings could not be saved.");

  revalidatePath("/director/integrations");
  return result("success", "Email and invoice settings saved.");
}

export async function testBrevoConnectionAction(
  _state: CrudActionState,
  _formData: FormData,
): Promise<CrudActionState> {
  void _state;
  void _formData;
  await requireRoleSession(["director"]);
  const supabase = await createServerSupabaseClient();
  const response = await supabase.functions.invoke("brevo-test-connection");
  if (response.error) return result("error", "Brevo connection test failed. Check Edge secrets.");

  revalidatePath("/director/integrations");
  return result("success", "Brevo connection verified.");
}

export async function processEmailQueueAction(
  _state: CrudActionState,
  _formData: FormData,
): Promise<CrudActionState> {
  void _state;
  void _formData;
  await requireRoleSession(["director"]);
  const supabase = await createServerSupabaseClient();
  const response = await supabase.functions.invoke("process-email-outbox");
  if (response.error) return result("error", "Email queue processing failed.");

  revalidatePath("/director/integrations");
  return result("success", "Email queue processed.");
}
