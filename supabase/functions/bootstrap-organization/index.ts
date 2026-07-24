import { getAdminClient, getBootstrapSecret } from "../_shared/auth.ts";
import type { User } from "@supabase/supabase-js";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import { normalizeIndianPhone, phoneToInternalAuthEmail } from "../_shared/phone.ts";
import { bootstrapOrganizationSchema } from "../_shared/schemas.ts";

const AUTH_CANDIDATE_RECOVERY_AGE_MS = 60_000;

function constantTimeEqual(actual: string, expected: string): boolean {
  const length = Math.max(actual.length, expected.length);
  let difference = actual.length ^ expected.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return difference === 0;
}

function slugifyOrganizationName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: timezone }).format();
  } catch (error) {
    throw new AppError("VALIDATION_FAILED", {
      cause: error,
      details: {
        fields: [
          {
            message: "Enter a valid IANA timezone.",
            path: "timezone",
          },
        ],
      },
    });
  }
}

function authCreateError(error: unknown): AppError {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";

  if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
    return new AppError("DUPLICATE_PHONE", { cause: error });
  }

  return new AppError("AUTH_USER_CREATE_FAILED", { cause: error });
}

async function recoverBootstrapCandidate(
  internalEmail: string,
  password: string,
  fullName: string,
  phoneE164: string,
  requestId: string,
): Promise<User | null> {
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
      user.email?.toLowerCase() === internalEmail.toLowerCase() &&
      user.app_metadata.khana_banao_bootstrap_candidate === true,
  );

  if (!candidate) {
    return null;
  }

  const candidateAge = Date.now() - Date.parse(candidate.created_at);
  if (!Number.isFinite(candidateAge) || candidateAge < AUTH_CANDIDATE_RECOVERY_AGE_MS) {
    // A fresh candidate may belong to an in-flight bootstrap request. Waiting
    // before recovery avoids racing that request or changing its password.
    return null;
  }

  const {
    data: { user },
    error: updateError,
  } = await admin.auth.admin.updateUserById(candidate.id, {
    app_metadata: {
      ...candidate.app_metadata,
      candidate_request_id: requestId,
      khana_banao_bootstrap_candidate: true,
    },
    password,
    user_metadata: {
      full_name: fullName,
      phone_e164: phoneE164,
    },
  });

  if (updateError || !user) {
    throw new AppError("AUTH_USER_CREATE_FAILED", { cause: updateError });
  }

  return user;
}

async function cleanupUnlinkedAuthUser(userId: string, requestId: string): Promise<void> {
  const admin = getAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error(
      JSON.stringify({
        code: "BOOTSTRAP_AUTH_COMPENSATION_LOOKUP_FAILED",
        requestId,
      }),
    );
    return;
  }

  if (profile) {
    return;
  }

  const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
  if (cleanupError) {
    console.error(
      JSON.stringify({
        code: "BOOTSTRAP_AUTH_COMPENSATION_FAILED",
        requestId,
      }),
    );
  }
}

async function loadBootstrapReplay(
  organizationId: string,
  requestId: string,
): Promise<{
  director: Record<string, unknown>;
  organization: Record<string, unknown>;
  replayed: true;
} | null> {
  const admin = getAdminClient();
  const { data: audit, error: auditError } = await admin
    .from("audit_logs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("action", "organization.bootstrapped")
    .eq("request_id", requestId)
    .limit(1)
    .maybeSingle();

  if (auditError) {
    throw fromDatabaseError(auditError);
  }

  if (!audit) {
    return null;
  }

  const [{ data: organization, error: organizationError }, directorResult] = await Promise.all([
    admin
      .from("organizations")
      .select("id,name,slug,timezone,currency,is_active")
      .eq("id", organizationId)
      .single(),
    admin
      .from("profiles")
      .select("id,organization_id,full_name,phone_e164,role,account_status,session_version")
      .eq("organization_id", organizationId)
      .eq("role", "director")
      .is("deleted_at", null)
      .single(),
  ]);

  if (organizationError || directorResult.error) {
    throw fromDatabaseError(organizationError ?? directorResult.error);
  }

  return {
    director: directorResult.data as Record<string, unknown>,
    organization: organization as Record<string, unknown>,
    replayed: true,
  };
}

Deno.serve((request) =>
  withEdgeRequest(request, async ({ requestId }) => {
    const suppliedSecret = request.headers.get("x-bootstrap-secret") ?? "";
    if (!constantTimeEqual(suppliedSecret, getBootstrapSecret())) {
      throw new AppError("BOOTSTRAP_FORBIDDEN");
    }

    const input = await parseJson(request, bootstrapOrganizationSchema);
    const admin = getAdminClient();
    const phoneE164 = normalizeIndianPhone(input.directorPhone);
    const internalEmail = phoneToInternalAuthEmail(phoneE164);
    const organizationSlug =
      input.organizationSlug ?? slugifyOrganizationName(input.organizationName);

    if (organizationSlug.length < 2) {
      throw new AppError("VALIDATION_FAILED", {
        details: {
          fields: [
            {
              message: "Enter an organization slug using letters and numbers.",
              path: "organizationSlug",
            },
          ],
        },
      });
    }

    validateTimezone(input.timezone);

    // This early check gives a clean replay response. The RPC repeats the check
    // under an advisory transaction lock, which is the race-safe authority.
    const { data: existingOrganizations, error: existingError } = await admin
      .from("organizations")
      .select("id")
      .limit(1);

    if (existingError) {
      throw fromDatabaseError(existingError);
    }

    if (existingOrganizations && existingOrganizations.length > 0) {
      const existingId = (existingOrganizations[0] as Record<string, unknown>).id;
      if (typeof existingId === "string") {
        const replay = await loadBootstrapReplay(existingId, requestId);
        if (replay) {
          return replay;
        }
      }

      throw new AppError("BOOTSTRAP_ALREADY_COMPLETED");
    }

    const {
      data: { user: createdUser },
      error: createUserError,
    } = await admin.auth.admin.createUser({
      app_metadata: {
        candidate_request_id: requestId,
        khana_banao_bootstrap_candidate: true,
      },
      email: internalEmail,
      email_confirm: true,
      password: input.directorPassword,
      user_metadata: {
        full_name: input.directorFullName,
        phone_e164: phoneE164,
      },
    });

    let user = createdUser;
    if (createUserError || !user) {
      const mappedError = authCreateError(createUserError);
      if (mappedError.code !== "DUPLICATE_PHONE") {
        throw mappedError;
      }

      user = await recoverBootstrapCandidate(
        internalEmail,
        input.directorPassword,
        input.directorFullName,
        phoneE164,
        requestId,
      );
      if (!user) {
        throw mappedError;
      }
    }

    const { error: bootstrapError } = await admin.rpc("bootstrap_organization", {
      p_currency: input.currency,
      p_director_full_name: input.directorFullName,
      p_director_phone_e164: phoneE164,
      p_director_user_id: user.id,
      p_name: input.organizationName,
      p_request_id: requestId,
      p_slug: organizationSlug,
      p_timezone: input.timezone,
    });

    if (bootstrapError) {
      const { data: winnerOrganization, error: winnerError } = await admin
        .from("organizations")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (!winnerError && winnerOrganization) {
        const winnerId = (winnerOrganization as Record<string, unknown>).id;
        if (typeof winnerId === "string") {
          const replay = await loadBootstrapReplay(winnerId, requestId);
          if (replay) {
            const replayDirectorId = replay.director.id;
            if (replayDirectorId !== user.id) {
              await cleanupUnlinkedAuthUser(user.id, requestId);
            }
            return replay;
          }
        }
      }

      await cleanupUnlinkedAuthUser(user.id, requestId);
      throw fromDatabaseError(bootstrapError, "BOOTSTRAP_ALREADY_COMPLETED");
    }

    const [{ data: organization, error: organizationError }, profileResult] = await Promise.all([
      admin
        .from("organizations")
        .select("id,name,slug,timezone,currency,is_active")
        .eq("slug", organizationSlug)
        .single(),
      admin
        .from("profiles")
        .select("id,organization_id,full_name,phone_e164,role,account_status,session_version")
        .eq("id", user.id)
        .single(),
    ]);

    if (organizationError || profileResult.error) {
      throw fromDatabaseError(organizationError ?? profileResult.error);
    }

    return {
      director: profileResult.data,
      organization,
    };
  }),
);
