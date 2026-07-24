import type { Role } from "@/lib/constants/roles";

export const PAYROLL_PERIOD_STATUSES = [
  "draft",
  "prepared",
  "reviewed",
  "approved",
  "paid",
  "locked",
] as const;

export const PAYROLL_ENTRY_STATUSES = [
  "draft",
  "reviewed",
  "approved",
  "paid",
  "reversed",
] as const;

export type PayrollPeriodStatus = (typeof PAYROLL_PERIOD_STATUSES)[number];
export type PayrollEntryStatus = (typeof PAYROLL_ENTRY_STATUSES)[number];

export const PAYROLL_PERIOD_STATUS_LABELS: Record<PayrollPeriodStatus, string> = {
  draft: "Draft",
  prepared: "Prepared",
  reviewed: "Reviewed",
  approved: "Approved",
  paid: "Paid",
  locked: "Locked",
};

export const PAYROLL_ENTRY_STATUS_LABELS: Record<PayrollEntryStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
  paid: "Paid",
  reversed: "Reversed",
};

export interface PayrollPeriodRecord {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollPeriodStatus;
  preparedByProfileId: string;
  reviewedByProfileId: string | null;
  approvedByProfileId: string | null;
  preparedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollEntryRecord {
  id: string;
  payrollPeriodId: string;
  profileId: string | null;
  temporaryWorkerId: string | null;
  subjectName: string;
  subjectLabel: string;
  baseAmount: string;
  attendanceAmount: string;
  bookingEarnings: string;
  overtimeAmount: string;
  expenseReimbursement: string;
  allowances: string;
  deductions: string;
  advances: string;
  netPayable: string;
  status: PayrollEntryStatus;
  paymentReference: string | null;
  paidAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollComponentRecord {
  id: string;
  payrollEntryId: string;
  componentType: string;
  sourceType: string | null;
  amount: string;
  description: string;
  createdAt: string;
}

export interface EarningsSummary {
  currentUnpaid: string;
  paidThisMonth: string;
  lifetimePaid: string;
  lastPaymentAmount: string | null;
  lastPaymentAt: string | null;
}

export interface PayrollWorkspaceData {
  viewerRole: Role;
  periods: PayrollPeriodRecord[];
  entries: PayrollEntryRecord[];
  components: PayrollComponentRecord[];
  earningsSummary: EarningsSummary | null;
}
