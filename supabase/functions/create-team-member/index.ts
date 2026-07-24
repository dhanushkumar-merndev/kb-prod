import { getAdminClient, getProfileById, requireActiveActor } from "../_shared/auth.ts";
import type { User } from "@supabase/supabase-js";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import { assertCanCreateRole, assertStoragePathOrganization } from "../_shared/permissions.ts";
import { normalizeIndianPhone, phoneToInternalAuthEmail } from "../_shared/phone.ts";
import { createTeamMemberSchema } from "../_shared/schemas.ts";
import type { AccountStatus, ProfileRecord, ProfileRole } from "../_shared/types.ts";

const AUTH_CANDIDATE_RECOVERY_AGE_MS = 60_000;

const REPORTING_ROLE: Record<Exclude<ProfileRole, "director">, ProfileRole> = {
  chef: "hr",
  hr: "manager",
  manager: "director",
  part_time_chef: "hr",
  sales: "sales_manager",
  sales_manager: "manager",
};

async function resolveReportingProfile(
  actor: ProfileRecord,
  targetRole: Exclude<ProfileRole, "director">,
): Promise<string> {
  const requiredRole = REPORTING_ROLE[targetRole];
  if (actor.role === requiredRole) {
    return actor.id;
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", actor.organization_id)
    .eq("role", requiredRole)
    .eq("account_status", "active")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error);
  }

  if (!data || typeof (data as Record<string, unknown>).id !== "string") {
    throw new AppError("ROLE_HOLDER_REQUIRED");
  }

  return (data as { id: string }).id;
}

function mapAuthCreateError(error: unknown): AppError {
  const errorRecord =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const searchable = [errorRecord.code, errorRecord.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (
    searchable.includes("already") ||
    searchable.includes("registered") ||
    searchable.includes("exists")
  ) {
    return new AppError("DUPLICATE_PHONE", { cause: error });
  }

  return new AppError("AUTH_USER_CREATE_FAILED", { cause: error });
}

async function recoverTeamMemberCandidate(input: {
  fullName: string;
  internalEmail: string;
  organizationId: string;
  password: string;
  phoneE164: string;
  requestId: string;
  role: Exclude<ProfileRole, "director">;
}): Promise<User | null> {
  const admin = getAdminClient();
  const { data: usersPage, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    throw new AppError("AUTH_USER_CREATE_FAILED", { cause: listError });
  }

  const candidate = usersPage.users.find(
    (user) =>
      user.email?.toLowerCase() === input.internalEmail.toLowerCase() &&
      user.app_metadata.khana_banao_profile_candidate === true &&
      user.app_metadata.organization_id === input.organizationId,
  );

  if (!candidate) {
    return null;
  }

  const candidateAge = Date.now() - Date.parse(candidate.created_at);
  if (!Number.isFinite(candidateAge) || candidateAge < AUTH_CANDIDATE_RECOVERY_AGE_MS) {
    return null;
  }

  const existingProfile = await getProfileById(admin, candidate.id);
  if (existingProfile) {
    return null;
  }

  const {
    data: { user },
    error: updateError,
  } = await admin.auth.admin.updateUserById(candidate.id, {
    app_metadata: {
      ...candidate.app_metadata,
      candidate_request_id: input.requestId,
      intended_role: input.role,
      khana_banao_profile_candidate: true,
      organization_id: input.organizationId,
    },
    password: input.password,
    user_metadata: {
      full_name: input.fullName,
      phone_e164: input.phoneE164,
    },
  });

  if (updateError || !user) {
    throw new AppError("AUTH_USER_CREATE_FAILED", { cause: updateError });
  }

  return user;
}

function teamMemberResponse(profile: ProfileRecord, replayed = false) {
  return {
    accountStatus: profile.account_status,
    profile,
    replayed,
    requiresPaymentConfirmation: profile.account_status === "payment_pending",
  };
}

async function loadTeamMemberReplay(input: {
  actorId: string;
  organizationId: string;
  profileId: string;
  requestId: string;
}): Promise<ProfileRecord | null> {
  const admin = getAdminClient();
  const { data: audit, error: auditError } = await admin
    .from("audit_logs")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("actor_profile_id", input.actorId)
    .eq("action", "profile.created")
    .eq("entity_id", input.profileId)
    .eq("request_id", input.requestId)
    .limit(1)
    .maybeSingle();

  if (auditError) {
    throw fromDatabaseError(auditError);
  }

  if (!audit) {
    return null;
  }

  const profile = await getProfileById(admin, input.profileId);
  if (!profile || profile.organization_id !== input.organizationId) {
    return null;
  }

  return profile;
}

async function cleanupUnlinkedAuthUser(userId: string, requestId: string): Promise<void> {
  const admin = getAdminClient();
  const profile = await getProfileById(admin, userId);
  if (profile) {
    return;
  }

  const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
  if (cleanupError) {
    console.error(
      JSON.stringify({
        code: "TEAM_MEMBER_AUTH_COMPENSATION_FAILED",
        requestId,
      }),
    );
  }
}

Deno.serve((request) =>
  withEdgeRequest(request, async ({ requestId }) => {
    const input = await parseJson(request, createTeamMemberSchema);
    const { profile: actor } = await requireActiveActor(request);
    assertCanCreateRole(actor.role, input.role);

    const admin = getAdminClient();
    const phoneE164 = normalizeIndianPhone(input.phone);
    const internalEmail = phoneToInternalAuthEmail(phoneE164);

    assertStoragePathOrganization(input.aadhaarStoragePath, actor.organization_id);
    assertStoragePathOrganization(input.partTimePaymentProofPath, actor.organization_id);

    const { data: duplicateProfile, error: duplicateError } = await admin
      .from("profiles")
      .select("id")
      .eq("organization_id", actor.organization_id)
      .eq("phone_e164", phoneE164)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (duplicateError) {
      throw fromDatabaseError(duplicateError);
    }

    if (duplicateProfile) {
      const duplicateProfileId = (duplicateProfile as Record<string, unknown>).id;
      if (typeof duplicateProfileId === "string") {
        const replay = await loadTeamMemberReplay({
          actorId: actor.id,
          organizationId: actor.organization_id,
          profileId: duplicateProfileId,
          requestId,
        });
        if (replay) {
          return teamMemberResponse(replay, true);
        }
      }

      throw new AppError("DUPLICATE_PHONE");
    }

    const reportsToProfileId = await resolveReportingProfile(actor, input.role);

    let accountStatus: AccountStatus = input.accountStatus;
    if (input.role === "part_time_chef") {
      const { data: settings, error: settingsError } = await admin
        .from("organization_settings")
        .select("part_time_payment_proof_required")
        .eq("organization_id", actor.organization_id)
        .single();

      if (settingsError) {
        throw fromDatabaseError(settingsError);
      }

      const proofRequired =
        (settings as Record<string, unknown>).part_time_payment_proof_required === true;
      if (proofRequired && !input.partTimePaymentProofPath && accountStatus === "active") {
        accountStatus = "payment_pending";
      }
    }

    const {
      data: { user: createdUser },
      error: createUserError,
    } = await admin.auth.admin.createUser({
      app_metadata: {
        candidate_request_id: requestId,
        intended_role: input.role,
        khana_banao_profile_candidate: true,
        organization_id: actor.organization_id,
      },
      email: internalEmail,
      email_confirm: true,
      password: input.password,
      user_metadata: {
        full_name: input.fullName,
        phone_e164: phoneE164,
      },
    });

    let user = createdUser;
    if (createUserError || !user) {
      const mappedError = mapAuthCreateError(createUserError);
      if (mappedError.code !== "DUPLICATE_PHONE") {
        throw mappedError;
      }

      user = await recoverTeamMemberCandidate({
        fullName: input.fullName,
        internalEmail,
        organizationId: actor.organization_id,
        password: input.password,
        phoneE164,
        requestId,
        role: input.role,
      });
      if (!user) {
        throw mappedError;
      }
    }

    const rpcArguments: Record<string, unknown> = {
      p_aadhaar_storage_path: input.aadhaarStoragePath ?? null,
      p_account_status: accountStatus,
      p_actor_profile_id: actor.id,
      p_auth_user_id: user.id,
      p_full_name: input.fullName,
      p_part_time_payment_amount: input.partTimePaymentAmount ?? null,
      p_part_time_payment_proof_path: input.partTimePaymentProofPath ?? null,
      p_payment_amount: input.paymentAmount ?? null,
      p_payment_type: input.paymentType ?? null,
      p_phone_e164: phoneE164,
      p_reports_to_profile_id: reportsToProfileId,
      p_request_id: requestId,
      p_role: input.role,
    };

    if (input.joiningDate) {
      rpcArguments.p_joining_date = input.joiningDate;
    }

    const { error: profileError } = await admin.rpc("create_team_member_profile", rpcArguments);

    if (profileError) {
      const replay = await loadTeamMemberReplay({
        actorId: actor.id,
        organizationId: actor.organization_id,
        profileId: user.id,
        requestId,
      });
      if (replay) {
        return teamMemberResponse(replay, true);
      }

      await cleanupUnlinkedAuthUser(user.id, requestId);
      const fallback =
        input.role === "manager" || input.role === "hr" || input.role === "sales_manager"
          ? "ROLE_HOLDER_CONFLICT"
          : "DUPLICATE_PHONE";
      throw fromDatabaseError(profileError, fallback);
    }

    const createdProfile = await getProfileById(admin, user.id);
    if (!createdProfile) {
      throw new AppError("DATABASE_OPERATION_FAILED");
    }

    return teamMemberResponse(createdProfile);
  }),
);
