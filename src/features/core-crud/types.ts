import type { Role } from "@/lib/constants/roles";

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "follow_up",
  "qualified",
  "booking_payment_pending",
  "booking_in_process",
  "won",
  "lost",
  "unreachable",
] as const;

export const EXPENSE_STATUSES = ["pending", "verified", "approved", "rejected", "paid"] as const;

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TASK_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  follow_up: "Follow-up",
  qualified: "Qualified",
  booking_payment_pending: "Booking payment pending",
  booking_in_process: "Booking in process",
  won: "Won",
  lost: "Lost",
  unreachable: "Unreachable",
};

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  pending: "Pending",
  verified: "Verified",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export interface CrudActionState {
  status: "idle" | "success" | "error";
  message: string;
  mutationId: string;
  fieldErrors?: Record<string, string>;
  requestId?: string;
}

export const INITIAL_CRUD_ACTION_STATE: CrudActionState = {
  status: "idle",
  message: "",
  mutationId: "initial",
};

export type CrudLoadState<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      message: string;
      requestId: string;
    };

export interface LeadRecord {
  id: string;
  clientName: string;
  customerEmail: string | null;
  phoneE164: string;
  source: string | null;
  requirement: string | null;
  eventDate: string | null;
  guestCount: number | null;
  quoteAmount: string | null;
  status: LeadStatus;
  assignedSalesProfileId: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
  tags: Array<{ id: string; tag: string }>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRecord {
  id: string;
  bookingId: string | null;
  category: string;
  amount: string;
  reason: string;
  status: ExpenseStatus;
  rejectionReason: string | null;
  attachments: Array<{
    id: string;
    fileName: string;
    signedUrl: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequestRecord {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  assignedToProfileId: string;
  assignedByProfileId: string;
  bookingId: string | null;
  leadId: string | null;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SafeProfileOption {
  id: string;
  fullName: string;
  role: Role;
}

export interface LeadCrudData {
  viewerId: string;
  viewerRole: Role;
  leads: LeadRecord[];
  salesAssignees: SafeProfileOption[];
  page: number;
  pageSize: number;
  search: string;
  total: number;
}

export interface OwnExpenseCrudData {
  viewerId: string;
  viewerRole: Role;
  expenses: ExpenseRecord[];
  bookings: Array<{
    id: string;
    bookingCode: string;
    clientName: string;
    eventDate: string;
  }>;
}

export interface OwnLeaveCrudData {
  viewerId: string;
  viewerRole: Role;
  leaveRequests: LeaveRequestRecord[];
}

export interface TaskCrudData {
  viewerId: string;
  viewerRole: Role;
  tasks: TaskRecord[];
  assignees: SafeProfileOption[];
  canCreate: boolean;
}
