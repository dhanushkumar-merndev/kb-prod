-- Khana Banao CRM: auditable payment verification and booking payment rollup.

create or replace function public.review_booking_payment(
  p_payment_id uuid,
  p_decision public.verification_status,
  p_rejection_reason text default null
)
returns table (
  payment_id uuid,
  verification_status public.verification_status,
  booking_id uuid,
  booking_payment_status public.booking_payment_status,
  booking_service_status public.booking_service_status
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.booking_payments%rowtype;
  v_payment public.booking_payments%rowtype;
  v_booking_before public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_verified_total numeric(12,2);
  v_payment_status public.booking_payment_status;
  v_service_status public.booking_service_status;
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

  if not found or v_actor.role not in ('director', 'manager', 'sales_manager') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_decision not in ('verified', 'rejected')
     or (
       p_decision = 'rejected'
       and nullif(btrim(p_rejection_reason), '') is null
     ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select bp.*
  into v_before
  from public.booking_payments bp
  where bp.id = p_payment_id
    and bp.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.verification_status <> 'pending' then
    raise exception using errcode = '22023', message = 'PAYMENT_ALREADY_REVIEWED';
  end if;

  update public.booking_payments bp
  set
    verification_status = p_decision,
    verified_by_profile_id = v_actor.id,
    verified_at = now(),
    rejection_reason = case
      when p_decision = 'rejected' then btrim(p_rejection_reason)
      else null
    end
  where bp.id = v_before.id
    and bp.organization_id = v_actor.organization_id
  returning bp.* into v_payment;

  select b.*
  into strict v_booking_before
  from public.bookings b
  where b.id = v_payment.booking_id
    and b.organization_id = v_actor.organization_id
    and b.deleted_at is null
  for update;

  select coalesce(sum(
    case
      when bp.payment_stage = 'refund' then -bp.amount
      else bp.amount
    end
  ), 0)
  into v_verified_total
  from public.booking_payments bp
  where bp.organization_id = v_actor.organization_id
    and bp.booking_id = v_booking_before.id
    and bp.verification_status = 'verified';

  v_payment_status := case
    when v_verified_total >= v_booking_before.total_value
      then 'fully_paid'::public.booking_payment_status
    when v_verified_total > 0
      then 'partial'::public.booking_payment_status
    else 'unpaid'::public.booking_payment_status
  end;

  v_service_status := case
    when p_decision = 'verified'
      and v_booking_before.service_status = 'pending'
      and v_verified_total > 0
    then 'confirmed'
    when v_booking_before.service_status = 'service_completed'
      and v_payment_status = 'fully_paid'
    then 'fully_completed'
    else v_booking_before.service_status
  end;

  update public.bookings b
  set
    payment_status = v_payment_status,
    service_status = v_service_status,
    fully_completed_at = case
      when v_service_status = 'fully_completed'
      then coalesce(b.fully_completed_at, now())
      else b.fully_completed_at
    end
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
      case
        when v_booking.service_status = 'confirmed'
          then 'Verified payment confirmed booking'
        else 'Service complete and verified balance fully paid'
      end
    );
  end if;

  if v_booking.service_status = 'fully_completed' and v_booking.lead_id is not null then
    update public.leads
    set
      status = 'won',
      last_activity_at = now()
    where id = v_booking.lead_id
      and organization_id = v_actor.organization_id
      and deleted_at is null;
  end if;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'booking_payment.reviewed',
    'booking_payment',
    v_payment.id,
    jsonb_build_object(
      'verification_status', v_before.verification_status,
      'booking_payment_status', v_booking_before.payment_status
    ),
    jsonb_build_object(
      'verification_status', v_payment.verification_status,
      'booking_payment_status', v_booking.payment_status,
      'booking_service_status', v_booking.service_status
    ),
    case
      when p_decision = 'rejected' then btrim(p_rejection_reason)
      else 'Payment proof verified'
    end,
    null
  );

  return query
  select
    v_payment.id,
    v_payment.verification_status,
    v_booking.id,
    v_booking.payment_status,
    v_booking.service_status;
end;
$$;

revoke all on function public.review_booking_payment(
  uuid,
  public.verification_status,
  text
) from public, anon, authenticated;
grant execute on function public.review_booking_payment(
  uuid,
  public.verification_status,
  text
) to authenticated;
