"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { loadNotifications, type NotificationItem } from "./queries";

const notificationSchema = z.object({
  notificationId: z.string().uuid(),
});

export interface NotificationMutationResult {
  ok: boolean;
  message: string;
}

export async function getMyNotificationsAction(): Promise<NotificationItem[]> {
  const session = await requireActiveSession();

  return loadNotifications(session.userId);
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationMutationResult> {
  const session = await requireActiveSession();
  const parsed = notificationSchema.safeParse({ notificationId });

  if (!parsed.success) {
    return { ok: false, message: "This notification could not be identified." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.notificationId)
    .eq("recipient_profile_id", session.userId)
    .is("read_at", null);

  if (error) {
    return { ok: false, message: "The notification could not be updated. Try again." };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Notification marked as read." };
}
