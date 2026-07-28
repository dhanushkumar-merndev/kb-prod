begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

select has_table('public', 'invoice_sequences', 'invoice sequence table exists');
select has_table('public', 'invoices', 'immutable invoice table exists');
select has_table('public', 'email_outbox', 'email outbox table exists');
select has_table('public', 'email_delivery_events', 'delivery event table exists');
select has_column('public', 'leads', 'customer_email', 'leads have customer email');
select has_column('public', 'bookings', 'customer_email', 'bookings have customer email');
select has_column(
  'public',
  'organization_settings',
  'email_automation_enabled',
  'email automation has a deployment switch'
);
select has_column(
  'public',
  'organization_settings',
  'customer_email_sender_email',
  'sender identity is organization-scoped'
);
select has_function(
  'public',
  'transition_lead_stage',
  array['uuid', 'lead_status', 'integer', 'text'],
  'audited lead transition RPC exists'
);
select has_function(
  'public',
  'issue_booking_invoice',
  array['uuid'],
  'invoice issue RPC exists'
);
select has_function(
  'public',
  'void_and_reissue_invoice',
  array['uuid', 'text'],
  'invoice replacement RPC exists'
);
select has_function(
  'public',
  'retry_customer_email',
  array['uuid'],
  'outbox retry RPC exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.invoices'::regclass),
  'invoice RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.email_outbox'::regclass),
  'outbox RLS is enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.invoice_sequences', 'SELECT'),
  'staff cannot inspect invoice sequence state'
);
select ok(
  not has_table_privilege('authenticated', 'public.invoices', 'UPDATE'),
  'staff cannot overwrite invoice snapshots'
);
select ok(
  not has_table_privilege('authenticated', 'public.email_outbox', 'INSERT'),
  'staff cannot insert arbitrary customer email'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.transition_lead_stage(uuid,public.lead_status,integer,text)',
    'EXECUTE'
  ),
  'authenticated staff use the guarded transition RPC'
);

-- Database-level lifecycle coverage: qualified lead -> payment pending ->
-- confirmed/in process -> fully completed/won. The transaction is rolled back.
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
values (
  '30000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'invoice-flow@test.invalid',
  crypt('Database-test-only-42!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.organizations (id, name, slug)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Invoice Flow', 'invoice-flow');

insert into public.organization_settings (
  organization_id,
  invoice_prefix,
  email_automation_enabled
)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'KB', false);

insert into public.profiles (
  id,
  organization_id,
  full_name,
  phone_e164,
  role,
  account_status,
  joining_date
)
values (
  '30000000-0000-4000-8000-000000000001',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Invoice Sales',
  '+919200000001',
  'sales',
  'active',
  current_date
);

insert into public.leads (
  id,
  organization_id,
  client_name,
  customer_email,
  phone_e164,
  phone_normalized,
  requirement,
  event_date,
  guest_count,
  quote_amount,
  status,
  assigned_sales_profile_id,
  created_by_profile_id
)
values (
  '31000000-0000-4000-8000-000000000001',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Invoice Customer',
  'customer@example.com',
  '+919200000002',
  '+919200000002',
  'Wedding catering',
  current_date + 30,
  150,
  125000,
  'qualified',
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
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
  venue,
  guest_count,
  menu,
  total_value,
  sold_by_profile_id
)
values (
  '32000000-0000-4000-8000-000000000001',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'KB-FLOW-001',
  '31000000-0000-4000-8000-000000000001',
  'Invoice Customer',
  '+919200000002',
  'Wedding',
  current_date + 30,
  'Test Venue',
  150,
  'Complete catering menu',
  125000,
  '30000000-0000-4000-8000-000000000001'
);

select is(
  (
    select customer_email
    from public.bookings
    where id = '32000000-0000-4000-8000-000000000001'
  ),
  'customer@example.com',
  'booking copies the lead customer email'
);
select is(
  (
    select count(*)
    from public.invoices
    where booking_id = '32000000-0000-4000-8000-000000000001'
      and status = 'pending_generation'
  ),
  1::bigint,
  'booking automatically creates one invoice snapshot'
);
select is(
  (
    select status::text
    from public.email_outbox
    where booking_id = '32000000-0000-4000-8000-000000000001'
      and event_type = 'booking_payment_requested'
  ),
  'skipped',
  'disabled automation records a visible skipped email'
);

update public.leads
set status = 'booking_in_process'
where id = '31000000-0000-4000-8000-000000000001';

select is(
  (
    select status::text
    from public.leads
    where id = '31000000-0000-4000-8000-000000000001'
  ),
  'booking_payment_pending',
  'unpaid booking cannot skip payment-pending stage'
);

update public.bookings
set payment_status = 'partial', service_status = 'confirmed'
where id = '32000000-0000-4000-8000-000000000001';

select is(
  (
    select status::text
    from public.leads
    where id = '31000000-0000-4000-8000-000000000001'
  ),
  'booking_in_process',
  'confirmed paid booking advances the lead to in process'
);

update public.bookings
set
  payment_status = 'fully_paid',
  service_status = 'service_completed',
  service_completed_at = now()
where id = '32000000-0000-4000-8000-000000000001';

select is(
  (
    select service_status::text
    from public.bookings
    where id = '32000000-0000-4000-8000-000000000001'
  ),
  'fully_completed',
  'fully paid service completes in either milestone order'
);
select is(
  (
    select status::text
    from public.leads
    where id = '31000000-0000-4000-8000-000000000001'
  ),
  'won',
  'fully paid completed booking advances its lead to won'
);

select * from finish();
rollback;
