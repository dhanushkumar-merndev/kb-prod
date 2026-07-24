import { getAdminClient, requireActiveActor } from "../_shared/auth.ts";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import { withEdgeRequest } from "../_shared/http.ts";
import {
  createSuperfoneProvider,
  requireSuperfoneCapability,
} from "../_shared/superfone/adapter.ts";

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const { profile: actor } = await requireActiveActor(request);
    if (actor.role !== "director") throw new AppError("PERMISSION_DENIED");

    const provider = createSuperfoneProvider();
    requireSuperfoneCapability(provider, "testConnection");
    const result = await provider.testConnection();
    const admin = getAdminClient();
    const connection = await admin.from("integration_connections").upsert(
      {
        organization_id: actor.organization_id,
        provider: "superfone",
        status: "connected",
        account_identifier_safe: result.accountIdentifierSafe,
        capabilities: result.capabilities,
        connected_by_profile_id: actor.id,
        connected_at: new Date().toISOString(),
        last_tested_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error_safe: null,
      },
      { onConflict: "organization_id,provider" },
    );
    if (connection.error) throw fromDatabaseError(connection.error);

    return {
      connected: true,
      accountIdentifierSafe: result.accountIdentifierSafe,
      capabilities: result.capabilities,
    };
  }),
);
