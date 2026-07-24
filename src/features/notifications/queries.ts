import "server-only";

import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const notificationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  notification_type: z.string(),
  entity_type: z.string().nullable(),
  entity_id: z.string().uuid().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
});

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  readAt: string | null;
  createdAt: string;
}

export async function loadNotifications(profileId: string): Promise<NotificationItem[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id,title,body,notification_type,entity_type,entity_id,read_at,created_at")
    .eq("recipient_profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("[notifications]", { operation: "load", code: error.code ?? "UNKNOWN" });
    return [];
  }

  const parsed = z.array(notificationSchema).safeParse(data ?? []);

  if (!parsed.success) {
    console.error("[notifications]", { operation: "parse", code: "INVALID_RESPONSE" });
    return [];
  }

  return parsed.data.map((notification) => ({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    type: notification.notification_type,
    readAt: notification.read_at,
    createdAt: notification.created_at,
  }));
}
