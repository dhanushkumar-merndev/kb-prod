import { configuredBrevoSender, testBrevoAccount } from "../_shared/brevo.ts";
import { getAdminClient, requireActiveActor } from "../_shared/auth.ts";
import { AppError, fromDatabaseError, toAppError } from "../_shared/errors.ts";
import { withEdgeRequest } from "../_shared/http.ts";

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const { profile: actor } = await requireActiveActor(request);
    if (actor.role !== "director") throw new AppError("PERMISSION_DENIED");

    const admin = getAdminClient();
    let result: Awaited<ReturnType<typeof testBrevoAccount>>;
    try {
      result = await testBrevoAccount();
    } catch (error) {
      const safe = toAppError(error);
      const failed = await admin.from("integration_connections").upsert(
        {
          account_identifier_safe: null,
          capabilities: {
            attachments: true,
            deliveryWebhooks: true,
            transactionalEmail: true,
          },
          connected_by_profile_id: actor.id,
          last_error_safe: safe.message,
          last_tested_at: new Date().toISOString(),
          organization_id: actor.organization_id,
          provider: "brevo",
          status: "failed",
        },
        { onConflict: "organization_id,provider" },
      );
      if (failed.error) throw fromDatabaseError(failed.error);
      throw error;
    }

    const connection = await admin.from("integration_connections").upsert(
      {
        account_identifier_safe: result.accountIdentifierSafe,
        capabilities: {
          attachments: true,
          deliveryWebhooks: true,
          transactionalEmail: true,
        },
        connected_at: new Date().toISOString(),
        connected_by_profile_id: actor.id,
        last_error_safe: null,
        last_success_at: new Date().toISOString(),
        last_tested_at: new Date().toISOString(),
        organization_id: actor.organization_id,
        provider: "brevo",
        status: "connected",
      },
      { onConflict: "organization_id,provider" },
    );
    if (connection.error) throw fromDatabaseError(connection.error);

    return {
      accountIdentifierSafe: result.accountIdentifierSafe,
      connected: true,
      planSummary: result.planSummary,
      sender: configuredBrevoSender().replace(/^(.{2}).*(@.*)$/u, "$1***$2"),
    };
  }),
);
