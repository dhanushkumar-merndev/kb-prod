-- Complete internally supported expense, leave, employee-record and attendance workflows.

create or replace function public.submit_expense_claim(
  p_expense_id uuid,
  p_booking_id uuid,
  p_category text,
  p_amount numeric,
  p_reason text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
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
  into strict v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if p_expense_id is null
     or nullif(btrim(p_category), '') is null
     or p_amount is null
     or p_amount <= 0
     or nullif(btrim(p_reason), '') is null
     or nullif(btrim(p_storage_path), '') is null
     or nullif(btrim(p_file_name), '') is null
     or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
     or p_size_bytes is null
     or p_size_bytes <= 0
     or p_size_bytes > 8388608 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if p_storage_path not like
    v_actor.organization_id::text || '/' ||
    v_actor.id::text || '/' ||
    p_expense_id::text || '/%' then
    raise exception using errcode = '22023', message = 'INVALID_EXPENSE_ATTACHMENT_PATH';
  end if;

  if p_booking_id is not null and not exists (
    select 1
    from public.bookings b
    where b.id = p_booking_id
      and b.organization_id = v_actor.organization_id
      and b.deleted_at is null
      and public.can_read_booking(b.id)
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  insert into public.expenses (
    id,
    organization_id,
    submitted_by_profile_id,
    booking_id,
    category,
    amount,
    reason,
    status
  )
  values (
    p_expense_id,
    v_actor.organization_id,
    v_actor.id,
    p_booking_id,
    btrim(p_category),
    p_amount,
    btrim(p_reason),
    'pending'
  );

  insert into public.expense_attachments (
    organization_id,
    expense_id,
    storage_path,
    file_name,
    mime_type,
    size_bytes
  )
  values (
    v_actor.organization_id,
    p_expense_id,
    p_storage_path,
    left(btrim(p_file_name), 255),
    p_mime_type,
    p_size_bytes
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'expense.submitted',
    'expense',
    p_expense_id,
    null,
    jsonb_build_object(
      'booking_id', p_booking_id,
      'category', btrim(p_category),
      'amount', p_amount,
      'has_attachment', true
    ),
    null,
    null
  );

  return p_expense_id;
end;
$$;

create or replace function public.review_expense_claim(
  p_expense_id uuid,
  p_status public.expense_status,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.expenses
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.expenses%rowtype;
  v_after public.expenses%rowtype;
  v_submitter_role public.profile_role;
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

  select e.*
  into v_before
  from public.expenses e
  where e.id = p_expense_id
    and e.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select p.role
  into strict v_submitter_role
  from public.profiles p
  where p.id = v_before.submitted_by_profile_id
    and p.organization_id = v_before.organization_id;

  if p_expected_updated_at is null or v_before.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if v_actor.role = 'hr' then
    if v_submitter_role not in ('chef', 'part_time_chef')
       or v_before.status <> 'pending'
       or p_status not in ('verified', 'rejected') then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
  elsif v_actor.role = 'manager' then
    if v_before.status not in ('pending', 'verified')
       or p_status not in ('verified', 'approved', 'rejected') then
      raise exception using errcode = '22023', message = 'INVALID_EXPENSE_TRANSITION';
    end if;
  elsif v_actor.role = 'director' then
    if not (
      (v_before.status in ('pending', 'verified') and p_status in ('verified', 'approved', 'rejected'))
      or (v_before.status = 'approved' and p_status = 'paid')
    ) then
      raise exception using errcode = '22023', message = 'INVALID_EXPENSE_TRANSITION';
    end if;
  else
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_status = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'REJECTION_REASON_REQUIRED';
  end if;

  update public.expenses e
  set
    status = p_status,
    reviewed_by_profile_id = v_actor.id,
    reviewed_at = now(),
    rejection_reason = case when p_status = 'rejected' then btrim(p_reason) else null end
  where e.id = v_before.id
    and e.organization_id = v_before.organization_id
  returning e.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'expense.reviewed',
    'expense',
    v_after.id,
    jsonb_build_object(
      'status', v_before.status,
      'reviewed_by_profile_id', v_before.reviewed_by_profile_id
    ),
    jsonb_build_object(
      'status', v_after.status,
      'reviewed_by_profile_id', v_after.reviewed_by_profile_id,
      'reviewed_at', v_after.reviewed_at
    ),
    nullif(btrim(p_reason), ''),
    null
  );

  insert into public.notifications (
    organization_id,
    recipient_profile_id,
    notification_type,
    title,
    body,
    entity_type,
    entity_id
  )
  values (
    v_actor.organization_id,
    v_after.submitted_by_profile_id,
    'expense_decision',
    'Expense ' || replace(v_after.status::text, '_', ' '),
    case
      when v_after.status = 'rejected' then 'Your expense was rejected. ' || coalesce(v_after.rejection_reason, '')
      else 'Your expense claim is now ' || replace(v_after.status::text, '_', ' ') || '.'
    end,
    'expense',
    v_after.id
  );

  return v_after;
end;
$$;

create or replace function public.review_leave_request(
  p_leave_request_id uuid,
  p_status public.leave_status,
  p_review_note text,
  p_expected_updated_at timestamptz
)
returns public.leave_requests
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.leave_requests%rowtype;
  v_after public.leave_requests%rowtype;
  v_requester_role public.profile_role;
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

  select lr.*
  into v_before
  from public.leave_requests lr
  where lr.id = p_leave_request_id
    and lr.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select p.role
  into strict v_requester_role
  from public.profiles p
  where p.id = v_before.profile_id
    and p.organization_id = v_before.organization_id;

  if p_expected_updated_at is null or v_before.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if v_before.status <> 'pending'
     or p_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'INVALID_LEAVE_TRANSITION';
  end if;

  if not (
    v_actor.role in ('director', 'manager')
    or (v_actor.role = 'hr' and v_requester_role in ('chef', 'part_time_chef'))
    or (v_actor.role = 'sales_manager' and v_requester_role = 'sales')
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_status = 'rejected' and nullif(btrim(p_review_note), '') is null then
    raise exception using errcode = '22023', message = 'REVIEW_NOTE_REQUIRED';
  end if;

  update public.leave_requests lr
  set
    status = p_status,
    reviewed_by_profile_id = v_actor.id,
    reviewed_at = now(),
    review_note = nullif(btrim(p_review_note), '')
  where lr.id = v_before.id
    and lr.organization_id = v_before.organization_id
  returning lr.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'leave.reviewed',
    'leave_request',
    v_after.id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object(
      'status', v_after.status,
      'reviewed_by_profile_id', v_after.reviewed_by_profile_id,
      'reviewed_at', v_after.reviewed_at
    ),
    nullif(btrim(p_review_note), ''),
    null
  );

  insert into public.notifications (
    organization_id,
    recipient_profile_id,
    notification_type,
    title,
    body,
    entity_type,
    entity_id
  )
  values (
    v_actor.organization_id,
    v_after.profile_id,
    'leave_decision',
    'Leave ' || v_after.status::text,
    'Your leave request from ' || v_after.start_date::text || ' to ' ||
      v_after.end_date::text || ' was ' || v_after.status::text || '.',
    'leave_request',
    v_after.id
  );

  return v_after;
end;
$$;

create or replace function public.update_employee_private_record(
  p_profile_id uuid,
  p_document_type text,
  p_storage_path text,
  p_part_time_payment_amount numeric,
  p_expected_updated_at timestamptz
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
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

  if v_actor.role not in ('director', 'manager', 'hr')
     or p_document_type not in ('aadhaar', 'part-time-payment-proof')
     or nullif(btrim(p_storage_path), '') is null then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select p.*
  into v_before
  from public.profiles p
  where p.id = p_profile_id
    and p.organization_id = v_actor.organization_id
    and p.role in ('chef', 'part_time_chef')
    and p.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_expected_updated_at is null or v_before.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if p_document_type = 'part-time-payment-proof'
     and (
       v_before.role <> 'part_time_chef'
       or p_part_time_payment_amount is null
       or p_part_time_payment_amount < 0
     ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if p_storage_path not like
    v_actor.organization_id::text || '/' ||
    v_before.id::text || '/' ||
    p_document_type || '/%' then
    raise exception using errcode = '22023', message = 'INVALID_EMPLOYEE_DOCUMENT_PATH';
  end if;

  update public.profiles p
  set
    aadhaar_storage_path = case
      when p_document_type = 'aadhaar' then p_storage_path
      else p.aadhaar_storage_path
    end,
    part_time_payment_proof_path = case
      when p_document_type = 'part-time-payment-proof' then p_storage_path
      else p.part_time_payment_proof_path
    end,
    part_time_payment_amount = case
      when p_document_type = 'part-time-payment-proof' then p_part_time_payment_amount
      else p.part_time_payment_amount
    end
  where p.id = v_before.id
    and p.organization_id = v_before.organization_id
  returning p.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'employee.private_record_updated',
    'profile',
    v_after.id,
    jsonb_build_object(
      'document_type', p_document_type,
      'had_document', case
        when p_document_type = 'aadhaar' then v_before.aadhaar_storage_path is not null
        else v_before.part_time_payment_proof_path is not null
      end
    ),
    jsonb_build_object(
      'document_type', p_document_type,
      'has_document', true,
      'part_time_payment_amount', case
        when p_document_type = 'part-time-payment-proof' then v_after.part_time_payment_amount
        else null
      end
    ),
    'Private employee record uploaded or replaced',
    null
  );

  return v_after;
end;
$$;

create or replace function public.update_workforce_compensation(
  p_profile_id uuid,
  p_joining_date date,
  p_payment_type public.payment_type,
  p_payment_amount numeric,
  p_expected_updated_at timestamptz
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
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

  if v_actor.role not in ('director', 'manager', 'hr')
     or p_joining_date is null
     or p_payment_type is null
     or p_payment_amount is null
     or p_payment_amount < 0 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select p.*
  into v_before
  from public.profiles p
  where p.id = p_profile_id
    and p.organization_id = v_actor.organization_id
    and p.role in ('chef', 'part_time_chef')
    and p.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_expected_updated_at is null or v_before.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if v_before.role = 'chef' and p_payment_type not in ('monthly', 'daily', 'hourly', 'per_booking') then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if v_before.role = 'part_time_chef' and p_payment_type not in ('daily', 'hourly', 'per_booking') then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  update public.profiles p
  set
    joining_date = p_joining_date,
    payment_type = p_payment_type,
    payment_amount = p_payment_amount
  where p.id = v_before.id
    and p.organization_id = v_before.organization_id
  returning p.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'employee.compensation_updated',
    'profile',
    v_after.id,
    jsonb_build_object(
      'joining_date', v_before.joining_date,
      'payment_type', v_before.payment_type,
      'payment_amount', v_before.payment_amount
    ),
    jsonb_build_object(
      'joining_date', v_after.joining_date,
      'payment_type', v_after.payment_type,
      'payment_amount', v_after.payment_amount
    ),
    'Workforce pay structure updated',
    null
  );

  return v_after;
end;
$$;

create or replace function public.correct_attendance_shift(
  p_shift_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_overtime_minutes integer,
  p_reason text
)
returns public.attendance_shifts
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.attendance_shifts%rowtype;
  v_after public.attendance_shifts%rowtype;
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

  if v_actor.role not in ('director', 'manager', 'hr')
     or p_started_at is null
     or p_ended_at is null
     or p_ended_at < p_started_at
     or p_overtime_minutes is null
     or p_overtime_minutes < 0
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select s.*
  into v_before
  from public.attendance_shifts s
  where s.id = p_shift_id
    and s.organization_id = v_actor.organization_id
  for update;

  if not found
     or (
       v_actor.role = 'hr'
       and v_before.temporary_worker_id is null
       and not public.is_workforce_profile(v_before.profile_id)
     ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status = 'working' then
    raise exception using errcode = '22023', message = 'ATTENDANCE_NOT_REVIEWABLE';
  end if;

  update public.attendance_shifts s
  set
    shift_date = (p_started_at at time zone 'Asia/Kolkata')::date,
    started_at = p_started_at,
    ended_at = p_ended_at,
    submitted_at = coalesce(s.submitted_at, p_ended_at),
    status = 'corrected',
    approved_by_profile_id = v_actor.id,
    approved_at = now(),
    corrected_by_profile_id = v_actor.id,
    correction_reason = btrim(p_reason),
    overtime_minutes = p_overtime_minutes,
    payroll_eligible = true
  where s.id = v_before.id
    and s.organization_id = v_before.organization_id
  returning s.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'attendance.corrected',
    'attendance_shift',
    v_after.id,
    jsonb_build_object(
      'started_at', v_before.started_at,
      'ended_at', v_before.ended_at,
      'overtime_minutes', v_before.overtime_minutes,
      'status', v_before.status
    ),
    jsonb_build_object(
      'started_at', v_after.started_at,
      'ended_at', v_after.ended_at,
      'overtime_minutes', v_after.overtime_minutes,
      'status', v_after.status
    ),
    btrim(p_reason),
    null
  );

  return v_after;
end;
$$;

create or replace function public.bulk_approve_attendance_shifts(p_shift_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_shift public.attendance_shifts%rowtype;
  v_count integer := 0;
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

  if v_actor.role not in ('director', 'manager', 'hr')
     or p_shift_ids is null
     or cardinality(p_shift_ids) = 0
     or cardinality(p_shift_ids) > 100 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  for v_shift in
    select s.*
    from public.attendance_shifts s
    where s.organization_id = v_actor.organization_id
      and s.id = any(p_shift_ids)
      and s.status = 'pending_approval'
      and (
        v_actor.role in ('director', 'manager')
        or s.temporary_worker_id is not null
        or public.is_workforce_profile(s.profile_id)
      )
    for update
  loop
    update public.attendance_shifts
    set
      status = 'approved',
      approved_by_profile_id = v_actor.id,
      approved_at = now(),
      corrected_by_profile_id = null,
      correction_reason = null,
      payroll_eligible = true
    where id = v_shift.id
      and organization_id = v_actor.organization_id;

    perform public.write_audit_log(
      v_actor.organization_id,
      v_actor.id,
      'attendance.approved',
      'attendance_shift',
      v_shift.id,
      jsonb_build_object('status', v_shift.status, 'payroll_eligible', v_shift.payroll_eligible),
      jsonb_build_object('status', 'approved', 'payroll_eligible', true),
      'Bulk attendance approval',
      null
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.record_missed_attendance_shift(
  p_profile_id uuid,
  p_temporary_worker_id uuid,
  p_booking_id uuid,
  p_shift_date date,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_status public.attendance_status,
  p_overtime_minutes integer,
  p_reason text
)
returns public.attendance_shifts
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_shift public.attendance_shifts%rowtype;
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

  if v_actor.role not in ('director', 'manager', 'hr')
     or num_nonnulls(p_profile_id, p_temporary_worker_id) <> 1
     or p_shift_date is null
     or p_status not in ('pending_approval', 'absent')
     or p_overtime_minutes is null
     or p_overtime_minutes < 0
     or nullif(btrim(p_reason), '') is null
     or (
       p_status = 'pending_approval'
       and (p_started_at is null or p_ended_at is null or p_ended_at < p_started_at)
     ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if p_profile_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.organization_id = v_actor.organization_id
      and p.role in ('chef', 'part_time_chef')
      and p.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_temporary_worker_id is not null and not exists (
    select 1
    from public.temporary_workers tw
    where tw.id = p_temporary_worker_id
      and tw.organization_id = v_actor.organization_id
      and tw.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_booking_id is not null and not exists (
    select 1
    from public.bookings b
    where b.id = p_booking_id
      and b.organization_id = v_actor.organization_id
      and b.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  insert into public.attendance_shifts (
    organization_id,
    profile_id,
    temporary_worker_id,
    booking_id,
    shift_date,
    started_at,
    ended_at,
    status,
    submitted_at,
    overtime_minutes,
    payroll_eligible,
    correction_reason
  )
  values (
    v_actor.organization_id,
    p_profile_id,
    p_temporary_worker_id,
    p_booking_id,
    p_shift_date,
    case when p_status = 'absent' then null else p_started_at end,
    case when p_status = 'absent' then null else p_ended_at end,
    p_status,
    case when p_status = 'pending_approval' then now() else null end,
    p_overtime_minutes,
    false,
    case when p_status = 'absent' then btrim(p_reason) else null end
  )
  returning * into v_shift;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'attendance.manual_record_created',
    'attendance_shift',
    v_shift.id,
    null,
    jsonb_build_object(
      'profile_id', v_shift.profile_id,
      'temporary_worker_id', v_shift.temporary_worker_id,
      'booking_id', v_shift.booking_id,
      'shift_date', v_shift.shift_date,
      'started_at', v_shift.started_at,
      'ended_at', v_shift.ended_at,
      'status', v_shift.status,
      'overtime_minutes', v_shift.overtime_minutes
    ),
    btrim(p_reason),
    null
  );

  return v_shift;
end;
$$;

create unique index if not exists temporary_worker_booking_date_unique
on public.temporary_worker_assignments (
  organization_id,
  temporary_worker_id,
  work_date
);

create or replace function public.assign_temporary_worker_to_booking(
  p_temporary_worker_id uuid,
  p_booking_id uuid,
  p_work_date date,
  p_reporting_time time,
  p_agreed_payment numeric,
  p_notes text
)
returns public.temporary_worker_assignments
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_worker public.temporary_workers%rowtype;
  v_booking public.bookings%rowtype;
  v_assignment public.temporary_worker_assignments%rowtype;
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

  if v_actor.role not in ('director', 'manager', 'hr')
     or p_work_date is null
     or p_agreed_payment is null
     or p_agreed_payment < 0 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select tw.*
  into v_worker
  from public.temporary_workers tw
  where tw.id = p_temporary_worker_id
    and tw.organization_id = v_actor.organization_id
    and tw.is_active
    and tw.deleted_at is null;

  if not found then
    raise exception using errcode = '22023', message = 'INVALID_TEMPORARY_WORKER';
  end if;

  select b.*
  into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null
    and b.service_status <> 'cancelled';

  if not found then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING';
  end if;

  if p_work_date <> v_booking.event_date then
    raise exception using errcode = '22023', message = 'WORK_DATE_MUST_MATCH_BOOKING';
  end if;

  insert into public.temporary_worker_assignments (
    organization_id,
    temporary_worker_id,
    booking_id,
    work_date,
    reporting_time,
    agreed_payment,
    notes,
    created_by_profile_id
  )
  values (
    v_actor.organization_id,
    v_worker.id,
    v_booking.id,
    p_work_date,
    p_reporting_time,
    p_agreed_payment,
    nullif(btrim(p_notes), ''),
    v_actor.id
  )
  returning * into v_assignment;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'temporary_worker.assigned',
    'temporary_worker_assignment',
    v_assignment.id,
    null,
    jsonb_build_object(
      'temporary_worker_id', v_assignment.temporary_worker_id,
      'booking_id', v_assignment.booking_id,
      'work_date', v_assignment.work_date,
      'agreed_payment', v_assignment.agreed_payment
    ),
    null,
    null
  );

  return v_assignment;
end;
$$;

create or replace function public.prevent_conflicting_chef_assignment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_event_date date;
begin
  if new.unassigned_at is not null or not new.is_primary then
    return new;
  end if;

  select b.event_date
  into strict v_event_date
  from public.bookings b
  where b.id = new.booking_id
    and b.organization_id = new.organization_id
    and b.deleted_at is null;

  if exists (
    select 1
    from public.booking_assignments ba
    join public.bookings b
      on b.id = ba.booking_id
     and b.organization_id = ba.organization_id
    where ba.organization_id = new.organization_id
      and ba.chef_profile_id = new.chef_profile_id
      and ba.is_primary
      and ba.unassigned_at is null
      and ba.id is distinct from new.id
      and b.deleted_at is null
      and b.service_status <> 'cancelled'
      and b.event_date = v_event_date
  ) then
    raise exception using errcode = '23P01', message = 'CHEF_ASSIGNMENT_CONFLICT';
  end if;

  return new;
end;
$$;

drop trigger if exists booking_assignments_prevent_chef_conflict
  on public.booking_assignments;
create trigger booking_assignments_prevent_chef_conflict
before insert or update of
  organization_id,
  booking_id,
  chef_profile_id,
  is_primary,
  unassigned_at
on public.booking_assignments
for each row execute function public.prevent_conflicting_chef_assignment();

revoke all on function public.submit_expense_claim(
  uuid, uuid, text, numeric, text, text, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.submit_expense_claim(
  uuid, uuid, text, numeric, text, text, text, text, bigint
) to authenticated;

revoke all on function public.review_expense_claim(
  uuid, public.expense_status, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.review_expense_claim(
  uuid, public.expense_status, text, timestamptz
) to authenticated;

revoke all on function public.review_leave_request(
  uuid, public.leave_status, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.review_leave_request(
  uuid, public.leave_status, text, timestamptz
) to authenticated;

revoke all on function public.update_employee_private_record(
  uuid, text, text, numeric, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_employee_private_record(
  uuid, text, text, numeric, timestamptz
) to authenticated;

revoke all on function public.update_workforce_compensation(
  uuid, date, public.payment_type, numeric, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_workforce_compensation(
  uuid, date, public.payment_type, numeric, timestamptz
) to authenticated;

revoke all on function public.correct_attendance_shift(
  uuid, timestamptz, timestamptz, integer, text
) from public, anon, authenticated;
grant execute on function public.correct_attendance_shift(
  uuid, timestamptz, timestamptz, integer, text
) to authenticated;

revoke all on function public.bulk_approve_attendance_shifts(uuid[])
  from public, anon, authenticated;
grant execute on function public.bulk_approve_attendance_shifts(uuid[])
  to authenticated;

revoke all on function public.record_missed_attendance_shift(
  uuid, uuid, uuid, date, timestamptz, timestamptz, public.attendance_status, integer, text
) from public, anon, authenticated;
grant execute on function public.record_missed_attendance_shift(
  uuid, uuid, uuid, date, timestamptz, timestamptz, public.attendance_status, integer, text
) to authenticated;

revoke all on function public.assign_temporary_worker_to_booking(
  uuid, uuid, date, time, numeric, text
) from public, anon, authenticated;
grant execute on function public.assign_temporary_worker_to_booking(
  uuid, uuid, date, time, numeric, text
) to authenticated;
