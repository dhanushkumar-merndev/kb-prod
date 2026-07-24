import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, fromDatabaseError } from "./errors.ts";

interface IntegrationEventReservation {
  duplicate: boolean;
  eventId: string;
  status: string;
}

export async function reserveIntegrationEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    providerEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<IntegrationEventReservation> {
  const { data, error } = await admin
    .from("integration_events")
    .insert({
      organization_id: input.organizationId,
      provider: "superfone",
      provider_event_id: input.providerEventId,
      event_type: input.eventType,
      payload: input.payload,
      status: "received",
    })
    .select("id,status")
    .maybeSingle();

  if (!error && data) {
    const row = data as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.status !== "string") {
      throw new AppError("DATABASE_OPERATION_FAILED");
    }
    return { duplicate: false, eventId: row.id, status: row.status };
  }

  if (error?.code !== "23505") {
    throw fromDatabaseError(error);
  }

  const existing = await admin
    .from("integration_events")
    .select("id,status")
    .eq("organization_id", input.organizationId)
    .eq("provider", "superfone")
    .eq("provider_event_id", input.providerEventId)
    .single();

  if (existing.error || !existing.data) {
    throw fromDatabaseError(existing.error);
  }

  const row = existing.data as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.status !== "string") {
    throw new AppError("DATABASE_OPERATION_FAILED");
  }

  return { duplicate: true, eventId: row.id, status: row.status };
}
