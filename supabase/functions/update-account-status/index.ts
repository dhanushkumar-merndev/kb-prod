import { getAdminClient, getProfileById, requireActiveActor } from "../_shared/auth.ts";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import {
  assertCanManageRole,
  assertSameOrganization,
  assertSeparateProfiles,
} from "../_shared/permissions.ts";
import { updateAccountStatusSchema } from "../_shared/schemas.ts";

Deno.serve((request) =>
  withEdgeRequest(request, async ({ requestId }) => {
    const input = await parseJson(request, updateAccountStatusSchema);
    const { profile: actor } = await requireActiveActor(request);
    const admin = getAdminClient();
    const target = await getProfileById(admin, input.targetProfileId);

    if (!target || target.deleted_at) {
      throw new AppError("NOT_FOUND");
    }

    assertSameOrganization(actor, target);
    assertSeparateProfiles(actor, target);
    assertCanManageRole(actor.role, target.role);

    if (target.account_status === input.accountStatus) {
      return {
        accountStatus: target.account_status,
        changed: false,
        profileId: target.id,
        sessionVersion: target.session_version,
        sessionsClosed: target.account_status !== "active",
      };
    }

    if (input.accountStatus === "payment_pending" && target.role !== "part_time_chef") {
      throw new AppError("VALIDATION_FAILED", {
        details: {
          fields: [
            {
              message: "Payment pending is only valid for Part-time Chef accounts.",
              path: "accountStatus",
            },
          ],
        },
      });
    }

    if (input.accountStatus === "active" && target.role === "part_time_chef") {
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
      if (proofRequired && !target.part_time_payment_proof_path) {
        throw new AppError("PAYMENT_PROOF_REQUIRED");
      }
    }

    const { error: updateError } = await admin.rpc("update_account_status", {
      p_account_status: input.accountStatus,
      p_actor_profile_id: actor.id,
      p_reason: input.reason,
      p_request_id: requestId,
      p_target_profile_id: target.id,
    });

    if (updateError) {
      const fallback =
        input.accountStatus === "active" &&
        (target.role === "manager" || target.role === "hr" || target.role === "sales_manager")
          ? "ROLE_HOLDER_CONFLICT"
          : "DATABASE_OPERATION_FAILED";
      throw fromDatabaseError(updateError, fallback);
    }

    const updatedProfile = await getProfileById(admin, target.id);
    if (!updatedProfile) {
      throw new AppError("DATABASE_OPERATION_FAILED");
    }

    return {
      accountStatus: updatedProfile.account_status,
      changed: true,
      profileId: updatedProfile.id,
      sessionVersion: updatedProfile.session_version,
      sessionsClosed: updatedProfile.account_status !== "active",
    };
  }),
);
