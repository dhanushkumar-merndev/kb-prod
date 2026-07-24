export interface EmployeeRecord {
  id: string;
  fullName: string;
  phoneE164: string;
  role: "chef" | "part_time_chef";
  accountStatus: "active" | "inactive" | "blocked" | "payment_pending" | "left_organization";
  joiningDate: string | null;
  paymentType: "monthly" | "daily" | "hourly" | "per_booking" | null;
  paymentAmount: string | null;
  partTimePaymentAmount: string | null;
  aadhaarUrl: string | null;
  paymentProofUrl: string | null;
  updatedAt: string;
}

export type EmployeeRecordsLoadResult =
  | { ok: true; records: EmployeeRecord[] }
  | { ok: false; message: string; requestId: string };
