"use client";

import { useCallback, useEffect, useRef } from "react";

import { checkCurrentSessionAction, terminateCurrentSessionAction } from "./actions";
import type { AccountStatus, AuthContext } from "@/lib/auth/types";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

interface SessionGuardProps {
  profile: AuthContext;
  children: React.ReactNode;
}

interface ProfileChange {
  accountStatus: AccountStatus;
  sessionVersion: number;
}

const ACCOUNT_STATUS_VALUES = new Set<AccountStatus>([
  "active",
  "inactive",
  "blocked",
  "payment_pending",
  "left_organization",
]);

function readProfileChange(value: unknown): ProfileChange | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const accountStatus = record.account_status;
  const sessionVersion = record.session_version;

  if (
    typeof accountStatus !== "string" ||
    !ACCOUNT_STATUS_VALUES.has(accountStatus as AccountStatus) ||
    typeof sessionVersion !== "number"
  ) {
    return null;
  }

  return {
    accountStatus: accountStatus as AccountStatus,
    sessionVersion,
  };
}

export function SessionGuard({ profile, children }: SessionGuardProps) {
  const endingSession = useRef(false);
  const checkingSession = useRef(false);

  const endSession = useCallback(async (status: string, reason: string) => {
    if (endingSession.current) {
      return;
    }

    endingSession.current = true;

    try {
      await terminateCurrentSessionAction(reason);
    } finally {
      window.location.replace(`/login?status=${encodeURIComponent(status)}`);
    }
  }, []);

  const checkSession = useCallback(async () => {
    if (checkingSession.current || endingSession.current) {
      return;
    }

    checkingSession.current = true;

    try {
      const result = await checkCurrentSessionAction();

      if (!result.valid && result.shouldLogout) {
        await endSession(result.reason, "session_revoked");
      }
    } catch {
      // A transient check failure must not expose an error or destroy a valid
      // session. The proxy still fail-closes protected navigation and the next
      // focus/interval check retries.
      console.warn("[auth] Session check temporarily unavailable.");
    } finally {
      checkingSession.current = false;
    }
  }, [endSession]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`profile-session-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${profile.id}`,
        },
        (payload) => {
          const change = readProfileChange(payload.new);

          if (!change) {
            return;
          }

          if (change.accountStatus !== "active") {
            void endSession(change.accountStatus, "account_status_changed");
            return;
          }

          if (change.sessionVersion !== profile.session_version) {
            void endSession("session_revoked", "session_revoked");
          }
        },
      )
      .subscribe();

    const intervalId = window.setInterval(() => {
      void checkSession();
    }, 60_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkSession();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", checkSession);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", checkSession);
      void supabase.removeChannel(channel);
    };
  }, [checkSession, endSession, profile.id, profile.session_version]);

  return children;
}
