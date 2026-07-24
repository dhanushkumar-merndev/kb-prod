import "server-only";

import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import type { Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { parseConversationInbox, parseConversationTimeline } from "./parsers";
import type {
  ConversationLead,
  ConversationLoadState,
  ConversationProfileOption,
  SuperfonePublicCapabilities,
} from "./types";

const SALES_ROLES: readonly Role[] = ["director", "manager", "sales_manager", "sales"];

const leadSchema = z.object({
  id: z.string().uuid(),
  client_name: z.string(),
  phone_e164: z.string(),
  status: z.string(),
  requirement: z.string().nullable(),
  event_date: z.string().nullable(),
  guest_count: z.number().int().nullable(),
  quote_amount: z.union([z.string(), z.number()]).transform(String).nullable(),
});

const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
});

const referenceDataSchema = z.object({
  leads: z.array(leadSchema),
  sales_profiles: z.array(profileSchema),
});

const capabilitySchema = z.object({
  connection_status: z.string(),
  messaging_available: z.boolean(),
  media_available: z.boolean(),
  calls_available: z.boolean(),
  unavailable_reason: z.string().nullable(),
});

function failure(operation: string, error: unknown): ConversationLoadState {
  const requestId = crypto.randomUUID();
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
  console.error("[conversations]", { operation, requestId, code });
  return {
    ok: false,
    message: "We could not load conversations. Refresh the page and try again.",
    requestId,
  };
}

export async function loadConversationWorkspaceData(): Promise<ConversationLoadState> {
  const session = await requireActiveSession();
  if (!SALES_ROLES.includes(session.profile.role)) {
    return {
      ok: false,
      message: "You do not have permission to view customer conversations.",
      requestId: crypto.randomUUID(),
    };
  }

  const supabase = await createServerSupabaseClient();
  const [inboxResult, referenceResult, capabilityResult] = await Promise.all([
    supabase.rpc("get_conversation_inbox", {
      p_search: null,
      p_filter: "all",
      p_assigned_profile_id: null,
      p_limit: 50,
      p_offset: 0,
    }),
    supabase.rpc("get_conversation_reference_data"),
    supabase.rpc("get_superfone_public_capabilities"),
  ]);

  const failed = [inboxResult, referenceResult, capabilityResult].find((result) => result.error);
  if (failed?.error) return failure("load", failed.error);

  try {
    const inbox = parseConversationInbox(inboxResult.data);
    const referenceData = referenceDataSchema.parse(referenceResult.data);
    const initialConversationId = inbox[0]?.id ?? null;
    const timelineResult = initialConversationId
      ? await supabase.rpc("get_conversation_timeline", {
          p_conversation_id: initialConversationId,
          p_limit: 200,
        })
      : { data: [], error: null };
    if (timelineResult.error) return failure("load-timeline", timelineResult.error);

    const leads: ConversationLead[] = referenceData.leads.map((row) => ({
      id: row.id,
      clientName: row.client_name,
      phoneE164: row.phone_e164,
      status: row.status,
      requirement: row.requirement,
      eventDate: row.event_date,
      guestCount: row.guest_count,
      quoteAmount: row.quote_amount,
    }));
    const salesProfiles: ConversationProfileOption[] = referenceData.sales_profiles.map((row) => ({
      id: row.id,
      fullName: row.full_name,
    }));
    const capabilityRow = z.array(capabilitySchema).parse(capabilityResult.data ?? [])[0];
    const capabilities: SuperfonePublicCapabilities = capabilityRow
      ? {
          connectionStatus: capabilityRow.connection_status,
          messagingAvailable: capabilityRow.messaging_available,
          mediaAvailable: capabilityRow.media_available,
          callsAvailable: capabilityRow.calls_available,
          unavailableReason: capabilityRow.unavailable_reason,
        }
      : {
          connectionStatus: "disconnected",
          messagingAvailable: false,
          mediaAvailable: false,
          callsAvailable: false,
          unavailableReason: "Superfone is not connected.",
        };

    return {
      ok: true,
      data: {
        viewerId: session.userId,
        viewerRole: session.profile.role,
        organizationId: session.profile.organization_id,
        inbox,
        initialTimeline: parseConversationTimeline(timelineResult.data),
        initialConversationId,
        leads,
        salesProfiles,
        capabilities,
      },
    };
  } catch (error) {
    return failure("parse", error);
  }
}
