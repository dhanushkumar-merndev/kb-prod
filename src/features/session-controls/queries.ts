import "server-only";

import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { SessionSummaryData } from "./types";

const breakRowSchema = z.object({
  id: z.string().uuid(),
  break_type: z.enum(["lunch", "break", "superfone"]),
  started_at: z.string(),
});

const loginRowSchema = z.object({
  login_at: z.string(),
});

export async function loadSessionSummary(profileId: string): Promise<SessionSummaryData> {
  const supabase = await createServerSupabaseClient();
  const [breakResult, loginResult] = await Promise.all([
    supabase
      .from("break_sessions")
      .select("id,break_type,started_at")
      .eq("profile_id", profileId)
      .is("ended_at", null)
      .maybeSingle(),
    supabase
      .from("login_sessions")
      .select("login_at")
      .eq("profile_id", profileId)
      .is("logout_at", null)
      .order("login_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const activeBreak = breakRowSchema.safeParse(breakResult.data);
  const login = loginRowSchema.safeParse(loginResult.data);

  return {
    loginAt: login.success ? login.data.login_at : null,
    activeBreak: activeBreak.success
      ? {
          id: activeBreak.data.id,
          breakType: activeBreak.data.break_type,
          startedAt: activeBreak.data.started_at,
        }
      : null,
  };
}
