-- Khana Banao CRM: HR Chef assignment and attendance review workflows.

create or replace function public.assign_booking_chef(
  p_booking_id uuid,
  p_chef_profile_id uuid,
  p_agreed_pay_type public.payment_type,
  p_agreed_pay_amount numeric,
  p_instructions text default null
)
returns table (
  assignment_id uuid,
  booking_id uuid,
  chef_profile_id uuid,
  service_status public.booking_service_status
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_chef public.profiles%rowtype;
  v_booking_before public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_assignment public.booking_assignments%rowtype;
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

  if not found or v_actor.role not in ('director', 'manager', 'hr') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_agreed_pay_type is null
     or p_agreed_pay_amount is null
     or p_agreed_pay_amount < 0 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select p.*
  into v_chef
  from public.profiles p
  where p.id = p_chef_profile_id
    and p.organization_id = v_actor.organization_id
    and p.role in ('chef', 'part_time_chef')
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found then
    raise exception using errcode = '22023', message = 'INVALID_CHEF_ASSIGNEE';
  end if;

  select b.*
  into v_booking_before
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_booking_before.service_status not in ('confirmed', 'chef_assigned') then
    raise exception using errcode = '22023', message = 'BOOKING_NOT_ASSIGNABLE';
  end if;

  update public.booking_assignments ba
  set unassigned_at = now()
  where ba.organization_id = v_actor.organization_id
    and ba.booking_id = v_booking_before.id
    and ba.is_primary
    and ba.unassigned_at is null;

  insert into public.booking_assignments (
    organization_id,
    booking_id,
    chef_profile_id,
    assigned_by_profile_id,
    is_primary,
    agreed_pay_type,
    agreed_pay_amount,
    instructions
  )
  values (
    v_actor.organization_id,
    v_booking_before.id,
    v_chef.id,
    v_actor.id,
    true,
    p_agreed_pay_type,
    p_agreed_pay_amount,
    nullif(btrim(p_instructions), '')
  )
  returning * into v_assignment;

  update public.bookings b
  set service_status = 'chef_assigned'
  where b.id = v_booking_before.id
    and b.organization_id = v_actor.organization_id
  returning b.* into v_booking;

  if v_booking.service_status is distinct from v_booking_before.service_status then
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
      v_booking_before.service_status,
      v_booking.service_status,
      v_actor.id,
      'Primary Chef assigned'
    );
  end if;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'booking.chef_assigned',
    'booking_assignment',
    v_assignment.id,
    null,
    jsonb_build_object(
      'booking_id', v_booking.id,
      'chef_profile_id', v_chef.id,
      'agreed_pay_type', v_assignment.agreed_pay_type,
      'agreed_pay_amount', v_assignment.agreed_pay_amount
    ),
    'Primary Chef assigned or reassigned',
    null
  );

  return query
  select
    v_assignment.id,
    v_booking.id,
    v_chef.id,
    v_booking.service_status;
end;
$$;

create or replace function public.review_attendance_shift(
  p_shift_id uuid,
  p_decision public.attendance_status,
  p_reason text default null
)
returns table (
  shift_id uuid,
  status public.attendance_status,
  payroll_eligible boolean,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.attendance_shifts%rowtype;
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

  if not found or v_actor.role not in ('director', 'manager', 'hr') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_decision not in ('approved', 'corrected', 'rejected')
     or (
       p_decision in ('corrected', 'rejected')
       and nullif(btrim(p_reason), '') is null
     ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select s.*
  into v_before
  from public.attendance_shifts s
  where s.id = p_shift_id
    and s.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_actor.role = 'hr'
     and v_before.temporary_worker_id is null
     and (
       v_before.profile_id is null
       or not public.profile_has_any_role(
         v_before.profile_id,
         array['chef', 'part_time_chef']::public.profile_role[]
       )
     ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status not in ('pending_approval', 'approved', 'corrected', 'rejected') then
    raise exception using errcode = '22023', message = 'ATTENDANCE_NOT_REVIEWABLE';
  end if;

  update public.attendance_shifts s
  set
    status = p_decision,
    approved_by_profile_id = case
      when p_decision in ('approved', 'corrected') then v_actor.id
      else null
    end,
    approved_at = case
      when p_decision in ('approved', 'corrected') then now()
      else null
    end,
    corrected_by_profile_id = case
      when p_decision = 'corrected' then v_actor.id
      else null
    end,
    correction_reason = case
      when p_decision in ('corrected', 'rejected') then btrim(p_reason)
      else null
    end,
    payroll_eligible = p_decision in ('approved', 'corrected')
  where s.id = v_before.id
    and s.organization_id = v_actor.organization_id
  returning s.* into v_shift;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'attendance.reviewed',
    'attendance_shift',
    v_shift.id,
    jsonb_build_object(
      'status', v_before.status,
      'payroll_eligible', v_before.payroll_eligible
    ),
    jsonb_build_object(
      'status', v_shift.status,
      'payroll_eligible', v_shift.payroll_eligible,
      'approved_at', v_shift.approved_at
    ),
    nullif(btrim(p_reason), ''),
    null
  );

  return query
  select
    v_shift.id,
    v_shift.status,
    v_shift.payroll_eligible,
    v_shift.approved_at;
end;
$$;

revoke all on function public.assign_booking_chef(
  uuid,
  uuid,
  public.payment_type,
  numeric,
  text
) from public, anon, authenticated;
grant execute on function public.assign_booking_chef(
  uuid,
  uuid,
  public.payment_type,
  numeric,
  text
) to authenticated;

revoke all on function public.review_attendance_shift(
  uuid,
  public.attendance_status,
  text
) from public, anon, authenticated;
grant execute on function public.review_attendance_shift(
  uuid,
  public.attendance_status,
  text
) to authenticated;
