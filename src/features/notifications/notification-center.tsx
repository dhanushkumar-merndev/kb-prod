"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

import { getMyNotificationsAction, markNotificationReadAction } from "./actions";
import styles from "./notifications.module.css";
import type { NotificationItem } from "./queries";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function NotificationCenter({
  notifications,
  organizationId,
  profileId,
}: {
  notifications: NotificationItem[];
  organizationId: string;
  profileId: string;
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["notifications", profileId] as const, [profileId]);
  const notificationQuery = useQuery({
    queryKey,
    queryFn: getMyNotificationsAction,
    initialData: notifications,
  });
  const visibleNotifications = notificationQuery.data;
  const unreadCount = visibleNotifications.filter((notification) => !notification.readAt).length;
  const markRead = useMutation({
    mutationFn: markNotificationReadAction,
    onSuccess: async (result) => {
      setFeedback({
        message: result.message,
        tone: result.ok ? "success" : "error",
      });

      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey });
      }
    },
    onError: () => {
      setFeedback({
        message: "The notification could not be updated. Try again.",
        tone: "error",
      });
    },
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`notifications-${profileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, profileId, queryClient, queryKey]);

  useEffect(() => {
    if (!feedback || feedback.tone !== "success") {
      return;
    }

    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${unreadCount} unread notifications`}
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Bell aria-hidden="true" size={20} />
        {unreadCount > 0 ? <span>{Math.min(unreadCount, 99)}</span> : null}
      </button>
      {open ? (
        <section aria-label="Notifications" className={styles.panel} role="dialog">
          <header>
            <div>
              <strong>Notifications</strong>
              <span>{unreadCount} unread</span>
            </div>
            <button aria-label="Close notifications" onClick={() => setOpen(false)} type="button">
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          {notificationQuery.isError ? (
            <p className={styles.error} role="alert">
              Notifications could not be refreshed. Try again.
            </p>
          ) : visibleNotifications.length === 0 ? (
            <p className={styles.empty}>No notifications yet.</p>
          ) : (
            <ul>
              {visibleNotifications.map((notification) => (
                <li data-read={Boolean(notification.readAt)} key={notification.id}>
                  <div>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <time dateTime={notification.createdAt}>
                      {formatTime(notification.createdAt)}
                    </time>
                  </div>
                  {!notification.readAt ? (
                    <button
                      aria-label="Mark notification read"
                      disabled={
                        markRead.isPending && markRead.variables === notification.id
                      }
                      onClick={() => markRead.mutate(notification.id)}
                      type="button"
                    >
                      <Check aria-hidden="true" size={15} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {feedback ? (
        <div
          className={styles.toast}
          data-tone={feedback.tone}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          <span>{feedback.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setFeedback(null)} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
