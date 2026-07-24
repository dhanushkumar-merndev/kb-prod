import type { Role } from "@/lib/constants/roles";

export interface ReviewAttachment {
  id: string;
  fileName: string;
  signedUrl: string;
}

export interface ExpenseReviewRecord {
  id: string;
  submitterName: string;
  submitterRole: Role;
  bookingId: string | null;
  category: string;
  amount: string;
  reason: string;
  status: "pending" | "verified" | "approved" | "rejected" | "paid";
  rejectionReason: string | null;
  attachments: ReviewAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface LeaveReviewRecord {
  id: string;
  profileName: string;
  profileRole: Role;
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewNote: string | null;
  conflictMessages: string[];
  createdAt: string;
  updatedAt: string;
}

export type ReviewLoadResult<T> =
  | {
      ok: true;
      viewerRole: Role;
      records: T[];
    }
  | {
      ok: false;
      message: string;
      requestId: string;
    };
