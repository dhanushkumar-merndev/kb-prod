import "server-only";

import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { ROLES } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  PAYROLL_ENTRY_STATUSES,
  PAYROLL_PERIOD_STATUSES,
  type EarningsSummary,
  type PayrollComponentRecord,
  type PayrollEntryRecord,
  type PayrollWorkspaceData,
  type PayrollPeriodRecord,
} from "./types";

const moneySchema = z.union([z.string(), z.number()]).transform(String);

const periodRowSchema = z.object({
  id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  status: z.enum(PAYROLL_PERIOD_STATUSES),
  prepared_by_profile_id: z.string().uuid(),
  reviewed_by_profile_id: z.string().uuid().nullable(),
  approved_by_profile_id: z.string().uuid().nullable(),
  prepared_at: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  approved_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  payment_reference: z.string().nullable(),
  locked_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const entryRowSchema = z.object({
  id: z.string().uuid(),
  payroll_period_id: z.string().uuid(),
  profile_id: z.string().uuid().nullable(),
  temporary_worker_id: z.string().uuid().nullable(),
  base_amount: moneySchema,
  attendance_amount: moneySchema,
  booking_earnings: moneySchema,
  overtime_amount: moneySchema,
  expense_reimbursement: moneySchema,
  allowances: moneySchema,
  deductions: moneySchema,
  advances: moneySchema,
  net_payable: moneySchema,
  status: z.enum(PAYROLL_ENTRY_STATUSES),
  payment_reference: z.string().nullable(),
  paid_at: z.string().nullable(),
  reversed_at: z.string().nullable(),
  reversal_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const componentRowSchema = z.object({
  id: z.string().uuid(),
  payroll_entry_id: z.string().uuid(),
  component_type: z.string(),
  source_type: z.string().nullable(),
  amount: moneySchema,
  description: z.string(),
  created_at: z.string(),
});

const profileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  role: z.enum(ROLES),
});

const temporaryWorkerRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  worker_type: z.string(),
});

const earningsRowSchema = z.object({
  current_unpaid: moneySchema,
  paid_this_month: moneySchema,
  lifetime_paid: moneySchema,
  last_payment_amount: moneySchema.nullable(),
  last_payment_at: z.string().nullable(),
});

function period(row: z.infer<typeof periodRowSchema>): PayrollPeriodRecord {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    preparedByProfileId: row.prepared_by_profile_id,
    reviewedByProfileId: row.reviewed_by_profile_id,
    approvedByProfileId: row.approved_by_profile_id,
    preparedAt: row.prepared_at,
    reviewedAt: row.reviewed_at,
    approvedAt: row.approved_at,
    paidAt: row.paid_at,
    paymentReference: row.payment_reference,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function component(row: z.infer<typeof componentRowSchema>): PayrollComponentRecord {
  return {
    id: row.id,
    payrollEntryId: row.payroll_entry_id,
    componentType: row.component_type,
    sourceType: row.source_type,
    amount: row.amount,
    description: row.description,
    createdAt: row.created_at,
  };
}

function earnings(row: z.infer<typeof earningsRowSchema>): EarningsSummary {
  return {
    currentUnpaid: row.current_unpaid,
    paidThisMonth: row.paid_this_month,
    lifetimePaid: row.lifetime_paid,
    lastPaymentAmount: row.last_payment_amount,
    lastPaymentAt: row.last_payment_at,
  };
}

export type PayrollLoadResult =
  { ok: true; data: PayrollWorkspaceData } | { ok: false; message: string };

export async function loadPayrollWorkspace(): Promise<PayrollLoadResult> {
  const session = await requireRoleSession(["director", "manager", "hr", "chef", "part_time_chef"]);
  const supabase = await createServerSupabaseClient();
  const isWorker = ["chef", "part_time_chef"].includes(session.profile.role);
  const [periodResult, entryResult, summaryResult] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select(
        "id,period_start,period_end,status,prepared_by_profile_id,reviewed_by_profile_id,approved_by_profile_id,prepared_at,reviewed_at,approved_at,paid_at,payment_reference,locked_at,created_at,updated_at",
      )
      .order("period_end", { ascending: false })
      .limit(36),
    supabase
      .from("payroll_entries")
      .select(
        "id,payroll_period_id,profile_id,temporary_worker_id,base_amount,attendance_amount,booking_earnings,overtime_amount,expense_reimbursement,allowances,deductions,advances,net_payable,status,payment_reference,paid_at,reversed_at,reversal_reason,created_at,updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    isWorker
      ? supabase.rpc("get_my_payroll_earnings")
      : Promise.resolve({ data: null, error: null }),
  ]);

  const parsedPeriods = z.array(periodRowSchema).safeParse(periodResult.data ?? []);
  const parsedEntries = z.array(entryRowSchema).safeParse(entryResult.data ?? []);
  const parsedSummary = isWorker
    ? z.array(earningsRowSchema).safeParse(summaryResult.data ?? [])
    : null;

  if (
    periodResult.error ||
    entryResult.error ||
    summaryResult.error ||
    !parsedPeriods.success ||
    !parsedEntries.success ||
    (parsedSummary && !parsedSummary.success)
  ) {
    return {
      ok: false,
      message: "Payroll data could not be loaded. Refresh the page and try again.",
    };
  }

  const profileIds = [
    ...new Set(
      parsedEntries.data.map((row) => row.profile_id).filter((id): id is string => id !== null),
    ),
  ];
  const temporaryWorkerIds = [
    ...new Set(
      parsedEntries.data
        .map((row) => row.temporary_worker_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const entryIds = parsedEntries.data.map((row) => row.id);
  const [profilesResult, workersResult, componentsResult] = await Promise.all([
    profileIds.length > 0
      ? supabase.from("profiles").select("id,full_name,role").in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
    temporaryWorkerIds.length > 0
      ? supabase
          .from("temporary_workers")
          .select("id,full_name,worker_type")
          .in("id", temporaryWorkerIds)
      : Promise.resolve({ data: [], error: null }),
    entryIds.length > 0
      ? supabase
          .from("payroll_components")
          .select("id,payroll_entry_id,component_type,source_type,amount,description,created_at")
          .in("payroll_entry_id", entryIds)
          .order("created_at", { ascending: true })
          .limit(3000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const parsedProfiles = z.array(profileRowSchema).safeParse(profilesResult.data ?? []);
  const parsedWorkers = z.array(temporaryWorkerRowSchema).safeParse(workersResult.data ?? []);
  const parsedComponents = z.array(componentRowSchema).safeParse(componentsResult.data ?? []);

  if (
    profilesResult.error ||
    workersResult.error ||
    componentsResult.error ||
    !parsedProfiles.success ||
    !parsedWorkers.success ||
    !parsedComponents.success
  ) {
    return {
      ok: false,
      message: "Payroll details could not be loaded. Refresh the page and try again.",
    };
  }

  const profileNames = new Map(
    parsedProfiles.data.map((row) => [
      row.id,
      {
        name: row.full_name,
        label: row.role === "part_time_chef" ? "Part-time Chef" : "Chef",
      },
    ]),
  );
  const workerNames = new Map(
    parsedWorkers.data.map((row) => [
      row.id,
      {
        name: row.full_name,
        label: row.worker_type.replaceAll("_", " "),
      },
    ]),
  );
  const entries: PayrollEntryRecord[] = parsedEntries.data.map((row) => {
    const subject = row.profile_id
      ? profileNames.get(row.profile_id)
      : workerNames.get(row.temporary_worker_id ?? "");

    return {
      id: row.id,
      payrollPeriodId: row.payroll_period_id,
      profileId: row.profile_id,
      temporaryWorkerId: row.temporary_worker_id,
      subjectName: subject?.name ?? "Workforce member",
      subjectLabel: subject?.label ?? "Worker",
      baseAmount: row.base_amount,
      attendanceAmount: row.attendance_amount,
      bookingEarnings: row.booking_earnings,
      overtimeAmount: row.overtime_amount,
      expenseReimbursement: row.expense_reimbursement,
      allowances: row.allowances,
      deductions: row.deductions,
      advances: row.advances,
      netPayable: row.net_payable,
      status: row.status,
      paymentReference: row.payment_reference,
      paidAt: row.paid_at,
      reversedAt: row.reversed_at,
      reversalReason: row.reversal_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return {
    ok: true,
    data: {
      viewerRole: session.profile.role,
      periods: parsedPeriods.data.map(period),
      entries,
      components: parsedComponents.data.map(component),
      earningsSummary:
        parsedSummary && parsedSummary.success && parsedSummary.data[0]
          ? earnings(parsedSummary.data[0])
          : null,
    },
  };
}
