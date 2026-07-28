# Khana Banao CRM implementation progress

Last updated: 2026-07-28

## Implementation contract

- `AGENTS.md` read completely (3,022 lines) before implementation.
- Legacy HTML reviewed completely (2,689 lines).
- Sanitized visual-only copy saved at `reference/legacy-crm.html`; the embedded Supabase
  project URL and publishable key were removed.
- Existing user changes to `AGENTS.md` and the deleted `CLAUDE.md` are intentionally not
  included in implementation commits.

## Phase status

| Phase | Scope                                                                                                    | Status                                       |
| ----- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1     | Fresh scaffold, Auth/session controls, base schema, tenant RLS, Storage policies, account Edge Functions | Code complete; migration validation pending  |
| 2     | Relationships, constraints, transactional RPCs, audit history, database tests                            | Code complete; migration validation pending  |
| 3     | Shared responsive UI system, shell, toasts, query/realtime infrastructure                                | Complete                                     |
| 4     | Seven role dashboards, navigation, KPIs and analytics                                                    | Complete                                     |
| 5     | Leads, follow-ups, calls and conversations                                                               | Core complete; provider actions pending      |
| 6     | Bookings and payment proof lifecycle                                                                     | Code complete; migration validation pending  |
| 7     | Workforce assignment, jobs and attendance                                                                | Code complete; migration validation pending  |
| 8     | Expenses, leave, tasks, meetings and payroll                                                             | Core CRUD complete; payroll workflow pending |
| 9     | Superfone adapter, webhook, import/sync and capability-gated messaging                                   | Waiting for official provider configuration  |
| 10    | Full test matrix, accessibility/responsive verification, production build and deployment docs            | In progress                                  |
| 11    | Lead-stage automation, private PDF invoices and Brevo customer email                                     | Remote migration applied; rollout pending    |

## Phase 1 work log

- Installed the required runtime and development toolchain with pnpm.
- Added lint, TypeScript, Vitest, Playwright, Prettier and Supabase CLI scripts.
- Added `.env.example` without secrets.
- Added the mandatory Bricolage Grotesque, IBM Plex Sans and IBM Plex Mono font setup.
- Added the Khana Banao navy/saffron global design tokens and accessibility defaults.
- Implemented Supabase SSR browser/server clients and the Next.js 16 request proxy.
- Implemented phone/password login without role selection, including canonical Indian phone
  normalization and the hidden internal Auth email convention.
- Implemented database-backed login sessions, HTTP-only application session identifiers,
  role-home redirects, exact account-status messages, Realtime profile revocation, session
  version checks, periodic/focus heartbeats, local logout and the protected layout guard.
- Added typed safe frontend errors and focused Auth/permission/architecture unit tests.
- Added server-enforced, role-specific layouts and navigation for Director, Manager, HR,
  Sales Manager, Sales Executive, Chef and Part-time Chef.
- Added real RLS-scoped KPI dashboards and operational charts for all seven roles.
- Added working lead, booking, payment proof, team-access, Chef assignment, attendance,
  expense, leave, task, meeting and temporary-worker workflows.
- Added normalized schema migrations, transactional workflow RPCs, tenant RLS, private
  Storage policies, Realtime publication setup and privileged account Edge Functions.

## Validation

- `pnpm lint` — passing.
- `pnpm typecheck` — passing in strict mode.
- `pnpm test:unit` — 17 files and 115 assertions passing.
- `pnpm build` — passing; all seven protected role dashboard namespaces are included.
- Changed email/invoice/lead automation files — Prettier check passing. The repository-wide
  `pnpm format:check` still reports the existing formatting baseline.
- Edge Function strict type/prettier checks — passing for the current files.

Remote migrations through `202607280001` are applied and aligned with local history. Remote
schema lint and read-only table/bucket verification pass. Local pgTAP execution remains pending
until a local Supabase/Docker runtime is available.

## Environment handoff

The real environment is configured. Continue using reviewed migrations for every database
change; do not reset or reseed staging/production.
