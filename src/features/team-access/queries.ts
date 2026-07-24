import "server-only";

import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { CREATABLE_ROLES } from "./permissions";

const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  phone_e164: z.string(),
  role: z.enum(["director", "manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"]),
  account_status: z.enum(["active", "inactive", "blocked", "payment_pending", "left_organization"]),
  joining_date: z.string().nullable(),
  last_login_at: z.string().nullable(),
});

export async function loadTeamAccessData(
  options: { page?: number | undefined; search?: string | undefined } = {},
) {
  const session = await requireRoleSession(["director", "manager", "hr", "sales_manager"]);
  const supabase = await createServerSupabaseClient();
  const pageSize = 10;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const search = (options.search ?? "").trim().slice(0, 80);
  const safeSearch = search
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let profileQuery = supabase
    .from("profiles")
    .select("id,full_name,phone_e164,role,account_status,joining_date,last_login_at", {
      count: "exact",
    })
    .is("deleted_at", null)
    .order("full_name");

  if (safeSearch) {
    profileQuery = profileQuery.or(
      `full_name.ilike.%${safeSearch}%,phone_e164.ilike.%${safeSearch}%`,
    );
  }

  const { count, data, error } = await profileQuery.range(
    (page - 1) * pageSize,
    page * pageSize - 1,
  );
  const parsed = z.array(profileSchema).safeParse(data ?? []);

  if (error || !parsed.success) {
    return { ok: false as const, message: "Team access data could not be loaded." };
  }

  return {
    ok: true as const,
    data: {
      viewerId: session.profile.id,
      viewerRole: session.profile.role,
      creatableRoles: CREATABLE_ROLES[session.profile.role],
      page,
      pageSize,
      profiles: parsed.data,
      search,
      total: count ?? 0,
    },
  };
}
