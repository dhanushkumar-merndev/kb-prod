-- Khana Banao CRM: normalized tenant schema.
-- All monetary values are stored as numeric(12,2) in the organization's currency.

create extension if not exists pgcrypto with schema extensions;

create type public.profile_role as enum (
  'director',
  'manager',
  'hr',
  'sales_manager',
  'sales',
  'chef',
  'part_time_chef'
);

create type public.account_status as enum (
  'active',
  'inactive',
  'blocked',
  'payment_pending',
  'left_organization'
);

create type public.payment_type as enum ('monthly', 'daily', 'hourly', 'per_booking');
create type public.lead_status as enum (
  'new',
  'contacted',
  'follow_up',
  'qualified',
  'booking_payment_pending',
  'booking_in_process',
  'won',
  'lost',
  'unreachable'
);
create type public.follow_up_status as enum ('open', 'completed', 'cancelled', 'overdue');
create type public.conversation_status as enum ('open', 'pending', 'resolved', 'closed');
create type public.message_direction as enum ('inbound', 'outbound', 'internal');
create type public.message_status as enum (
  'received',
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'opened_external',
  'skipped'
);
create type public.integration_connection_status as enum (
  'disconnected',
  'testing',
  'connected',
  'degraded',
  'failed'
);
create type public.integration_event_status as enum (
  'received',
  'processing',
  'processed',
  'failed',
  'ignored'
);
create type public.integration_sync_status as enum (
  'queued',
  'running',
  'completed',
  'partially_completed',
  'failed',
  'cancelled'
);
create type public.booking_payment_status as enum (
  'unpaid',
  'partial',
  'fully_paid',
  'refund_pending',
  'refunded'
);
create type public.booking_service_status as enum (
  'pending',
  'confirmed',
  'chef_assigned',
  'preparing',
  'service_completed',
  'fully_completed',
  'cancelled'
);
create type public.booking_payment_stage as enum ('advance', 'partial', 'final', 'full', 'refund');
create type public.verification_status as enum ('pending', 'verified', 'rejected');
create type public.temporary_worker_type as enum ('helper', 'server', 'cleaner', 'driver', 'other');
create type public.attendance_status as enum (
  'working',
  'pending_approval',
  'approved',
  'corrected',
  'rejected',
  'absent'
);
create type public.break_type as enum ('lunch', 'break', 'superfone');
create type public.expense_status as enum ('pending', 'verified', 'approved', 'rejected', 'paid');
create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.task_status as enum ('open', 'in_progress', 'completed', 'cancelled');
create type public.meeting_status as enum ('scheduled', 'completed', 'cancelled');
create type public.meeting_attendance_status as enum ('invited', 'accepted', 'declined', 'attended', 'absent');
create type public.payroll_period_status as enum (
  'draft',
  'prepared',
  'reviewed',
  'approved',
  'paid',
  'locked'
);
create type public.payroll_entry_status as enum (
  'draft',
  'reviewed',
  'approved',
  'paid',
  'reversed'
);
create type public.notification_type as enum (
  'lead_assignment',
  'customer_message',
  'follow_up_due',
  'payment_decision',
  'chef_assignment',
  'booking_status',
  'final_payment_required',
  'attendance_decision',
  'expense_decision',
  'leave_decision',
  'payroll_paid',
  'meeting_change',
  'account_status',
  'task_assignment',
  'info'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_row_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  manager_expense_limit numeric(12,2) not null default 0 check (manager_expense_limit >= 0),
  monthly_revenue_target numeric(12,2) not null default 0 check (monthly_revenue_target >= 0),
  attendance_approval_required boolean not null default true,
  part_time_payment_proof_required boolean not null default true,
  lead_assignment_mode text not null default 'manual' check (lead_assignment_mode in ('manual', 'round_robin')),
  booking_code_prefix text not null default 'KB' check (booking_code_prefix ~ '^[A-Z0-9]{1,8}$'),
  payroll_cutoff_day smallint not null default 25 check (payroll_cutoff_day between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  role public.profile_role not null,
  reports_to_profile_id uuid,
  account_status public.account_status not null default 'active',
  session_version integer not null default 1 check (session_version > 0),
  joining_date date,
  payment_type public.payment_type,
  payment_amount numeric(12,2) check (payment_amount is null or payment_amount >= 0),
  aadhaar_storage_path text,
  part_time_payment_proof_path text,
  part_time_payment_amount numeric(12,2)
    check (part_time_payment_amount is null or part_time_payment_amount >= 0),
  is_active boolean generated always as (account_status = 'active') stored,
  last_login_at timestamptz,
  created_by_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_id_organization_key unique (id, organization_id),
  constraint profiles_reports_to_organization_fk
    foreign key (reports_to_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint profiles_created_by_organization_fk
    foreign key (created_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint part_time_profile_fields_check check (
    role = 'part_time_chef'
    or (part_time_payment_proof_path is null and part_time_payment_amount is null)
  )
);

create table public.role_assignment_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  role public.profile_role not null,
  profile_id uuid not null,
  assigned_by_profile_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_history_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint role_history_actor_organization_fk
    foreign key (assigned_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint role_history_dates_check check (ended_at is null or ended_at >= started_at)
);

create table public.login_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid not null,
  session_code text not null,
  session_version integer not null check (session_version > 0),
  login_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  logout_at timestamptz,
  logout_reason text,
  user_agent_safe text,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint login_sessions_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint login_sessions_code_unique unique (organization_id, session_code),
  constraint login_sessions_dates_check
    check (logout_at is null or logout_at >= login_at)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_profile_id uuid,
  action text not null check (char_length(btrim(action)) > 0),
  entity_type text not null check (char_length(btrim(entity_type)) > 0),
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now(),
  constraint audit_actor_organization_fk
    foreign key (actor_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null default 'manual',
  provider_lead_id text,
  source text,
  campaign_name text,
  client_name text not null check (char_length(btrim(client_name)) > 0),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_normalized text not null check (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  requirement text,
  event_date date,
  guest_count integer check (guest_count is null or guest_count > 0),
  quote_amount numeric(12,2) check (quote_amount is null or quote_amount >= 0),
  status public.lead_status not null default 'new',
  assigned_sales_profile_id uuid,
  next_follow_up_at timestamptz,
  notes text,
  first_received_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  created_by_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint leads_id_organization_key unique (id, organization_id),
  constraint leads_assignee_organization_fk
    foreign key (assigned_sales_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint leads_creator_organization_fk
    foreign key (created_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.lead_assignment_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  lead_id uuid not null,
  assigned_to_profile_id uuid not null,
  assigned_by_profile_id uuid not null,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_assignments_lead_organization_fk
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete restrict,
  constraint lead_assignments_target_organization_fk
    foreign key (assigned_to_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint lead_assignments_actor_organization_fk
    foreign key (assigned_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint lead_assignments_dates_check
    check (unassigned_at is null or unassigned_at >= assigned_at)
);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  lead_id uuid not null,
  actor_profile_id uuid,
  activity_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_activities_lead_organization_fk
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete restrict,
  constraint lead_activities_actor_organization_fk
    foreign key (actor_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  lead_id uuid not null,
  assigned_profile_id uuid not null,
  due_at timestamptz not null,
  status public.follow_up_status not null default 'open',
  outcome text,
  completed_at timestamptz,
  created_by_profile_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint follow_ups_id_organization_key unique (id, organization_id),
  constraint follow_ups_lead_organization_fk
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete restrict,
  constraint follow_ups_assignee_organization_fk
    foreign key (assigned_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint follow_ups_creator_organization_fk
    foreign key (created_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint follow_ups_completion_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed')
  )
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  lead_id uuid not null,
  provider text not null,
  provider_conversation_id text,
  channel text not null,
  contact_name text,
  contact_phone_e164 text not null check (contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  assigned_sales_profile_id uuid,
  status public.conversation_status not null default 'open',
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  closed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_id_organization_key unique (id, organization_id),
  constraint conversations_lead_organization_fk
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete restrict,
  constraint conversations_assignee_organization_fk
    foreign key (assigned_sales_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.conversation_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  conversation_id uuid not null,
  assigned_to_profile_id uuid not null,
  assigned_by_profile_id uuid not null,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_assignments_conversation_organization_fk
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id) on delete restrict,
  constraint conversation_assignments_target_organization_fk
    foreign key (assigned_to_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint conversation_assignments_actor_organization_fk
    foreign key (assigned_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint conversation_assignments_dates_check
    check (unassigned_at is null or unassigned_at >= assigned_at)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  conversation_id uuid not null,
  lead_id uuid not null,
  provider text not null,
  provider_message_id text,
  provider_event_id text,
  direction public.message_direction not null,
  channel text not null,
  message_type text not null default 'text',
  body text,
  attachment_storage_path text,
  sender_profile_id uuid,
  recipient_phone_e164 text,
  status public.message_status not null,
  provider_created_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_message_safe text,
  reply_to_message_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_id_organization_key unique (id, organization_id),
  constraint messages_conversation_organization_fk
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id) on delete restrict,
  constraint messages_lead_organization_fk
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete restrict,
  constraint messages_sender_organization_fk
    foreign key (sender_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint messages_reply_organization_fk
    foreign key (reply_to_message_id, organization_id)
    references public.messages(id, organization_id) on delete restrict,
  constraint messages_content_check check (
    nullif(btrim(body), '') is not null or attachment_storage_path is not null
  ),
  constraint messages_recipient_phone_check check (
    recipient_phone_e164 is null or recipient_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint messages_direction_sender_check check (
    direction = 'inbound' or sender_profile_id is not null
  )
);

create table public.message_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  message_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  request_id text,
  provider_status_code integer,
  provider_response_safe jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_attempts_message_organization_fk
    foreign key (message_id, organization_id)
    references public.messages(id, organization_id) on delete restrict,
  constraint message_attempts_number_unique unique (message_id, attempt_number),
  constraint message_attempts_dates_check
    check (completed_at is null or completed_at >= started_at)
);

create table public.conversation_reads (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  conversation_id uuid not null,
  profile_id uuid not null,
  last_read_message_id uuid,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, profile_id),
  constraint conversation_reads_conversation_organization_fk
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id) on delete restrict,
  constraint conversation_reads_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint conversation_reads_message_organization_fk
    foreign key (last_read_message_id, organization_id)
    references public.messages(id, organization_id) on delete restrict
);

create table public.superfone_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  conversation_id uuid,
  lead_id uuid not null,
  provider_call_id text not null,
  direction public.message_direction not null check (direction <> 'internal'),
  from_phone_e164 text not null check (from_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  to_phone_e164 text not null check (to_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  agent_profile_id uuid,
  status text not null,
  started_at timestamptz not null,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  recording_external_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint superfone_calls_id_organization_key unique (id, organization_id),
  constraint superfone_calls_conversation_organization_fk
    foreign key (conversation_id, organization_id)
    references public.conversations(id, organization_id) on delete restrict,
  constraint superfone_calls_lead_organization_fk
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete restrict,
  constraint superfone_calls_agent_organization_fk
    foreign key (agent_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint superfone_calls_dates_check check (
    (answered_at is null or answered_at >= started_at)
    and (ended_at is null or ended_at >= started_at)
  )
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null,
  status public.integration_connection_status not null default 'disconnected',
  account_identifier_safe text,
  capabilities jsonb not null default '{}'::jsonb,
  connected_by_profile_id uuid,
  connected_at timestamptz,
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_error_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_id_organization_key unique (id, organization_id),
  constraint integration_connections_provider_unique unique (organization_id, provider),
  constraint integration_connections_actor_organization_fk
    foreign key (connected_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status public.integration_event_status not null default 'received',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_events_id_organization_key unique (id, organization_id)
);

create table public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider text not null,
  sync_type text not null,
  status public.integration_sync_status not null default 'queued',
  cursor_before text,
  cursor_after text,
  fetched_count integer not null default 0 check (fetched_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  started_by_profile_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  error_summary_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_sync_runs_id_organization_key unique (id, organization_id),
  constraint integration_sync_runs_actor_organization_fk
    foreign key (started_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint integration_sync_dates_check
    check (completed_at is null or started_at is null or completed_at >= started_at)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_code text not null,
  lead_id uuid,
  client_name text not null check (char_length(btrim(client_name)) > 0),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  event_type text not null,
  event_date date not null,
  event_start_time time,
  reporting_time time,
  venue text not null,
  guest_count integer not null check (guest_count > 0),
  menu text not null,
  instructions text,
  total_value numeric(12,2) not null check (total_value >= 0),
  payment_status public.booking_payment_status not null default 'unpaid',
  service_status public.booking_service_status not null default 'pending',
  sold_by_profile_id uuid not null,
  service_completed_at timestamptz,
  fully_completed_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint bookings_id_organization_key unique (id, organization_id),
  constraint bookings_code_organization_unique unique (organization_id, booking_code),
  constraint bookings_lead_organization_fk
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete restrict,
  constraint bookings_sales_owner_organization_fk
    foreign key (sold_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint bookings_completion_dates_check check (
    (service_completed_at is null or service_status in ('service_completed', 'fully_completed'))
    and (fully_completed_at is null or service_status = 'fully_completed')
  )
);

create table public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null,
  from_status public.booking_service_status,
  to_status public.booking_service_status not null,
  changed_by_profile_id uuid,
  reason text,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_status_history_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint booking_status_history_actor_organization_fk
    foreign key (changed_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.booking_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null,
  chef_profile_id uuid not null,
  assigned_by_profile_id uuid not null,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  is_primary boolean not null default true,
  agreed_pay_type public.payment_type,
  agreed_pay_amount numeric(12,2) check (agreed_pay_amount is null or agreed_pay_amount >= 0),
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_assignments_id_organization_key unique (id, organization_id),
  constraint booking_assignments_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint booking_assignments_chef_organization_fk
    foreign key (chef_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint booking_assignments_actor_organization_fk
    foreign key (assigned_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint booking_assignments_dates_check
    check (unassigned_at is null or unassigned_at >= assigned_at)
);

create table public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null,
  payment_stage public.booking_payment_stage not null,
  amount numeric(12,2) not null check (amount >= 0),
  payment_method text,
  transaction_reference text,
  proof_storage_path text,
  submitted_by_profile_id uuid not null,
  verification_status public.verification_status not null default 'pending',
  verified_by_profile_id uuid,
  verified_at timestamptz,
  rejection_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_payments_id_organization_key unique (id, organization_id),
  constraint booking_payments_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint booking_payments_submitter_organization_fk
    foreign key (submitted_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint booking_payments_verifier_organization_fk
    foreign key (verified_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint booking_payments_decision_check check (
    (verification_status = 'pending' and verified_by_profile_id is null and verified_at is null and rejection_reason is null)
    or (verification_status = 'verified' and verified_by_profile_id is not null and verified_at is not null and rejection_reason is null)
    or (verification_status = 'rejected' and verified_by_profile_id is not null and verified_at is not null and nullif(btrim(rejection_reason), '') is not null)
  )
);

create table public.temporary_workers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  worker_type public.temporary_worker_type not null,
  payment_type public.payment_type not null check (payment_type in ('daily', 'hourly', 'per_booking')),
  payment_amount numeric(12,2) not null check (payment_amount >= 0),
  notes text,
  is_active boolean not null default true,
  created_by_profile_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint temporary_workers_id_organization_key unique (id, organization_id),
  constraint temporary_workers_creator_organization_fk
    foreign key (created_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.temporary_worker_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  temporary_worker_id uuid not null,
  booking_id uuid not null,
  work_date date not null,
  reporting_time time,
  agreed_payment numeric(12,2) not null check (agreed_payment >= 0),
  notes text,
  created_by_profile_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint temporary_worker_assignments_id_organization_key unique (id, organization_id),
  constraint temporary_worker_assignments_worker_organization_fk
    foreign key (temporary_worker_id, organization_id)
    references public.temporary_workers(id, organization_id) on delete restrict,
  constraint temporary_worker_assignments_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint temporary_worker_assignments_creator_organization_fk
    foreign key (created_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid,
  temporary_worker_id uuid,
  booking_id uuid,
  shift_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  start_location jsonb,
  end_location jsonb,
  status public.attendance_status not null,
  submitted_at timestamptz,
  approved_by_profile_id uuid,
  approved_at timestamptz,
  corrected_by_profile_id uuid,
  correction_reason text,
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  payroll_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_shifts_id_organization_key unique (id, organization_id),
  constraint attendance_shifts_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint attendance_shifts_temp_worker_organization_fk
    foreign key (temporary_worker_id, organization_id)
    references public.temporary_workers(id, organization_id) on delete restrict,
  constraint attendance_shifts_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint attendance_shifts_approver_organization_fk
    foreign key (approved_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint attendance_shifts_corrector_organization_fk
    foreign key (corrected_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint attendance_one_subject_check
    check (num_nonnulls(profile_id, temporary_worker_id) = 1),
  constraint attendance_dates_check check (
    ended_at is null or started_at is null or ended_at >= started_at
  ),
  constraint attendance_correction_reason_check check (
    status <> 'corrected' or nullif(btrim(correction_reason), '') is not null
  )
);

create or replace function public.set_attendance_payroll_eligibility()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.payroll_eligible := new.status in ('approved', 'corrected');
  return new;
end;
$$;

create table public.break_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid not null,
  break_type public.break_type not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint break_sessions_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint break_sessions_dates_check check (ended_at is null or ended_at >= started_at)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  submitted_by_profile_id uuid not null,
  booking_id uuid,
  category text not null,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null check (nullif(btrim(reason), '') is not null),
  status public.expense_status not null default 'pending',
  reviewed_by_profile_id uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_id_organization_key unique (id, organization_id),
  constraint expenses_submitter_organization_fk
    foreign key (submitted_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint expenses_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint expenses_reviewer_organization_fk
    foreign key (reviewed_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint expenses_review_check check (
    (status = 'pending' and reviewed_by_profile_id is null and reviewed_at is null and rejection_reason is null)
    or (status <> 'pending' and reviewed_by_profile_id is not null and reviewed_at is not null)
  ),
  constraint expenses_rejection_check check (
    status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null
  )
);

create table public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  expense_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_attachments_expense_organization_fk
    foreign key (expense_id, organization_id)
    references public.expenses(id, organization_id) on delete restrict,
  constraint expense_attachments_path_unique unique (organization_id, storage_path)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid not null,
  start_date date not null,
  end_date date not null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  status public.leave_status not null default 'pending',
  reviewed_by_profile_id uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_id_organization_key unique (id, organization_id),
  constraint leave_requests_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint leave_requests_reviewer_organization_fk
    foreign key (reviewed_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint leave_requests_dates_check check (end_date >= start_date),
  constraint leave_requests_review_check check (
    (status = 'pending' and reviewed_by_profile_id is null and reviewed_at is null)
    or (status <> 'pending')
  )
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  title text not null check (nullif(btrim(title), '') is not null),
  description text,
  assigned_to_profile_id uuid not null,
  assigned_by_profile_id uuid not null,
  booking_id uuid,
  lead_id uuid,
  due_at timestamptz,
  priority public.task_priority not null default 'normal',
  status public.task_status not null default 'open',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_id_organization_key unique (id, organization_id),
  constraint tasks_assignee_organization_fk
    foreign key (assigned_to_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint tasks_actor_organization_fk
    foreign key (assigned_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint tasks_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint tasks_lead_organization_fk
    foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete restrict,
  constraint tasks_completion_check check (
    (status = 'completed' and completed_at is not null)
    or status <> 'completed'
  )
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  title text not null check (nullif(btrim(title), '') is not null),
  reason text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  meeting_url text,
  status public.meeting_status not null default 'scheduled',
  created_by_profile_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint meetings_id_organization_key unique (id, organization_id),
  constraint meetings_creator_organization_fk
    foreign key (created_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint meetings_dates_check check (ends_at > starts_at)
);

create table public.meeting_attendees (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  meeting_id uuid not null,
  profile_id uuid not null,
  attendance_status public.meeting_attendance_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (meeting_id, profile_id),
  constraint meeting_attendees_meeting_organization_fk
    foreign key (meeting_id, organization_id)
    references public.meetings(id, organization_id) on delete restrict,
  constraint meeting_attendees_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status public.payroll_period_status not null default 'draft',
  prepared_by_profile_id uuid not null,
  reviewed_by_profile_id uuid,
  approved_by_profile_id uuid,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_periods_id_organization_key unique (id, organization_id),
  constraint payroll_periods_preparer_organization_fk
    foreign key (prepared_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint payroll_periods_reviewer_organization_fk
    foreign key (reviewed_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint payroll_periods_approver_organization_fk
    foreign key (approved_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint payroll_periods_dates_check check (period_end >= period_start),
  constraint payroll_periods_range_unique unique (organization_id, period_start, period_end)
);

create table public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payroll_period_id uuid not null,
  profile_id uuid,
  temporary_worker_id uuid,
  base_amount numeric(12,2) not null default 0 check (base_amount >= 0),
  attendance_amount numeric(12,2) not null default 0 check (attendance_amount >= 0),
  booking_earnings numeric(12,2) not null default 0 check (booking_earnings >= 0),
  overtime_amount numeric(12,2) not null default 0 check (overtime_amount >= 0),
  expense_reimbursement numeric(12,2) not null default 0 check (expense_reimbursement >= 0),
  allowances numeric(12,2) not null default 0 check (allowances >= 0),
  deductions numeric(12,2) not null default 0 check (deductions >= 0),
  advances numeric(12,2) not null default 0 check (advances >= 0),
  net_payable numeric(12,2) not null default 0 check (net_payable >= 0),
  status public.payroll_entry_status not null default 'draft',
  payment_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_entries_id_organization_key unique (id, organization_id),
  constraint payroll_entries_period_organization_fk
    foreign key (payroll_period_id, organization_id)
    references public.payroll_periods(id, organization_id) on delete restrict,
  constraint payroll_entries_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint payroll_entries_temp_worker_organization_fk
    foreign key (temporary_worker_id, organization_id)
    references public.temporary_workers(id, organization_id) on delete restrict,
  constraint payroll_entries_one_subject_check
    check (num_nonnulls(profile_id, temporary_worker_id) = 1),
  constraint payroll_entries_paid_check check (
    (status = 'paid' and paid_at is not null and nullif(btrim(payment_reference), '') is not null)
    or status <> 'paid'
  )
);

create table public.payroll_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payroll_entry_id uuid not null,
  component_type text not null,
  source_type text,
  source_id uuid,
  amount numeric(12,2) not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_components_entry_organization_fk
    foreign key (payroll_entry_id, organization_id)
    references public.payroll_entries(id, organization_id) on delete restrict
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  recipient_profile_id uuid not null,
  notification_type public.notification_type not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_id_organization_key unique (id, organization_id),
  constraint notifications_recipient_organization_fk
    foreign key (recipient_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  title text not null,
  body text not null,
  audience_role public.profile_role,
  created_by_profile_id uuid not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint announcements_id_organization_key unique (id, organization_id),
  constraint announcements_creator_organization_fk
    foreign key (created_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint announcements_dates_check check (expires_at is null or expires_at > starts_at)
);

create table public.announcement_recipients (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  announcement_id uuid not null,
  profile_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (announcement_id, profile_id),
  constraint announcement_recipients_announcement_organization_fk
    foreign key (announcement_id, organization_id)
    references public.announcements(id, organization_id) on delete restrict,
  constraint announcement_recipients_profile_organization_fk
    foreign key (profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict
);

-- Required uniqueness and idempotency constraints.
create unique index one_active_manager_per_org
  on public.profiles (organization_id)
  where role = 'manager' and account_status = 'active' and deleted_at is null;
create unique index one_active_hr_per_org
  on public.profiles (organization_id)
  where role = 'hr' and account_status = 'active' and deleted_at is null;
create unique index one_active_sales_manager_per_org
  on public.profiles (organization_id)
  where role = 'sales_manager' and account_status = 'active' and deleted_at is null;
create unique index profile_phone_per_org
  on public.profiles (organization_id, phone_e164)
  where deleted_at is null;
create unique index provider_event_unique
  on public.integration_events (organization_id, provider, provider_event_id);
create unique index provider_lead_unique
  on public.leads (organization_id, provider, provider_lead_id)
  where provider_lead_id is not null and deleted_at is null;
create unique index lead_phone_unique
  on public.leads (organization_id, phone_normalized)
  where deleted_at is null;
create unique index provider_message_unique
  on public.messages (organization_id, provider, provider_message_id)
  where provider_message_id is not null;
create unique index outbound_message_idempotency_unique
  on public.messages (organization_id, idempotency_key)
  where idempotency_key is not null;
create unique index superfone_call_provider_unique
  on public.superfone_calls (organization_id, provider_call_id);
create unique index one_booking_per_lead
  on public.bookings (organization_id, lead_id)
  where lead_id is not null and deleted_at is null;
create unique index one_active_primary_chef_assignment
  on public.booking_assignments (organization_id, booking_id)
  where is_primary and unassigned_at is null;
create unique index one_open_profile_shift
  on public.attendance_shifts (organization_id, profile_id)
  where ended_at is null and profile_id is not null and status = 'working';
create unique index one_open_temporary_worker_shift
  on public.attendance_shifts (organization_id, temporary_worker_id)
  where ended_at is null and temporary_worker_id is not null and status = 'working';
create unique index one_open_break_per_profile
  on public.break_sessions (organization_id, profile_id)
  where ended_at is null;
create unique index payroll_entry_profile_per_period
  on public.payroll_entries (payroll_period_id, profile_id)
  where profile_id is not null;
create unique index payroll_entry_temp_worker_per_period
  on public.payroll_entries (payroll_period_id, temporary_worker_id)
  where temporary_worker_id is not null;

-- Operational pagination and dashboard indexes.
create index profiles_organization_role_status_idx
  on public.profiles (organization_id, role, account_status)
  where deleted_at is null;
create index login_sessions_profile_active_idx
  on public.login_sessions (organization_id, profile_id, last_seen_at desc)
  where logout_at is null;
create index audit_logs_organization_created_idx
  on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx
  on public.audit_logs (organization_id, entity_type, entity_id, created_at desc);
create index leads_queue_idx
  on public.leads (organization_id, assigned_sales_profile_id, status, last_activity_at desc)
  where deleted_at is null;
create index leads_status_received_idx
  on public.leads (organization_id, status, first_received_at desc)
  where deleted_at is null;
create index lead_activities_timeline_idx
  on public.lead_activities (organization_id, lead_id, occurred_at desc);
create index follow_ups_assignee_due_idx
  on public.follow_ups (organization_id, assigned_profile_id, status, due_at);
create index conversations_queue_idx
  on public.conversations (organization_id, assigned_sales_profile_id, status, last_message_at desc);
create index messages_timeline_idx
  on public.messages (organization_id, conversation_id, provider_created_at desc, created_at desc);
create index calls_lead_started_idx
  on public.superfone_calls (organization_id, lead_id, started_at desc);
create index integration_events_processing_idx
  on public.integration_events (organization_id, provider, status, received_at);
create index integration_sync_runs_status_idx
  on public.integration_sync_runs (organization_id, provider, status, created_at desc);
create index bookings_event_status_idx
  on public.bookings (organization_id, event_date, service_status)
  where deleted_at is null;
create index bookings_sales_owner_idx
  on public.bookings (organization_id, sold_by_profile_id, event_date desc)
  where deleted_at is null;
create index booking_assignments_chef_idx
  on public.booking_assignments (organization_id, chef_profile_id, assigned_at desc)
  where unassigned_at is null;
create index booking_payments_verification_idx
  on public.booking_payments (organization_id, verification_status, created_at);
create index booking_payments_booking_idx
  on public.booking_payments (organization_id, booking_id, paid_at);
create index temporary_worker_assignments_date_idx
  on public.temporary_worker_assignments (organization_id, work_date, booking_id);
create index attendance_date_status_profile_idx
  on public.attendance_shifts (organization_id, shift_date, status, profile_id);
create index attendance_booking_idx
  on public.attendance_shifts (organization_id, booking_id, shift_date);
create index expenses_review_idx
  on public.expenses (organization_id, status, created_at);
create index leave_requests_review_idx
  on public.leave_requests (organization_id, status, start_date);
create index tasks_assignee_due_idx
  on public.tasks (organization_id, assigned_to_profile_id, status, due_at);
create index meetings_schedule_idx
  on public.meetings (organization_id, starts_at, status)
  where deleted_at is null;
create index payroll_periods_status_idx
  on public.payroll_periods (organization_id, status, period_end desc);
create index payroll_entries_period_profile_status_idx
  on public.payroll_entries (organization_id, payroll_period_id, profile_id, status);
create index notifications_recipient_unread_idx
  on public.notifications (organization_id, recipient_profile_id, created_at desc)
  where read_at is null;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();
create trigger organization_settings_set_updated_at
before update on public.organization_settings
for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
create trigger role_assignment_history_set_updated_at
before update on public.role_assignment_history
for each row execute function public.set_updated_at();
create trigger login_sessions_set_updated_at
before update on public.login_sessions
for each row execute function public.set_updated_at();
create trigger leads_set_row_version
before update on public.leads
for each row execute function public.set_row_version();
create trigger lead_assignment_history_set_updated_at
before update on public.lead_assignment_history
for each row execute function public.set_updated_at();
create trigger lead_activities_set_updated_at
before update on public.lead_activities
for each row execute function public.set_updated_at();
create trigger follow_ups_set_updated_at
before update on public.follow_ups
for each row execute function public.set_updated_at();
create trigger conversations_set_row_version
before update on public.conversations
for each row execute function public.set_row_version();
create trigger conversation_assignments_set_updated_at
before update on public.conversation_assignments
for each row execute function public.set_updated_at();
create trigger messages_set_updated_at
before update on public.messages
for each row execute function public.set_updated_at();
create trigger message_attempts_set_updated_at
before update on public.message_attempts
for each row execute function public.set_updated_at();
create trigger conversation_reads_set_updated_at
before update on public.conversation_reads
for each row execute function public.set_updated_at();
create trigger superfone_calls_set_updated_at
before update on public.superfone_calls
for each row execute function public.set_updated_at();
create trigger integration_connections_set_updated_at
before update on public.integration_connections
for each row execute function public.set_updated_at();
create trigger integration_events_set_updated_at
before update on public.integration_events
for each row execute function public.set_updated_at();
create trigger integration_sync_runs_set_updated_at
before update on public.integration_sync_runs
for each row execute function public.set_updated_at();
create trigger bookings_set_row_version
before update on public.bookings
for each row execute function public.set_row_version();
create trigger booking_status_history_set_updated_at
before update on public.booking_status_history
for each row execute function public.set_updated_at();
create trigger booking_assignments_set_updated_at
before update on public.booking_assignments
for each row execute function public.set_updated_at();
create trigger booking_payments_set_updated_at
before update on public.booking_payments
for each row execute function public.set_updated_at();
create trigger temporary_workers_set_updated_at
before update on public.temporary_workers
for each row execute function public.set_updated_at();
create trigger temporary_worker_assignments_set_updated_at
before update on public.temporary_worker_assignments
for each row execute function public.set_updated_at();
create trigger attendance_shifts_set_eligibility
before insert or update on public.attendance_shifts
for each row execute function public.set_attendance_payroll_eligibility();
create trigger attendance_shifts_set_updated_at
before update on public.attendance_shifts
for each row execute function public.set_updated_at();
create trigger break_sessions_set_updated_at
before update on public.break_sessions
for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();
create trigger expense_attachments_set_updated_at
before update on public.expense_attachments
for each row execute function public.set_updated_at();
create trigger leave_requests_set_updated_at
before update on public.leave_requests
for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();
create trigger meetings_set_updated_at
before update on public.meetings
for each row execute function public.set_updated_at();
create trigger meeting_attendees_set_updated_at
before update on public.meeting_attendees
for each row execute function public.set_updated_at();
create trigger payroll_periods_set_updated_at
before update on public.payroll_periods
for each row execute function public.set_updated_at();
create trigger payroll_entries_set_updated_at
before update on public.payroll_entries
for each row execute function public.set_updated_at();
create trigger payroll_components_set_updated_at
before update on public.payroll_components
for each row execute function public.set_updated_at();
create trigger notifications_set_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();
create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function public.set_updated_at();
create trigger announcement_recipients_set_updated_at
before update on public.announcement_recipients
for each row execute function public.set_updated_at();

comment on column public.profiles.aadhaar_storage_path is
  'Private Storage object path only; never a public URL or base64 payload.';
comment on column public.integration_connections.capabilities is
  'Provider-reported safe capability flags only. Raw credentials belong in Edge Function secrets.';
comment on column public.superfone_calls.recording_external_url is
  'Provider URL only. Recording copying requires a separate consent and contract review.';
comment on column public.messages.status is
  'Delivered/read states may only be written after provider confirmation.';
