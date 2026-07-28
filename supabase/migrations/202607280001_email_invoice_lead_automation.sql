-- Khana Banao CRM: milestone lead automation, immutable invoices and
-- transactional customer-email outbox.

create type public.invoice_status as enum (
  'pending_generation',
  'issued',
  'generation_failed',
  'void'
);

create type public.email_outbox_status as enum (
  'queued',
  'processing',
  'sent',
  'delivered',
  'failed',
  'skipped'
);

alter table public.organization_settings
  add column invoice_prefix text not null default 'KB'
    check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  add column invoice_payment_instructions text,
  add column invoice_terms text not null
    default 'This is a commercial invoice and not a GST tax invoice.',
  add column customer_email_sender_name text not null default 'Khana Banao'
    check (char_length(customer_email_sender_name) between 2 and 100),
  add column customer_email_sender_email text
    check (
      customer_email_sender_email is null
      or (
        char_length(customer_email_sender_email) <= 254
        and customer_email_sender_email ~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
      )
    ),
  add column email_automation_enabled boolean not null default false,
  add column email_daily_send_cap smallint not null default 280
    check (email_daily_send_cap between 1 and 10000);

alter table public.leads
  add column customer_email text
    check (
      customer_email is null
      or (
        char_length(customer_email) <= 254
        and customer_email ~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
      )
    );

alter table public.bookings
  add column customer_email text
    check (
      customer_email is null
      or (
        char_length(customer_email) <= 254
        and customer_email ~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
      )
    );

create table public.invoice_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  calendar_year integer not null check (calendar_year between 2000 and 9999),
  last_value bigint not null default 0 check (last_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_sequences_id_organization_key unique (id, organization_id),
  constraint invoice_sequences_org_year_unique unique (organization_id, calendar_year)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null,
  invoice_number text not null,
  status public.invoice_status not null default 'pending_generation',
  client_name text not null,
  customer_email text,
  customer_phone_e164 text not null,
  event_type text not null,
  event_date date not null,
  venue text not null,
  guest_count integer not null check (guest_count > 0),
  service_description text not null,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  total numeric(12,2) not null check (total >= 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  payment_instructions text,
  terms text not null,
  pdf_storage_path text,
  issued_at timestamptz,
  voided_at timestamptz,
  voided_by_profile_id uuid,
  void_reason text,
  replaces_invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_id_organization_key unique (id, organization_id),
  constraint invoices_number_organization_unique unique (organization_id, invoice_number),
  constraint invoices_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint invoices_void_actor_organization_fk
    foreign key (voided_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict,
  constraint invoices_replaces_organization_fk
    foreign key (replaces_invoice_id, organization_id)
    references public.invoices(id, organization_id) on delete restrict,
  constraint invoices_email_check check (
    customer_email is null or char_length(customer_email) <= 254
  ),
  constraint invoices_status_fields_check check (
    (
      status = 'pending_generation'
      and pdf_storage_path is null
      and issued_at is null
      and voided_at is null
    )
    or (
      status = 'generation_failed'
      and pdf_storage_path is null
      and issued_at is null
      and voided_at is null
    )
    or (
      status = 'issued'
      and pdf_storage_path is not null
      and issued_at is not null
      and voided_at is null
    )
    or (
      status = 'void'
      and voided_at is not null
      and void_reason is not null
    )
  )
);

create unique index invoices_one_active_per_booking
on public.invoices (organization_id, booking_id)
where status <> 'void';

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null,
  invoice_id uuid,
  event_type text not null check (
    event_type in (
      'booking_payment_requested',
      'invoice_reissued',
      'booking_confirmed',
      'payment_verified',
      'payment_rejected',
      'balance_due',
      'booking_completed'
    )
  ),
  recipient_email text,
  recipient_name text not null,
  subject text not null,
  status public.email_outbox_status not null default 'queued',
  idempotency_key text not null,
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_outbox_id_organization_key unique (id, organization_id),
  constraint email_outbox_idempotency_unique unique (organization_id, idempotency_key),
  constraint email_outbox_booking_organization_fk
    foreign key (booking_id, organization_id)
    references public.bookings(id, organization_id) on delete restrict,
  constraint email_outbox_invoice_organization_fk
    foreign key (invoice_id, organization_id)
    references public.invoices(id, organization_id) on delete restrict,
  constraint email_outbox_recipient_check check (
    recipient_email is null or char_length(recipient_email) <= 254
  )
);

create table public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email_outbox_id uuid not null,
  provider_event_id text not null,
  event_type text not null check (
    event_type in (
      'sent',
      'delivered',
      'deferred',
      'soft_bounce',
      'hard_bounce',
      'blocked',
      'spam',
      'invalid',
      'error'
    )
  ),
  occurred_at timestamptz not null,
  error_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_delivery_events_id_organization_key unique (id, organization_id),
  constraint email_delivery_events_provider_unique
    unique (organization_id, provider_event_id),
  constraint email_delivery_events_outbox_organization_fk
    foreign key (email_outbox_id, organization_id)
    references public.email_outbox(id, organization_id) on delete restrict
);

create index invoices_booking_created_idx
  on public.invoices (organization_id, booking_id, created_at desc);
create index email_outbox_processing_idx
  on public.email_outbox (status, next_attempt_at, created_at)
  where status in ('queued', 'failed');
create index email_outbox_booking_idx
  on public.email_outbox (organization_id, booking_id, created_at desc);
create index email_delivery_events_outbox_idx
  on public.email_delivery_events (organization_id, email_outbox_id, occurred_at desc);

create trigger invoice_sequences_set_updated_at
before update on public.invoice_sequences
for each row execute function public.set_updated_at();

create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

create trigger email_outbox_set_updated_at
before update on public.email_outbox
for each row execute function public.set_updated_at();

create trigger email_delivery_events_set_updated_at
before update on public.email_delivery_events
for each row execute function public.set_updated_at();

create or replace function public.can_read_invoice(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile()
    and exists (
      select 1
      from public.invoices i
      join public.bookings b
        on b.id = i.booking_id
       and b.organization_id = i.organization_id
      where i.id = p_invoice_id
        and i.organization_id = public.current_organization_id()
        and (
          public.is_sales_scope_admin()
          or (
            public.current_role() = 'sales'
            and b.sold_by_profile_id = public.current_profile_id()
          )
        )
    );
$$;

alter table public.invoice_sequences enable row level security;
alter table public.invoices enable row level security;
alter table public.email_outbox enable row level security;
alter table public.email_delivery_events enable row level security;

create policy invoices_select_sales_scoped
on public.invoices for select to authenticated
using (public.can_read_invoice(id));

create policy email_outbox_select_sales_scoped
on public.email_outbox for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_sales_scope_admin()
    or (
      public.current_role() = 'sales'
      and exists (
        select 1
        from public.bookings b
        where b.id = booking_id
          and b.organization_id = organization_id
          and b.sold_by_profile_id = public.current_profile_id()
      )
    )
  )
);

create policy email_delivery_events_select_sales_scoped
on public.email_delivery_events for select to authenticated
using (
  exists (
    select 1
    from public.email_outbox eo
    where eo.id = email_outbox_id
      and eo.organization_id = organization_id
      and (
        public.is_sales_scope_admin()
        or (
          public.current_role() = 'sales'
          and exists (
            select 1
            from public.bookings b
            where b.id = eo.booking_id
              and b.organization_id = eo.organization_id
              and b.sold_by_profile_id = public.current_profile_id()
          )
        )
      )
  )
);

grant select on public.invoices, public.email_outbox, public.email_delivery_events
  to authenticated;
revoke all on public.invoice_sequences from authenticated;
revoke insert, update, delete, truncate
  on public.invoices, public.email_outbox, public.email_delivery_events
  from authenticated;
revoke update (status) on public.leads from authenticated;
grant update (customer_email) on public.leads to authenticated;
grant update (customer_email) on public.bookings to authenticated;
grant update (
  invoice_prefix,
  invoice_payment_instructions,
  invoice_terms,
  customer_email_sender_name,
  customer_email_sender_email,
  email_automation_enabled,
  email_daily_send_cap
) on public.organization_settings to authenticated;

revoke all on function public.can_read_invoice(uuid) from public, anon;
grant execute on function public.can_read_invoice(uuid) to authenticated, service_role;

create or replace function public.enqueue_customer_email(
  p_organization_id uuid,
  p_booking_id uuid,
  p_invoice_id uuid,
  p_event_type text,
  p_subject text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_enabled boolean;
  v_outbox_id uuid;
  v_status public.email_outbox_status;
begin
  select b.*
  into strict v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = p_organization_id
    and b.deleted_at is null;

  select os.email_automation_enabled
  into strict v_enabled
  from public.organization_settings os
  where os.organization_id = p_organization_id;

  v_status := case
    when not v_enabled or v_booking.customer_email is null then 'skipped'
    else 'queued'
  end;

  insert into public.email_outbox (
    organization_id,
    booking_id,
    invoice_id,
    event_type,
    recipient_email,
    recipient_name,
    subject,
    status,
    idempotency_key,
    next_attempt_at,
    last_error_safe
  )
  values (
    p_organization_id,
    p_booking_id,
    p_invoice_id,
    p_event_type,
    lower(v_booking.customer_email),
    v_booking.client_name,
    p_subject,
    v_status,
    p_idempotency_key,
    case when v_status = 'queued' then now() else null end,
    case
      when not v_enabled then 'Email automation is disabled.'
      when v_booking.customer_email is null then 'Customer email is missing.'
      else null
    end
  )
  on conflict (organization_id, idempotency_key) do update
  set idempotency_key = excluded.idempotency_key
  returning id into v_outbox_id;

  return v_outbox_id;
end;
$$;

create or replace function public.create_booking_invoice_internal(
  p_booking_id uuid,
  p_actor_profile_id uuid,
  p_replaces_invoice_id uuid default null,
  p_email_event text default 'booking_payment_requested'
)
returns public.invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_settings public.organization_settings%rowtype;
  v_organization public.organizations%rowtype;
  v_year integer;
  v_sequence bigint;
  v_invoice public.invoices%rowtype;
  v_subject text;
begin
  select b.*
  into strict v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.deleted_at is null
  for update;

  if exists (
    select 1
    from public.invoices i
    where i.organization_id = v_booking.organization_id
      and i.booking_id = v_booking.id
      and i.status <> 'void'
  ) then
    raise exception using errcode = '23505', message = 'ACTIVE_INVOICE_EXISTS';
  end if;

  select os.*
  into strict v_settings
  from public.organization_settings os
  where os.organization_id = v_booking.organization_id;

  select o.*
  into strict v_organization
  from public.organizations o
  where o.id = v_booking.organization_id;

  v_year := extract(year from current_date)::integer;

  insert into public.invoice_sequences (
    organization_id,
    calendar_year,
    last_value
  )
  values (v_booking.organization_id, v_year, 1)
  on conflict (organization_id, calendar_year) do update
  set last_value = public.invoice_sequences.last_value + 1
  returning last_value into v_sequence;

  insert into public.invoices (
    organization_id,
    booking_id,
    invoice_number,
    client_name,
    customer_email,
    customer_phone_e164,
    event_type,
    event_date,
    venue,
    guest_count,
    service_description,
    subtotal,
    total,
    currency,
    payment_instructions,
    terms,
    replaces_invoice_id
  )
  values (
    v_booking.organization_id,
    v_booking.id,
    v_settings.invoice_prefix || '-INV-' || v_year::text || '-'
      || lpad(v_sequence::text, 6, '0'),
    v_booking.client_name,
    v_booking.customer_email,
    v_booking.phone_e164,
    v_booking.event_type,
    v_booking.event_date,
    v_booking.venue,
    v_booking.guest_count,
    'Catering service for ' || v_booking.event_type
      || ' on ' || to_char(v_booking.event_date, 'DD Mon YYYY'),
    v_booking.total_value,
    v_booking.total_value,
    v_organization.currency,
    v_settings.invoice_payment_instructions,
    v_settings.invoice_terms,
    p_replaces_invoice_id
  )
  returning * into v_invoice;

  v_subject := case
    when p_email_event = 'invoice_reissued'
      then 'Updated invoice ' || v_invoice.invoice_number
    else 'Payment requested for booking ' || v_booking.booking_code
  end;

  perform public.enqueue_customer_email(
    v_booking.organization_id,
    v_booking.id,
    v_invoice.id,
    p_email_event,
    v_subject,
    p_email_event || ':' || v_invoice.id::text
  );

  perform public.write_audit_log(
    v_booking.organization_id,
    p_actor_profile_id,
    'invoice.issued',
    'invoice',
    v_invoice.id,
    null,
    jsonb_build_object(
      'booking_id', v_invoice.booking_id,
      'invoice_number', v_invoice.invoice_number,
      'status', v_invoice.status,
      'total', v_invoice.total
    ),
    case
      when p_replaces_invoice_id is null then 'Booking invoice created'
      else 'Replacement booking invoice created'
    end,
    null
  );

  return v_invoice;
end;
$$;

create or replace function public.fill_booking_customer_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.customer_email is null and new.lead_id is not null then
    select lower(l.customer_email)
    into new.customer_email
    from public.leads l
    where l.id = new.lead_id
      and l.organization_id = new.organization_id;
  end if;

  return new;
end;
$$;

create trigger bookings_fill_customer_email
before insert on public.bookings
for each row execute function public.fill_booking_customer_email();

create or replace function public.issue_invoice_after_booking_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.create_booking_invoice_internal(
    new.id,
    coalesce(auth.uid(), new.sold_by_profile_id),
    null,
    'booking_payment_requested'
  );
  return new;
end;
$$;

create trigger bookings_issue_invoice_after_insert
after insert on public.bookings
for each row execute function public.issue_invoice_after_booking_created();

create or replace function public.enforce_derived_lead_stage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status in ('booking_payment_pending', 'booking_in_process', 'won') then
    select b.*
    into v_booking
    from public.bookings b
    where b.organization_id = new.organization_id
      and b.lead_id = new.id
      and b.deleted_at is null
    order by b.created_at desc
    limit 1;

    if not found then
      raise exception using errcode = '22023', message = 'BOOKING_STAGE_REQUIRES_BOOKING';
    end if;

    if new.status = 'booking_in_process'
       and not (
         v_booking.payment_status in ('partial', 'fully_paid')
         and v_booking.service_status in (
           'confirmed',
           'chef_assigned',
           'preparing',
           'service_completed',
           'fully_completed'
         )
       ) then
      new.status := 'booking_payment_pending';
    elsif new.status = 'won'
       and not (
         v_booking.payment_status = 'fully_paid'
         and v_booking.service_status = 'fully_completed'
       ) then
      raise exception using errcode = '22023', message = 'LEAD_NOT_READY_TO_WIN';
    end if;
  end if;

  return new;
end;
$$;

create trigger leads_enforce_derived_stage
before update of status on public.leads
for each row execute function public.enforce_derived_lead_stage();

create or replace function public.capture_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_id uuid;
  v_reason text := nullif(current_setting('app.lead_transition_reason', true), '');
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  select p.id
  into v_actor_id
  from public.profiles p
  where p.id = auth.uid()
    and p.organization_id = new.organization_id
    and p.deleted_at is null;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata
  )
  values (
    new.organization_id,
    new.id,
    v_actor_id,
    'status_change',
    'Lead status changed from ' || replace(old.status::text, '_', ' ')
      || ' to ' || replace(new.status::text, '_', ' '),
    jsonb_build_object(
      'from_status', old.status,
      'to_status', new.status,
      'version', new.version,
      'reason', v_reason
    )
  );

  perform public.write_audit_log(
    new.organization_id,
    v_actor_id,
    'lead.status_changed',
    'lead',
    new.id,
    jsonb_build_object('status', old.status, 'version', old.version),
    jsonb_build_object('status', new.status, 'version', new.version),
    v_reason,
    null
  );

  return new;
end;
$$;

create or replace function public.transition_lead_stage(
  p_lead_id uuid,
  p_to_status public.lead_status,
  p_expected_version integer,
  p_reason text default null
)
returns table (
  lead_id uuid,
  status public.lead_status,
  version integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_after public.leads%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.*
  into strict v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if v_actor.role not in ('director', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select l.*
  into v_lead
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = v_actor.organization_id
    and l.deleted_at is null
  for update;

  if not found
     or (
       v_actor.role = 'sales'
       and v_lead.assigned_sales_profile_id is distinct from v_actor.id
     ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_lead.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if v_lead.status = p_to_status then
    return query select v_lead.id, v_lead.status, v_lead.version;
    return;
  end if;

  if p_to_status = 'qualified' then
    if v_lead.status not in ('contacted', 'follow_up')
       or v_lead.event_date is null
       or v_lead.guest_count is null
       or v_lead.quote_amount is null
       or nullif(btrim(v_lead.requirement), '') is null then
      raise exception using errcode = '22023', message = 'LEAD_QUALIFICATION_INCOMPLETE';
    end if;
  elsif p_to_status in ('lost', 'unreachable') then
    if v_lead.status in ('booking_payment_pending', 'booking_in_process', 'won')
       or v_reason is null
       or exists (
         select 1
         from public.bookings b
         where b.organization_id = v_lead.organization_id
           and b.lead_id = v_lead.id
           and b.deleted_at is null
           and b.service_status <> 'cancelled'
       ) then
      raise exception using errcode = '22023', message = 'INVALID_TERMINAL_LEAD_TRANSITION';
    end if;
  elsif v_lead.status in ('lost', 'unreachable') then
    if v_actor.role not in ('director', 'manager', 'sales_manager')
       or p_to_status not in ('contacted', 'follow_up')
       or v_reason is null then
      raise exception using errcode = '42501', message = 'LEAD_REOPEN_REQUIRES_MANAGER';
    end if;
  else
    raise exception using errcode = '22023', message = 'AUTOMATED_LEAD_STAGE';
  end if;

  perform set_config('app.lead_transition_reason', coalesce(v_reason, ''), true);

  update public.leads l
  set
    status = p_to_status,
    last_activity_at = now()
  where l.id = v_lead.id
    and l.organization_id = v_lead.organization_id
  returning l.* into v_after;

  return query select v_after.id, v_after.status, v_after.version;
end;
$$;

create or replace function public.apply_contacted_lead_automation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_should_contact boolean := false;
  v_occurred_at timestamptz := now();
begin
  if tg_table_name = 'messages' then
    v_should_contact := (
      new.direction = 'inbound'
      and new.status = 'received'
    ) or (
      new.direction = 'outbound'
      and new.status in ('sent', 'delivered', 'read')
    );
    v_occurred_at := coalesce(new.provider_created_at, new.sent_at, now());

    if tg_op = 'UPDATE'
       and old.status = new.status then
      return new;
    end if;
  elsif tg_table_name = 'superfone_calls' then
    v_should_contact := (
      lower(new.status) in ('completed', 'answered')
      and new.answered_at is not null
    );
    v_occurred_at := new.started_at;
  end if;

  if v_should_contact then
    update public.leads l
    set
      status = case when l.status = 'new' then 'contacted' else l.status end,
      last_activity_at = greatest(l.last_activity_at, v_occurred_at)
    where l.id = new.lead_id
      and l.organization_id = new.organization_id
      and l.deleted_at is null;
  end if;

  return new;
end;
$$;

create trigger messages_apply_contacted_stage
after insert or update of status on public.messages
for each row execute function public.apply_contacted_lead_automation();

create trigger calls_apply_contacted_stage
after insert on public.superfone_calls
for each row execute function public.apply_contacted_lead_automation();

create or replace function public.finalize_fully_paid_service()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.service_status = 'service_completed'
     and new.payment_status = 'fully_paid' then
    new.service_status := 'fully_completed';
    new.fully_completed_at := coalesce(new.fully_completed_at, now());
  end if;
  return new;
end;
$$;

create trigger bookings_finalize_fully_paid_service
before update of service_status, payment_status on public.bookings
for each row execute function public.finalize_fully_paid_service();

create or replace function public.apply_booking_workflow_automation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verified_total numeric(12,2);
begin
  if new.lead_id is not null then
    if new.service_status in (
      'confirmed',
      'chef_assigned',
      'preparing',
      'service_completed',
      'fully_completed'
    ) and new.payment_status in ('partial', 'fully_paid') then
      update public.leads
      set status = case
        when new.service_status = 'fully_completed'
          and new.payment_status = 'fully_paid' then 'won'
        else 'booking_in_process'
      end,
      last_activity_at = now()
      where id = new.lead_id
        and organization_id = new.organization_id
        and deleted_at is null
        and status not in ('won');
    end if;
  end if;

  if old.service_status is distinct from new.service_status then
    if new.service_status = 'confirmed' then
      perform public.enqueue_customer_email(
        new.organization_id,
        new.id,
        (
          select i.id
          from public.invoices i
          where i.organization_id = new.organization_id
            and i.booking_id = new.id
            and i.status <> 'void'
          order by i.created_at desc
          limit 1
        ),
        'booking_confirmed',
        'Booking ' || new.booking_code || ' confirmed',
        'booking-confirmed:' || new.id::text
      );
    elsif new.service_status = 'service_completed' then
      select coalesce(sum(
        case when bp.payment_stage = 'refund' then -bp.amount else bp.amount end
      ), 0)
      into v_verified_total
      from public.booking_payments bp
      where bp.organization_id = new.organization_id
        and bp.booking_id = new.id
        and bp.verification_status = 'verified';

      if v_verified_total < new.total_value then
        perform public.enqueue_customer_email(
          new.organization_id,
          new.id,
          null,
          'balance_due',
          'Balance payment due for booking ' || new.booking_code,
          'balance-due:' || new.id::text
        );
      end if;
    elsif new.service_status = 'fully_completed' then
      perform public.enqueue_customer_email(
        new.organization_id,
        new.id,
        (
          select i.id
          from public.invoices i
          where i.organization_id = new.organization_id
            and i.booking_id = new.id
            and i.status <> 'void'
          order by i.created_at desc
          limit 1
        ),
        'booking_completed',
        'Booking ' || new.booking_code || ' completed',
        'booking-completed:' || new.id::text
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger bookings_apply_workflow_automation
after update of service_status, payment_status on public.bookings
for each row execute function public.apply_booking_workflow_automation();

create or replace function public.apply_payment_email_automation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_verified_count integer;
  v_verified_total numeric(12,2);
begin
  if old.verification_status = new.verification_status
     or new.verification_status not in ('verified', 'rejected') then
    return new;
  end if;

  select b.*
  into strict v_booking
  from public.bookings b
  where b.id = new.booking_id
    and b.organization_id = new.organization_id;

  if new.verification_status = 'rejected' then
    perform public.enqueue_customer_email(
      new.organization_id,
      new.booking_id,
      null,
      'payment_rejected',
      'Payment proof needs attention for ' || v_booking.booking_code,
      'payment-rejected:' || new.id::text
    );
    return new;
  end if;

  select
    count(*) filter (where bp.payment_stage <> 'refund'),
    coalesce(sum(
      case when bp.payment_stage = 'refund' then -bp.amount else bp.amount end
    ), 0)
  into v_verified_count, v_verified_total
  from public.booking_payments bp
  where bp.organization_id = new.organization_id
    and bp.booking_id = new.booking_id
    and bp.verification_status = 'verified';

  if v_verified_count > 1
     and not (
       v_booking.service_status = 'service_completed'
       and v_verified_total >= v_booking.total_value
     ) then
    perform public.enqueue_customer_email(
      new.organization_id,
      new.booking_id,
      null,
      'payment_verified',
      'Payment received for booking ' || v_booking.booking_code,
      'payment-verified:' || new.id::text
    );
  end if;

  return new;
end;
$$;

create trigger booking_payments_apply_email_automation
after update of verification_status on public.booking_payments
for each row execute function public.apply_payment_email_automation();

create or replace function public.issue_booking_invoice(p_booking_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_booking public.bookings%rowtype;
  v_invoice public.invoices%rowtype;
begin
  select p.*
  into strict v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  select b.*
  into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null;

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales')
     or (
       v_actor.role = 'sales'
       and v_booking.sold_by_profile_id is distinct from v_actor.id
     ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select i.*
  into v_invoice
  from public.invoices i
  where i.organization_id = v_booking.organization_id
    and i.booking_id = v_booking.id
    and i.status <> 'void'
  order by i.created_at desc
  limit 1;

  if found then
    return v_invoice;
  end if;

  return public.create_booking_invoice_internal(v_booking.id, v_actor.id);
end;
$$;

create or replace function public.void_and_reissue_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns public.invoices
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_invoice public.invoices%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select p.*
  into strict v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if v_actor.role not in ('director', 'manager', 'sales_manager')
     or v_reason is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select i.*
  into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
    and i.organization_id = v_actor.organization_id
    and i.status <> 'void'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'INVOICE_NOT_FOUND';
  end if;

  update public.invoices
  set
    status = 'void',
    voided_at = now(),
    voided_by_profile_id = v_actor.id,
    void_reason = v_reason
  where id = v_invoice.id
    and organization_id = v_invoice.organization_id;

  perform public.write_audit_log(
    v_invoice.organization_id,
    v_actor.id,
    'invoice.voided',
    'invoice',
    v_invoice.id,
    jsonb_build_object('status', v_invoice.status),
    jsonb_build_object('status', 'void'),
    v_reason,
    null
  );

  return public.create_booking_invoice_internal(
    v_invoice.booking_id,
    v_actor.id,
    v_invoice.id,
    'invoice_reissued'
  );
end;
$$;

create or replace function public.update_booking_customer_email(
  p_booking_id uuid,
  p_customer_email text
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_booking public.bookings%rowtype;
  v_email text := nullif(lower(btrim(p_customer_email)), '');
begin
  select p.*
  into strict v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  select b.*
  into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null
  for update;

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales')
     or (
       v_actor.role = 'sales'
       and v_booking.sold_by_profile_id is distinct from v_actor.id
     ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_email is not null and (
    char_length(v_email) > 254
    or v_email !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_CUSTOMER_EMAIL';
  end if;

  update public.bookings
  set customer_email = v_email
  where id = v_booking.id
    and organization_id = v_booking.organization_id;

  update public.leads
  set customer_email = v_email
  where id = v_booking.lead_id
    and organization_id = v_booking.organization_id;

  return v_email;
end;
$$;

create or replace function public.resend_booking_invoice(
  p_invoice_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_invoice public.invoices%rowtype;
  v_booking public.bookings%rowtype;
begin
  select p.*
  into strict v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  select i.*
  into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
    and i.organization_id = v_actor.organization_id
    and i.status = 'issued';

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select b.*
  into v_booking
  from public.bookings b
  where b.id = v_invoice.booking_id
    and b.organization_id = v_invoice.organization_id
    and b.deleted_at is null;

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales')
     or (
       v_actor.role = 'sales'
       and v_booking.sold_by_profile_id is distinct from v_actor.id
     )
     or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 8 and 120 then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  return public.enqueue_customer_email(
    v_invoice.organization_id,
    v_invoice.booking_id,
    v_invoice.id,
    'invoice_reissued',
    'Invoice ' || v_invoice.invoice_number,
    'manual-resend:' || p_idempotency_key
  );
end;
$$;

create or replace function public.retry_customer_email(p_outbox_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_outbox public.email_outbox%rowtype;
  v_booking public.bookings%rowtype;
  v_enabled boolean;
begin
  select p.*
  into strict v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  select eo.*
  into v_outbox
  from public.email_outbox eo
  where eo.id = p_outbox_id
    and eo.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select b.*
  into v_booking
  from public.bookings b
  where b.id = v_outbox.booking_id
    and b.organization_id = v_outbox.organization_id
    and b.deleted_at is null;

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales')
     or (
       v_actor.role = 'sales'
       and v_booking.sold_by_profile_id is distinct from v_actor.id
     )
     or v_outbox.status not in ('failed', 'skipped') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select os.email_automation_enabled
  into strict v_enabled
  from public.organization_settings os
  where os.organization_id = v_outbox.organization_id;

  if not v_enabled or v_booking.customer_email is null then
    raise exception using errcode = '22023', message = 'EMAIL_NOT_READY';
  end if;

  update public.email_outbox
  set
    recipient_email = lower(v_booking.customer_email),
    status = 'queued',
    attempt_count = 0,
    next_attempt_at = now(),
    last_error_safe = null,
    failed_at = null
  where id = v_outbox.id
    and organization_id = v_outbox.organization_id;

  return v_outbox.id;
end;
$$;

create or replace function public.claim_email_outbox(
  p_limit integer default 25,
  p_organization_id uuid default null
)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('postgres', 'service_role')
     or p_limit < 1
     or p_limit > 100 then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  return query
  with candidates as (
    select eo.id
    from public.email_outbox eo
    join public.organization_settings os
      on os.organization_id = eo.organization_id
    where eo.status in ('queued', 'failed')
      and eo.attempt_count < 5
      and eo.recipient_email is not null
      and os.email_automation_enabled
      and (eo.next_attempt_at is null or eo.next_attempt_at <= now())
      and (p_organization_id is null or eo.organization_id = p_organization_id)
      and (
        select count(*)
        from public.email_outbox sent
        where sent.organization_id = eo.organization_id
          and sent.sent_at >= date_trunc('day', now() at time zone 'Asia/Kolkata')
            at time zone 'Asia/Kolkata'
      ) < os.email_daily_send_cap
    order by eo.created_at
    for update of eo skip locked
    limit p_limit
  )
  update public.email_outbox eo
  set
    status = 'processing',
    attempt_count = eo.attempt_count + 1,
    last_attempt_at = now(),
    next_attempt_at = null,
    last_error_safe = null
  from candidates c
  where eo.id = c.id
  returning eo.*;
end;
$$;

create or replace function public.handle_booking_invoice_snapshot_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_role public.profile_role;
  v_invoice public.invoices%rowtype;
begin
  if row(
    old.client_name,
    old.phone_e164,
    old.event_type,
    old.event_date,
    old.venue,
    old.guest_count,
    old.total_value
  ) is not distinct from row(
    new.client_name,
    new.phone_e164,
    new.event_type,
    new.event_date,
    new.venue,
    new.guest_count,
    new.total_value
  ) then
    return new;
  end if;

  select p.role
  into v_actor_role
  from public.profiles p
  where p.id = auth.uid()
    and p.organization_id = new.organization_id;

  select i.*
  into v_invoice
  from public.invoices i
  where i.organization_id = new.organization_id
    and i.booking_id = new.id
    and i.status <> 'void'
  order by i.created_at desc
  limit 1
  for update;

  if not found then
    return new;
  end if;

  if v_actor_role = 'sales' then
    raise exception using errcode = '42501', message = 'INVOICE_REISSUE_REQUIRES_MANAGER';
  end if;

  update public.invoices
  set
    status = 'void',
    voided_at = now(),
    voided_by_profile_id = auth.uid(),
    void_reason = 'Booking invoice details changed'
  where id = v_invoice.id
    and organization_id = v_invoice.organization_id;

  perform public.create_booking_invoice_internal(
    new.id,
    auth.uid(),
    v_invoice.id,
    'invoice_reissued'
  );

  return new;
end;
$$;

create trigger bookings_reissue_changed_invoice
after update of
  client_name,
  phone_e164,
  event_type,
  event_date,
  venue,
  guest_count,
  total_value
on public.bookings
for each row execute function public.handle_booking_invoice_snapshot_change();

-- Add the customer email and invoice/email summary to the existing optimized
-- booking reader without changing its public argument list.
create or replace function public.get_bookings_page(
  p_page integer default 1,
  p_page_size integer default 10,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_offset integer;
  v_total bigint;
  v_bookings jsonb;
  v_eligible_leads jsonb := '[]'::jsonb;
begin
  if p_page < 1
     or p_page_size < 1
     or p_page_size > 100
     or char_length(coalesce(p_search, '')) > 80 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null
    and o.is_active
    and p.role in ('director', 'manager', 'sales_manager', 'sales')
    and public.current_auth_session_is_valid();

  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_offset := (p_page - 1) * p_page_size;

  with visible_bookings as materialized (
    select b.*
    from public.bookings b
    where b.organization_id = v_profile.organization_id
      and b.deleted_at is null
      and (
        v_profile.role in ('director', 'manager', 'sales_manager')
        or b.sold_by_profile_id = v_profile.id
      )
      and (
        v_search is null
        or b.booking_code ilike '%' || v_search || '%'
        or b.client_name ilike '%' || v_search || '%'
        or b.event_type ilike '%' || v_search || '%'
        or b.venue ilike '%' || v_search || '%'
        or coalesce(b.customer_email, '') ilike '%' || v_search || '%'
      )
  ),
  page_rows as (
    select
      b.id,
      b.booking_code,
      b.lead_id,
      b.client_name,
      b.customer_email,
      b.event_type,
      b.event_date,
      b.event_start_time,
      b.reporting_time,
      b.venue,
      b.guest_count,
      b.menu,
      b.instructions,
      b.total_value,
      b.payment_status,
      b.service_status,
      b.version,
      invoice.id as invoice_id,
      invoice.invoice_number,
      invoice.status as invoice_status,
      invoice.pdf_storage_path as invoice_pdf_storage_path,
      latest_email.id as latest_email_id,
      latest_email.status as latest_email_status,
      latest_email.last_error_safe as latest_email_error_safe
    from visible_bookings b
    left join lateral (
      select i.*
      from public.invoices i
      where i.organization_id = b.organization_id
        and i.booking_id = b.id
        and i.status <> 'void'
      order by i.created_at desc
      limit 1
    ) invoice on true
    left join lateral (
      select eo.*
      from public.email_outbox eo
      where eo.organization_id = b.organization_id
        and eo.booking_id = b.id
      order by eo.created_at desc
      limit 1
    ) latest_email on true
    order by b.event_date desc, b.id
    limit p_page_size
    offset v_offset
  )
  select
    (select count(*) from visible_bookings),
    coalesce(
      (
        select jsonb_agg(to_jsonb(page_rows) order by page_rows.event_date desc, page_rows.id)
        from page_rows
      ),
      '[]'::jsonb
    )
  into v_total, v_bookings;

  if v_profile.role in ('sales_manager', 'sales') then
    select coalesce(
      jsonb_agg(to_jsonb(eligible) order by eligible.updated_at desc, eligible.id),
      '[]'::jsonb
    )
    into v_eligible_leads
    from (
      select
        l.id,
        l.client_name,
        l.customer_email,
        l.event_date,
        l.guest_count,
        l.quote_amount,
        l.updated_at
      from public.leads l
      where l.organization_id = v_profile.organization_id
        and l.deleted_at is null
        and l.status = 'qualified'
        and (
          v_profile.role = 'sales_manager'
          or l.assigned_sales_profile_id = v_profile.id
        )
        and not exists (
          select 1
          from public.bookings existing
          where existing.organization_id = l.organization_id
            and existing.lead_id = l.id
            and existing.deleted_at is null
        )
      order by l.updated_at desc, l.id
      limit 100
    ) eligible;
  end if;

  return jsonb_build_object(
    'bookings', v_bookings,
    'eligible_leads', v_eligible_leads,
    'total', v_total
  );
end;
$$;

create or replace function public.get_leads_page(
  p_page integer default 1,
  p_page_size integer default 10,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_offset integer;
  v_result jsonb;
begin
  if p_page < 1 or p_page_size < 1 or p_page_size > 100
     or char_length(coalesce(p_search, '')) > 80 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null
    and o.is_active
    and p.role in ('director', 'manager', 'sales_manager', 'sales')
    and public.current_auth_session_is_valid();

  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_offset := (p_page - 1) * p_page_size;

  with visible_leads as materialized (
    select l.*
    from public.leads l
    where l.organization_id = v_profile.organization_id
      and l.deleted_at is null
      and (
        v_profile.role in ('director', 'manager', 'sales_manager')
        or l.assigned_sales_profile_id = v_profile.id
      )
      and (
        v_search is null
        or l.client_name ilike '%' || v_search || '%'
        or l.phone_e164 ilike '%' || v_search || '%'
        or coalesce(l.customer_email, '') ilike '%' || v_search || '%'
        or coalesce(l.source, '') ilike '%' || v_search || '%'
      )
  ),
  page_rows as (
    select
      l.id,
      l.client_name,
      l.customer_email,
      l.phone_e164,
      l.source,
      l.requirement,
      l.event_date,
      l.guest_count,
      l.quote_amount,
      l.status,
      l.assigned_sales_profile_id,
      l.next_follow_up_at,
      l.notes,
      l.version,
      l.created_at,
      l.updated_at,
      l.last_activity_at
    from visible_leads l
    order by l.last_activity_at desc nulls last, l.id
    limit p_page_size
    offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from visible_leads),
    'rows', coalesce(
      (
        select jsonb_agg(
          to_jsonb(page_row) - 'last_activity_at'
          order by page_row.last_activity_at desc nulls last, page_row.id
        )
        from page_rows page_row
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'invoices',
  'invoices',
  false,
  5242880,
  array['application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy invoices_storage_select_sales_scoped
on storage.objects for select to authenticated
using (
  bucket_id = 'invoices'
  and public.storage_path_is_current_organization(name)
  and exists (
    select 1
    from public.invoices i
    where i.organization_id = public.current_organization_id()
      and i.pdf_storage_path = name
      and public.can_read_invoice(i.id)
  )
);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.invoices;
    alter publication supabase_realtime add table public.email_outbox;
  end if;
exception
  when duplicate_object then null;
end;
$$;

revoke all on function public.enqueue_customer_email(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.create_booking_invoice_internal(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_email_outbox(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer, uuid) to service_role;

revoke all on function public.transition_lead_stage(uuid, public.lead_status, integer, text)
  from public, anon;
grant execute on function public.transition_lead_stage(
  uuid,
  public.lead_status,
  integer,
  text
) to authenticated;

revoke all on function public.issue_booking_invoice(uuid) from public, anon;
grant execute on function public.issue_booking_invoice(uuid) to authenticated;

revoke all on function public.void_and_reissue_invoice(uuid, text) from public, anon;
grant execute on function public.void_and_reissue_invoice(uuid, text) to authenticated;

revoke all on function public.update_booking_customer_email(uuid, text) from public, anon;
grant execute on function public.update_booking_customer_email(uuid, text) to authenticated;

revoke all on function public.resend_booking_invoice(uuid, text) from public, anon;
grant execute on function public.resend_booking_invoice(uuid, text) to authenticated;

revoke all on function public.retry_customer_email(uuid) from public, anon;
grant execute on function public.retry_customer_email(uuid) to authenticated;

revoke all on function public.get_bookings_page(integer, integer, text)
  from public, anon;
grant execute on function public.get_bookings_page(integer, integer, text)
  to authenticated, service_role;

revoke all on function public.get_leads_page(integer, integer, text)
  from public, anon;
grant execute on function public.get_leads_page(integer, integer, text)
  to authenticated, service_role;

comment on table public.invoices is
  'Immutable commercial invoice snapshots. Corrections void and replace; PDFs are private Storage objects.';
comment on table public.email_outbox is
  'Transactional email work queue. Business transactions commit independently of provider delivery.';
comment on column public.organization_settings.email_automation_enabled is
  'Deployment safety switch. Historical records are never queued when this flag is enabled.';

-- Guard the legacy manual-call RPC and every other write path: a lead can only
-- become contacted after a real customer interaction has been persisted.
create or replace function public.guard_automated_contacted_stage()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'new' and new.status = 'contacted' and not (
    exists (
      select 1
      from public.superfone_calls c
      where c.lead_id = new.id
        and c.organization_id = new.organization_id
        and (
          (
            c.status = 'answered'
            and c.answered_at is not null
          )
          or (
            c.status = 'completed'
            and c.answered_at is not null
            and coalesce(c.duration_seconds, 0) > 0
          )
        )
    )
    or exists (
      select 1
      from public.messages m
      where m.lead_id = new.id
        and m.organization_id = new.organization_id
        and (
          (m.direction = 'inbound' and m.status = 'received')
          or (m.direction = 'outbound' and m.status in ('sent', 'delivered', 'read'))
        )
    )
  ) then
    new.status := old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_automated_contacted_stage on public.leads;
create trigger guard_automated_contacted_stage
before update of status on public.leads
for each row execute function public.guard_automated_contacted_stage();
