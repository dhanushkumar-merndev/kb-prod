begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(60);

-- Stable fixture identifiers make failures easy to inspect while the outer
-- transaction guarantees the database is left unchanged.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  u.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  u.email,
  crypt('Database-test-only-42!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
from (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'director-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'manager-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'hr-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'sales-manager-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'sales-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'chef-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000007'::uuid, 'inactive-sales-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000008'::uuid, 'replacement-hr-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000009'::uuid, 'second-hr-a@test.invalid'),
    ('10000000-0000-4000-8000-000000000010'::uuid, 'part-time-chef-a@test.invalid'),
    ('20000000-0000-4000-8000-000000000001'::uuid, 'director-b@test.invalid'),
    ('20000000-0000-4000-8000-000000000002'::uuid, 'sales-b@test.invalid'),
    ('20000000-0000-4000-8000-000000000003'::uuid, 'sales-manager-b@test.invalid'),
    ('20000000-0000-4000-8000-000000000004'::uuid, 'manager-b@test.invalid')
) as u(id, email);

insert into public.organizations (id, name, slug)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A', 'tenant-a'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B', 'tenant-b');

insert into public.organization_settings (organization_id, manager_expense_limit)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5000),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 5000);

insert into public.profiles (
  id,
  organization_id,
  full_name,
  phone_e164,
  role,
  reports_to_profile_id,
  account_status,
  joining_date
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Director A',
    '+919000000001',
    'director',
    null,
    'active',
    current_date
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Director B',
    '+919100000001',
    'director',
    null,
    'active',
    current_date
  );

insert into public.profiles (
  id,
  organization_id,
  full_name,
  phone_e164,
  role,
  reports_to_profile_id,
  account_status,
  joining_date
)
values
  (
    '10000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Manager A',
    '+919000000002',
    'manager',
    '10000000-0000-4000-8000-000000000001',
    'active',
    current_date
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Manager B',
    '+919100000004',
    'manager',
    '20000000-0000-4000-8000-000000000001',
    'active',
    current_date
  );

insert into public.profiles (
  id,
  organization_id,
  full_name,
  phone_e164,
  role,
  reports_to_profile_id,
  account_status,
  joining_date
)
values
  (
    '10000000-0000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'HR A',
    '+919000000003',
    'hr',
    '10000000-0000-4000-8000-000000000002',
    'active',
    current_date
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Sales Manager A',
    '+919000000004',
    'sales_manager',
    '10000000-0000-4000-8000-000000000002',
    'active',
    current_date
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Sales Manager B',
    '+919100000003',
    'sales_manager',
    '20000000-0000-4000-8000-000000000004',
    'active',
    current_date
  );

insert into public.profiles (
  id,
  organization_id,
  full_name,
  phone_e164,
  role,
  reports_to_profile_id,
  account_status,
  joining_date
)
values
  (
    '10000000-0000-4000-8000-000000000005',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Sales A',
    '+919000000005',
    'sales',
    '10000000-0000-4000-8000-000000000004',
    'active',
    current_date
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Chef A',
    '+919000000006',
    'chef',
    '10000000-0000-4000-8000-000000000003',
    'active',
    current_date
  ),
  (
    '10000000-0000-4000-8000-000000000007',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Inactive Sales A',
    '+919000000007',
    'sales',
    '10000000-0000-4000-8000-000000000004',
    'inactive',
    current_date
  ),
  (
    '10000000-0000-4000-8000-000000000008',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Replacement HR A',
    '+919000000008',
    'hr',
    '10000000-0000-4000-8000-000000000002',
    'inactive',
    current_date
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Sales B',
    '+919100000002',
    'sales',
    '20000000-0000-4000-8000-000000000003',
    'active',
    current_date
  );

insert into public.profiles (
  id,
  organization_id,
  full_name,
  phone_e164,
  role,
  reports_to_profile_id,
  account_status,
  joining_date,
  payment_type,
  payment_amount,
  part_time_payment_proof_path,
  part_time_payment_amount
)
values (
  '10000000-0000-4000-8000-000000000010',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Part-time Chef A',
  '+919000000010',
  'part_time_chef',
  '10000000-0000-4000-8000-000000000003',
  'active',
  current_date,
  'per_booking',
  1800,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
    '10000000-0000-4000-8000-000000000010/' ||
    'part-time-payment-proof/proof.png',
  1800
);

insert into auth.sessions (id, user_id)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007'),
  ('30000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008'),
  ('30000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000010'),
  ('30000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000103', '20000000-0000-4000-8000-000000000003');

insert into public.role_assignment_history (
  organization_id,
  role,
  profile_id,
  assigned_by_profile_id,
  reason
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'hr',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000002',
  'Test fixture'
);

insert into public.login_sessions (
  organization_id,
  profile_id,
  session_code,
  session_version,
  auth_session_id
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000001',
    'director-session-code-0000000000001',
    1,
    '30000000-0000-4000-8000-000000000001'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000002',
    'manager-session-code-00000000000001',
    1,
    '30000000-0000-4000-8000-000000000002'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000003',
    'old-hr-session-code-00000000000001',
    1,
    '30000000-0000-4000-8000-000000000003'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000004',
    'sales-manager-session-code-00000001',
    1,
    '30000000-0000-4000-8000-000000000004'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000005',
    'sales-session-code-0000000000000001',
    1,
    '30000000-0000-4000-8000-000000000005'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000006',
    'chef-session-code-00000000000000001',
    1,
    '30000000-0000-4000-8000-000000000006'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000007',
    'inactive-sales-session-00000000001',
    1,
    '30000000-0000-4000-8000-000000000007'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000008',
    'replacement-hr-session-00000000001',
    1,
    '30000000-0000-4000-8000-000000000008'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000010',
    'part-time-chef-session-code-0000001',
    1,
    '30000000-0000-4000-8000-000000000010'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '20000000-0000-4000-8000-000000000001',
    'director-b-session-code-00000000001',
    1,
    '30000000-0000-4000-8000-000000000101'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '20000000-0000-4000-8000-000000000002',
    'sales-b-session-code-0000000000001',
    1,
    '30000000-0000-4000-8000-000000000102'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '20000000-0000-4000-8000-000000000003',
    'sales-manager-b-session-0000000001',
    1,
    '30000000-0000-4000-8000-000000000103'
  );

insert into public.leads (
  id,
  organization_id,
  provider,
  provider_lead_id,
  client_name,
  phone_e164,
  phone_normalized,
  assigned_sales_profile_id,
  created_by_profile_id
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'manual',
    null,
    'Customer A',
    '+919200000001',
    '+919200000001',
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'manual',
    null,
    'Customer B',
    '+919200000002',
    '+919200000002',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002'
  );

insert into public.bookings (
  id,
  organization_id,
  booking_code,
  lead_id,
  client_name,
  phone_e164,
  event_type,
  event_date,
  reporting_time,
  venue,
  guest_count,
  menu,
  total_value,
  service_status,
  sold_by_profile_id
)
values (
  '50000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'KB-T001',
  '40000000-0000-4000-8000-000000000001',
  'Customer A',
  '+919200000001',
  'Wedding',
  current_date + 5,
  '10:00',
  'Test Venue',
  100,
  'Test menu',
  25000,
  'confirmed',
  '10000000-0000-4000-8000-000000000005'
);

insert into public.booking_assignments (
  id,
  organization_id,
  booking_id,
  chef_profile_id,
  assigned_by_profile_id,
  agreed_pay_type,
  agreed_pay_amount
)
values (
  '51000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000003',
  'per_booking',
  2500
);

insert into storage.objects (bucket_id, name)
values
  (
    'employee-private',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
      '10000000-0000-4000-8000-000000000006/aadhaar/document.pdf'
  ),
  (
    'payment-proofs',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
      '10000000-0000-4000-8000-000000000005/' ||
      '50000000-0000-4000-8000-000000000001/proof.png'
  );

insert into public.tasks (
  id,
  organization_id,
  title,
  assigned_to_profile_id,
  assigned_by_profile_id,
  status
)
values (
  '60000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Prepare event',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000003',
  'open'
);

insert into public.expenses (
  id,
  organization_id,
  submitted_by_profile_id,
  category,
  amount,
  reason
)
values (
  '61000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '10000000-0000-4000-8000-000000000005',
  'travel',
  100,
  'Customer visit'
);

insert into public.audit_logs (
  id,
  organization_id,
  actor_profile_id,
  action,
  entity_type,
  entity_id,
  before_data,
  after_data
)
values
  (
    '62000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000005',
    'expense.created',
    'expense',
    '61000000-0000-4000-8000-000000000001',
    null,
    '{"amount":100,"branch":"sales"}'
  ),
  (
    '62000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000001',
    'organization.settings_changed',
    'organization',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    null,
    '{"monthly_revenue_target":500000}'
  );

select is(
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname = any (array[
        'organizations', 'organization_settings', 'profiles',
        'role_assignment_history', 'login_sessions', 'audit_logs', 'leads',
        'lead_assignment_history', 'lead_activities', 'follow_ups',
        'conversations', 'conversation_assignments', 'messages',
        'message_attempts', 'conversation_reads', 'superfone_calls',
        'integration_connections', 'integration_events',
        'integration_sync_runs', 'bookings', 'booking_status_history',
        'booking_assignments', 'booking_payments', 'temporary_workers',
        'temporary_worker_assignments', 'attendance_shifts', 'break_sessions',
        'expenses', 'expense_attachments', 'leave_requests', 'tasks',
        'meetings', 'meeting_attendees', 'payroll_periods', 'payroll_entries',
        'payroll_components', 'notifications', 'announcements',
        'announcement_recipients'
      ])
      and not c.relrowsecurity
  ),
  0,
  'RLS is enabled on every business table'
);

select ok(
  not has_table_privilege('authenticated', 'public.login_sessions', 'INSERT'),
  'application sessions cannot be inserted directly'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.login_sessions',
    'session_code',
    'SELECT'
  ),
  'reusable application session codes are not selectable'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.close_all_my_login_sessions(text)',
    'EXECUTE'
  ),
  'authenticated users can invoke audited all-device logout'
);
select ok(
  not has_table_privilege('service_role', 'public.audit_logs', 'INSERT'),
  'service-role API clients cannot forge audit rows directly'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'employee_private_update_hr_scope'
  ),
  0,
  'referenced employee documents cannot be overwritten in place'
);
select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'login_sessions'
      and indexname = 'one_active_app_session_per_profile'
  ),
  1,
  'one active application session is enforced per profile'
);
select ok(
  public.storage_path_is_structurally_safe(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
    '10000000-0000-4000-8000-000000000005/' ||
    '50000000-0000-4000-8000-000000000001/proof.png'
  ),
  'normalized four-component Storage paths are accepted'
);
select ok(
  not public.storage_path_is_structurally_safe(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
    '10000000-0000-4000-8000-000000000005/../proof.png'
  ),
  'ambiguous Storage traversal segments are rejected'
);

select throws_ok(
  $test$
    insert into public.profiles (
      id, organization_id, full_name, phone_e164, role,
      reports_to_profile_id, account_status
    )
    values (
      '10000000-0000-4000-8000-000000000009',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Second HR',
      '+919000000009',
      'hr',
      '10000000-0000-4000-8000-000000000002',
      'active'
    )
  $test$,
  '23505',
  null,
  'only one active HR is allowed per organization'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000005"}',
  true
);
select is((select count(*) from public.leads), 1::bigint, 'Sales sees only assigned tenant leads');
select is((select count(*) from public.bookings), 1::bigint, 'Sales sees only own sold bookings');
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'payment-proofs'
  ),
  1::bigint,
  'Sales can read a proof uploaded under their own booking path'
);
select lives_ok(
  $test$
    insert into storage.objects (bucket_id, name)
    values (
      'expense-bills',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
        '10000000-0000-4000-8000-000000000005/' ||
        '61000000-0000-4000-8000-000000000099/bill.png'
    )
  $test$,
  'Sales can stage an own-scoped expense bill before submitting its metadata'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000001"}',
  true
);
select is(
  (select count(*) from public.leads),
  1::bigint,
  'Director sees all leads in their organization and no cross-tenant lead'
);
reset role;

update public.login_sessions
set
  login_at = now() - interval '8 days',
  last_seen_at = now()
where profile_id = '20000000-0000-4000-8000-000000000001'
  and logout_at is null;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000101"}',
  true
);
select is(
  public.current_auth_session_is_valid(),
  false,
  'application sessions stop authorizing after the seven-day maximum lifetime'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000010","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000010"}',
  true
);
select is(
  public.current_auth_session_is_valid(),
  true,
  'active Part-time Chef has a valid role-scoped application session'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000002"}',
  true
);
select is(
  (select count(*) from public.profiles where role = 'director'),
  0::bigint,
  'Manager cannot enumerate the Director profile'
);
select is(
  (
    select count(*)
    from public.audit_logs
    where id = '62000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'Manager cannot read Director organization audit events'
);
select throws_ok(
  $test$
    select public.open_login_session(
      'replayed-manager-session-code-00001',
      'pgTAP',
      'test-ip-hash'
    )
  $test$,
  '42501',
  'AUTH_SESSION_ALREADY_BOUND',
  'a bound Supabase Auth session cannot mint another application session'
);
reset role;

insert into auth.sessions (id, user_id)
values (
  '30000000-0000-4000-8000-000000000202',
  '10000000-0000-4000-8000-000000000002'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000202"}',
  true
);
select lives_ok(
  $test$
    select public.open_login_session(
      'replacement-manager-session-code-00001',
      'pgTAP',
      'test-ip-hash'
    )
  $test$,
  'opening a new bound application session succeeds'
);
select is(
  (
    select count(*)
    from public.login_sessions
    where profile_id = '10000000-0000-4000-8000-000000000002'
      and logout_at is null
  ),
  1::bigint,
  'opening a session leaves exactly one active application session'
);
select is(
  (
    select logout_reason
    from public.login_sessions
    where profile_id = '10000000-0000-4000-8000-000000000002'
      and logout_at is not null
    order by logout_at desc
    limit 1
  ),
  'superseded_by_new_login',
  'opening a session records why the previous session was closed'
);
reset role;

update public.login_sessions
set last_seen_at = now() - interval '13 hours'
where profile_id = '20000000-0000-4000-8000-000000000002'
  and logout_at is null;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000102"}',
  true
);
select is(
  public.current_auth_session_is_valid(),
  false,
  'application sessions stop authorizing after 12 hours of inactivity'
);
select is(
  (select count(*) from public.leads),
  0::bigint,
  'expired application sessions receive no RLS-protected business rows'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000103"}',
  true
);
select is(
  public.close_all_my_login_sessions('pgTAP all-device logout'),
  1,
  'all-device logout closes the caller active application session'
);
reset role;
select is(
  (
    select count(*)
    from auth.sessions
    where user_id = '20000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'all-device logout revokes the caller Supabase Auth sessions'
);
select is(
  (
    select count(*)
    from public.login_sessions
    where profile_id = '20000000-0000-4000-8000-000000000003'
      and logout_at is null
  ),
  0::bigint,
  'all-device logout leaves no active application session'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000007"}',
  true
);
select is((select count(*) from public.leads), 0::bigint, 'inactive profile receives no lead rows');
select is(
  (select account_status::text from public.get_my_auth_context()),
  'inactive',
  'inactive profile can still retrieve its safe login status'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000003"}',
  true
);
select is((select count(*) from public.bookings), 0::bigint, 'HR cannot select raw booking financial/contact rows');
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'employee-private'
  ),
  1::bigint,
  'HR can read workforce employee documents in the same organization'
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'payment-proofs'
  ),
  0::bigint,
  'HR cannot read customer payment proofs'
);
select is(
  (select count(*) from public.get_workforce_bookings(current_date, current_date + 30, null)),
  1::bigint,
  'HR receives the redacted workforce booking projection'
);
select is((select count(*) from public.audit_logs), 0::bigint, 'HR cannot read sales-branch audit JSON');
select throws_ok(
  $test$
    update public.tasks
    set assigned_to_profile_id = '10000000-0000-4000-8000-000000000005'
    where id = '60000000-0000-4000-8000-000000000001'
  $test$,
  '42501',
  null,
  'HR cannot move a workforce task into the sales branch'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000006"}',
  true
);
select is((select count(*) from public.bookings), 0::bigint, 'Chef cannot select raw booking financial/contact rows');
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'employee-private'
  ),
  0::bigint,
  'Chef cannot read employee-private documents, including their own Aadhaar file'
);
select is(
  (select count(*) from public.get_workforce_bookings(current_date, current_date + 30, null)),
  1::bigint,
  'assigned Chef receives one redacted operational booking'
);
select throws_ok(
  $test$
    update public.tasks
    set title = 'Rewritten by assignee'
    where id = '60000000-0000-4000-8000-000000000001'
  $test$,
  '42501',
  'PERMISSION_DENIED',
  'task assignee cannot rewrite task metadata'
);
select lives_ok(
  $test$
    update public.tasks
    set status = 'completed', completed_at = now()
    where id = '60000000-0000-4000-8000-000000000001'
  $test$,
  'task assignee may complete the task'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"30000000-0000-4000-8000-000000000004"}',
  true
);
select is(
  (select count(*) from public.booking_assignments),
  0::bigint,
  'Sales Manager cannot select agreed Chef pay from assignment rows'
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'payment-proofs'
  ),
  1::bigint,
  'Sales Manager can read payment proofs for verification'
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'employee-private'
  ),
  0::bigint,
  'Sales Manager cannot read employee-private documents'
);
select is(
  (
    select count(*)
    from public.get_booking_assignee_summaries(
      array['50000000-0000-4000-8000-000000000001'::uuid]
    )
  ),
  1::bigint,
  'Sales Manager receives the pay-free assignee summary'
);
reset role;

select throws_ok(
  $test$
    insert into public.follow_ups (
      organization_id, lead_id, assigned_profile_id, due_at, created_by_profile_id
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000006',
      now() + interval '1 day',
      '10000000-0000-4000-8000-000000000004'
    )
  $test$,
  '23514',
  'INVALID_SALES_ASSIGNEE',
  'follow-up cannot be assigned to a Chef'
);

select throws_ok(
  $test$
    insert into public.booking_payments (
      organization_id, booking_id, payment_stage, amount,
      proof_storage_path, submitted_by_profile_id
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '50000000-0000-4000-8000-000000000001',
      'advance',
      1000,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/wrong-user/wrong-booking/file.png',
      '10000000-0000-4000-8000-000000000005'
    )
  $test$,
  '23514',
  'INVALID_PAYMENT_PROOF_PATH',
  'payment metadata cannot bind an arbitrary Storage path'
);

select throws_ok(
  $test$
    insert into public.booking_payments (
      organization_id,
      booking_id,
      payment_stage,
      amount,
      proof_storage_path,
      submitted_by_profile_id
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '50000000-0000-4000-8000-000000000001',
      'advance',
      0,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' ||
        '10000000-0000-4000-8000-000000000005/' ||
        '50000000-0000-4000-8000-000000000001/zero.png',
      '10000000-0000-4000-8000-000000000005'
    )
  $test$,
  '23514',
  null,
  'zero-value payment records are rejected'
);

select throws_ok(
  $test$
    insert into public.expense_attachments (
      organization_id, expense_id, storage_path, file_name, mime_type, size_bytes
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '61000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/wrong-user/wrong-expense/file.png',
      'file.png',
      'image/png',
      128
    )
  $test$,
  '23514',
  'INVALID_EXPENSE_ATTACHMENT_PATH',
  'expense metadata cannot hijack an arbitrary Storage path'
);

select throws_ok(
  $test$
    insert into public.profiles (
      id,
      organization_id,
      full_name,
      phone_e164,
      role,
      reports_to_profile_id,
      account_status
    )
    values (
      '10000000-0000-4000-8000-000000000009',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Invalid HR Hierarchy',
      '+919000000009',
      'hr',
      '10000000-0000-4000-8000-000000000001',
      'inactive'
    )
  $test$,
  '23514',
  'INVALID_REPORTING_HIERARCHY',
  'profile reporting hierarchy is enforced in the database'
);

set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
select throws_ok(
  $test$
    select public.replace_role_holder(
      '10000000-0000-4000-8000-000000000006',
      'manager',
      'Invalid cross-role promotion',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      'test-role-mismatch'
    )
  $test$,
  '22023',
  'ROLE_CANDIDATE_MISMATCH',
  'role replacement requires a same-role candidate'
);
select lives_ok(
  $test$
    select public.replace_role_holder(
      '10000000-0000-4000-8000-000000000008',
      'hr',
      'Planned HR replacement',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      'test-role-replace'
    )
  $test$,
  'same-role HR replacement succeeds'
);
select is(
  (
    select reports_to_profile_id
    from public.profiles
    where id = '10000000-0000-4000-8000-000000000006'
  ),
  '10000000-0000-4000-8000-000000000008'::uuid,
  'HR replacement reparents existing Chefs'
);
select is(
  (
    select account_status::text
    from public.profiles
    where id = '10000000-0000-4000-8000-000000000003'
  ),
  'inactive',
  'outgoing role holder is preserved and deactivated'
);
select is(
  (
    select count(*)
    from public.login_sessions
    where profile_id = '10000000-0000-4000-8000-000000000003'
      and logout_at is null
  ),
  0::bigint,
  'role replacement closes outgoing application sessions'
);

-- Simulate credentials creating an Auth session while the profile is inactive;
-- reactivation must revoke that session and require a fresh login.
select lives_ok(
  $test$
    select public.update_account_status(
      '10000000-0000-4000-8000-000000000007',
      'active',
      'Reactivate test account',
      '10000000-0000-4000-8000-000000000001',
      'test-reactivate'
    )
  $test$,
  'reactivation transaction succeeds'
);
select is(
  (
    select count(*)
    from auth.sessions
    where user_id = '10000000-0000-4000-8000-000000000007'
  ),
  0::bigint,
  'reactivation revokes sessions obtained while inactive'
);
reset role;

select ok(
  not has_function_privilege(
    'authenticated',
    'public.update_account_status(uuid,public.account_status,text,uuid,text)',
    'EXECUTE'
  ),
  'account administration RPC is Edge/service-role only'
);

select throws_ok(
  $test$
    update public.audit_logs
    set reason = 'tampered'
    where id = '62000000-0000-4000-8000-000000000001'
  $test$,
  '42501',
  'AUDIT_LOG_IMMUTABLE',
  'audit rows cannot be updated'
);

select throws_ok(
  'truncate table public.audit_logs',
  '42501',
  'AUDIT_LOG_IMMUTABLE',
  'audit history cannot be truncated'
);

select * from finish();
rollback;
