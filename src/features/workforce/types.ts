export type WorkforceActionState = {
  status: "idle" | "success" | "error";
  message: string;
  mutationId: string;
};

export const INITIAL_WORKFORCE_ACTION_STATE: WorkforceActionState = {
  status: "idle",
  message: "",
  mutationId: "initial",
};

export type WorkforceJobStatus =
  | "pending"
  | "confirmed"
  | "chef_assigned"
  | "preparing"
  | "service_completed"
  | "fully_completed"
  | "cancelled";

export interface WorkforceJob {
  bookingId: string;
  bookingCode: string;
  eventType: string;
  eventDate: string;
  reportingTime: string | null;
  venue: string;
  guestCount: number;
  menu: string;
  instructions: string | null;
  serviceStatus: WorkforceJobStatus;
  version: number;
  agreedPayAmount: string | null;
}

export interface AttendanceShift {
  id: string;
  bookingId: string | null;
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
  status: "working" | "pending_approval" | "approved" | "corrected" | "rejected" | "absent";
}

export interface WorkforceSelfServiceData {
  jobs: WorkforceJob[];
  shifts: AttendanceShift[];
  openShift: AttendanceShift | null;
}
