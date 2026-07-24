-- Khana Banao CRM: atomic Chef and Part-time Chef self-service workflows.
--
-- These security-definer RPCs are the only browser mutation surface for worker
-- attendance and booking service status. Every function derives identity,
-- organization, role, and session validity from the authenticated database
-- context; no actor or organization identifier is accepted from the caller.

create or replace function public.start_attendance_shift(
  p_booking_id uuid,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_accuracy_meters numeric default null
)
returns table (
  shift_id uuid,
  booking_id uuid,
  shift_date date,
  started_at timestamptz,
  ended_at timestamptz,
  status public.attendance_status
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_booking public.bookings%rowtype;
  v_assignment_id uuid;
  v_local_date date;
  v_timezone text;
  v_location jsonb;
  v_shift public.attendance_shifts%rowtype;
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

  if not found or v_actor.role not in ('chef', 'part_time_chef') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if num_nonnulls(p_latitude, p_longitude) = 1
     or p_latitude is not null and (p_latitude < -90 or p_latitude > 90)
     or p_longitude is not null and (p_longitude < -180 or p_longitude > 180)
     or p_accuracy_meters is not null
       and (p_accuracy_meters < 0 or p_latitude is null or p_longitude is null) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select o.timezone
  into strict v_timezone
  from public.organizations o
  where o.id = v_actor.organization_id
    and o.is_active;

  v_local_date := (now() at time zone v_timezone)::date;

  select b.*
  into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null
  for update;

  if not found
     or v_booking.service_status not in ('pending', 'confirmed', 'chef_assigned', 'preparing') then
    raise exception using errcode = '42501', message = 'ATTENDANCE_NOT_ASSIGNED';
  end if;

  select ba.id
  into v_assignment_id
  from public.booking_assignments ba
  where ba.booking_id = v_booking.id
    and ba.organization_id = v_actor.organization_id
    and ba.chef_profile_id = v_actor.id
    and ba.unassigned_at is null
  order by ba.is_primary desc, ba.assigned_at desc
  limit 1
  for update;

  if v_assignment_id is null then
    raise exception using errcode = '42501', message = 'ATTENDANCE_NOT_ASSIGNED';
  end if;

  if v_actor.role = 'part_time_chef' and v_booking.event_date <> v_local_date then
    raise exception using errcode = '42501', message = 'ATTENDANCE_NOT_ASSIGNED';
  end if;

  -- Serialize starts for this worker so concurrent duplicate clicks produce one
  -- deterministic open shift instead of relying only on the unique-index error.
  perform pg_advisory_xact_lock(hashtextextended(v_actor.id::text, 0));

  if exists (
    select 1
    from public.attendance_shifts s
    where s.organization_id = v_actor.organization_id
      and s.profile_id = v_actor.id
      and s.status = 'working'
      and s.ended_at is null
  ) then
    raise exception using errcode = '23505', message = 'ATTENDANCE_ALREADY_OPEN';
  end if;

  if p_latitude is not null then
    v_location := jsonb_strip_nulls(jsonb_build_object(
      'latitude', p_latitude,
      'longitude', p_longitude,
      'accuracy_meters', p_accuracy_meters
    ));
  end if;

  insert into public.attendance_shifts (
    organization_id,
    profile_id,
    booking_id,
    shift_date,
    started_at,
    start_location,
    status
  )
  values (
    v_actor.organization_id,
    v_actor.id,
    v_booking.id,
    v_local_date,
    now(),
    v_location,
    'working'
  )
  returning * into v_shift;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'attendance.shift_started',
    'attendance_shift',
    v_shift.id,
    null,
    jsonb_build_object(
      'booking_id', v_shift.booking_id,
      'shift_date', v_shift.shift_date,
      'started_at', v_shift.started_at,
      'status', v_shift.status
    ),
    'Worker started assigned shift',
    null
  );

  return query
  select
    v_shift.id,
    v_shift.booking_id,
    v_shift.shift_date,
    v_shift.started_at,
    v_shift.ended_at,
    v_shift.status;
end;
$$;

create or replace function public.end_attendance_shift(
  p_shift_id uuid,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_accuracy_meters numeric default null
)
returns table (
  shift_id uuid,
  booking_id uuid,
  shift_date date,
  started_at timestamptz,
  ended_at timestamptz,
  status public.attendance_status
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.attendance_shifts%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_location jsonb;
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

  if not found or v_actor.role not in ('chef', 'part_time_chef') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if num_nonnulls(p_latitude, p_longitude) = 1
     or p_latitude is not null and (p_latitude < -90 or p_latitude > 90)
     or p_longitude is not null and (p_longitude < -180 or p_longitude > 180)
     or p_accuracy_meters is not null
       and (p_accuracy_meters < 0 or p_latitude is null or p_longitude is null) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select s.*
  into v_before
  from public.attendance_shifts s
  where s.id = p_shift_id
    and s.organization_id = v_actor.organization_id
    and s.profile_id = v_actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status <> 'working'
     or v_before.started_at is null
     or v_before.ended_at is not null then
    raise exception using errcode = '22023', message = 'ATTENDANCE_NOT_OPEN';
  end if;

  if p_latitude is not null then
    v_location := jsonb_strip_nulls(jsonb_build_object(
      'latitude', p_latitude,
      'longitude', p_longitude,
      'accuracy_meters', p_accuracy_meters
    ));
  end if;

  update public.attendance_shifts s
  set
    ended_at = now(),
    end_location = v_location,
    status = 'pending_approval',
    submitted_at = now()
  where s.id = v_before.id
    and s.organization_id = v_actor.organization_id
  returning s.* into v_shift;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'attendance.shift_submitted',
    'attendance_shift',
    v_shift.id,
    jsonb_build_object(
      'booking_id', v_before.booking_id,
      'shift_date', v_before.shift_date,
      'started_at', v_before.started_at,
      'ended_at', v_before.ended_at,
      'status', v_before.status
    ),
    jsonb_build_object(
      'booking_id', v_shift.booking_id,
      'shift_date', v_shift.shift_date,
      'started_at', v_shift.started_at,
      'ended_at', v_shift.ended_at,
      'status', v_shift.status
    ),
    'Worker ended shift for HR approval',
    null
  );

  return query
  select
    v_shift.id,
    v_shift.booking_id,
    v_shift.shift_date,
    v_shift.started_at,
    v_shift.ended_at,
    v_shift.status;
end;
$$;

create or replace function public.change_booking_service_status(
  p_booking_id uuid,
  p_to_status public.booking_service_status,
  p_expected_version integer,
  p_reason text default null
)
returns table (
  booking_id uuid,
  service_status public.booking_service_status,
  version integer,
  service_completed_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_assignment_id uuid;
  v_local_date date;
  v_timezone text;
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

  if not found or v_actor.role not in ('chef', 'part_time_chef') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_expected_version is null or p_expected_version < 1
     or p_to_status is null
     or p_to_status not in ('preparing', 'service_completed') then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select b.*
  into v_before
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select ba.id
  into v_assignment_id
  from public.booking_assignments ba
  where ba.booking_id = v_before.id
    and ba.organization_id = v_actor.organization_id
    and ba.chef_profile_id = v_actor.id
    and ba.unassigned_at is null
  order by ba.is_primary desc, ba.assigned_at desc
  limit 1
  for update;

  if v_assignment_id is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_actor.role = 'part_time_chef' then
    select o.timezone
    into strict v_timezone
    from public.organizations o
    where o.id = v_actor.organization_id
      and o.is_active;

    v_local_date := (now() at time zone v_timezone)::date;

    if v_before.event_date <> v_local_date then
      raise exception using errcode = '42501', message = 'ATTENDANCE_NOT_ASSIGNED';
    end if;
  end if;

  -- A repeated request that already reached its intended status is safe and
  -- does not add duplicate history or audit rows.
  if v_before.service_status = p_to_status then
    return query
    select
      v_before.id,
      v_before.service_status,
      v_before.version,
      v_before.service_completed_at;
    return;
  end if;

  if v_before.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if not (
    p_to_status = 'preparing'
      and v_before.service_status in ('pending', 'confirmed', 'chef_assigned')
    or p_to_status = 'service_completed'
      and v_before.service_status = 'preparing'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_STATUS_TRANSITION';
  end if;

  update public.bookings b
  set
    service_status = p_to_status,
    service_completed_at = case
      when p_to_status = 'service_completed' then now()
      else b.service_completed_at
    end
  where b.id = v_before.id
    and b.organization_id = v_actor.organization_id
  returning b.* into v_booking;

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
    v_before.service_status,
    v_booking.service_status,
    v_actor.id,
    nullif(btrim(p_reason), '')
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'booking.service_status_changed',
    'booking',
    v_booking.id,
    jsonb_build_object(
      'service_status', v_before.service_status,
      'version', v_before.version
    ),
    jsonb_build_object(
      'service_status', v_booking.service_status,
      'version', v_booking.version,
      'service_completed_at', v_booking.service_completed_at
    ),
    coalesce(nullif(btrim(p_reason), ''), 'Assigned worker updated job status'),
    null
  );

  return query
  select
    v_booking.id,
    v_booking.service_status,
    v_booking.version,
    v_booking.service_completed_at;
end;
$$;

create or replace function public.get_my_workforce_jobs(
  p_from_date date default current_date - 365,
  p_to_date date default current_date + 365
)
returns table (
  booking_id uuid,
  booking_code text,
  event_type text,
  event_date date,
  event_start_time time,
  reporting_time time,
  venue text,
  guest_count integer,
  menu text,
  instructions text,
  service_status public.booking_service_status,
  version integer,
  agreed_pay_type public.payment_type,
  agreed_pay_amount numeric
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
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

  if not found or v_actor.role not in ('chef', 'part_time_chef') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_from_date is null
     or p_to_date is null
     or p_to_date < p_from_date
     or p_to_date - p_from_date > 730 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  return query
  select
    b.id,
    b.booking_code,
    b.event_type,
    b.event_date,
    b.event_start_time,
    b.reporting_time,
    b.venue,
    b.guest_count,
    b.menu,
    b.instructions,
    b.service_status,
    b.version,
    ba.agreed_pay_type,
    ba.agreed_pay_amount
  from public.booking_assignments ba
  join public.bookings b
    on b.id = ba.booking_id
   and b.organization_id = ba.organization_id
   and b.deleted_at is null
  where ba.organization_id = v_actor.organization_id
    and ba.chef_profile_id = v_actor.id
    and ba.unassigned_at is null
    and b.event_date between p_from_date and p_to_date
  order by b.event_date, b.reporting_time nulls last, b.booking_code;
end;
$$;

revoke all on function public.start_attendance_shift(uuid, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.start_attendance_shift(uuid, numeric, numeric, numeric)
  to authenticated;

revoke all on function public.end_attendance_shift(uuid, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.end_attendance_shift(uuid, numeric, numeric, numeric)
  to authenticated;

revoke all on function public.change_booking_service_status(
  uuid,
  public.booking_service_status,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.change_booking_service_status(
  uuid,
  public.booking_service_status,
  integer,
  text
) to authenticated;

revoke all on function public.get_my_workforce_jobs(date, date)
  from public, anon, authenticated;
grant execute on function public.get_my_workforce_jobs(date, date)
  to authenticated;
