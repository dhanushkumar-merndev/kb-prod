begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- One organization, two franchises. Every assertion below is about the wall
-- between them: a franchise-scoped user must never read or write across it,
-- while the Director keeps organization-wide reach.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
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
    ('c0000000-0000-4000-8000-000000000001'::uuid, 'fr-director@test.invalid'),
    ('c0000000-0000-4000-8000-000000000011'::uuid, 'fr-owner-one@test.invalid'),
    ('c0000000-0000-4000-8000-000000000012'::uuid, 'fr-manager-one@test.invalid'),
    ('c0000000-0000-4000-8000-000000000013'::uuid, 'fr-salesmgr-one@test.invalid'),
    ('c0000000-0000-4000-8000-000000000014'::uuid, 'fr-sales-one@test.invalid'),
    ('c0000000-0000-4000-8000-000000000021'::uuid, 'fr-owner-two@test.invalid'),
    ('c0000000-0000-4000-8000-000000000022'::uuid, 'fr-manager-two@test.invalid'),
    ('c0000000-0000-4000-8000-000000000023'::uuid, 'fr-salesmgr-two@test.invalid'),
    ('c0000000-0000-4000-8000-000000000024'::uuid, 'fr-sales-two@test.invalid')
) as u(id, email);

insert into public.organizations (id, name, slug)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Franchise Tenant', 'franchise-tenant');

insert into public.organization_settings (organization_id, manager_expense_limit)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 5000);

insert into public.franchises (id, organization_id, name, code)
values
  ('caaaaaaa-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'North', 'NOR'),
  ('cbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'South', 'SOU');

insert into public.profiles (
  id, organization_id, franchise_id, full_name, phone_e164, role,
  reports_to_profile_id, account_status, joining_date
)
values (
  'c0000000-0000-4000-8000-000000000001',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  null,
  'Franchise Director',
  '+919500000001',
  'director',
  null,
  'active',
  current_date
);

insert into public.profiles (
  id, organization_id, franchise_id, full_name, phone_e164, role,
  reports_to_profile_id, account_status, joining_date
)
values
  ('c0000000-0000-4000-8000-000000000011', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'caaaaaaa-0000-4000-8000-000000000001', 'Owner North', '+919500000011', 'franchise',
   'c0000000-0000-4000-8000-000000000001', 'active', current_date),
  ('c0000000-0000-4000-8000-000000000021', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'cbbbbbbb-0000-4000-8000-000000000002', 'Owner South', '+919500000021', 'franchise',
   'c0000000-0000-4000-8000-000000000001', 'active', current_date);

insert into public.profiles (
  id, organization_id, franchise_id, full_name, phone_e164, role,
  reports_to_profile_id, account_status, joining_date
)
values
  ('c0000000-0000-4000-8000-000000000012', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'caaaaaaa-0000-4000-8000-000000000001', 'Manager North', '+919500000012', 'manager',
   'c0000000-0000-4000-8000-000000000011', 'active', current_date),
  ('c0000000-0000-4000-8000-000000000022', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'cbbbbbbb-0000-4000-8000-000000000002', 'Manager South', '+919500000022', 'manager',
   'c0000000-0000-4000-8000-000000000021', 'active', current_date);

insert into public.profiles (
  id, organization_id, franchise_id, full_name, phone_e164, role,
  reports_to_profile_id, account_status, joining_date
)
values
  ('c0000000-0000-4000-8000-000000000013', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'caaaaaaa-0000-4000-8000-000000000001', 'Sales Manager North', '+919500000013',
   'sales_manager', 'c0000000-0000-4000-8000-000000000012', 'active', current_date),
  ('c0000000-0000-4000-8000-000000000023', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'cbbbbbbb-0000-4000-8000-000000000002', 'Sales Manager South', '+919500000023',
   'sales_manager', 'c0000000-0000-4000-8000-000000000022', 'active', current_date);

insert into public.profiles (
  id, organization_id, franchise_id, full_name, phone_e164, role,
  reports_to_profile_id, account_status, joining_date
)
values
  ('c0000000-0000-4000-8000-000000000014', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'caaaaaaa-0000-4000-8000-000000000001', 'Sales North', '+919500000014', 'sales',
   'c0000000-0000-4000-8000-000000000013', 'active', current_date),
  ('c0000000-0000-4000-8000-000000000024', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'cbbbbbbb-0000-4000-8000-000000000002', 'Sales South', '+919500000024', 'sales',
   'c0000000-0000-4000-8000-000000000023', 'active', current_date);

insert into auth.sessions (id, user_id)
values
  ('c3000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('c3000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000011'),
  ('c3000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000014'),
  ('c3000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000021');

-- Access also requires a live application session bound to the Auth session.
insert into public.login_sessions (
  organization_id, profile_id, session_code, session_version, auth_session_id
)
values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c0000000-0000-4000-8000-000000000001',
   'fr-director-session-code-000000001', 1, 'c3000000-0000-4000-8000-000000000001'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c0000000-0000-4000-8000-000000000011',
   'fr-owner-one-session-code-00000001', 1, 'c3000000-0000-4000-8000-000000000011'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c0000000-0000-4000-8000-000000000014',
   'fr-sales-one-session-code-00000001', 1, 'c3000000-0000-4000-8000-000000000014'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c0000000-0000-4000-8000-000000000021',
   'fr-owner-two-session-code-00000001', 1, 'c3000000-0000-4000-8000-000000000021');

insert into public.leads (
  id, organization_id, franchise_id, client_name, phone_e164, phone_normalized,
  status, assigned_sales_profile_id, created_by_profile_id
)
values
  ('c1000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'caaaaaaa-0000-4000-8000-000000000001', 'North Customer', '+919600000001', '+919600000001',
   'new', 'c0000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000013'),
  ('c2000000-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'cbbbbbbb-0000-4000-8000-000000000002', 'South Customer', '+919600000002', '+919600000002',
   'new', 'c0000000-0000-4000-8000-000000000024', 'c0000000-0000-4000-8000-000000000023');

-- @assertions-begin
select plan(26);

-- ---------------------------------------------------------------------------
-- Structural guarantees
-- ---------------------------------------------------------------------------

select has_table('public', 'franchises', 'the franchise registry exists');
select has_column('public', 'profiles', 'franchise_id', 'profiles carry franchise membership');
select col_is_null('public', 'profiles', 'franchise_id', 'only the Director may hold no franchise');

select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and permissive = 'RESTRICTIVE'
     and policyname like '%franchise_isolation'),
  38,
  'every franchise-scoped table carries a restrictive isolation policy'
);

select is(
  (select count(*)::int
   from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal
     and t.tgname in ('aa_franchise_scope', 'ab_enforce_franchise_scope')),
  38,
  'every franchise-scoped table carries the write guard trigger'
);

-- Role holders are unique per franchise, not per organization.
select hasnt_index('public', 'profiles', 'one_active_manager_per_org',
  'the organization-wide Manager index is gone');
select has_index('public', 'profiles', 'one_active_manager_per_franchise',
  'each franchise gets its own active Manager');
select has_index('public', 'profiles', 'one_active_franchise_owner_per_franchise',
  'each franchise gets a single active owner');

select throws_ok(
  $$insert into public.profiles (
      id, organization_id, franchise_id, full_name, phone_e164, role,
      reports_to_profile_id, account_status
    )
    values (
      'c0000000-0000-4000-8000-0000000000ff',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'caaaaaaa-0000-4000-8000-000000000001',
      'Second Manager North',
      '+919500000099',
      'manager',
      'c0000000-0000-4000-8000-000000000011',
      'active'
    )$$,
  '23505',
  null,
  'a franchise cannot hold two active Managers'
);

-- ---------------------------------------------------------------------------
-- Reads: a franchise owner sees only its own franchise
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-000000000011","role":"authenticated","session_id":"c3000000-0000-4000-8000-000000000011"}',
  true
);

select is(
  (select count(*)::int from public.leads),
  1,
  'the North owner sees only the North lead'
);

select is(
  (select count(*)::int from public.leads
   where id = 'c2000000-0000-4000-8000-000000000002'),
  0,
  'the North owner cannot read the South lead'
);

select is(
  (select public.current_franchise_id()),
  'caaaaaaa-0000-4000-8000-000000000001'::uuid,
  'the franchise context comes from the database profile'
);

select is(
  (select count(*)::int from public.profiles
   where franchise_id = 'cbbbbbbb-0000-4000-8000-000000000002'),
  0,
  'the North owner cannot enumerate South staff'
);

select is(
  (select count(*)::int from public.franchises),
  1,
  'a franchise owner sees only its own franchise registry row'
);

select is(
  ((public.get_leads_page(1, 50, null) ->> 'total')::int),
  1,
  'the leads read model is franchise scoped'
);

select is(
  (select total_count::int from public.get_dashboard_lead_counts()),
  1,
  'dashboard lead counts are franchise scoped'
);

select ok(
  not public.can_read_lead('c2000000-0000-4000-8000-000000000002'),
  'the lead read predicate refuses another franchise'
);

-- ---------------------------------------------------------------------------
-- Writes: the guard trigger blocks cross-franchise mutation
-- ---------------------------------------------------------------------------

with attempted as (
  update public.leads
  set client_name = 'Hijacked'
  where id = 'c2000000-0000-4000-8000-000000000002'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'updating another franchise lead matches no rows'
);

select throws_ok(
  $$insert into public.leads (
      organization_id, franchise_id, client_name, phone_e164, phone_normalized, status
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'cbbbbbbb-0000-4000-8000-000000000002',
      'Planted',
      '+919600000009',
      '+919600000009',
      'new'
    )$$,
  '42501',
  'FRANCHISE_SCOPE_VIOLATION',
  'a franchise owner cannot plant a row in another franchise'
);

select throws_ok(
  $$select public.create_franchise('Rogue', 'RGE')$$,
  '42501',
  'PERMISSION_DENIED',
  'only the Director may create a franchise'
);

select throws_ok(
  $$select public.assign_lead_to_franchise(
      'c1000000-0000-4000-8000-000000000001',
      'cbbbbbbb-0000-4000-8000-000000000002'
    )$$,
  '42501',
  'PERMISSION_DENIED',
  'only the Director may move a lead between franchises'
);

-- A Sales Executive is confined by its franchise as well as its assignment.
select set_config(
  'request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-000000000014","role":"authenticated","session_id":"c3000000-0000-4000-8000-000000000014"}',
  true
);

select is(
  (select count(*)::int from public.leads),
  1,
  'North Sales sees only its own franchise lead'
);

-- ---------------------------------------------------------------------------
-- The Director keeps organization-wide reach
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c3000000-0000-4000-8000-000000000001"}',
  true
);

select is(
  (select count(*)::int from public.leads),
  2,
  'the Director sees every franchise lead'
);

select is(
  (select count(*)::int from public.franchises),
  2,
  'the Director sees every franchise'
);

select is(
  (select count(*)::int from public.profiles),
  9,
  'the Director sees every profile in the organization'
);

select is(
  ((public.get_leads_page(1, 50, null) ->> 'total')::int),
  2,
  'the leads read model stays organization-wide for the Director'
);

select lives_ok(
  $$select public.create_franchise('East', 'EAS', 'Kolkata')$$,
  'the Director may create a franchise'
);

select lives_ok(
  $$select public.assign_lead_to_franchise(
      'c1000000-0000-4000-8000-000000000001',
      'cbbbbbbb-0000-4000-8000-000000000002',
      'Routing test'
    )$$,
  'the Director may route a lead into another franchise'
);

select is(
  (select franchise_id from public.leads where id = 'c1000000-0000-4000-8000-000000000001'),
  'cbbbbbbb-0000-4000-8000-000000000002'::uuid,
  'the routed lead now belongs to the receiving franchise'
);

select is(
  (select assigned_sales_profile_id
   from public.leads where id = 'c1000000-0000-4000-8000-000000000001'),
  null,
  'routing clears the previous franchise sales owner'
);

select * from finish();
rollback;
