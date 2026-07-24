# Khana Banao CRM architecture

`AGENTS.md` is the product and security contract. This document describes the
checked-in implementation; it does not replace that contract.

## System context

```text
Staff browser
  │
  ├─ Next.js App Router
  │    ├─ Server Components: initial, RLS-scoped reads
  │    ├─ Server Actions: validated mutations and cache revalidation
  │    ├─ Client Components: forms, drawers, charts and Realtime refresh
  │    └─ server-side role/session guards
  │
  └─ Supabase
       ├─ Auth: internal email + password behind phone-number login
       ├─ PostgreSQL: normalized tenant data, RLS and transactional RPCs
       ├─ Storage: private employee, payment, expense and conversation files
       ├─ Realtime: focused operational table changes
       └─ Edge Functions
            ├─ bootstrap and privileged account administration
            └─ Superfone adapter boundary and provider workflows
```

The browser never receives the service-role key or provider credentials. The
legacy HTML is retained only at `reference/legacy-crm.html` for visual
comparison and is not an application dependency.

## Runtime boundaries

| Boundary                | Responsibility                                                                                                               | Trust level                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Next.js route/layout    | Render the role workspace and perform server-side session and namespace checks                                               | Authenticated user                   |
| Next.js Server Action   | Parse form input with Zod, call an RLS-protected table/RPC or an authenticated Edge Function, and revalidate affected routes | Authenticated user                   |
| Browser Supabase client | Scoped Realtime subscriptions and interactive authenticated operations                                                       | Public publishable key plus user JWT |
| PostgreSQL/RLS          | Tenant isolation, active-account checks, row/column access and authoritative state transitions                               | Security authority                   |
| Security-definer RPC    | Multi-row transactional workflows, version/status checks, history and audit writes                                           | Database-controlled                  |
| Edge Function           | Auth administration, service-role work and provider operations                                                               | Privileged server runtime            |
| Storage policy          | Bucket, tenant, path and role checks                                                                                         | Database-controlled                  |

RLS and RPC permission checks remain authoritative even when the UI hides an
action. A role menu is navigation, not an authorization boundary.

## Authentication and application sessions

The login form accepts only an Indian phone number and password.

1. The phone is normalized to E.164.
2. A deterministic internal Auth email is derived from the normalized phone.
   It is never shown in the interface.
3. Supabase Auth validates the password.
4. `get_my_auth_context()` loads the database profile.
5. Account status is checked before access is granted.
6. `open_login_session()` binds an opaque application session code to the
   current Supabase Auth session.
7. The application stores only that opaque code in an HTTP cookie and redirects
   to the profile's role dashboard.

Every protected Server Component calls `requireActiveSession()` and role
layouts call `requireRoleSession()`. The session must satisfy all of these:

- the Supabase Auth session still exists;
- the application session is bound to the current Auth session;
- the application session version equals `profiles.session_version`;
- the profile is active and not deleted;
- the organization is active;
- inactivity is less than 12 hours;
- absolute session age is less than seven days.

The database enforces one active application/Auth session per profile.
Deactivation, blocking and role replacement increment the session version,
close application sessions and remove the corresponding Auth sessions.
Clients also subscribe to their profile row so revoked users are sent back to
login promptly. “Log out all devices” closes every application and Auth session
for the caller.

## Role route structure

All seven roles use the same shell and dynamic module renderer:

| Database role    | URL namespace     | Home                        |
| ---------------- | ----------------- | --------------------------- |
| `director`       | `/director`       | `/director/dashboard`       |
| `manager`        | `/manager`        | `/manager/dashboard`        |
| `hr`             | `/hr`             | `/hr/dashboard`             |
| `sales_manager`  | `/sales-manager`  | `/sales-manager/dashboard`  |
| `sales`          | `/sales`          | `/sales/dashboard`          |
| `chef`           | `/chef`           | `/chef/dashboard`           |
| `part_time_chef` | `/part-time-chef` | `/part-time-chef/dashboard` |

Each namespace has its own server layout, dashboard, loading boundary, error
boundary and module route. A user who requests another role namespace is
redirected to their own home. Unknown module slugs return a real 404.

Navigation definitions live in `src/lib/navigation/role-navigation.ts`.
Shared feature panels are selected by the role/module resource in
`src/features/modules/role-module-page.tsx`, which avoids copying business logic
into seven route trees.

## Data access and mutations

Initial dashboard and module reads are made through server-side Supabase
clients. The JWT is forwarded from the request cookies, so these reads remain
subject to RLS. Query modules parse database responses with Zod before handing
them to components.

Interactive mutations use one of two patterns:

- ordinary, single-domain CRUD uses a Server Action with Zod validation and
  RLS-protected Supabase access;
- state machines or multi-row changes call a security-definer PostgreSQL RPC
  that derives the actor and organization from `auth.uid()`.

Successful actions revalidate only affected role paths. Client forms use React
action state for pending/disabled feedback and surface safe success or error
messages. Database/provider errors are mapped to application error codes rather
than exposing raw stack traces.

The current source uses server queries, Server Actions and focused Supabase
Realtime refresh. TanStack Query and TanStack Table are installed but are not
currently imported by the application; they must not be listed as an active
runtime dependency until adopted for client caching or complex data grids.

## Realtime

Migration `202607230004_storage_and_realtime.sql` publishes focused operational
tables, including profiles, leads, conversations, messages, bookings,
assignments, payments, attendance, expenses, leave, tasks, meetings and
notifications. Raw provider payloads, audit history and payroll ledgers are not
published.

The shared `RealtimeRefresh` component subscribes with the authenticated
browser client and refreshes the current server-rendered view when an
authorized row changes. Conversation and notification workspaces use narrower
channels for timeline/unread behavior. PostgreSQL RLS still controls what a
subscriber may receive.

## Storage

All application buckets are private. PostgreSQL stores paths, never base64 file
contents or permanent public URLs. Reads use five-minute signed URLs in the
implemented payment, employee and expense workflows.

Object paths have four components and begin with the organization UUID. The
remaining components bind the object to its profile, booking, expense or
conversation. Database constraints validate referenced paths in addition to
Storage policies.

See `docs/DATABASE.md` for bucket limits and policy scope.

## Transactional workflows

Authoritative workflow transitions are kept close to the data:

- role-holder replacement and account revocation;
- lead and conversation assignment;
- sales follow-ups, calls and internal notes;
- booking creation/update and payment review;
- Chef assignment and service status;
- shift start/end/review/correction and manual attendance;
- expense and leave review;
- private employee-record and compensation updates;
- temporary-worker assignment;
- payroll generation, correction, review, approval, payment, locking and
  reversal.

RPCs lock or version-check the relevant records, derive tenant/actor context,
write audit/history records and commit as one transaction. Unique indexes
provide the final race-safe guard for role holders, provider events, outbound
idempotency keys, active assignments and open shifts.

## Edge Functions

Privileged account functions:

- `bootstrap-organization`
- `create-team-member`
- `update-account-status`
- `replace-role-holder`

Provider-boundary functions:

- `superfone-test-connection`
- `superfone-webhook`
- `superfone-sync`
- `superfone-import-existing-leads`
- `superfone-send-message`
- `superfone-send-media`
- `superfone-replay-event`

Every authenticated function revalidates the JWT against Supabase Auth, loads
the active profile from the database and checks the current Auth session before
using the service-role client.

The Superfone adapter is intentionally capability-disabled until the official
contract is supplied. The normalization, idempotency, sync and persistence
pipeline is present, but no production endpoint, header or signature algorithm
has been guessed. See `docs/SUPERFONE_INTEGRATION.md`.

## Frontend composition

```text
src/app/                         App Router boundaries and role routes
src/components/layout/           Shared responsive application shell
src/components/realtime/         Focused Realtime-to-server refresh bridge
src/features/auth/               Login, logout and session checks
src/features/dashboard/          RLS-scoped role metrics and charts
src/features/modules/            Shared role/module dispatch
src/features/*/actions.ts        Validated Server Actions
src/features/*/queries.ts        RLS-scoped query repositories
src/lib/auth/                    Session and role guards
src/lib/navigation/              Canonical role navigation
src/lib/permissions/             Frontend permission helpers
src/lib/supabase/                Browser, server and proxy clients
supabase/migrations/             Versioned schema, RLS and RPCs
supabase/functions/              Privileged/provider Edge Functions
```

The design tokens and responsive shell are centralized in application CSS.
Desktop uses the navy sidebar; mobile uses a focus-trapped navigation drawer.
Charts use the shared navy/saffron/mint status palette.

## Environment isolation

Local, staging and production must use separate Supabase projects and Storage
buckets. Only the publishable URL/key are exposed to Next.js browser code.
Service-role and Superfone values belong in Edge Function secrets.

Migration files describe the desired database state but do not prove that any
particular remote project has that state. Record `supabase migration list`,
dry-run, push and post-push verification evidence for each environment as
described in `docs/DEPLOYMENT.md`.
