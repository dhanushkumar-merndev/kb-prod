export const PROFILE_ROLES = [
  "director",
  "manager",
  "hr",
  "sales_manager",
  "sales",
  "chef",
  "part_time_chef",
] as const;

export type ProfileRole = (typeof PROFILE_ROLES)[number];

export const ACCOUNT_STATUSES = [
  "active",
  "inactive",
  "blocked",
  "payment_pending",
  "left_organization",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const PAYMENT_TYPES = ["monthly", "daily", "hourly", "per_booking"] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];

export interface ProfileRecord {
  id: string;
  organization_id: string;
  full_name: string;
  phone_e164: string;
  role: ProfileRole;
  reports_to_profile_id: string | null;
  account_status: AccountStatus;
  session_version: number;
  joining_date: string | null;
  payment_type: PaymentType | null;
  payment_amount: number | null;
  aadhaar_storage_path: string | null;
  part_time_payment_proof_path: string | null;
  part_time_payment_amount: number | null;
  deleted_at: string | null;
}

export interface ActorContext {
  accessToken: string;
  profile: ProfileRecord;
  userId: string;
}
