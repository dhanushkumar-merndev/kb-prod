# Testing and release validation

No single test layer proves production readiness. Run static checks, unit tests,
a clean migrated database with pgTAP, browser workflows and a production build.
Never describe a remote database or provider integration as tested without
retained environment-specific evidence.

## Commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:test
pnpm test:e2e
pnpm build
```

`supabase:reset` is local-only. Never use it on staging or production.

## Static and build gates

| Gate                   | Command             | Pass condition                                                  |
| ---------------------- | ------------------- | --------------------------------------------------------------- |
| Formatting             | `pnpm format:check` | No unformatted tracked source/docs                              |
| ESLint                 | `pnpm lint`         | Exit 0 with zero warnings                                       |
| TypeScript             | `pnpm typecheck`    | Strict compile with no emit/errors                              |
| Production compilation | `pnpm build`        | Next.js build completes and all expected role routes are listed |

Run the production build with the same public environment-variable shape used
for deployment. Do not substitute dummy server secrets into browser variables.

## Unit and component tests

Vitest runs in JSDOM through `vitest.config.ts`; React Testing Library setup is
in `tests/setup.ts`.

The checked-in suites cover:

- Indian phone normalization and hidden Auth-email derivation;
- account-status messaging;
- role redirect/namespace logic;
- application-session helpers;
- login form fields and safe validation feedback;
- role hierarchy and domain permissions;
- exact role navigation and route file presence;
- legacy browser-storage/embedded-secret architecture prohibition;
- conversation result parsing and provider-confirmed status preservation;
- Superfone pending-adapter boundaries and required function files;
- sales assignment/follow-up validation;
- integer/paise payroll arithmetic and payroll input validation.

Run:

```bash
pnpm test
```

For one area:

```bash
pnpm exec vitest run tests/unit/auth
pnpm exec vitest run tests/unit/payroll
```

Unit tests do not prove RLS, Storage policy, SQL syntax or real session behavior.

## Database and RLS tests

`supabase/tests/001_phase1_security.test.sql` is a pgTAP transaction with 58
planned assertions and deterministic fixture UUIDs. Its outer transaction
rolls back all Auth/business fixtures.

It exercises tenant and role scope, inactive-account denial, hierarchy
constraints, role-holder replacement/session invalidation, deduplication,
private records and key workforce/payment operations. Treat the SQL file's
current assertions as the source of exact database coverage.

`supabase/tests/003_franchise_isolation.test.sql` is a pgTAP transaction with 26
planned assertions covering the franchise tier: one organization with two
franchises, and a full Franchise Owner → Manager → Sales Manager → Sales chain in
each.

It asserts that every franchise-scoped table carries both the restrictive
isolation policy and the write-guard trigger, that role-holder uniqueness is per
franchise, that a Franchise Owner cannot read, update or plant rows in another
franchise, that the definer read models and dashboard aggregates are franchise
scoped, that only the Director may create a franchise or route a lead, and that
the Director retains organization-wide reach.

Its fixtures build a live application session (`login_sessions` bound to
`auth.sessions`), because access requires one.

Run against a clean local database:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:test
```

The reset is part of the test: it proves migrations reproduce from zero in
order. A pgTAP pass against an old manually modified database is insufficient.

Before production, database coverage must include allow and deny cases for:

- every role and a second organization;
- inactive/blocked/session-version access;
- one active role holder;
- provider/phone/message/outbound idempotency;
- atomic lead conversion and payment decision;
- Chef assignment/date conflict;
- one open shift and attendance review/correction;
- payroll eligibility and immutable paid history;
- all four private Storage buckets.

If an item is not asserted by the current pgTAP file, add a later test before
claiming it is covered.

## Playwright

`playwright.config.ts` is configured for:

- desktop Chromium;
- mobile Chromium (Pixel 5 profile);
- a Next.js development server on an isolated port;
- trace on first retry and screenshot on failure.

At the time this document was generated, `tests/e2e` contains no executable
specs. Configuration alone is not E2E coverage, and `pnpm test:e2e` must not be
reported as passing production workflows until specs exist.

Required E2E flows:

1. one-time Director bootstrap and phone/password login;
2. hierarchy account creation;
3. deactivation/realtime revocation and correct warning;
4. all seven role redirects, sidebars and dashboards;
5. unauthorized namespace and direct data denial;
6. lead assignment, follow-up, note/call and conversion;
7. payment proof submit/review;
8. HR Chef assignment;
9. Chef start/end shift and service completion;
10. HR attendance review and payroll eligibility;
11. final payment and fully completed booking;
12. payroll prepare/review/approve/pay/lock with retained history;
13. expense bill, employee file and payment-proof privacy;
14. meeting create/edit/status/delete and Google Calendar URL;
15. Realtime lead/conversation/attendance/notification updates;
16. Superfone duplicate webhook/import/outbound flow after the official adapter
    is enabled.

Use isolated test organizations/users and deterministic cleanup. Never seed or
reuse production credentials. Tests that need service-role administration must
read it from the test runner environment and never print it.

## Responsive and accessibility validation

Automate or manually retain screenshots/results for:

```text
360×800
390×844
768×1024
1024×768
1366×768
1440×900
```

For each critical flow verify:

- no horizontal page overflow;
- mobile navigation opens, traps focus, closes on Escape and restores focus;
- keyboard-visible saffron focus state;
- controls have labels and 44px touch targets where practical;
- drawers/dialogs are keyboard usable;
- tables have usable scrolling/card behavior;
- top-right toast placement moves below the mobile app bar;
- loading, empty, success and error states are readable;
- conversation composer remains usable above the mobile safe area;
- chart has an accessible summary and zero-data state.

## Superfone test boundary

While `PendingOfficialContractProvider` is active, the correct tests assert:

- missing configuration returns `SUPERFONE_NOT_CONFIGURED`;
- configured-but-unsupported capability returns
  `SUPERFONE_CAPABILITY_UNAVAILABLE`;
- no invented endpoint appears in source;
- provider-only controls remain unavailable.

Do not mark connection, webhook, sync, send or delivery status as integration
tested. Once the official contract arrives, add signed fixtures, sandbox tests
and negative tests for invalid signature, stale timestamp, wrong account,
duplicate event, rate limit and provider failures.

## Remote release verification

After staging/production migration push, retain:

- linked project/environment name (not credentials);
- local/remote migration list;
- dry-run and push output;
- RLS-enabled table check;
- selected `anon`/role allow-deny probes;
- private bucket/policy checks;
- Edge Function deployment/version;
- seven-role smoke-test evidence;
- provider status/evidence.

Database migration files do not prove this state automatically.

## Result reporting template

```text
Release commit:
Environment:

format:check:
lint:
typecheck:
unit:
clean db reset:
pgTAP:
Playwright desktop:
Playwright mobile:
production build:

Migrations before/after:
RLS/Storage/Realtime verification:
Seven-role smoke test:
Superfone status:
Known blockers:
```

Report `not run` or the exact blocker rather than converting a missing
environment, missing Docker runtime, absent test spec or pending provider
contract into a pass.
