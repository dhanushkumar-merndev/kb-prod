import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { AppError, fromDatabaseError } from "./errors.ts";
import {
  ACCOUNT_STATUSES,
  PAYMENT_TYPES,
  PROFILE_ROLES,
  type AccountStatus,
  type ActorContext,
  type PaymentType,
  type ProfileRecord,
  type ProfileRole,
} from "./types.ts";

let cachedAdminClient: SupabaseClient | undefined;

function requireEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new AppError("CONFIGURATION_ERROR");
  }

  return value;
}

export function getAdminClient(): SupabaseClient {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  cachedAdminClient = createClient(
    requireEnvironment("SUPABASE_URL"),
    requireEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );

  return cachedAdminClient;
}

function getAuthenticatedClient(accessToken: string): SupabaseClient {
  return createClient(requireEnvironment("SUPABASE_URL"), requireEnvironment("SUPABASE_ANON_KEY"), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function bearerTokenFor(request: Request): string {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!match?.[1]) {
    throw new AppError("AUTH_REQUIRED");
  }

  return match[1];
}

function isProfileRole(value: unknown): value is ProfileRole {
  return typeof value === "string" && PROFILE_ROLES.includes(value as ProfileRole);
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && ACCOUNT_STATUSES.includes(value as AccountStatus);
}

function isPaymentType(value: unknown): value is PaymentType | null {
  return (
    value === null || (typeof value === "string" && PAYMENT_TYPES.includes(value as PaymentType))
  );
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function parseProfileRecord(value: unknown): ProfileRecord {
  if (typeof value !== "object" || value === null) {
    throw new AppError("DATABASE_OPERATION_FAILED");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.organization_id !== "string" ||
    typeof record.full_name !== "string" ||
    typeof record.phone_e164 !== "string" ||
    !isProfileRole(record.role) ||
    !isAccountStatus(record.account_status) ||
    typeof record.session_version !== "number" ||
    !isPaymentType(record.payment_type)
  ) {
    throw new AppError("DATABASE_OPERATION_FAILED");
  }

  return {
    aadhaar_storage_path: nullableString(record.aadhaar_storage_path),
    account_status: record.account_status,
    deleted_at: nullableString(record.deleted_at),
    full_name: record.full_name,
    id: record.id,
    joining_date: nullableString(record.joining_date),
    organization_id: record.organization_id,
    part_time_payment_amount: nullableNumber(record.part_time_payment_amount),
    part_time_payment_proof_path: nullableString(record.part_time_payment_proof_path),
    payment_amount: nullableNumber(record.payment_amount),
    payment_type: record.payment_type,
    phone_e164: record.phone_e164,
    reports_to_profile_id: nullableString(record.reports_to_profile_id),
    role: record.role,
    session_version: record.session_version,
  };
}

export async function getProfileById(
  client: SupabaseClient,
  profileId: string,
): Promise<ProfileRecord | null> {
  const { data, error } = await client
    .from("profiles")
    .select(
      [
        "id",
        "organization_id",
        "franchise_id",
        "full_name",
        "phone_e164",
        "role",
        "reports_to_profile_id",
        "account_status",
        "session_version",
        "joining_date",
        "payment_type",
        "payment_amount",
        "aadhaar_storage_path",
        "part_time_payment_proof_path",
        "part_time_payment_amount",
        "deleted_at",
      ].join(","),
    )
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error);
  }

  return data ? parseProfileRecord(data) : null;
}

function accountStatusError(status: AccountStatus): AppError {
  switch (status) {
    case "inactive":
      return new AppError("ACCOUNT_INACTIVE");
    case "blocked":
      return new AppError("ACCOUNT_BLOCKED");
    case "payment_pending":
      return new AppError("ACCOUNT_PAYMENT_PENDING");
    case "left_organization":
      return new AppError("ACCOUNT_LEFT_ORGANIZATION");
    case "active":
      return new AppError("PERMISSION_DENIED");
  }
}

async function validateAuthUser(client: SupabaseClient, accessToken: string): Promise<User> {
  const {
    data: { user },
    error,
  } = await client.auth.getUser(accessToken);

  if (error || !user) {
    throw new AppError("AUTH_REQUIRED", { cause: error });
  }

  return user;
}

export async function requireActiveActor(request: Request): Promise<ActorContext> {
  const accessToken = bearerTokenFor(request);
  const client = getAdminClient();
  const user = await validateAuthUser(client, accessToken);
  const profile = await getProfileById(client, user.id);

  if (!profile || profile.deleted_at) {
    throw new AppError("PERMISSION_DENIED");
  }

  if (profile.account_status !== "active") {
    throw accountStatusError(profile.account_status);
  }

  // Account-status changes and role replacement remove the caller's row from
  // auth.sessions. JWT signature validation alone is insufficient because a
  // revoked access token remains cryptographically valid until its expiry.
  const authenticatedClient = getAuthenticatedClient(accessToken);
  const { data: currentSessionIsValid, error: sessionValidationError } =
    await authenticatedClient.rpc("validate_current_auth_session");

  if (sessionValidationError) {
    throw fromDatabaseError(sessionValidationError);
  }

  if (currentSessionIsValid !== true) {
    throw new AppError("AUTH_REQUIRED");
  }

  const { data: organization, error } = await client
    .from("organizations")
    .select("id,is_active")
    .eq("id", profile.organization_id)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error);
  }

  if (!organization || (organization as Record<string, unknown>).is_active !== true) {
    throw new AppError("PERMISSION_DENIED");
  }

  return {
    accessToken,
    profile,
    userId: user.id,
  };
}

export function getBootstrapSecret(): string {
  return requireEnvironment("BOOTSTRAP_TOKEN");
}
