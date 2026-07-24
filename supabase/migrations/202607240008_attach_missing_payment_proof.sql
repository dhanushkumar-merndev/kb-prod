create or replace function public.attach_booking_payment_proof(
  p_payment_id uuid,
  p_proof_storage_path text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_payment public.booking_payments%rowtype;
  v_booking public.bookings%rowtype;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select * into v_actor from public.profiles
  where id = auth.uid() and account_status = 'active' and deleted_at is null;

  if not found or v_actor.role not in ('sales', 'sales_manager') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select * into v_payment from public.booking_payments
  where id = p_payment_id and organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_payment.proof_storage_path is not null then
    raise exception using errcode = '23505', message = 'PAYMENT_PROOF_ALREADY_ATTACHED';
  end if;

  select * into v_booking from public.bookings
  where id = v_payment.booking_id and organization_id = v_actor.organization_id
    and deleted_at is null;

  if not found or (v_actor.role = 'sales' and v_booking.sold_by_profile_id is distinct from v_actor.id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if not public.storage_path_is_structurally_safe(p_proof_storage_path)
     or split_part(p_proof_storage_path, '/', 1) <> v_actor.organization_id::text
     or split_part(p_proof_storage_path, '/', 2) <> v_actor.id::text
     or split_part(p_proof_storage_path, '/', 3) <> v_booking.id::text then
    raise exception using errcode = '22023', message = 'INVALID_STORAGE_PATH';
  end if;

  update public.booking_payments
  set proof_storage_path = p_proof_storage_path,
      verification_status = 'pending',
      rejection_reason = null,
      updated_at = now()
  where id = v_payment.id;

  perform public.write_audit_log(
    v_actor.organization_id, v_actor.id, 'booking_payment.proof_attached',
    'booking_payment', v_payment.id,
    jsonb_build_object('proof_storage_path', null),
    jsonb_build_object('proof_storage_path', p_proof_storage_path),
    'Missing payment proof attached', null
  );
end;
$$;

revoke all on function public.attach_booking_payment_proof(uuid, text)
  from public, anon, authenticated;
grant execute on function public.attach_booking_payment_proof(uuid, text)
  to authenticated;
