# Deployment and operations

This runbook separates local, staging and production. Migration files and a
successful build are not proof that a remote Supabase project has been
configured; retain command output for every release.

## Environment model

| Environment | Supabase                 | Data/secrets     | Purpose                                        |
| ----------- | ------------------------ | ---------------- | ---------------------------------------------- |
| Local       | Supabase CLI containers  | Development-only | Migration reset, pgTAP and feature development |
| Staging     | Dedicated linked project | Staging-only     | Full release rehearsal and provider sandbox    |
| Production  | Dedicated linked project | Production-only  | Live staff/customer data                       |

Never reuse another product's project, Storage buckets or provider credentials.
Never copy production Auth users into the development seed.

## Prerequisites

- Node.js 20.9 or newer
- pnpm 10
- Docker-compatible runtime for local Supabase
- access to the intended Supabase project
- deployment target for Next.js 16
- official Superfone contract and credentials only when enabling that integration

## Environment variables

Next.js runtime:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=
```

Supabase Edge Function secrets:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
BOOTSTRAP_TOKEN=

SUPERFONE_BASE_URL=
SUPERFONE_API_KEY=
SUPERFONE_ACCOUNT_ID=
SUPERFONE_WEBHOOK_SECRET=
SUPERFONE_WEBHOOK_TOLERANCE_SECONDS=300
```

`SUPABASE_DB_URL` is a local database-test convenience only. Service-role,
bootstrap and Superfone values must never be exposed through `NEXT_PUBLIC_*`.

Use `.env.local` for Next.js local development and a separate ignored file such
as `supabase/.env.local` when running `supabase secrets set`. Do not commit
either file.

## Local setup

```bash
pnpm install
cp .env.example .env.local
pnpm supabase:start
pnpm supabase:reset
pnpm dev
```

Fill the local publishable/anon/service values printed by `supabase start`
before starting Next.js or invoking Edge Functions. `supabase:reset` applies all
migrations and then the intentionally empty production-safe seed.

Run the quality gates before linking or pushing a remote project:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm supabase:test
pnpm build
```

Playwright also belongs in the release gate once executable specs and their
test-user setup are present:

```bash
pnpm test:e2e
```

## Staging database release

Confirm the intended project in the Supabase dashboard, then link explicitly:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <staging-project-ref>
pnpm exec supabase migration list
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
pnpm exec supabase migration list
```

Stop if the linked project, remote history or dry-run output is unexpected.
Never use `db reset` against staging or production.

Post-push checks must confirm:

- every checked-in migration is in remote history;
- every business table has RLS enabled;
- `anon` has no business table/function access;
- role-holder, idempotency and open-shift indexes exist;
- all four Storage buckets are private with the expected limits/policies;
- focused tables are in `supabase_realtime`;
- account/session helper functions and workflow RPC grants are present.

## Edge Function secrets

Prepare an ignored environment file containing only the target environment's
values, then:

```bash
pnpm exec supabase secrets set --env-file supabase/.env.staging
```

Generate a long random one-time `BOOTSTRAP_TOKEN`. Rotate or remove it after the
organization is successfully bootstrapped. Do not log the value.

Superfone secrets may remain unset while the adapter is pending. Setting them
does not enable capabilities without the official adapter.

## Edge Function deployment

The functions import npm packages by bare specifier (`@supabase/supabase-js`,
`zod`, `pdf-lib`). The remote bundler cannot resolve those without an import
map, so every `[functions.*]` block in `supabase/config.toml` declares
`import_map = "./functions/deno.json"`. A new function must add the same line or
its deploy fails with `Relative import path ... not prefixed with / or ./ or ../`.

`verify_jwt` is also read from `config.toml`, so the whole set deploys in one
command and each function keeps its configured gateway behaviour:

```bash
pnpm exec supabase functions deploy --project-ref <project-ref>
```

The per-function commands below remain valid when deploying a single function.

Functions requiring a staff JWT:

```bash
pnpm exec supabase functions deploy create-team-member
pnpm exec supabase functions deploy update-account-status
pnpm exec supabase functions deploy replace-role-holder
pnpm exec supabase functions deploy superfone-test-connection
pnpm exec supabase functions deploy superfone-sync
pnpm exec supabase functions deploy superfone-import-existing-leads
pnpm exec supabase functions deploy superfone-send-message
pnpm exec supabase functions deploy superfone-send-media
pnpm exec supabase functions deploy superfone-replay-event
```

Bootstrap and webhook do not use a staff JWT at the gateway:

```bash
pnpm exec supabase functions deploy bootstrap-organization --no-verify-jwt
pnpm exec supabase functions deploy superfone-webhook --no-verify-jwt
```

Bootstrap validates `x-bootstrap-secret` in constant time and the database
enforces a one-time global lock. The webhook must validate the official
provider signature before accepting an event; it remains capability-disabled
until that verifier is implemented.

## First organization bootstrap

Invoke exactly once over HTTPS. Substitute environment-specific values without
putting secrets in shell history:

```bash
curl --request POST \
  "$SUPABASE_URL/functions/v1/bootstrap-organization" \
  --header "Content-Type: application/json" \
  --header "x-bootstrap-secret: $BOOTSTRAP_TOKEN" \
  --data '{
    "organizationName": "Khana Banao",
    "organizationSlug": "khana-banao",
    "timezone": "Asia/Kolkata",
    "currency": "INR",
    "directorFullName": "Director Name",
    "directorPhone": "+919876543210",
    "directorPassword": "replace-with-a-strong-secret"
  }'
```

For production, use an approved secret-injection mechanism instead of literal
values. Confirm the response contains the organization/Director but no
credential. A second non-replay request must return
`BOOTSTRAP_ALREADY_COMPLETED`.

After bootstrap:

1. remove or rotate `BOOTSTRAP_TOKEN`;
2. log in as Director using phone/password;
3. create the active Manager;
4. create/appoint HR and Sales Manager through the hierarchy;
5. create worker accounts from their authorized branch lead;
6. verify disabled and cross-role users are denied.

## Next.js deployment

Configure only these values on the web deployment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_APP_URL`

Set `NEXT_PUBLIC_APP_URL` to the canonical HTTPS origin. In Supabase Auth,
configure the same site URL/allowed redirects and keep public signup disabled.

Build the exact release commit:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Deploy the built application using the platform's Next.js 16 support. Do not
place service-role, bootstrap or provider secrets in the web deployment.

The repository pins Vercel Functions to Mumbai (`bom1`) in `vercel.json`, which
keeps the Next.js compute in the same AWS region (`ap-south-1`) as the production
Supabase project. For an explicit cache-bypassing production deployment, first
link the intended Vercel project and then run:

```bash
npx --yes vercel@59.11.2 link
pnpm deploy:production:bom1 -- --confirm-production
```

The confirmation argument and link check prevent the script from silently
creating or deploying a different Vercel project. The command uses Vercel's
`--force` option, so it creates a fresh build without the previous build cache.

## Superfone activation

Do not mark this deployment step complete while the pending adapter is active.
After the official adapter passes staging:

1. configure production-only Edge Function secrets;
2. deploy the reviewed provider functions;
3. connect/test as Director;
4. copy
   `https://<project-ref>.supabase.co/functions/v1/superfone-webhook`;
5. register it with Superfone;
6. send an officially signed test event;
7. verify one normalized event/lead and a duplicate acknowledgement;
8. run an incremental sync, then an optional resumable historical import.

See `docs/SUPERFONE_INTEGRATION.md` for the provider acceptance checklist.

## Brevo and invoice activation

Deploy the customer-email functions after setting the four `BREVO_*` Edge
secrets:

```bash
pnpm exec supabase functions deploy brevo-test-connection
pnpm exec supabase functions deploy generate-booking-invoice
pnpm exec supabase functions deploy process-email-outbox --no-verify-jwt
pnpm exec supabase functions deploy brevo-webhook --no-verify-jwt
```

Keep automatic email disabled while deploying. In Director -> Integrations,
save the verified sender identity and invoice wording, then test the Brevo
connection. Register the Brevo webhook with the secret token and schedule
`process-email-outbox` every minute using the service-role bearer token.

Verify SPF, DKIM and DMARC, a controlled-recipient send, the private signed PDF
download, and webhook-confirmed delivery before enabling automation. Detailed
steps and supported events are in `docs/EMAIL_INVOICE_AUTOMATION.md`.

## Post-deployment smoke checks

Test with real RLS-scoped accounts for all seven roles:

- phone/password login reaches the correct dashboard;
- direct access to another role namespace redirects safely;
- inactive/blocked/payment-pending accounts receive the correct message;
- logout and logout-all-devices revoke access;
- dashboard metrics load from the database with zero-data handling;
- every sidebar route renders without 404, blank state or redirect loop;
- create/update/status workflows return visible success/error feedback;
- payment, employee and expense files are private and signed URLs expire;
- Realtime updates appear only to permitted roles;
- a second tenant cannot read or mutate the first tenant;
- production logs contain request IDs but no credentials, Aadhaar or proof URLs.

Provider actions should show capability-unavailable until the official adapter
is enabled.

## Backups, rollback and incident handling

Before a production migration, confirm Supabase backups/PITR appropriate to the
plan and record a restore point. SQL migrations are forward-only:

- do not edit an applied migration;
- do not run destructive reset/rollback commands in production;
- repair with a reviewed later migration;
- restore from backup/PITR only under the incident plan.

For an application regression, roll the web deployment back to the previous
compatible commit. If the prior application is incompatible with a forward
schema change, deploy a compatibility fix rather than reverting data blindly.

For suspected credential exposure:

1. rotate the affected Supabase/provider secret;
2. revoke affected Auth sessions;
3. inspect safe audit/integration logs;
4. preserve evidence without copying sensitive payloads;
5. deploy the corrected configuration;
6. re-run tenant, role and webhook security checks.

## Release evidence

Record without secret values:

- release commit;
- target environment/project name;
- `migration list` before/after;
- dry-run and push result;
- Storage/RLS/Realtime verification result;
- Edge Function deployment versions;
- bootstrap status (never the token/password);
- lint, typecheck, unit, pgTAP, E2E and build results;
- seven-role smoke-test result;
- Superfone status: `pending official contract` or the verified provider
  document/version and sandbox evidence.
