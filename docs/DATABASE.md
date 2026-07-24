# Database, RLS and Storage

`AGENTS.md` is authoritative. This document is an operator/developer map of the
checked-in Supabase migrations.

## Migration ledger

Migrations are ordered and forward-only:

| Migration                                        | Responsibility                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `202607230001_core_schema.sql`                   | Extensions, enums, normalized tables, foreign keys, checks, timestamps, core uniqueness and query indexes                                                          |
| `202607230002_auth_helpers_and_rls.sql`          | Auth/tenant helper functions, initial RLS policies, restricted column grants, audit immutability and scoped read RPCs                                              |
| `202607230003_account_admin_and_integrity.sql`   | One-time organization bootstrap, team profile creation, account status, role replacement and integrity/audit triggers                                              |
| `202607230004_storage_and_realtime.sql`          | Four private buckets, Storage policies, focused Realtime publication and replica identity                                                                          |
| `202607230005_workforce_self_service.sql`        | Chef/PT Chef job projection, start/end shift and service-status transitions                                                                                        |
| `202607230006_booking_crud.sql`                  | Booking-from-lead creation, booking update and active-booking constraint                                                                                           |
| `202607230007_payment_workflow.sql`              | Payment verification/rejection and booking payment/service consequences                                                                                            |
| `202607230008_workforce_management.sql`          | Chef assignment/reassignment and attendance review                                                                                                                 |
| `202607230009_production_security_hardening.sql` | Auth-session binding, 12-hour idle/seven-day maximum lifetime, single-session enforcement, tighter admin scope, hierarchy/path constraints and privilege hardening |
| `202607230010_payroll_workflow.sql`              | Payroll lifecycle, source components, eligibility, immutable paid history, audited reversal and earnings summary                                                   |
| `202607230011_sales_conversation_workflows.sql`  | Atomic lead/conversation assignment, follow-ups, notes, manual calls, inbox/timeline RPCs and Superfone capability projection                                      |
| `202607230012_internal_workflow_completion.sql`  | Expense/leave review, private employee records, compensation, attendance correction/bulk/manual flows, temporary assignments and Chef date-conflict prevention     |

Do not edit a migration after it has been applied to a shared environment.
Create a later migration for every correction.

## Data model

All business rows are normalized. Tenant-owned tables carry
`organization_id`; mutable tables carry timestamps, and durable business
history is retained rather than overwritten or reset.

### Organization and identity

- `organizations`
- `organization_settings`
- `profiles`
- `role_assignment_history`
- `login_sessions`
- `audit_logs`

`profiles.id` is the Supabase Auth user UUID. Phone numbers are canonical E.164
values. The role and account-status enums are database constraints, not free
text. `reports_to_profile_id` expresses the Director → Manager → branch lead →
worker hierarchy.

### Sales and provider activity

- `leads`
- `lead_assignment_history`
- `lead_activities`
- `follow_ups`
- `conversations`
- `conversation_assignments`
- `messages`
- `message_attempts`
- `conversation_reads`
- `superfone_calls`
- `integration_connections`
- `integration_events`
- `integration_sync_runs`

Provider IDs and normalized phones are indexed for deduplication.
Assignments and human-entered notes survive provider merges. Provider message
status is persisted only from the adapter/event mapper; the application must
not infer delivered/read.

### Bookings and payments

- `bookings`
- `booking_status_history`
- `booking_assignments`
- `booking_payments`

`bookings.lead_id` preserves the conversion source and
`sold_by_profile_id` preserves sales ownership. Every payment stage is a
separate row with its own proof path and verification history; advance and
final proofs are never overwritten.

### Workforce

- `temporary_workers`
- `temporary_worker_assignments`
- `attendance_shifts`
- `break_sessions`

Temporary workers have no Auth profile. An attendance shift belongs to exactly
one profile or one temporary worker. Only `approved` or `corrected` shifts are
payroll eligible.

### Internal operations

- `expenses`
- `expense_attachments`
- `leave_requests`
- `tasks`
- `meetings`
- `meeting_attendees`
- `notifications`
- `announcements`
- `announcement_recipients`

Expense metadata is separate from Storage objects. Meeting attendees use a
composite key, and notifications are distinct from external provider messages.

### Payroll

- `payroll_periods`
- `payroll_entries`
- `payroll_components`
- `payroll_earnings_summary` (security-invoker view)

Payroll components retain their normalized source. The period state machine is:

```text
draft → prepared → reviewed → approved → paid → locked
```

Paid rows retain amount, date and reference. Corrections use an audited reversal
record; paid history is not deleted or zeroed.

## Critical relationships

```text
auth.users
  └─ profiles
      ├─ assigned leads/conversations/follow-ups/tasks
      ├─ sold bookings and submitted payments
      ├─ booking assignments and attendance
      ├─ expenses and leave
      └─ payroll entries

leads
  ├─ lead activities and assignment history
  ├─ follow-ups, calls and conversations
  └─ booking

conversations
  ├─ assignments and reads
  └─ messages → message attempts

bookings
  ├─ status history
  ├─ payment rows
  ├─ Chef and temporary-worker assignments
  ├─ attendance and expenses
  └─ payroll components
```

Composite foreign keys include `organization_id` where needed so a child cannot
reference another tenant's row.

## RLS authority

Migration 002 enables RLS on every business table. Migration 009 tightens
profile, role-history, login-session and audit visibility.

All policy helpers derive identity from `auth.uid()`:

- `current_profile_id()`
- `current_organization_id()`
- `current_role()`
- `current_auth_session_is_valid()`
- `is_active_profile()`
- `is_director()`
- `is_manager_or_director()`
- `is_hr_scope_admin()`
- `is_sales_scope_admin()`
- record-specific `can_read_*` helpers

The common policy predicate requires an active profile in the current
organization. An inactive, blocked, payment-pending, left or deleted profile
does not receive business rows.

RLS scope is branch-aware:

- Director: organization-wide access, subject to workflow functions for writes;
- Manager: lower-role operational data, excluding Director/provider-secret
  scope;
- HR: workforce branch;
- Sales Manager: sales branch;
- Sales: assigned/owned sales records;
- Chef/PT Chef: own profile, assigned jobs, own shifts, claims, leave, tasks,
  meetings and earnings.

Sensitive operations do not rely on broad direct table writes. Authenticated
users receive selected columns and explicit insert/update grants; immutable
audit, financial and assignment-history tables reject direct mutation.

## Session enforcement

Migration 009 binds `login_sessions.auth_session_id` to the Auth session ID in
the JWT and enforces:

- one active application session per profile;
- one application row per Auth session;
- 12-hour inactivity timeout;
- seven-day absolute maximum lifetime;
- matching profile `session_version`;
- active profile and organization.

`open_login_session`, `validate_login_session`, `touch_login_session`,
`close_login_session` and `close_all_my_login_sessions` are the only supported
session write interface. Reusable session codes are omitted from the columns
granted to authenticated login-activity readers.

## Concurrency and integrity

Important race-safe constraints include:

- one active Director, Manager, HR and Sales Manager per organization;
- one profile phone per organization;
- provider event, lead, conversation, message and call deduplication;
- outbound message idempotency key uniqueness;
- one active lead/conversation assignment;
- one active booking per lead;
- one active primary Chef assignment per booking;
- no conflicting active Chef assignment on the same work date;
- one open shift per profile or temporary worker;
- one open break per profile;
- one payroll entry per worker/period;
- one eligible payroll source component;
- one temporary-worker booking/date assignment.

Transactional RPCs use row/advisory locks, current status and/or expected
version checks where stale concurrent writes would be harmful.

## Transactional RPC catalog

### Organization and access

- `bootstrap_organization`
- `create_team_member_profile`
- `update_account_status`
- `replace_role_holder`

### Sales, conversations and bookings

- `assign_lead`, `reassign_lead`
- `assign_conversation`
- `create_sales_follow_up`, `update_sales_follow_up`
- `add_lead_note`, `log_manual_sales_call`
- `add_conversation_internal_note`, `set_conversation_status`
- `mark_conversation_read`
- `get_conversation_inbox`, `get_conversation_timeline`
- `create_booking_from_lead`, `update_booking_details`
- `review_booking_payment`

### Workforce

- `get_workforce_bookings`, `get_booking_assignee_summaries`
- `get_my_workforce_jobs`, `list_chef_availability`
- `assign_booking_chef`, `change_booking_service_status`
- `start_attendance_shift`, `end_attendance_shift`
- `review_attendance_shift`, `correct_attendance_shift`
- `bulk_approve_attendance_shifts`
- `record_missed_attendance_shift`
- `assign_temporary_worker_to_booking`

### Expenses, leave and employee records

- `submit_expense_claim`, `review_expense_claim`
- `review_leave_request`
- `update_employee_private_record`
- `update_workforce_compensation`

### Payroll

- `generate_payroll_period`
- `adjust_payroll_entry`
- `prepare_payroll_period`
- `review_payroll_period`
- `approve_payroll_period`
- `mark_payroll_paid`
- `lock_payroll_period`
- `reverse_payroll_entry`
- `get_my_payroll_earnings`

RPC execute privileges are explicitly revoked from `public`/`anon` and granted
only to the intended `authenticated` or `service_role` principal.

## Private Storage

| Bucket               | Maximum object | Allowed MIME types                  | Object path                                                 |
| -------------------- | -------------: | ----------------------------------- | ----------------------------------------------------------- |
| `employee-private`   |         10 MiB | PDF, JPEG, PNG, WebP                | `<org>/<profile>/<aadhaar\|part-time-payment-proof>/<file>` |
| `payment-proofs`     |          8 MiB | PDF, JPEG, PNG, WebP                | `<org>/<submitter>/<booking>/<file>`                        |
| `expense-bills`      |         10 MiB | PDF, JPEG, PNG, WebP                | `<org>/<submitter>/<expense>/<file>`                        |
| `conversation-media` |         15 MiB | PDF, JPEG, PNG, WebP, MP3, OGG, MP4 | `<org>/<conversation>/<sender-or-provider>/<file>`          |

Every bucket is `public = false`. Policies bind reads and writes to tenant,
role, record ownership and normalized metadata. Referenced financial or
employee objects cannot be deleted through the normal user path. Migration 009
also requires exactly four safe path components and blocks control characters,
backslashes and dot segments.

## Realtime publication

The `supabase_realtime` publication is populated idempotently with focused
operational tables. Full replica identity is enabled for records that need
reliable update/delete payloads. Audit logs, raw integration events and payroll
ledgers intentionally remain outside the publication.

## Audit and history

`audit_logs` is append-only from controlled database functions. Authenticated
clients cannot insert, update, delete or truncate it. Migration 009 also removes
service-role mutation privileges outside the controlled audit writer and adds
a truncate-rejection trigger.

Assignment, role, booking-status and payroll history are preserved. Soft delete
is used where the contract permits deletion; financial, attendance, booking and
audit records are not hard-deleted by application workflows.

## Seed behavior

`supabase/seed.sql` deliberately creates no Auth users or production-like data.
The first Director must be created through the one-time
`bootstrap-organization` function. Repeatable database test fixtures live in
`supabase/tests` and execute inside a transaction that rolls back.

## Verification

Files in this directory are desired state, not proof of remote state. Before
promoting an environment:

```bash
pnpm exec supabase migration list
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

For a clean local database:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:test
```

Do not run `db reset` against staging or production. Record the linked project,
migration list, push result, pgTAP result and Storage policy smoke test in the
release evidence without recording secrets.
