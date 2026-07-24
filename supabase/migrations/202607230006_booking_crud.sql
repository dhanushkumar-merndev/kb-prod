-- Khana Banao CRM: transactional sales booking creation and editing.

create unique index one_active_booking_per_lead
on public.bookings (organization_id, lead_id)
where lead_id is not null and deleted_at is null;

create or replace function public.create_booking_from_lead(
  p_lead_id uuid,
  p_event_type text,
  p_event_date date,
  p_event_start_time time default null,
  p_reporting_time time default null,
  p_venue text default null,
  p_guest_count integer default null,
  p_menu text default null,
  p_instructions text default null,
  p_total_value numeric default null
)
returns table (
  booking_id uuid,
  booking_code text,
  service_status public.booking_service_status,
  version integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_booking public.bookings%rowtype;
  v_booking_id uuid := gen_random_uuid();
  v_prefix text;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.*
  into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found or v_actor.role not in ('sales', 'sales_manager') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if nullif(btrim(p_event_type), '') is null
     or p_event_date is null
     or p_event_date < current_date - 1
     or nullif(btrim(p_venue), '') is null
     or p_guest_count is null
     or p_guest_count < 1
     or nullif(btrim(p_menu), '') is null
     or p_total_value is null
     or p_total_value < 0 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select l.*
  into v_lead
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = v_actor.organization_id
    and l.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_actor.role = 'sales'
     and v_lead.assigned_sales_profile_id is distinct from v_actor.id then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_lead.status not in (
    'qualified',
    'booking_payment_pending',
    'booking_in_process'
  ) then
    raise exception using errcode = '22023', message = 'LEAD_NOT_READY_FOR_BOOKING';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.organization_id = v_actor.organization_id
      and b.lead_id = v_lead.id
      and b.deleted_at is null
  ) then
    raise exception using errcode = '23505', message = 'LEAD_ALREADY_CONVERTED';
  end if;

  select os.booking_code_prefix
  into strict v_prefix
  from public.organization_settings os
  where os.organization_id = v_actor.organization_id;

  insert into public.bookings (
    id,
    organization_id,
    booking_code,
    lead_id,
    client_name,
    phone_e164,
    event_type,
    event_date,
    event_start_time,
    reporting_time,
    venue,
    guest_count,
    menu,
    instructions,
    total_value,
    payment_status,
    service_status,
    sold_by_profile_id
  )
  values (
    v_booking_id,
    v_actor.organization_id,
    v_prefix || '-' || to_char(p_event_date, 'YYMM') || '-' ||
      upper(substr(replace(v_booking_id::text, '-', ''), 1, 6)),
    v_lead.id,
    v_lead.client_name,
    v_lead.phone_e164,
    btrim(p_event_type),
    p_event_date,
    p_event_start_time,
    p_reporting_time,
    btrim(p_venue),
    p_guest_count,
    btrim(p_menu),
    nullif(btrim(p_instructions), ''),
    p_total_value,
    'unpaid',
    'pending',
    v_actor.id
  )
  returning * into v_booking;

  update public.leads
  set
    status = 'booking_in_process',
    event_date = p_event_date,
    guest_count = p_guest_count,
    quote_amount = p_total_value,
    last_activity_at = now()
  where id = v_lead.id
    and organization_id = v_actor.organization_id;

  insert into public.booking_status_history (
    organization_id,
    booking_id,
    from_status,
    to_status,
    changed_by_profile_id,
    reason
  )
  values (
    v_actor.organization_id,
    v_booking.id,
    null,
    v_booking.service_status,
    v_actor.id,
    'Booking created from qualified lead'
  );

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata
  )
  values (
    v_actor.organization_id,
    v_lead.id,
    v_actor.id,
    'booking_conversion',
    'Lead converted to booking ' || v_booking.booking_code,
    jsonb_build_object('booking_id', v_booking.id)
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'booking.created',
    'booking',
    v_booking.id,
    null,
    jsonb_build_object(
      'booking_code', v_booking.booking_code,
      'lead_id', v_booking.lead_id,
      'event_date', v_booking.event_date,
      'total_value', v_booking.total_value,
      'service_status', v_booking.service_status
    ),
    'Lead converted to booking',
    null
  );

  return query
  select
    v_booking.id,
    v_booking.booking_code,
    v_booking.service_status,
    v_booking.version;
end;
$$;

create or replace function public.update_booking_details(
  p_booking_id uuid,
  p_expected_version integer,
  p_event_type text,
  p_event_date date,
  p_event_start_time time default null,
  p_reporting_time time default null,
  p_venue text default null,
  p_guest_count integer default null,
  p_menu text default null,
  p_instructions text default null,
  p_total_value numeric default null
)
returns table (
  booking_id uuid,
  booking_code text,
  service_status public.booking_service_status,
  version integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.bookings%rowtype;
  v_booking public.bookings%rowtype;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.*
  into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_expected_version is null
     or p_expected_version < 1
     or nullif(btrim(p_event_type), '') is null
     or p_event_date is null
     or nullif(btrim(p_venue), '') is null
     or p_guest_count is null
     or p_guest_count < 1
     or nullif(btrim(p_menu), '') is null
     or p_total_value is null
     or p_total_value < 0 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select b.*
  into v_before
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null
  for update;

  if not found
     or (
       v_actor.role = 'sales'
       and v_before.sold_by_profile_id is distinct from v_actor.id
     ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if v_before.service_status in (
    'preparing',
    'service_completed',
    'fully_completed',
    'cancelled'
  ) then
    raise exception using errcode = '22023', message = 'BOOKING_DETAILS_LOCKED';
  end if;

  update public.bookings b
  set
    event_type = btrim(p_event_type),
    event_date = p_event_date,
    event_start_time = p_event_start_time,
    reporting_time = p_reporting_time,
    venue = btrim(p_venue),
    guest_count = p_guest_count,
    menu = btrim(p_menu),
    instructions = nullif(btrim(p_instructions), ''),
    total_value = p_total_value
  where b.id = v_before.id
    and b.organization_id = v_actor.organization_id
  returning b.* into v_booking;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'booking.updated',
    'booking',
    v_booking.id,
    jsonb_build_object(
      'event_date', v_before.event_date,
      'venue', v_before.venue,
      'guest_count', v_before.guest_count,
      'total_value', v_before.total_value,
      'version', v_before.version
    ),
    jsonb_build_object(
      'event_date', v_booking.event_date,
      'venue', v_booking.venue,
      'guest_count', v_booking.guest_count,
      'total_value', v_booking.total_value,
      'version', v_booking.version
    ),
    'Booking operational details updated',
    null
  );

  return query
  select
    v_booking.id,
    v_booking.booking_code,
    v_booking.service_status,
    v_booking.version;
end;
$$;

revoke all on function public.create_booking_from_lead(
  uuid,
  text,
  date,
  time,
  time,
  text,
  integer,
  text,
  text,
  numeric
) from public, anon, authenticated;
grant execute on function public.create_booking_from_lead(
  uuid,
  text,
  date,
  time,
  time,
  text,
  integer,
  text,
  text,
  numeric
) to authenticated;

revoke all on function public.update_booking_details(
  uuid,
  integer,
  text,
  date,
  time,
  time,
  text,
  integer,
  text,
  text,
  numeric
) from public, anon, authenticated;
grant execute on function public.update_booking_details(
  uuid,
  integer,
  text,
  date,
  time,
  time,
  text,
  integer,
  text,
  text,
  numeric
) to authenticated;
