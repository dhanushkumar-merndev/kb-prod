# Superfone integration

## Current status: official provider contract required

The repository contains the provider boundary, normalized data model, Edge
Function entry points, idempotency controls, sync bookkeeping and CRM
conversation UI. It does **not** contain a guessed Superfone production
endpoint, authentication header, webhook signature algorithm or payload map.

`PendingOfficialContractProvider` reports every capability as unavailable.
Supplying environment values alone does not enable the integration. Calls
return typed `SUPERFONE_NOT_CONFIGURED` or
`SUPERFONE_CAPABILITY_UNAVAILABLE` errors instead of sending fake requests or
claiming delivery.

This status is intentional and must remain until official documentation or a
provider-approved contract is supplied and verified.

## Provider information still required

Obtain all of the following from Superfone:

1. production and sandbox base URLs;
2. authentication scheme, credential names and required headers;
3. account/tenant identifier behavior;
4. connection-test endpoint and expected response;
5. lead list endpoint, filters, page size, cursor semantics and rate limits;
6. conversation, message and call history endpoints, if supported;
7. outbound text and media endpoints, request schemas and idempotency support;
8. webhook URL configuration procedure;
9. webhook signature/shared-secret header, exact signing bytes, algorithm,
   timestamp format and replay tolerance;
10. stable webhook event ID and complete event-type catalog;
11. delivery/read/failure status meanings and ordering guarantees;
12. retry rules, `Retry-After` behavior and API error taxonomy;
13. media size/type/upload/download rules;
14. recording retention/consent rules;
15. test credentials and representative signed fixtures.

Do not infer any missing field from examples or an unofficial blog.

## Adapter contract

The provider interface is defined in
`supabase/functions/_shared/superfone/types.ts` and implemented at
`supabase/functions/_shared/superfone/adapter.ts`.

Capabilities:

- `testConnection`
- `fetchLeads`
- `fetchConversations`
- `fetchMessages`
- `fetchCalls`
- `sendMessage`
- `sendMedia`
- `verifyWebhook`

The future official adapter must:

- read credentials only from Deno environment secrets;
- use the documented endpoints and headers;
- verify the raw webhook body before parsing when required;
- map provider data to the normalized types in `types.ts`;
- return only safe provider response/error fields;
- set a capability to `true` only after that operation is implemented and
  integration-tested;
- never translate accepted/queued into delivered/read.

`SUPERFONE_WEBHOOK_TOLERANCE_SECONDS` is present in the environment contract but
is not used by the pending adapter. The official webhook verifier must validate
and bound it before enforcing timestamp replay protection.

## Edge Functions

| Function                          | Caller                                            | Purpose while adapter is pending                                                                              |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `superfone-test-connection`       | Director JWT                                      | Returns capability-unavailable; future connection test persists safe status/capabilities                      |
| `superfone-import-existing-leads` | Director JWT                                      | Resumable historical lead import once `fetchLeads` exists                                                     |
| `superfone-sync`                  | Director JWT                                      | Incremental cursor/date sync once `fetchLeads` exists                                                         |
| `superfone-webhook`               | Provider, no Supabase JWT                         | Verifies provider signature, reserves event idempotently and normalizes supported events once verifier exists |
| `superfone-send-message`          | Director/Manager/Sales Manager/assigned Sales JWT | Rate-limited, idempotent outbound text once enabled                                                           |
| `superfone-send-media`            | Same sales scope                                  | Path and permission checks; deliberately unavailable until media contract exists                              |
| `superfone-replay-event`          | Director JWT                                      | Reprocesses a stored failed event through the official mapper                                                 |

The webhook must be deployed without Supabase gateway JWT verification because
the provider cannot send a staff JWT. This does not make it unauthenticated:
the adapter must authenticate the raw request using the official webhook
signature/secret. All other provider functions require an active staff JWT.

## Webhook pipeline

```text
raw provider request
  → verify signature, timestamp and account
  → validate/map payload
  → find connected organization by safe account identifier
  → reserve (organization, provider, provider event id)
  → duplicate: acknowledge without reapplying
  → new event: mark processing
  → upsert/append normalized lead, conversation, message or call
  → mark integration event processed
  → authorized Realtime subscribers refresh
```

On processing failure the event is retained with a safe error and attempt count
for Director review/replay. Raw credentials, proof URLs and stack traces must
never be stored in the event or logs.

## Lead merge rules

`mergeProviderLead` uses this order:

1. organization + provider + provider lead ID;
2. otherwise organization + normalized phone;
3. insert only when neither exists.

For an existing lead, provider synchronization fills missing provider fields
and updates provider activity time. It preserves assignment, human notes and
booking links, and appends a `provider_sync` lead activity. Unique indexes are
the race-safe final deduplication layer.

## Conversation and message persistence

- Provider conversations upsert on organization/provider/provider-conversation
  ID.
- Provider messages upsert on organization/provider/provider-message ID.
- Calls dedupe on organization/provider-call ID.
- Outbound requests reserve a CRM message row using an idempotency key.
- Every outbound attempt has a `message_attempts` row.
- Provider-confirmed status events update sent/delivered/read/failure times.
- Internal notes use normalized CRM rows and are never passed to the provider.

## Historical import

The implemented sync runner:

- creates an `integration_sync_runs` row;
- accepts a resume cursor;
- processes up to 100 provider pages per invocation;
- updates cursor and fetched/inserted/updated/duplicate/failed counts after each
  page;
- marks completed, partially completed or failed with a safe summary.

Provider page size, rate-limit backoff and next-cursor behavior must follow the
official contract. A production acceptance test must interrupt a multi-page
import and resume it without duplicate leads.

## Outbound safety

Outbound text requires:

- an active Director/Manager/Sales Manager/Sales profile;
- tenant-matching conversation;
- assigned ownership for an individual Sales user;
- body length validation;
- UUID idempotency key;
- provider `sendMessage` capability;
- fewer than 30 outbound CRM message rows from that sender in the preceding
  minute.

The pending adapter rejects before inserting a queued message. Once enabled,
the workflow records queued/attempt/sent or failed state. Retries must use a new
idempotency key and reference the failed message.

## Environment secrets

Configure only in the Supabase Edge Function environment:

```env
SUPERFONE_BASE_URL=
SUPERFONE_API_KEY=
SUPERFONE_ACCOUNT_ID=
SUPERFONE_WEBHOOK_SECRET=
SUPERFONE_WEBHOOK_TOLERANCE_SECONDS=300
```

Names may be adapted to the official contract in one reviewed change. Never
move them to `NEXT_PUBLIC_*`, a database row, rendered HTML or client log.

## Activation procedure

1. Save the official API/webhook documents with version/date for review.
2. Implement the real provider class and strict Zod payload schemas.
3. Add signed webhook fixtures and negative signature/replay tests.
4. Add sandbox tests for every capability to be enabled.
5. Confirm status mapping, idempotency and pagination against the sandbox.
6. Enable only verified capabilities in `capabilities`.
7. Configure staging secrets.
8. Deploy the webhook with gateway JWT verification disabled; deploy all staff
   functions with JWT verification enabled.
9. Use Director “Connect & Test” in staging.
10. Register the generated staging webhook URL and replay signed fixtures.
11. Run incremental sync and an interrupted/resumed historical import.
12. Test concurrent assignment and duplicate outbound clicks.
13. Repeat in production with production-only credentials and URLs.

## Acceptance criteria

Superfone is not production-ready until:

- connection test succeeds against an official sandbox/production endpoint;
- bad signature, expired timestamp and wrong account are rejected;
- duplicate webhook event is acknowledged once without duplicate business rows;
- phone/provider dedupe preserves human data;
- cursor import resumes and records accurate counts;
- unsupported controls remain disabled with a clear reason;
- outbound idempotency prevents duplicate sends;
- only provider-confirmed statuses show delivered/read;
- credentials and raw sensitive payloads are absent from browser bundles/logs;
- authorized Realtime users see new activity and other roles/tenants do not.
