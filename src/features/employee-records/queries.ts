import "server-only";

import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { EmployeeRecordsLoadResult } from "./types";

const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  phone_e164: z.string(),
  role: z.enum(["chef", "part_time_chef"]),
  account_status: z.enum([
    "active",
    "inactive",
    "blocked",
    "payment_pending",
    "left_organization",
  ]),
  joining_date: z.string().nullable(),
  payment_type: z.enum(["monthly", "daily", "hourly", "per_booking"]).nullable(),
  payment_amount: z.union([z.string(), z.number()]).transform(String).nullable(),
  aadhaar_storage_path: z.string().nullable(),
  part_time_payment_proof_path: z.string().nullable(),
  part_time_payment_amount: z.union([z.string(), z.number()]).transform(String).nullable(),
  updated_at: z.string(),
});

function failure(operation: string, error: unknown): EmployeeRecordsLoadResult {
  const requestId = crypto.randomUUID();
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";

  console.error("[employee-records]", { operation, requestId, code });
  return {
    ok: false,
    message: "Employee records could not be loaded. Refresh the page and try again.",
    requestId,
  };
}

export async function loadEmployeeRecords(): Promise<EmployeeRecordsLoadResult> {
  await requireRoleSession(["director", "manager", "hr"]);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id,full_name,phone_e164,role,account_status,joining_date,payment_type,payment_amount,aadhaar_storage_path,part_time_payment_proof_path,part_time_payment_amount,updated_at",
    )
    .in("role", ["chef", "part_time_chef"])
    .is("deleted_at", null)
    .order("full_name");

  if (error) {
    return failure("load-profiles", error);
  }

  try {
    const profiles = z.array(profileSchema).parse(data ?? []);
    const paths = [
      ...new Set(
        profiles.flatMap((profile) =>
          [profile.aadhaar_storage_path, profile.part_time_payment_proof_path].flatMap((path) =>
            path ? [path] : [],
          ),
        ),
      ),
    ];
    const signedResult =
      paths.length === 0
        ? { data: [], error: null }
        : await supabase.storage.from("employee-private").createSignedUrls(paths, 300);

    if (signedResult.error) {
      return failure("sign-private-records", signedResult.error);
    }

    const signedByPath = new Map(
      (signedResult.data ?? []).flatMap((entry) =>
        entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : [],
      ),
    );

    return {
      ok: true,
      records: profiles.map((profile) => ({
        id: profile.id,
        fullName: profile.full_name,
        phoneE164: profile.phone_e164,
        role: profile.role,
        accountStatus: profile.account_status,
        joiningDate: profile.joining_date,
        paymentType: profile.payment_type,
        paymentAmount: profile.payment_amount,
        partTimePaymentAmount: profile.part_time_payment_amount,
        aadhaarUrl: profile.aadhaar_storage_path
          ? (signedByPath.get(profile.aadhaar_storage_path) ?? null)
          : null,
        paymentProofUrl: profile.part_time_payment_proof_path
          ? (signedByPath.get(profile.part_time_payment_proof_path) ?? null)
          : null,
        updatedAt: profile.updated_at,
      })),
    };
  } catch (parseError) {
    return failure("parse-profiles", parseError);
  }
}
