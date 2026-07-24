# AGENTS.md — Khana Banao CRM Production Implementation Contract

## 0. Authority and execution rule

This file is the final implementation contract for the coding agent.

Build a fresh, production-ready **Khana Banao CRM** using **Next.js App Router, TypeScript and Supabase**. The supplied legacy HTML is a visual and workflow reference only. Do not extend its browser-side database, localStorage persistence, browser-side password logic, embedded credentials, or JSON-blob storage architecture.

The coding agent must implement the entire application, database migrations, Row Level Security, Storage policies, Edge Functions, tests and responsive user interface. Do not leave primary buttons as placeholders. Do not mark an integration capability complete when the provider has not supplied the required official endpoint.

The final product must be usable by multiple staff members simultaneously without one user overwriting another user's work.

---

# 1. Product objective

Create one connected CRM for the full Khana Banao workflow:

```text
Superfone lead/message/call
→ Sales Manager queue
→ Sales Member assignment
→ Calls, messages and follow-ups
→ Lead converted to booking
→ Advance or full-payment proof submitted
→ Payment verified
→ HR assigns Chef or Part-time Chef
→ Chef starts work and updates preparation
→ Chef completes service
→ Sales collects remaining payment when required
→ Final payment verified
→ Booking fully completed
→ HR prepares payroll from approved attendance and completed work
→ Manager monitors operations
→ Director sees the complete business
```

The application must provide:

- secure role-based access;
- realtime lead, conversation, booking and attendance updates;
- normalized PostgreSQL tables;
- private file storage;
- auditable approvals and corrections;
- dashboards with useful KPI cards and charts for every role;
- a modern, consistent Khana Banao design on desktop, tablet and mobile;
- a simple top-right toast system for all success, warning and error feedback;
- Superfone webhook ingestion, API synchronization, historical lead import and provider-backed messaging when officially supported.

---

# 2. Source files and rebuild rule

Use the supplied files as references:

```text
src_khanabanao-crm-v26 (2).html
AGENTS_Khana_Banao_CRM.md
SUPERFONE_MESSAGING_IMPLEMENTATION_PROMPT.md
```

The HTML is the visual reference for:

- Khana Banao navy and saffron branding;
- typography;
- dark sidebar;
- KPI cards;
- compact tables;
- coloured status tags;
- booking docket cards;
- forms and modals;
- clock-in panel;
- charts;
- empty states.

Create the new app from scratch. Copy the HTML into `reference/legacy-crm.html` only for comparison, after removing embedded keys. Never import its storage or authentication code.

---

# 3. Required technology stack

Use:

```text
Next.js App Router
React
TypeScript strict mode
pnpm
Supabase Auth
Supabase PostgreSQL
Supabase Storage
Supabase Realtime
Supabase Edge Functions
@supabase/ssr
@supabase/supabase-js
TanStack Query
TanStack Table for complex data tables
React Hook Form
Zod
Chart.js + react-chartjs-2
date-fns
Lucide React icons
Vitest
React Testing Library
Playwright
ESLint
Prettier
```

Use Server Components for initial data where appropriate and Client Components only for interactive views.

Do not add another general-purpose backend unless a proven requirement cannot be handled by Supabase. Privileged provider operations must run through Supabase Edge Functions.

---

# 4. Environments and configuration

Use separate environments:

```text
Local       → Supabase CLI
Staging     → dedicated staging Supabase project
Production  → dedicated production Supabase project
```

Never share the production database, Storage buckets or secrets with another product.

Next.js public environment variables:

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

SUPERFONE_BASE_URL=
SUPERFONE_API_KEY=
SUPERFONE_ACCOUNT_ID=
SUPERFONE_WEBHOOK_SECRET=
SUPERFONE_WEBHOOK_TOLERANCE_SECONDS=300
```

Adapt the Superfone names to its official documentation. Never expose provider credentials through `NEXT_PUBLIC_*`, browser JavaScript, rendered HTML or client logs.

---

# 5. Design system — same identity, modern and consistent

## 5.1 Design direction

Preserve the recognizable Khana Banao identity, but rebuild it as a modern and consistent component system. Do not make one page look modern while another page looks like the legacy HTML. The same spacing, form, status, table, modal, toast and chart rules must apply everywhere.

Do not use the default visual appearance of a generic dashboard template. Components may use headless primitives, but their final styling must match this contract.

## 5.2 Design tokens

```css
:root {
  --ink: #0b2545;
  --ink-2: #123061;
  --slate: #5b6b85;
  --hair: #e1e6ef;
  --hair-2: #f0f3f8;
  --canvas: #f5f7fa;
  --card: #ffffff;

  --saffron: #f2701d;
  --saffron-dark: #c9560e;
  --saffron-tint: #fff1e6;
  --haldi: #e8a33d;

  --mint: #1e9e6a;
  --mint-tint: #e5f4ee;

  --chilli: #d93a2b;
  --chilli-tint: #fbeae8;

  --indigo-tint: #e7ecf5;

  --radius-sm: 8px;
  --radius-md: 13px;
  --radius-lg: 18px;

  --shadow-sm:
    0 1px 2px rgba(11, 37, 69, 0.05),
    0 1px 1px rgba(11, 37, 69, 0.04);
  --shadow-md: 0 6px 20px rgba(11, 37, 69, 0.09);
  --shadow-lg: 0 20px 48px rgba(11, 37, 69, 0.18);
}
```

## 5.3 Typography

Use `next/font/google`:

```text
Headings and display numbers → Bricolage Grotesque 600/800
Body and controls             → IBM Plex Sans 400/500/600/700
Labels, codes and table heads → IBM Plex Mono 500/600
```

Rules:

- body text defaults to 14px;
- page headings are strong but compact;
- field labels and table headers use uppercase mono styling;
- money, codes and durations use tabular/monospaced numerals;
- text must never become unreadably small on mobile.

## 5.4 Application shell

Desktop, width `>= 1100px`:

- 220px sticky sidebar;
- main content maximum width approximately 1280px;
- main padding approximately 32px 34px 64px;
- page header with title, subtitle and right-side actions;
- sidebar uses the navy gradient and saffron active indicator.

Tablet, width `768px–1099px`:

- collapsible sidebar or compact icon rail;
- preserve labels in an accessible tooltip/drawer;
- content padding approximately 24px;
- two-column KPI/card grids where space permits.

Mobile, width `< 768px`:

- sticky top app bar with logo, page title and menu button;
- navigation opens as a full-height sheet/drawer;
- no wrapped horizontal sidebar menu;
- cards use one column;
- tables become horizontally scrollable or purpose-built mobile cards;
- important page actions may be sticky at the bottom above the safe area;
- conversation composer remains above the keyboard/safe area;
- never create horizontal page overflow.

## 5.5 Core components

Create reusable components:

```text
AppShell
DesktopSidebar
MobileAppBar
MobileNavigationDrawer
RoleBadge
SessionSummary
BreakControls
PageHeader
KpiGrid
KpiCard
AppCard
DataTable
MobileRecordCard
StatusBadge
BookingDocket
ShiftClock
ChartCard
EmptyState
SkeletonState
FileDropzone
FilePreview
AppDialog
ConfirmDialog
AppDrawer
FilterBar
PaginationControls
TopRightToastViewport
```

## 5.6 Buttons and forms

Button variants:

- primary navy;
- saffron accent;
- success mint;
- danger outline/chilli;
- neutral outline;
- ghost/icon.

Every mutation button must have:

- loading state;
- disabled state;
- duplicate-click prevention;
- success/error toast;
- confirmation for destructive actions.

Use React Hook Form and Zod. Show field errors directly below the relevant field.

## 5.7 Toasts

All toasts must appear in the **top-right** on desktop/tablet and below the mobile app bar on small screens.

Supported types:

```text
success
error
warning
info
loading
```

Rules:

- success auto-dismiss: approximately 3 seconds;
- error remains longer and can be closed;
- mutation failures must not fail silently;
- use plain, actionable wording;
- never expose raw database/provider stack traces.

Examples:

```text
Lead assigned to Priya.
Attendance submitted for HR approval.
Payment proof uploaded.
Account deactivated. Active sessions were closed.
Superfone sync failed. Check the connection and try again.
```

## 5.8 Charts

Every role dashboard must include at least one useful analytic chart. Charts are mandatory, but they must communicate an operational decision, not decorate the screen.

Use the same chart palette throughout:

```text
Navy       → primary totals/trends
Saffron    → active/pending/in-progress
Mint       → completed/paid/approved
Haldi      → warnings/internal notes
Chilli     → failed/rejected/overdue
Slate      → inactive/neutral
```

Charts must:

- be responsive;
- have accessible labels/tooltips;
- handle zero-data states;
- use React lifecycle cleanup;
- not redraw the entire page on a timer.

---

# 6. Authentication, account status and sessions

## 6.1 Login UI

The login page contains only:

```text
Phone number
Password
Log in
Error/status area
```

Do not show role-selection chips. The authenticated profile determines the role and redirect.

## 6.2 Phone/password implementation

Normalize Indian phone numbers to E.164:

```text
98765 43210
+91-98765-43210
919876543210
→ +919876543210
```

Use a hidden internal Auth email derived from the normalized phone only as an implementation detail. Never show it in the UI.

All staff Auth users are created through the secure `create-team-member` Edge Function. Public staff signup is disabled. Password hashing is handled by Supabase Auth.

## 6.3 Profile account statuses

Use:

```text
active
inactive
blocked
payment_pending
left_organization
```

Login behavior:

- `active`: allow login;
- `inactive`: show “Your account has been deactivated. Please contact HR or your Manager.”;
- `blocked`: show “Your account has been blocked. Please contact HR or your Manager.”;
- `payment_pending`: Part-time Chef sees “Your access is pending payment confirmation. Please contact HR.”;
- `left_organization`: show “This account is no longer active in this organization.”

Do not show “wrong password” when valid credentials belong to a disabled account.

## 6.4 Immediate revocation

When an authorized upper role deactivates or blocks a user:

1. update the profile status;
2. increment `profiles.session_version`;
3. revoke/close application login sessions;
4. deny further RLS access because the profile is no longer active;
5. redirect an active client to login on its next realtime/session check;
6. create an audit event with reason;
7. preserve all historical records.

Do not delete a user to remove access.

## 6.5 Bootstrap

Do not use “the first browser visitor becomes Director.”

Create `bootstrap-organization`, protected by a one-time deployment secret. It atomically creates:

- organization;
- organization settings;
- Director Auth user;
- Director profile;
- role history;
- initial audit event.

---

# 7. Final hierarchy and upper-role access

```text
Director
└── Manager
    ├── HR
    │   ├── Chef
    │   ├── Part-time Chef
    │   └── Temporary workers — no login
    └── Sales Manager
        └── Sales Members
```

General permission rule:

- an upper role may view and manage lower-role operational data within its permitted department;
- Director can access all departments;
- Manager can access all operations below Director but not raw integration secrets or Director-only profit controls;
- HR can manage only the kitchen/workforce branch;
- Sales Manager can manage only the sales branch;
- individual workers can access only their own/assigned records;
- all rules must be enforced by RLS and server authorization, not only hidden buttons.

Allow one active Manager, one active HR and one active Sales Manager per organization. Enforce this with partial unique indexes.

---

# 8. Final roles and responsibilities

## 8.1 Director

The Director has full organizational oversight and may override lower roles.

Can:

- appoint/replace the Manager;
- activate, deactivate, block and reactivate any subordinate account;
- see all leads, calls, conversations, bookings and payment proofs;
- see all staff, attendance, expenses, payroll and reports;
- manage organization targets and approval limits;
- connect Superfone;
- run historical lead import and sync;
- see integration health, sync runs and safe error summaries;
- approve or override any workflow;
- view immutable audit history.

Only the Director can access provider connection setup and historical import controls.

## 8.2 Manager

The Manager runs the full operation under the Director.

Can:

- appoint/replace HR and Sales Manager;
- view and edit lower-role operational work;
- view sales and kitchen operations;
- reassign bookings and leads as an override;
- verify payment proofs as an override;
- approve/correct attendance as an override;
- review expenses and leave;
- monitor login activity;
- create team tasks and meetings.

Cannot:

- view raw Superfone secrets;
- modify Director-only integration credentials;
- change Director-only business ownership settings;
- see restricted profit/margin controls when configured as Director-only.

## 8.3 HR

HR manages Chef, Part-time Chef and temporary workforce operations.

Can:

- create and manage Chef accounts;
- create and manage Part-time Chef accounts;
- activate, deactivate, block and reactivate those accounts;
- store essential employee fields only: full name, phone, role, Aadhaar, payment type, payment amount, joining date, account status and Part-time Chef payment proof when applicable;
- add helpers, servers, cleaners and drivers without login accounts;
- view confirmed bookings and assign/reassign Chef or Part-time Chef;
- see all active shifts as “Working Now”;
- review completed shifts date-wise;
- approve, correct or reject attendance;
- review expense claims from Chef and Part-time Chef;
- review leave requests from Chef and Part-time Chef;
- create, edit, reschedule and delete staff meetings;
- provide “Add to Google Calendar” for meetings;
- prepare payroll from approved attendance, completed bookings, overtime, deductions, approved expenses and agreed pay structure;
- view unpaid, paid, monthly and lifetime earnings for the workforce branch.

HR does not manage sales leads, quotations, customer conversations, business profit, provider settings or Director reports.

## 8.4 Sales Manager

Can:

- create, manage, activate and deactivate Sales Member accounts;
- see all sales-team leads, calls, conversations, follow-ups and bookings;
- see unassigned Superfone leads/conversations;
- assign/reassign leads and conversations;
- monitor overdue follow-ups and response time;
- verify or reject advance, partial, full and final payment proofs;
- monitor final-payment collection;
- score and coach Sales Members;
- view team performance and leaderboards;
- create sales tasks and meetings;
- submit own expenses and leave.

Cannot access Chef payroll, HR records, Director-only profit or provider secrets.

## 8.5 Sales Member

Can:

- see only assigned leads and conversations;
- call/message customers through supported Superfone capabilities;
- log call outcomes, internal notes and follow-ups;
- update lead status;
- convert a qualified assigned lead into a booking;
- enter event, guest, venue, menu and total-value information;
- upload advance, partial, final or full-payment proof;
- see own bookings and payment collection tasks;
- collect remaining payment after service completion;
- view own performance;
- submit own expenses and leave;
- view assigned tasks and meetings.

Cannot see other Sales Members’ assigned records unless reassigned, and cannot edit Chef payroll or attendance.

## 8.6 Chef

Can:

- see only assigned bookings/jobs;
- view necessary operational details: booking code, event name, date, reporting time, venue, guest count, menu/instructions and agreed Chef pay when allowed;
- move own job through Pending/Confirmed → Preparing → Service Completed;
- start and end shifts;
- see attendance as Working, Pending HR Approval, Approved, Corrected or Rejected;
- submit expenses with bills;
- apply for leave;
- view current unpaid, paid this month, last payment and lifetime earnings;
- view assigned tasks and meetings.

Cannot edit customer quotation, total booking value, payment proof, sales notes, own approved attendance or payroll.

## 8.7 Part-time Chef

Uses the same operational dashboard as Chef after activation.

Differences:

- usually paid per booking, day or hour;
- attendance is allowed only for an assigned work date/booking unless an authorized role creates an exception;
- payment proof may be required during account creation;
- HR uploads the proof to private Storage;
- when proof is absent, account may remain `payment_pending`;
- after proof is saved and account is activated, the normal dashboard opens;
- no permanent “Unlock” sidebar item is needed after activation.

---

# 9. Final sidebar menus

Use the same component and visual hierarchy for every role.

## 9.1 Director

1. Dashboard
2. Leads & Calls
3. Conversations
4. Bookings
5. Payments
6. Sales Team
7. Chefs & Staff
8. Attendance
9. Expenses
10. Team & Access
11. Assign Work
12. HR Overview
13. Leave
14. Meetings
15. Payroll
16. Business Reports
17. Login Activity
18. Integrations
19. Import & Sync

## 9.2 Manager

1. Operations Dashboard
2. Leads & Calls
3. Conversations
4. Bookings
5. Payment Verification
6. Chefs & Staff
7. Attendance
8. Expenses
9. Team & Access
10. Assign Work
11. Leave
12. Meetings
13. Login Activity

`Team & Access` permits HR and Sales Manager appointment/replacement only.

## 9.3 HR

1. HR Dashboard
2. Chefs & Part-time Chefs
3. Temporary Workers
4. Booking Assignment
5. Attendance Approval
6. Expense Claims
7. Leave Requests
8. Employee Records
9. Meetings
10. Payroll

## 9.4 Sales Manager

1. Dashboard
2. Team Leads
3. Lead Assignment
4. Follow-ups
5. Calls
6. Conversations
7. Team Bookings
8. Payment Verification
9. Sales Team
10. Performance
11. My Expenses
12. Assign Work
13. Leave
14. Meetings

## 9.5 Sales Member

1. Dashboard
2. My Leads
3. Follow-ups
4. Calls
5. Conversations
6. My Bookings
7. Payments
8. My Performance
9. My Expenses
10. My Tasks
11. Leave
12. Meetings

## 9.6 Chef

1. Dashboard
2. My Jobs
3. Attendance
4. My Expenses
5. My Earnings
6. My Tasks
7. Leave
8. Meetings

## 9.7 Part-time Chef

After activation:

1. Dashboard
2. My Jobs
3. Attendance
4. My Expenses
5. My Earnings
6. My Tasks
7. Leave
8. Meetings

Before activation, show only the account-status/payment-pending screen.

Remove the legacy “My Documents” page for Chef and Part-time Chef MVP. HR manages required employee records.

---

# 10. Core data relationships

```text
Organization
├── Profiles
│   ├── Role history
│   ├── Sessions
│   ├── Tasks
│   ├── Leave
│   └── Audit actions
│
├── Leads
│   ├── Contact
│   ├── Assignment history
│   ├── Activities
│   ├── Calls
│   ├── Conversations
│   ├── Follow-ups
│   └── Booking
│
├── Bookings
│   ├── Sales owner
│   ├── Chef assignment
│   ├── Status history
│   ├── Payments and proof files
│   ├── Attendance
│   ├── Expenses
│   └── Payroll components
│
├── Temporary workers
│   ├── Booking assignment
│   ├── Attendance
│   └── Wage/payroll record
│
└── Integrations
    ├── Webhook events
    ├── Sync runs
    ├── Provider calls
    └── Provider messages
```

Critical foreign-key relationships:

```text
leads.assigned_sales_profile_id       → profiles.id
lead_activities.lead_id               → leads.id
follow_ups.lead_id                     → leads.id
conversations.lead_id                  → leads.id
messages.conversation_id               → conversations.id
bookings.lead_id                       → leads.id
bookings.sold_by_profile_id            → profiles.id
booking_assignments.booking_id         → bookings.id
booking_assignments.chef_profile_id    → profiles.id
booking_payments.booking_id            → bookings.id
attendance_shifts.booking_id           → bookings.id, nullable
expenses.booking_id                    → bookings.id, nullable
payroll_entries.profile_id             → profiles.id, nullable
payroll_entries.temporary_worker_id    → temporary_workers.id, nullable
```

---

# 11. Database schema

Create versioned SQL migrations. Enable RLS on every business table.

All tenant-owned tables must include:

```text
id uuid primary key default gen_random_uuid()
organization_id uuid not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Use `deleted_at` for soft-deletable business records.

## 11.1 Organizations and users

### `organizations`

```text
id
name
slug
timezone default 'Asia/Kolkata'
currency default 'INR'
is_active
created_at
updated_at
```

### `organization_settings`

```text
organization_id primary key
manager_expense_limit
monthly_revenue_target
attendance_approval_required default true
part_time_payment_proof_required default true
lead_assignment_mode default 'manual'
booking_code_prefix default 'KB'
payroll_cutoff_day
created_at
updated_at
```

### `profiles`

```text
id uuid primary key references auth.users(id)
organization_id
full_name
phone_e164
role
reports_to_profile_id
account_status
session_version integer default 1
joining_date
payment_type
payment_amount numeric(12,2)
aadhaar_storage_path
part_time_payment_proof_path
part_time_payment_amount
is_active generated or synchronized from account_status
last_login_at
created_by_profile_id
created_at
updated_at
deleted_at
```

Role enum:

```text
director
manager
hr
sales_manager
sales
chef
part_time_chef
```

Payment type:

```text
monthly
daily
hourly
per_booking
```

### `role_assignment_history`

```text
id
organization_id
role
profile_id
assigned_by_profile_id
started_at
ended_at
reason
```

### `login_sessions`

```text
id
organization_id
profile_id
session_code
session_version
login_at
last_seen_at
logout_at
logout_reason
user_agent_safe
ip_hash
```

### `audit_logs`

```text
id
organization_id
actor_profile_id
action
entity_type
entity_id
before_data jsonb
after_data jsonb
reason
request_id
created_at
```

Audit logs are immutable and cannot be updated or deleted from the application.

## 11.2 Leads and sales

### `leads`

```text
id
organization_id
provider
provider_lead_id
source
campaign_name
client_name
phone_e164
phone_normalized
requirement
event_date
guest_count
quote_amount
status
assigned_sales_profile_id
next_follow_up_at
notes
first_received_at
last_activity_at
version integer default 1
created_by_profile_id
created_at
updated_at
deleted_at
```

Lead status:

```text
new
contacted
follow_up
qualified
booking_payment_pending
booking_in_process
won
lost
unreachable
```

### `lead_assignment_history`

```text
id
organization_id
lead_id
assigned_to_profile_id
assigned_by_profile_id
assigned_at
unassigned_at
reason
```

### `lead_activities`

```text
id
organization_id
lead_id
actor_profile_id
activity_type
summary
metadata jsonb
occurred_at
created_at
```

Activity types include call, message, note, follow-up, status change, assignment, payment proof and booking conversion.

### `follow_ups`

```text
id
organization_id
lead_id
assigned_profile_id
due_at
status
outcome
completed_at
created_by_profile_id
created_at
updated_at
```

Status:

```text
open
completed
cancelled
overdue
```

## 11.3 Conversations and Superfone activity

### `conversations`

```text
id
organization_id
lead_id
provider
provider_conversation_id
channel
contact_name
contact_phone_e164
assigned_sales_profile_id
status
last_message_at
last_message_preview
last_inbound_at
last_outbound_at
closed_at
version integer default 1
created_at
updated_at
```

Conversation status:

```text
open
pending
resolved
closed
```

### `conversation_assignments`

```text
id
organization_id
conversation_id
assigned_to_profile_id
assigned_by_profile_id
assigned_at
unassigned_at
reason
```

### `messages`

```text
id
organization_id
conversation_id
lead_id
provider
provider_message_id
provider_event_id
direction
channel
message_type
body
attachment_storage_path
sender_profile_id
recipient_phone_e164
status
provider_created_at
sent_at
delivered_at
read_at
failed_at
failure_code
failure_message_safe
reply_to_message_id
idempotency_key
created_at
updated_at
```

Message status:

```text
received
queued
sending
sent
delivered
read
failed
opened_external
skipped
```

Never display `delivered` or `read` unless the provider confirms it.

### `message_attempts`

```text
id
organization_id
message_id
attempt_number
request_id
provider_status_code
provider_response_safe jsonb
started_at
completed_at
created_at
```

### `conversation_reads`

```text
organization_id
conversation_id
profile_id
last_read_message_id
last_read_at
primary key (conversation_id, profile_id)
```

### `superfone_calls`

```text
id
organization_id
conversation_id
lead_id
provider_call_id
direction
from_phone_e164
to_phone_e164
agent_profile_id
status
started_at
answered_at
ended_at
duration_seconds
recording_external_url
created_at
```

Do not copy recordings unless the official contract and consent permit it.

### `integration_connections`

```text
id
organization_id
provider
status
account_identifier_safe
capabilities jsonb
connected_by_profile_id
connected_at
last_tested_at
last_success_at
last_error_safe
created_at
updated_at
```

Never store raw secrets in this table. Store secrets only in Edge Function secret storage.

### `integration_events`

```text
id
organization_id
provider
provider_event_id
event_type
payload jsonb
status
attempt_count
received_at
processed_at
last_error_safe
created_at
```

### `integration_sync_runs`

```text
id
organization_id
provider
sync_type
status
cursor_before
cursor_after
fetched_count
inserted_count
updated_count
duplicate_count
failed_count
started_by_profile_id
started_at
completed_at
error_summary_safe
```

## 11.4 Bookings and payments

### `bookings`

```text
id
organization_id
booking_code
lead_id
client_name
phone_e164
event_type
event_date
event_start_time
reporting_time
venue
guest_count
menu
instructions
total_value
payment_status
service_status
sold_by_profile_id
service_completed_at
fully_completed_at
version integer default 1
created_at
updated_at
deleted_at
```

Payment status:

```text
unpaid
partial
fully_paid
refund_pending
refunded
```

Service status:

```text
pending
confirmed
chef_assigned
preparing
service_completed
fully_completed
cancelled
```

### `booking_status_history`

```text
id
organization_id
booking_id
from_status
to_status
changed_by_profile_id
reason
changed_at
```

### `booking_assignments`

```text
id
organization_id
booking_id
chef_profile_id
assigned_by_profile_id
assigned_at
unassigned_at
agreed_pay_type
agreed_pay_amount
instructions
```

Only one active primary Chef assignment per booking unless the booking explicitly supports multiple assigned workers.

### `booking_payments`

```text
id
organization_id
booking_id
payment_stage
amount
payment_method
transaction_reference
proof_storage_path
submitted_by_profile_id
verification_status
verified_by_profile_id
verified_at
rejection_reason
paid_at
created_at
updated_at
```

Payment stage:

```text
advance
partial
final
full
refund
```

Verification status:

```text
pending
verified
rejected
```

Keep every payment record. Never overwrite the advance proof with the final proof.

## 11.5 Workforce and attendance

### `temporary_workers`

```text
id
organization_id
full_name
phone_e164
worker_type
payment_type
payment_amount
notes
is_active
created_by_profile_id
created_at
updated_at
deleted_at
```

Worker type:

```text
helper
server
cleaner
driver
other
```

Temporary workers have no Auth user and no CRM login.

### `temporary_worker_assignments`

```text
id
organization_id
temporary_worker_id
booking_id
work_date
reporting_time
agreed_payment
notes
created_by_profile_id
created_at
```

### `attendance_shifts`

```text
id
organization_id
profile_id nullable
temporary_worker_id nullable
booking_id nullable
shift_date
started_at
ended_at
start_location jsonb nullable
end_location jsonb nullable
status
submitted_at
approved_by_profile_id
approved_at
corrected_by_profile_id
correction_reason
overtime_minutes default 0
payroll_eligible boolean default false
created_at
updated_at
```

Exactly one of `profile_id` or `temporary_worker_id` must be present.

Attendance status:

```text
working
pending_approval
approved
corrected
rejected
absent
```

Only approved/corrected attendance sets `payroll_eligible = true`.

### `break_sessions`

```text
id
organization_id
profile_id
break_type
started_at
ended_at
created_at
```

Break type:

```text
lunch
break
superfone
```

## 11.6 Expenses, leave, tasks and meetings

### `expenses`

```text
id
organization_id
submitted_by_profile_id
booking_id nullable
category
amount
reason
status
reviewed_by_profile_id
reviewed_at
rejection_reason
created_at
updated_at
```

### `expense_attachments`

```text
id
organization_id
expense_id
storage_path
file_name
mime_type
size_bytes
created_at
```

Expense status:

```text
pending
verified
approved
rejected
paid
```

HR verifies Chef-side claims. Manager/Director provide final approval according to configured limits.

### `leave_requests`

```text
id
organization_id
profile_id
start_date
end_date
reason
status
reviewed_by_profile_id
reviewed_at
review_note
created_at
updated_at
```

Status:

```text
pending
approved
rejected
cancelled
```

### `tasks`

```text
id
organization_id
title
description
assigned_to_profile_id
assigned_by_profile_id
booking_id nullable
lead_id nullable
due_at
priority
status
completed_at
created_at
updated_at
```

### `meetings`

```text
id
organization_id
title
reason
starts_at
ends_at
location
meeting_url
status
created_by_profile_id
created_at
updated_at
deleted_at
```

Meeting status:

```text
scheduled
completed
cancelled
```

### `meeting_attendees`

```text
organization_id
meeting_id
profile_id
attendance_status
created_at
primary key (meeting_id, profile_id)
```

## 11.7 Payroll

### `payroll_periods`

```text
id
organization_id
period_start
period_end
status
prepared_by_profile_id
reviewed_by_profile_id
approved_by_profile_id
paid_at
created_at
updated_at
```

Status:

```text
draft
prepared
reviewed
approved
paid
locked
```

### `payroll_entries`

```text
id
organization_id
payroll_period_id
profile_id nullable
temporary_worker_id nullable
base_amount
attendance_amount
booking_earnings
overtime_amount
expense_reimbursement
allowances
deductions
advances
net_payable
status
payment_reference
paid_at
created_at
updated_at
```

### `payroll_components`

```text
id
organization_id
payroll_entry_id
component_type
source_type
source_id
amount
description
created_at
```

Do not reset earnings to zero after payment. Lock the paid payroll period and start a new period. Calculate current unpaid, monthly paid and lifetime paid through queries/views.

---

# 12. Required database constraints and indexes

Implement at least:

```sql
-- One active top-level holder per organization.
create unique index one_active_manager_per_org
on profiles (organization_id)
where role = 'manager' and account_status = 'active' and deleted_at is null;

create unique index one_active_hr_per_org
on profiles (organization_id)
where role = 'hr' and account_status = 'active' and deleted_at is null;

create unique index one_active_sales_manager_per_org
on profiles (organization_id)
where role = 'sales_manager' and account_status = 'active' and deleted_at is null;

-- One phone/profile per organization.
create unique index profile_phone_per_org
on profiles (organization_id, phone_e164)
where deleted_at is null;

-- Provider event idempotency.
create unique index provider_event_unique
on integration_events (organization_id, provider, provider_event_id);

-- Provider lead dedupe when provider id exists.
create unique index provider_lead_unique
on leads (organization_id, provider, provider_lead_id)
where provider_lead_id is not null and deleted_at is null;

-- Phone dedupe fallback.
create unique index lead_phone_unique
on leads (organization_id, phone_normalized)
where deleted_at is null;

-- Provider message idempotency.
create unique index provider_message_unique
on messages (organization_id, provider, provider_message_id)
where provider_message_id is not null;

-- Prevent duplicate outbound clicks.
create unique index outbound_message_idempotency_unique
on messages (organization_id, idempotency_key)
where idempotency_key is not null;

-- One open shift per person.
create unique index one_open_profile_shift
on attendance_shifts (organization_id, profile_id)
where ended_at is null and profile_id is not null;
```

Add indexes for:

- leads by organization, assigned sales, status and last activity;
- conversations by assigned sales and last message;
- follow-ups by assigned user and due date;
- bookings by event date, service status and sales owner;
- attendance by shift date/status/profile;
- payments by booking/verification status;
- payroll by period/profile/status.

---

# 13. Row Level Security and permission model

Create helper functions such as:

```sql
current_profile_id()
current_organization_id()
current_role()
is_active_profile()
is_director()
is_manager_or_director()
is_hr_scope_admin()
is_sales_scope_admin()
```

All helpers must use the authenticated user and database profile. Never trust role or organization values sent by the browser.

Permission summary:

| Domain | Director | Manager | HR | Sales Manager | Sales | Chef/PT Chef |
|---|---|---|---|---|---|---|
| Provider secrets | configure through secure function | no | no | no | no | no |
| All leads | yes | operational access | no | yes | assigned only | no |
| Conversations | all | all operational | no | sales team | assigned only | no |
| Bookings | all | all | confirmed/assigned workforce view | team | own sold | assigned only |
| Payment proofs | all | verify/override | no customer payment proof | verify | submit/view own booking | no |
| Chef accounts | all | override | manage | view availability only | view availability only | own profile |
| Attendance | all | override | manage/approve | own only if needed | own only if needed | own start/end/history |
| Payroll | all | review | prepare | no | no | own earnings only |
| Audit logs | all | scoped | scoped workforce | scoped sales | own actions | own actions |

Use secure views/RPCs when a role needs only a redacted projection. Do not select restricted columns and hide them with CSS.

---

# 14. Superfone connection — simple operational setup

The end-user setup must be simple.

## 14.1 Director-only connection screen

The Director sees one connection card:

```text
Superfone API credential/account information
Connect & Test button
Generated CRM webhook URL
Copy Webhook URL button
Connection status
Last successful sync
Import Existing Leads button
Sync Now button
```

After the official Superfone adapter is implemented, the Director should only need to:

1. enter the required API credential/account value once;
2. click **Connect & Test**;
3. copy the generated webhook URL;
4. paste that URL into Superfone;
5. begin using the CRM.

Do not expose complex field mapping or technical settings during normal use. Provider-specific endpoint/header/payload logic belongs inside the adapter and Edge Functions. If the provider officially requires additional values, keep them in a small “Advanced connection details” section available only to Director.

No Sales Member, Sales Manager, Manager, HR or Chef should configure the provider.

## 14.2 Provider adapter

Create:

```ts
export interface SuperfoneProvider {
  testConnection(): Promise<ConnectionResult>;
  fetchLeads(input: { cursor?: string; updatedAfter?: string }): Promise<LeadPage>;
  fetchConversations?(input: { cursor?: string; updatedAfter?: string }): Promise<ConversationPage>;
  fetchMessages?(input: { conversationExternalId: string; cursor?: string }): Promise<MessagePage>;
  fetchCalls?(input: { cursor?: string; updatedAfter?: string }): Promise<CallPage>;
  sendMessage?(input: SendMessageInput): Promise<SendResult>;
  sendMedia?(input: SendMediaInput): Promise<SendResult>;
  verifyWebhook(request: Request): Promise<VerifiedProviderEvent>;
}
```

Do not invent a production endpoint. Unsupported capabilities must return a typed `SUPERFONE_CAPABILITY_UNAVAILABLE` response, and the UI must disable that control with a clear explanation.

## 14.3 Required Edge Functions

```text
bootstrap-organization
create-team-member
update-account-status
replace-role-holder
superfone-test-connection
superfone-webhook
superfone-sync
superfone-import-existing-leads
superfone-send-message
superfone-send-media
superfone-replay-event
```

## 14.4 Webhook flow

```text
Superfone
→ superfone-webhook
→ verify signature/secret
→ idempotent integration_events insert
→ normalize phone/provider IDs
→ upsert lead
→ upsert conversation
→ insert message/call/activity
→ update unread/preview
→ Supabase Realtime
→ authorized CRM users update immediately
```

The function must:

- read the raw body before parsing when required for signing;
- validate payloads with Zod;
- identify a stable provider event ID;
- return success for already-processed duplicate events;
- respond quickly;
- never expose secrets or stack traces.

## 14.5 Historical import

Only Director may run **Import Existing Leads**.

Requirements:

- run in paginated batches;
- show live/resumable progress;
- store cursor/checkpoint;
- tolerate safe retries;
- respect provider rate limits;
- continue after transient errors;
- create a sync-run record;
- show fetched, inserted, updated, duplicate and failed counts.

Example progress:

```text
Fetched: 5,000
New: 3,200
Updated: 1,750
Duplicates merged: 45
Failed: 5
```

## 14.6 Lead deduplication

Normalize all phone formats to one canonical value before lookup.

```text
+91 98765 43210
98765-43210
919876543210
→ +919876543210
```

Deduplication order:

1. match organization + provider + provider lead ID;
2. otherwise match organization + normalized phone;
3. do not create a second lead;
4. preserve existing assignment, notes, booking link and human-entered data;
5. fill missing fields and append new provider activity/source information;
6. append calls/messages to the existing timeline;
7. record the merge/update in audit/activity history.

## 14.7 Realtime and 20 simultaneous Sales users

The architecture must comfortably support at least 20 simultaneous Sales users.

Use:

- individual database rows, never shared JSON arrays;
- indexed server-side pagination;
- scoped Realtime channels;
- optimistic concurrency via `version` columns;
- idempotency keys for send/convert/assign operations;
- assignment ownership and “Handled by/Viewing now” presence;
- TanStack Query invalidation for targeted records;
- no polling of entire tables;
- no N+1 request loops.

---

# 15. Conversation and call interface

Available only to Director, Manager, Sales Manager and Sales Member.

Desktop uses three panels:

```text
Conversation list | Message/call timeline | Lead/customer panel
```

Conversation list includes:

- search by name/phone;
- filters: All, Unread, Unassigned, Mine, Open, Pending, Resolved, Failed;
- assigned-person filter for authorized roles;
- channel, customer, last preview, time, unread badge, status and assignee;
- server/cursor pagination.

Timeline includes:

- inbound messages;
- outbound messages;
- internal notes;
- incoming/outgoing/missed calls;
- call duration;
- assignment changes;
- lead status changes;
- follow-up events;
- booking conversion;
- payment proof events;
- date separators;
- failed-message retry.

Visual treatment:

- inbound: light bubble left;
- outbound: saffron/navy-accent bubble right;
- internal note: haldi card labelled `Internal note`;
- system events: centred compact mono labels;
- call events: compact docket cards;
- failed messages: chilli state with Retry.

Composer:

- message textarea;
- Send;
- Internal note mode;
- attachment only when provider supports it;
- Enter sends and Shift+Enter adds newline;
- idempotency key prevents duplicate sends;
- show correct queued/sent/delivered/read states only when confirmed.

Mobile:

- conversation list first;
- tap opens timeline full screen;
- lead panel opens as a drawer;
- composer stays fixed above safe area;
- browser back returns to conversation list.

---

# 16. Lead and booking lifecycle

## 16.1 Lead flow

```text
New
→ Contacted
→ Follow-up
→ Qualified
→ Booking Payment Pending
→ Booking In Process
→ Won or Lost
```

Sales Member may add call outcome, follow-up, note and customer/event information.

## 16.2 Convert to booking

Sales Member selects **Convert to Booking**.

Required form fields:

```text
Customer name
Phone
Event type
Event date and time
Reporting time
Venue
Guest count
Menu/requirements
Total booking amount
Payment option: advance, partial or full
Amount received
Payment method
Transaction reference
Payment-proof image
Notes
```

Conversion must use an atomic PostgreSQL RPC:

1. lock the lead/version;
2. validate Sales access;
3. create booking code;
4. create booking;
5. create payment row/proof reference;
6. link lead to booking;
7. update lead status;
8. clear/complete follow-up as appropriate;
9. create activity/history/audit rows;
10. commit once.

Booking initially becomes `booking_in_process` until payment proof is verified.

## 16.3 Payment verification

Sales Manager verifies/rejects normal sales payment proofs. Manager and Director can override.

Verified advance/partial/full payment changes booking payment status and permits booking confirmation.

Rejected proof requires a reason and returns a task to the submitting Sales Member.

## 16.4 Chef assignment

After booking confirmation:

```text
Sales confirms booking
→ HR sees confirmed unassigned booking
→ HR assigns Chef or Part-time Chef
→ assigned person receives job
```

Sales does not assign Chef. Manager and Director can override/reassign.

## 16.5 Service completion and final payment

Chef flow:

```text
Pending/Confirmed
→ Preparing
→ Service Completed
```

If balance remains:

```text
Service Completed
→ Sales receives Final Payment Pending task
→ Sales uploads final proof
→ Sales Manager verifies
→ Booking becomes Fully Completed
```

If the booking was already fully paid:

```text
Service Completed
→ Booking becomes Fully Completed
```

Job completion and attendance approval remain separate. A completed job does not automatically create approved payroll attendance.

---

# 17. Attendance workflow

## 17.1 Chef and Part-time Chef

```text
Start Shift
→ Working Now
→ End Shift
→ Pending HR Approval
→ Approved / Corrected / Rejected
```

When Start Shift is pressed, record:

- authenticated person;
- start date/time;
- assigned booking when applicable;
- optional location if permission is granted;
- status `working`.

Do not use login time as attendance.

When End Shift is pressed, record end time and set `pending_approval`.

Only approved/corrected attendance counts for payroll.

Part-time Chef Start Shift is normally available only for an assigned booking/work date.

## 17.2 HR Attendance Approval page

Default view is **Today**.

Filters:

```text
Today
Yesterday
Custom date range
Chef
Part-time Chef
Temporary worker
Working Now
Pending Approval
Approved
Corrected
Rejected
Absent
Booking
```

Table/list fields:

```text
Employee
Role
Booking
Start
End
Duration
Overtime
Status
Actions
```

HR can:

- see all currently working staff in realtime;
- approve one record;
- bulk approve selected valid records;
- correct start/end/overtime with mandatory reason;
- reject false attendance with reason;
- mark absent;
- create missed attendance manually;
- view date-wise history.

Manager and Director can override.

Every correction writes before/after values to audit history.

## 17.3 Temporary workers

HR creates them through a form. They receive no login.

HR records:

```text
Name
Phone
Worker type
Assigned booking
Work date
Start time
End time
Daily/hourly/agreed wage
Notes
Payment status
```

For daily wage, the agreed amount is payable after approved attendance. For hourly wage, authoritative pay is approved hours × hourly rate. Preserve the paid record permanently.

---

# 18. Expenses

Chef/Part-time Chef expense form:

```text
Related booking
Category
Amount
Reason
Bill upload
```

Flow:

```text
Submitted
→ HR verifies booking and bill
→ Manager approves within limit
→ Director approves above limit/overrides
→ Included as reimbursement in payroll when approved
```

Sales roles may submit their own permitted expenses through the same normalized tables, with review scope controlled by policy.

Files go to private Storage. Do not store base64 files in database rows.

---

# 19. Leave

Chef and Part-time Chef submit leave dates and reason.

HR reviews workforce leave. Manager may provide final approval/override when scheduled bookings are affected. Director may override.

Sales Member leave is reviewed by Sales Manager, with Manager/Director override.

The review screen must warn when approved leave conflicts with an assigned booking or overdue follow-up.

---

# 20. Meetings and Google Calendar

HR can create workforce meetings. Sales Manager can create sales meetings. Manager/Director can create broader meetings.

Meeting form:

```text
Title
Reason/agenda
Start date and time
End date and time
Location or meeting link
Selected attendees
```

Authorized creator can:

- create;
- edit;
- reschedule;
- cancel;
- delete/soft-delete;
- mark completed.

Selected employees see the meeting in their CRM.

Add an **Add to Google Calendar** button that opens a prefilled Google Calendar event URL. No Google Calendar API is required for MVP. The user presses Save in Google Calendar and Google handles reminders.

Generate the URL from:

```text
action=TEMPLATE
text=title
dates=UTC_START/UTC_END
details=reason/agenda
location=location
```

Editing/deleting the internal CRM meeting does not automatically edit a separately saved Google Calendar event unless a future OAuth/API integration is added. Make this limitation clear in a small helper message.

---

# 21. Payroll and earnings

## 21.1 Pay structures

Regular Chef may use:

```text
Monthly base salary
+ overtime
+ booking incentives
+ approved reimbursements
+ allowances
− leave/attendance deductions
− advances
```

Part-time Chef may use:

```text
Completed booking/day/hour earnings
+ overtime
+ approved reimbursements/allowances
− advances
− deductions
```

Temporary worker may use:

```text
Approved day wage
or approved hours × hourly rate
```

## 21.2 Eligibility

A Chef booking component is eligible only when required conditions are met:

```text
Job service completed
AND attendance approved/corrected where attendance is required
```

## 21.3 Payroll process

```text
HR generates draft payroll period
→ system calculates components
→ HR reviews/corrects with reason
→ Manager reviews
→ Director approves
→ payment marked Paid with reference
→ period locked
```

Do not reset balances by deleting or zeroing paid rows.

Show on individual earnings dashboard:

```text
Current unpaid earnings
Paid this month
Lifetime paid earnings
Last payment amount/date
Payment history
Component breakdown
```

Paid history is immutable except through an audited correction/reversal workflow.

---

# 22. Dashboards, KPI cards and mandatory analytics

Each dashboard must have a meaningful empty state and date filters where relevant.

## 22.1 Director dashboard

KPI cards:

- total verified revenue;
- advance collected;
- outstanding balance;
- total approved expenses;
- net operational margin;
- leads received;
- conversion rate;
- confirmed/upcoming bookings;
- staff working now;
- pending approvals.

Charts:

1. revenue vs target line/progress chart;
2. bookings by status doughnut;
3. leads received vs converted by month bar chart;
4. revenue and expense trend chart.

Operational sections:

- sales leaderboard;
- Chef completion leaderboard;
- upcoming events/run sheet;
- overdue payments;
- attendance pending approval;
- integration health.

## 22.2 Manager dashboard

KPI cards:

- today’s events;
- guests today;
- active staff;
- unassigned confirmed bookings;
- pending payment verifications;
- pending attendance approvals;
- pending expenses;
- overdue tasks.

Charts:

1. seven-day events and guest-load bar chart;
2. operation status doughnut: unassigned, assigned, preparing, completed;
3. approval ageing bar chart.

## 22.3 HR dashboard

KPI cards:

- active Chefs;
- active Part-time Chefs;
- temporary workers scheduled today;
- working now;
- attendance pending approval;
- leave pending;
- expense claims pending;
- current payroll payable.

Charts:

1. attendance status doughnut;
2. approved work hours by week bar chart;
3. Chef vs Part-time completed bookings chart;
4. payroll paid vs unpaid chart.

Lists:

- working now;
- shifts awaiting approval;
- unassigned confirmed bookings;
- upcoming leave conflicts;
- upcoming meetings.

## 22.4 Sales Manager dashboard

KPI cards:

- new leads;
- unassigned leads;
- overdue follow-ups;
- contacts today;
- qualified leads;
- booking proofs pending verification;
- final payments pending;
- team booking value;
- team conversion rate.

Charts:

1. leads received vs converted bar chart;
2. lead-status funnel/doughnut;
3. Sales Member conversion leaderboard;
4. response-time/SLA trend.

## 22.5 Sales Member dashboard

KPI cards:

- new assigned leads;
- follow-ups due today;
- overdue follow-ups;
- qualified leads;
- booking payment pending;
- confirmed bookings;
- final payments pending;
- own conversion rate/value.

Charts:

1. personal lead-status doughnut;
2. weekly leads contacted vs converted bar chart;
3. monthly booking value line/bar chart.

Lists:

- urgent follow-ups;
- unread conversations;
- payment collection tasks;
- upcoming bookings.

## 22.6 Chef dashboard

KPI cards:

- Pending Jobs;
- Preparing Jobs;
- Completed Jobs;
- Total Assigned;
- attendance status;
- current unpaid earnings;
- pending expense claims.

Charts:

1. job-status doughnut: Pending, Preparing, Completed;
2. completed jobs by month bar chart;
3. attendance summary/progress;
4. paid vs unpaid earnings bar chart.

Below KPIs show Today’s Booking, otherwise Next Booking:

```text
Booking code
Event name
Date
Reporting time
Venue
Guests
Menu/instructions
Status
```

## 22.7 Part-time Chef dashboard

Use the Chef dashboard with part-time wording and pay logic.

Additional KPI:

- current booking-wise unpaid amount.

Charts:

- assigned vs completed jobs;
- monthly booking earnings;
- attendance approval status.

---

# 23. Notifications and announcements

Use in-app notifications for:

- new lead assignment;
- unread customer message;
- follow-up due/overdue;
- payment proof decision;
- Chef assignment;
- booking status change;
- final payment required;
- attendance approved/rejected/corrected;
- expense/leave decision;
- payroll paid;
- meeting created/rescheduled/cancelled;
- account status change.

Use separate tables for dashboard announcements and provider messages. Internal notes/announcements must never be sent externally.

---

# 24. Storage architecture

Create private buckets:

```text
employee-private
payment-proofs
expense-bills
conversation-media
```

Rules:

- store only Storage paths in PostgreSQL;
- use signed URLs with short expiry;
- validate MIME type and size;
- compress large payment screenshots/images client-side before upload where reasonable;
- never store sensitive files in public buckets;
- never store base64 documents in PostgreSQL;
- RLS/Storage policies must enforce organization and role access.

MVP essential employee records:

```text
Aadhaar
Part-time Chef payment proof when applicable
```

Salary/payment information is stored as structured database fields, not as a document.

---

# 25. RPCs and transactional operations

Create transactional PostgreSQL functions/RPCs for:

```text
replace_role_holder
assign_lead
reassign_lead
convert_lead_to_booking
verify_booking_payment
assign_chef_to_booking
change_booking_service_status
start_attendance_shift
end_attendance_shift
approve_attendance_shift
correct_attendance_shift
reject_attendance_shift
generate_payroll_period
approve_payroll_period
mark_payroll_paid
```

Each RPC must:

- derive actor/organization from auth;
- verify permissions;
- enforce expected current version/status;
- update all related rows atomically;
- write history and audit entries;
- return a typed safe result.

---

# 26. Frontend folder architecture

```text
app/
  (public)/
    login/page.tsx

  (protected)/
    layout.tsx

    director/
      dashboard/
      leads/
      conversations/
      bookings/
      payments/
      sales-team/
      workforce/
      attendance/
      expenses/
      team/
      tasks/
      hr/
      leave/
      meetings/
      payroll/
      reports/
      sessions/
      integrations/
      import-sync/

    manager/
      dashboard/
      leads/
      conversations/
      bookings/
      payments/
      workforce/
      attendance/
      expenses/
      team/
      tasks/
      leave/
      meetings/
      sessions/

    hr/
      dashboard/
      chefs/
      temporary-workers/
      booking-assignment/
      attendance/
      expenses/
      leave/
      employee-records/
      meetings/
      payroll/

    sales-manager/
      dashboard/
      leads/
      assignment/
      follow-ups/
      calls/
      conversations/
      bookings/
      payments/
      team/
      performance/
      expenses/
      tasks/
      leave/
      meetings/

    sales/
      dashboard/
      leads/
      follow-ups/
      calls/
      conversations/
      bookings/
      payments/
      performance/
      expenses/
      tasks/
      leave/
      meetings/

    chef/
      dashboard/
      jobs/
      attendance/
      expenses/
      earnings/
      tasks/
      leave/
      meetings/

components/
  auth/
  layout/
  crm/
  charts/
  conversations/
  forms/
  feedback/

features/
  auth/
  users/
  leads/
  conversations/
  bookings/
  payments/
  workforce/
  attendance/
  expenses/
  leave/
  tasks/
  meetings/
  payroll/
  dashboards/
  integrations/

lib/
  auth/
  permissions/
  supabase/
  validation/
  formatting/
  queries/
  errors/
  constants/

supabase/
  migrations/
  functions/
    _shared/
      auth.ts
      cors.ts
      errors.ts
      idempotency.ts
      superfone/
        adapter.ts
        types.ts
        mapper.ts
    bootstrap-organization/
    create-team-member/
    update-account-status/
    replace-role-holder/
    superfone-test-connection/
    superfone-webhook/
    superfone-sync/
    superfone-import-existing-leads/
    superfone-send-message/
    superfone-send-media/
    superfone-replay-event/
  seed.sql

tests/
  unit/
  integration/
  e2e/

reference/
  legacy-crm.html
```

Keep feature repositories/query modules separate from presentational components. Avoid role logic duplicated across pages.

---

# 27. Query, Realtime and concurrency rules

- use server-side initial queries for dashboard routes where appropriate;
- use TanStack Query for client caching and targeted invalidation;
- use Supabase Realtime for new messages, unread counts, assignments, booking status and “Working Now” attendance;
- subscribe only to authorized organization/scope;
- paginate long lists from the server;
- use database joins/views instead of client-side N+1 loops;
- use optimistic UI only when rollback is implemented;
- use `version`/expected-status checks to prevent stale overwrites;
- do not refresh entire pages every 20 seconds;
- use focused intervals only for displayed elapsed timers.

---

# 28. Security requirements

- RLS enabled on every tenant/business table;
- inactive/blocked profiles receive no business data;
- organization isolation is mandatory;
- service-role key only in Edge Functions;
- provider secrets only in Edge Function secrets;
- webhook signature/shared-secret verification;
- strict Zod validation for external payloads;
- idempotent webhook and outbound-send handling;
- immutable audit logs;
- private Storage with signed URLs;
- rate limiting on login and provider-send functions;
- safe structured logs without passwords, keys, full Aadhaar values or proof URLs;
- CSRF-safe/authenticated mutations;
- no role/organization trust from client payloads;
- no raw SQL from the browser;
- no sensitive data in analytics or error trackers.

Mask Aadhaar in normal lists. Only authorized HR/Manager/Director may open the stored document.

---

# 29. Responsive and accessibility requirements

- keyboard navigation for menus, dialogs and tables;
- visible saffron focus state;
- semantic labels and form associations;
- accessible chart summaries;
- reduced-motion support;
- touch targets at least 44px where practical;
- no action available only on hover;
- all dialogs trap focus and restore it on close;
- mobile tables have a usable card/list alternative where horizontal scrolling harms comprehension;
- all critical workflows must work on a low-width phone viewport.

Test at least:

```text
360×800
390×844
768×1024
1024×768
1366×768
1440×900
```

---

# 30. Error handling

Create typed application errors:

```text
AUTH_REQUIRED
ACCOUNT_INACTIVE
ACCOUNT_BLOCKED
PERMISSION_DENIED
VALIDATION_FAILED
CONFLICT_STALE_VERSION
DUPLICATE_PHONE
PAYMENT_PROOF_REQUIRED
ATTENDANCE_NOT_ASSIGNED
ATTENDANCE_ALREADY_OPEN
SUPERFONE_NOT_CONFIGURED
SUPERFONE_CAPABILITY_UNAVAILABLE
SUPERFONE_RATE_LIMITED
SUPERFONE_AUTH_FAILED
STORAGE_UPLOAD_FAILED
```

Map them to user-friendly messages and top-right toasts. Log request IDs for support without exposing raw internals.

---

# 31. Tests

## 31.1 Unit tests

Test:

- phone normalization;
- money calculations;
- booking balance calculation;
- payroll component calculation;
- status-transition guards;
- permission helpers;
- Superfone payload mapping;
- Google Calendar URL generation;
- chart aggregation helpers.

## 31.2 Integration/database tests

Test:

- organization isolation;
- every role’s RLS allow/deny cases;
- one active Manager/HR/Sales Manager constraint;
- account deactivation denial;
- lead dedupe by provider ID and phone;
- duplicate webhook event;
- duplicate outbound send;
- atomic lead-to-booking conversion;
- payment verification;
- Chef assignment;
- one open shift per worker;
- attendance approval before payroll;
- paid payroll history preservation;
- private Storage authorization.

## 31.3 Playwright E2E

Test complete flows:

1. Director bootstrap/login.
2. Manager, HR, Sales Manager and workers created through hierarchy.
3. Deactivated user receives correct login warning and loses active access.
4. Webhook lead enters CRM once.
5. Director historical import shows progress and dedupes.
6. Sales Manager assigns lead.
7. Sales Member calls/messages, sets follow-up and converts lead.
8. Advance/full proof submitted and verified.
9. HR assigns Chef.
10. Chef starts/ends shift and completes service.
11. HR sees Working Now, then approves attendance date-wise.
12. Sales collects final payment when required.
13. Booking becomes Fully Completed.
14. HR prepares payroll; Director marks it paid; history remains.
15. Meeting is created, edited and Add to Google Calendar opens correctly.
16. All seven role sidebars and dashboards work on mobile and desktop.
17. Unauthorized routes and direct database reads fail.

---

# 32. Performance and cost optimization

- normal authorized CRUD may go directly from frontend to Supabase with JWT/RLS;
- do not proxy every query through a Server Action;
- Edge Functions only for privileged/provider/atomic service-role operations;
- add all required indexes before production;
- paginate leads, conversations, messages, bookings and audit logs;
- lazy-load heavy charts and large detail drawers;
- optimize images before upload;
- use private Storage paths, not inline data;
- avoid repeated aggregate scans by using SQL views/RPCs and appropriate indexes;
- scope Realtime subscriptions;
- clean old raw provider payloads according to retention policy while preserving normalized records/audit history.

---

# 33. Deployment and first-run setup

Deliver:

```text
.env.example
Supabase migrations
Storage policies
Edge Functions
seed.sql with development-only demo data
README setup/deployment instructions
AGENTS.md
```

Setup sequence:

1. install dependencies with pnpm;
2. start local Supabase;
3. apply migrations;
4. create private buckets/policies;
5. configure environment variables/secrets;
6. deploy Edge Functions;
7. run bootstrap-organization once;
8. log in as Director;
9. connect/test Superfone;
10. copy webhook URL into Superfone;
11. optionally run Import Existing Leads;
12. create Manager and complete hierarchy;
13. run tests;
14. deploy Next.js and production Supabase migrations.

Never commit secrets or production seed users.

---

# 34. Coding rules

- TypeScript strict; never use `any` without an explicit justified boundary.
- Keep components focused; split components that become difficult to reason about.
- Centralize roles, status labels, transition rules and colours.
- Use shared Zod schemas for client and Edge Function validation where practical.
- Calculate authoritative money values in PostgreSQL/RPCs, not floating-point browser code.
- Store currency as `numeric(12,2)` or integer paise consistently.
- Use `date` for event-only dates and `timestamptz` for instants.
- Avoid timezone parsing bugs for `YYYY-MM-DD`.
- Never silently catch errors.
- Never hard-delete financial, attendance, booking or audit history.
- Never label a message Delivered without provider confirmation.
- Never build fake Superfone endpoints.
- Never expose restricted columns and rely only on CSS hiding.
- Every primary feature requires loading, empty, error and success states.
- Every action must be connected to database logic and permission checks.

---

# 35. Definition of done

The implementation is complete only when:

- the fresh Next.js/Supabase codebase runs without the legacy JSON/localStorage architecture;
- the design remains recognizably Khana Banao and is modern/consistent on every page;
- top-right toasts work for all important mutations;
- all seven role sidebars, dashboards, KPI cards and mandatory charts are implemented;
- role hierarchy and upper-role access are enforced in RLS and Edge Functions;
- account deactivation/blocking shows the correct login warning and revokes active access;
- Superfone can be connected by Director through the simple connection flow;
- the generated webhook URL can receive supported official events;
- Director can import existing leads with resumable progress;
- normalized-phone/provider-ID deduplication works;
- 20 simultaneous Sales users do not overwrite or duplicate work;
- conversations, calls and unread counts update in realtime when supported;
- Sales Member converts a lead with advance/full payment proof;
- Sales Manager verifies payment;
- HR assigns Chef/Part-time Chef;
- Chef/Part-time Chef job and attendance workflows work;
- HR sees Working Now and date-wise pending attendance until approval;
- only approved/corrected attendance enters payroll;
- final-payment and fully-completed booking flow works;
- temporary workers work without login and wages are retained in history;
- meetings can be created, edited, rescheduled, deleted and added to Google Calendar;
- payroll paid history and lifetime earnings remain intact;
- private files are protected by Storage policies;
- migrations are reproducible;
- unit, integration and Playwright tests pass;
- production build, lint and type-check pass;
- no primary control is a mock or dead button.

---

# 36. Final instruction to the coding agent

Implement the product fully. Start from a fresh codebase and use the supplied legacy HTML only as the visual reference. Preserve the Khana Banao navy/saffron identity, then modernize it consistently across all roles and all screen sizes.

Do not stop after creating pages or database tables. Complete the relationships, permissions, workflows, realtime updates, Storage handling, Edge Functions, dashboards, charts, responsive behavior, tests and production setup described above.
