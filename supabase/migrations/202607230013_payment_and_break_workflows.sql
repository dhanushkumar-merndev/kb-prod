-- Khana Banao CRM: close remaining direct-write gaps for payment submissions
-- and staff break sessions.

create unique index if not exists booking_payment_transaction_reference_unique
on public.booking_payments (organization_id, lower(transaction_reference))
where nullif(btrim(transaction_reference), '') is not null;

create or replace function public.submit_booking_payment(
  p_booking_id uuid,
  p_payment_stage public.booking_payment_stage,
  p_amount numeric,
  p_payment_method text,
  p_transaction_reference text,
  p_proof_storage_path text
)
returns table (
  payment_id uuid,
  booking_id uuid,
  verification_status public.verification_status
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_booking public.bookings%rowtype;
  v_payment public.booking_payments%rowtype;
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

  if p_payment_stage is null
     or p_payment_stage = 'refund'
     or p_amount is null
     or p_amount <= 0
     or p_amount > 9999999999.99
     or char_length(coalesce(btrim(p_payment_method), '')) not between 2 and 100
     or char_length(coalesce(btrim(p_transaction_reference), '')) > 200
     or nullif(btrim(p_proof_storage_path), '') is null
     or not public.storage_path_is_structurally_safe(p_proof_storage_path) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select b.*
  into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null
  for update;

  if not found
     or (
       v_actor.role = 'sales'
       and v_booking.sold_by_profile_id is distinct from v_actor.id
     )
     or v_booking.service_status = 'cancelled' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if split_part(p_proof_storage_path, '/', 1) <> v_actor.organization_id::text
     or split_part(p_proof_storage_path, '/', 2) <> v_actor.id::text
     or split_part(p_proof_storage_path, '/', 3) <> v_booking.id::text then
    raise exception using errcode = '22023', message = 'INVALID_STORAGE_PATH';
  end if;

  insert into public.booking_payments (
    organization_id,
    booking_id,
    payment_stage,
    amount,
    payment_method,
    transaction_reference,
    proof_storage_path,
    submitted_by_profile_id,
    verification_status,
    paid_at
  )
  values (
    v_actor.organization_id,
    v_booking.id,
    p_payment_stage,
    p_amount,
    btrim(p_payment_method),
    nullif(btrim(p_transaction_reference), ''),
    btrim(p_proof_storage_path),
    v_actor.id,
    'pending',
    now()
  )
  returning * into v_payment;

  if v_booking.lead_id is not null then
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
      v_booking.lead_id,
      v_actor.id,
      'payment_proof',
      'Payment proof submitted for ' || v_booking.booking_code,
      jsonb_build_object(
        'booking_id', v_booking.id,
        'payment_id', v_payment.id,
        'payment_stage', v_payment.payment_stage,
        'amount', v_payment.amount
      )
    );
  end if;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'booking_payment.submitted',
    'booking_payment',
    v_payment.id,
    null,
    jsonb_build_object(
      'booking_id', v_payment.booking_id,
      'payment_stage', v_payment.payment_stage,
      'amount', v_payment.amount,
      'verification_status', v_payment.verification_status,
      'proof_storage_path', v_payment.proof_storage_path
    ),
    'Customer payment proof submitted',
    null
  );

  return query
  select v_payment.id, v_payment.booking_id, v_payment.verification_status;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'PAYMENT_REFERENCE_DUPLICATE';
end;
$$;

create or replace function public.start_break_session(
  p_break_type public.break_type
)
returns table (
  break_session_id uuid,
  break_type public.break_type,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_break public.break_sessions%rowtype;
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

  if not found or p_break_type is null then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if exists (
    select 1
    from public.break_sessions bs
    where bs.organization_id = v_actor.organization_id
      and bs.profile_id = v_actor.id
      and bs.ended_at is null
  ) then
    raise exception using errcode = '23505', message = 'BREAK_ALREADY_OPEN';
  end if;

  insert into public.break_sessions (
    organization_id,
    profile_id,
    break_type
  )
  values (
    v_actor.organization_id,
    v_actor.id,
    p_break_type
  )
  returning * into v_break;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'break.started',
    'break_session',
    v_break.id,
    null,
    jsonb_build_object(
      'break_type', v_break.break_type,
      'started_at', v_break.started_at
    ),
    'Staff break started',
    null
  );

  return query
  select v_break.id, v_break.break_type, v_break.started_at;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'BREAK_ALREADY_OPEN';
end;
$$;

create or replace function public.end_break_session(
  p_break_session_id uuid
)
returns table (
  break_session_id uuid,
  break_type public.break_type,
  started_at timestamptz,
  ended_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.break_sessions%rowtype;
  v_break public.break_sessions%rowtype;
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

  select bs.*
  into v_before
  from public.break_sessions bs
  where bs.id = p_break_session_id
    and bs.organization_id = v_actor.organization_id
    and bs.profile_id = v_actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.ended_at is not null then
    raise exception using errcode = '22023', message = 'BREAK_ALREADY_ENDED';
  end if;

  update public.break_sessions bs
  set ended_at = now()
  where bs.id = v_before.id
  returning * into v_break;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'break.ended',
    'break_session',
    v_break.id,
    jsonb_build_object(
      'break_type', v_before.break_type,
      'started_at', v_before.started_at,
      'ended_at', v_before.ended_at
    ),
    jsonb_build_object(
      'break_type', v_break.break_type,
      'started_at', v_break.started_at,
      'ended_at', v_break.ended_at
    ),
    'Staff break ended',
    null
  );

  return query
  select v_break.id, v_break.break_type, v_break.started_at, v_break.ended_at;
end;
$$;

revoke insert, update on public.booking_payments from authenticated;
revoke insert, update on public.break_sessions from authenticated;

revoke all on function public.submit_booking_payment(
  uuid,
  public.booking_payment_stage,
  numeric,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.submit_booking_payment(
  uuid,
  public.booking_payment_stage,
  numeric,
  text,
  text,
  text
) to authenticated;

revoke all on function public.start_break_session(public.break_type)
  from public, anon, authenticated;
grant execute on function public.start_break_session(public.break_type)
  to authenticated;

revoke all on function public.end_break_session(uuid)
  from public, anon, authenticated;
grant execute on function public.end_break_session(uuid)
  to authenticated;
