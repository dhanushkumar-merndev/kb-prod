"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

interface RealtimeRefreshProps {
  channelName: string;
  organizationId: string;
  tables: readonly string[];
}

export function RealtimeRefresh({
  channelName,
  organizationId,
  tables,
}: RealtimeRefreshProps) {
  const router = useRouter();
  const refreshTimer = useRef<number | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let channel = supabase.channel(`${channelName}-${organizationId}`);

    const scheduleRefresh = () => {
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }

      refreshTimer.current = window.setTimeout(() => {
        startTransition(() => router.refresh());
      }, 300);
    };

    for (const table of [...new Set(tables)]) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `organization_id=eq.${organizationId}`,
        },
        scheduleRefresh,
      );
    }

    channel.subscribe();

    return () => {
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }

      void supabase.removeChannel(channel);
    };
  }, [channelName, organizationId, router, tables]);

  return null;
}
