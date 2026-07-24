# Roles and permissions

This is a readable map of the role model implemented in navigation, server
guards, PostgreSQL RLS, transactional RPCs and Edge Functions. `AGENTS.md`
remains authoritative.

## Hierarchy

```text
Director
└── Manager
    ├── HR
    │   ├── Chef
    │   ├── Part-time Chef
    │   └── Temporary workers (no login)
    └── Sales Manager
        └── Sales Executive (`sales`)
```

Exactly one active Director, Manager, HR and Sales Manager is allowed per
organization. Replacement is a transactional, audited workflow; deactivation
never deletes historical records.

## Enforcement layers

Permissions are enforced in depth:

1. the login flow derives role from `profiles`, never from a role picker;
2. each protected layout validates the active Auth/application session;
3. a role layout accepts only its own database role;
4. cross-role URL namespaces redirect to the caller's dashboard;
5. Server Actions revalidate actor state and validate inputs;
6. RLS derives organization and role from `auth.uid()`;
7. security-definer RPCs repeat authorization and state/version checks;
8. Edge Functions revalidate the Auth session and role before service-role use;
9. Storage policies enforce tenant, path and record scope.

Removing a menu item alone is never treated as access control.

## Account statuses

| Status              | Business access                                              |
| ------------------- | ------------------------------------------------------------ |
| `active`            | Allowed while Auth and application sessions are valid        |
| `inactive`          | Denied; contact HR/Manager message                           |
| `blocked`           | Denied; blocked-account message                              |
| `payment_pending`   | Denied; valid only for Part-time Chef pending required proof |
| `left_organization` | Denied; historical records retained                          |

Changing a user away from `active` increments `session_version`, closes
application sessions, revokes Auth sessions and writes an audit event.

## Domain permission matrix

| Domain                 | Director               | Manager                 | HR                       | Sales Manager             | Sales                     | Chef / PT Chef        |
| ---------------------- | ---------------------- | ----------------------- | ------------------------ | ------------------------- | ------------------------- | --------------------- |
| Organization settings  | Manage                 | No ownership/secrets    | No                       | No                        | No                        | No                    |
| Superfone setup/import | Director only          | No                      | No                       | No                        | No                        | No                    |
| Leads                  | All                    | Operational all         | No                       | Sales team                | Assigned/owned            | No                    |
| Conversations/calls    | All                    | Operational all         | No                       | Sales team                | Assigned                  | No                    |
| Bookings               | All                    | All                     | Confirmed/workforce view | Team                      | Own sold                  | Assigned jobs         |
| Customer payments      | Verify/override        | Verify/override         | No                       | Verify/reject             | Submit for own bookings   | No                    |
| Workforce accounts     | All lower roles        | Operational lower roles | Chef/PT Chef             | Availability only         | Availability only         | Own profile           |
| Attendance             | Override               | Override                | Manage/review            | Own only where applicable | Own only where applicable | Own start/end/history |
| Expense review         | Override/final         | Final within workflow   | Workforce verification   | Own submission            | Own submission            | Own submission        |
| Leave review           | Override               | Override                | Workforce branch         | Sales branch              | Own                       | Own                   |
| Payroll                | Full approval/pay/lock | Review                  | Generate/adjust/prepare  | No                        | No                        | Own earnings          |
| Sessions/audit         | Organization-wide      | Lower-role/scoped       | Workforce-scoped         | Sales-scoped              | Own actions               | Own actions           |

RLS redacts rows and restricted columns; the UI does not fetch sensitive data
and hide it with CSS.

## Account administration

### Create scope

| Actor                       | May create                                              |
| --------------------------- | ------------------------------------------------------- |
| Director                    | Manager, HR, Sales Manager, Sales, Chef, Part-time Chef |
| Manager                     | HR, Sales Manager                                       |
| HR                          | Chef, Part-time Chef                                    |
| Sales Manager               | Sales                                                   |
| Sales, Chef, Part-time Chef | Nobody                                                  |

### Account-status scope

| Actor                   | May change status for                      |
| ----------------------- | ------------------------------------------ |
| Director                | Every subordinate role                     |
| Manager                 | HR, Sales Manager and their lower branches |
| HR                      | Chef and Part-time Chef                    |
| Sales Manager           | Sales                                      |
| Individual contributors | Nobody                                     |

A user cannot administer their own account through this workflow. Part-time Chef
activation fails with `PAYMENT_PROOF_REQUIRED` when the organization setting
requires proof and no private proof path is recorded.

### Role replacement

- Director appoints/replaces Manager.
- Manager appoints/replaces HR and Sales Manager.
- The candidate must already hold the target role and be inactive.
- The caller supplies the expected current holder, preventing stale replacement.
- The prior holder is deactivated and sessions are revoked atomically.

## Role workspaces

### Director — `/director`

Navigation covers Dashboard, Leads & Calls, Conversations, Bookings, Payments,
Sales Team, Chefs & Staff, Attendance, Expenses, Team & Access, Assign Work, HR
Overview, Leave, Meetings, Payroll, Business Reports, Login Activity,
Integrations, and Import & Sync.

Director is the only role permitted to configure/test Superfone or run provider
sync/import/replay functions.

### Manager — `/manager`

Navigation covers Operations Dashboard, Leads & Calls, Conversations, Bookings,
Payment Verification, Chefs & Staff, Attendance, Expenses, Team & Access,
Assign Work, Leave, Meetings, and Login Activity.

Manager can review payroll at the permission/RPC layer but cannot approve, pay
or lock it. Director profile details, Director sessions, Director audit actions
and provider-secret/integration internals are excluded from Manager scope.

### HR — `/hr`

Navigation covers HR Dashboard, Chefs & Part-time Chefs, Temporary Workers,
Booking Assignment, Attendance Approval, Expense Claims, Leave Requests,
Employee Records, Meetings, and Payroll.

HR controls only the workforce branch. Employee private documents are limited
to essential Aadhaar and Part-time Chef payment proof records.

### Sales Manager — `/sales-manager`

Navigation covers Dashboard, Team Leads, Lead Assignment, Follow-ups, Calls,
Conversations, Team Bookings, Payment Verification, Sales Team, Performance,
My Expenses, Assign Work, Leave, and Meetings.

Sales Manager can manage Sales accounts, assignment and payment decisions but
cannot access workforce payroll/employee documents or provider configuration.

### Sales Executive — `/sales`

Navigation covers Dashboard, My Leads, Follow-ups, Calls, Conversations, My
Bookings, Payments, My Performance, My Expenses, My Tasks, Leave, and Meetings.

RLS limits leads, conversations and bookings to assigned/owned records. Sales
can submit proof for an owned booking but cannot verify it.

### Chef — `/chef`

Navigation covers Dashboard, My Jobs, Attendance, My Expenses, My Earnings, My
Tasks, Leave, and Meetings.

Chef can operate only assigned jobs and their own shifts. Customer quotation,
booking total, payment proof, sales notes, approved attendance and payroll
administration remain outside scope.

### Part-time Chef — `/part-time-chef`

The active workspace matches Chef with part-time pay/assignment rules. Before
activation, `payment_pending` is denied the normal workspace and receives the
account-status screen. There is no permanent “unlock” module.

## Workflow authority

### Sales

- Sales Manager/Manager/Director can assign and reassign leads/conversations.
- Sales can update only assigned work.
- Expected `version` values protect assignment and conversation status changes.
- Outbound messages require the official provider capability and an idempotency
  UUID.

### Payments and bookings

- Sales/authorized sales admins submit proof.
- Sales Manager, Manager or Director verifies/rejects.
- Rejection requires a reason.
- HR assigns Chef only after the booking reaches an eligible state; Manager and
  Director can override.
- Chef changes only their assigned service workflow.

### Attendance

- Chef/PT Chef starts and ends only their own eligible shift.
- HR, Manager and Director review, correct, reject, mark absent or record a
  missed shift.
- Correction requires a reason and writes before/after audit data.
- Only approved/corrected attendance becomes payroll eligible.

### Expenses and leave

- Submitters see and mutate their own pending requests.
- HR verifies workforce expense claims.
- Manager/Director perform later approval/override according to workflow.
- HR reviews workforce leave; Sales Manager reviews Sales leave; upper roles
  may override.

### Payroll

```text
HR generate/adjust/prepare
→ Manager review
→ Director approve
→ Director mark paid
→ Director lock
```

Director can perform an audited reversal; paid history remains present.
Chef/PT Chef can read only their own earnings summary/history.

## Sensitive-data rules

- Service-role and Superfone secrets are Edge Function secrets only.
- Manager and lower roles never read provider secrets.
- Employee files are private and limited to HR-scope admins
  (Director/Manager/HR).
- Customer payment proofs are private to sales-scope submitters/reviewers.
- Expense bills follow the normalized expense's RLS scope.
- Login-session codes are never selected by login-activity screens.
- Audit/provider failure text is sanitized and request-ID based.
- Aadhaar values/documents must not appear in ordinary lists or logs.

## Adding a permission

Changing permissions requires all applicable layers in one reviewed change:

1. update the role contract if product authority changes;
2. add/adjust the RLS policy or RPC authorization;
3. restrict table-column grants;
4. update Storage policies if a file is involved;
5. add server/action authorization;
6. add navigation only after the data permission exists;
7. add allow and deny tests for the target role and another tenant;
8. run the complete release checks in `docs/TESTING.md`.
