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
  prepared: "Review",
  reviewed: "Review",
  approved: "Approved",
  paid: "Paid",
  locked: "Paid",
};

export const PAYROLL_ENTRY_STATUS_LABELS: Record<PayrollEntryStatus, string> = {
  draft: "Draft",
  reviewed: "Review",
  approved: "Approved",
  paid: "Paid",
  reversed: "Reversed",
};

export interface PayrollPeriodRecord {
  id: string;
  franchiseId: string | null;
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
  attendanceDays: number | null;
  payableDays: number | null;
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
  franchises: { id: string; name: string }[];
  periods: PayrollPeriodRecord[];
  entries: PayrollEntryRecord[];
  components: PayrollComponentRecord[];
  earningsSummary: EarningsSummary | null;
  salaryStructures: SalaryStructure[];
  workforce: {
    id: string;
    name: string;
    paymentType: string | null;
    paymentAmount: string | null;
  }[];
}

export const SALARY_FIELDS = {
  hra: "HRA",
  allowances: "Allowances",
  incentives: "Incentives",
  pf: "PF",
  esic: "ESIC",
  professional_tax: "Professional Tax",
  tds: "TDS",
  other_deductions: "Other Deductions",
  employer_pf: "Employer PF",
  employer_esic: "Employer ESIC",
} as const;

export type SalaryStructure = Record<keyof typeof SALARY_FIELDS, string> & {
  profile_id: string;
  effective_from: string;
  paid_leave: boolean;
  version: number;
};
