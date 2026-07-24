import type { Role } from "@/lib/constants/roles";

export const MEETING_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export const MEETING_ATTENDANCE_STATUSES = [
  "invited",
  "accepted",
  "declined",
  "attended",
  "absent",
] as const;
export const TEMPORARY_WORKER_TYPES = ["helper", "server", "cleaner", "driver", "other"] as const;
export const TEMPORARY_WORKER_PAYMENT_TYPES = ["daily", "hourly", "per_booking"] as const;

export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export type MeetingAttendanceStatus = (typeof MEETING_ATTENDANCE_STATUSES)[number];
export type TemporaryWorkerType = (typeof TEMPORARY_WORKER_TYPES)[number];
export type TemporaryWorkerPaymentType = (typeof TEMPORARY_WORKER_PAYMENT_TYPES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TEMPORARY_WORKER_TYPE_LABELS: Record<TemporaryWorkerType, string> = {
  helper: "Helper",
  server: "Server",
  cleaner: "Cleaner",
  driver: "Driver",
  other: "Other",
};

export const TEMPORARY_WORKER_PAYMENT_TYPE_LABELS: Record<TemporaryWorkerPaymentType, string> = {
  daily: "Daily",
  hourly: "Hourly",
  per_booking: "Per booking",
};

export interface MeetingAttendeeRecord {
  profileId: string;
  attendanceStatus: MeetingAttendanceStatus;
}

export interface MeetingRecord {
  id: string;
  title: string;
  reason: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  meetingUrl: string | null;
  status: MeetingStatus;
  createdByProfileId: string;
  createdAt: string;
  updatedAt: string;
  attendees: MeetingAttendeeRecord[];
}

export interface MeetingDirectoryProfile {
  id: string;
  fullName: string;
  role: Role;
}

export interface MeetingCrudData {
  viewerId: string;
  viewerRole: Role;
  canCreate: boolean;
  meetings: MeetingRecord[];
  directory: MeetingDirectoryProfile[];
}

export interface TemporaryWorkerRecord {
  id: string;
  fullName: string;
  phoneE164: string | null;
  workerType: TemporaryWorkerType;
  paymentType: TemporaryWorkerPaymentType;
  paymentAmount: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemporaryWorkerCrudData {
  viewerRole: Role;
  workers: TemporaryWorkerRecord[];
  bookings: Array<{
    id: string;
    bookingCode: string;
    eventDate: string;
  }>;
  assignments: Array<{
    id: string;
    temporaryWorkerId: string;
    bookingId: string;
    workDate: string;
    reportingTime: string | null;
    agreedPayment: string;
    notes: string | null;
    createdAt: string;
  }>;
}
