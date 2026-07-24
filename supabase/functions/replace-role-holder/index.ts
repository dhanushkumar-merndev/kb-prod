import { getAdminClient, getProfileById, requireActiveActor } from "../_shared/auth.ts";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import {
  assertCanManageRole,
  assertCanReplaceRole,
  assertSameOrganization,
  assertSeparateProfiles,
} from "../_shared/permissions.ts";
import { replaceRoleHolderSchema } from "../_shared/schemas.ts";

Deno.serve((request) =>
  withEdgeRequest(request, async ({ requestId }) => {
    const input = await parseJson(request, replaceRoleHolderSchema);
    const { profile: actor } = await requireActiveActor(request);
    const admin = getAdminClient();
    const target = await getProfileById(admin, input.targetProfileId);

    if (!target || target.deleted_at) {
      throw new AppError("NOT_FOUND");
    }

    assertSameOrganization(actor, target);
    assertSeparateProfiles(actor, target);
    assertCanManageRole(actor.role, target.role);
    assertCanReplaceRole(actor.role, input.role);

    if (target.role !== input.role) {
      throw new AppError("VALIDATION_FAILED", {
        details: {
          fields: [
            {
              message: "Choose an inactive candidate already assigned to this role.",
              path: "targetProfileId",
            },
          ],
        },
      });
    }

    if (input.expectedCurrentHolderId === target.id) {
      throw new AppError("VALIDATION_FAILED", {
        details: {
          fields: [
            {
              message: "The replacement and current role holder must be different people.",
              path: "expectedCurrentHolderId",
            },
          ],
        },
      });
    }

    if (input.expectedCurrentHolderId) {
      const expectedHolder = await getProfileById(admin, input.expectedCurrentHolderId);
      if (!expectedHolder || expectedHolder.deleted_at) {
        throw new AppError("CONFLICT_STALE_VERSION");
      }

      assertSameOrganization(actor, expectedHolder);
      if (expectedHolder.role !== input.role) {
        throw new AppError("CONFLICT_STALE_VERSION");
      }
    }

    const { data: currentHolder, error: currentHolderError } = await admin
      .from("profiles")
      .select("id")
      .eq("organization_id", actor.organization_id)
      .eq("role", input.role)
      .eq("account_status", "active")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (currentHolderError) {
      throw fromDatabaseError(currentHolderError);
    }

    const currentHolderId =
      currentHolder && typeof (currentHolder as Record<string, unknown>).id === "string"
        ? ((currentHolder as Record<string, unknown>).id as string)
        : null;

    if (input.expectedCurrentHolderId && currentHolderId !== input.expectedCurrentHolderId) {
      throw new AppError("CONFLICT_STALE_VERSION");
    }

    if (currentHolderId === target.id) {
      return {
        changed: false,
        previousHolderId: currentHolderId,
        role: input.role,
        roleHolder: {
          account_status: target.account_status,
          full_name: target.full_name,
          id: target.id,
          phone_e164: target.phone_e164,
          reports_to_profile_id: target.reports_to_profile_id,
          role: target.role,
          session_version: target.session_version,
        },
      };
    }

    if (target.account_status !== "inactive") {
      throw new AppError("VALIDATION_FAILED", {
        details: {
          fields: [
            {
              message: "The replacement candidate must have inactive account status.",
              path: "targetProfileId",
            },
          ],
        },
      });
    }

    const { error: replaceError } = await admin.rpc("replace_role_holder", {
      p_actor_profile_id: actor.id,
      p_expected_current_holder_id: currentHolderId,
      p_reason: input.reason,
      p_request_id: requestId,
      p_role: input.role,
      p_target_profile_id: target.id,
    });

    if (replaceError) {
      throw fromDatabaseError(replaceError, "ROLE_HOLDER_CONFLICT");
    }

    const { data: activeHolder, error: activeHolderError } = await admin
      .from("profiles")
      .select("id,full_name,phone_e164,role,account_status,session_version,reports_to_profile_id")
      .eq("organization_id", actor.organization_id)
      .eq("role", input.role)
      .eq("account_status", "active")
      .is("deleted_at", null)
      .single();

    if (activeHolderError) {
      throw fromDatabaseError(activeHolderError);
    }

    return {
      changed: true,
      previousHolderId: currentHolderId,
      role: input.role,
      roleHolder: activeHolder,
    };
  }),
);
