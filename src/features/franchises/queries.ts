import "server-only";

import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const franchiseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  city: z.string().nullable(),
  contact_phone_e164: z.string().nullable(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
});

const staffSchema = z.object({
  franchise_id: z.string().uuid().nullable(),
  role: z.string(),
  account_status: z.string(),
});

export interface FranchiseSummary {
  id: string;
  name: string;
  code: string;
  city: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  activeStaffCount: number;
  ownerAssigned: boolean;
}

/**
 * Only the Director reaches this screen. RLS would still limit a franchise-scoped
 * caller to its own row, but the route guard keeps the intent explicit.
 */
export async function loadFranchisesData() {
  await requireRoleSession(["director"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: franchiseRows, error: franchiseError }, { data: staffRows, error: staffError }] =
    await Promise.all([
      supabase
        .from("franchises")
        .select("id,name,code,city,contact_phone_e164,notes,is_active,created_at")
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("profiles")
        .select("franchise_id,role,account_status")
        .is("deleted_at", null)
        .eq("account_status", "active"),
    ]);

  const parsedFranchises = z.array(franchiseSchema).safeParse(franchiseRows ?? []);
  const parsedStaff = z.array(staffSchema).safeParse(staffRows ?? []);

  if (franchiseError || staffError || !parsedFranchises.success || !parsedStaff.success) {
    return { ok: false as const, message: "Franchises could not be loaded." };
  }

  const staffByFranchise = new Map<string, { count: number; hasOwner: boolean }>();
  for (const row of parsedStaff.data) {
    if (!row.franchise_id) {
      continue;
    }
    const entry = staffByFranchise.get(row.franchise_id) ?? { count: 0, hasOwner: false };
    entry.count += 1;
    entry.hasOwner = entry.hasOwner || row.role === "franchise";
    staffByFranchise.set(row.franchise_id, entry);
  }

  const franchises: FranchiseSummary[] = parsedFranchises.data.map((row) => {
    const staff = staffByFranchise.get(row.id);
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      city: row.city,
      contactPhone: row.contact_phone_e164,
      notes: row.notes,
      isActive: row.is_active,
      activeStaffCount: staff?.count ?? 0,
      ownerAssigned: staff?.hasOwner ?? false,
    };
  });

  return { ok: true as const, data: { franchises } };
}

/** Franchise options for the Director's account-creation form. */
export async function loadActiveFranchiseOptions(): Promise<
  Array<{ id: string; name: string; code: string }>
> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("franchises")
    .select("id,name,code")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name");

  if (error) {
    return [];
  }

  const parsed = z
    .array(z.object({ id: z.string().uuid(), name: z.string(), code: z.string() }))
    .safeParse(data ?? []);

  return parsed.success ? parsed.data : [];
}
