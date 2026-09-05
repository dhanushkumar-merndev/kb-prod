-- A locked payroll period is final. Reversal previously checked only the entry
-- status, so a paid entry inside a locked period could still be reversed.
create or replace function public.reverse_payroll_entry(
  p_payroll_entry_id uuid,
  p_reason text
)
returns table (
  payroll_entry_id uuid,
  status public.payroll_entry_status,
  reversed_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.payroll_entries%rowtype;
  v_after public.payroll_entries%rowtype;
  v_reason text;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found or v_actor.role <> 'director' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select pe.* into v_before
  from public.payroll_entries pe
  where pe.id = p_payroll_entry_id
    and pe.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status <> 'paid' then
    raise exception using errcode = '40001', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  if exists (
    select 1
    from public.payroll_periods pp
    where pp.id = v_before.payroll_period_id
      and pp.organization_id = v_before.organization_id
      and pp.status = 'locked'
  ) then
    raise exception using errcode = '42501', message = 'PAYROLL_PERIOD_LOCKED';
  end if;

  update public.payroll_entries pe
  set
    status = 'reversed',
    reversed_at = now(),
    reversed_by_profile_id = v_actor.id,
    reversal_reason = v_reason
  where pe.id = v_before.id
  returning pe.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.entry_reversed',
    'payroll_entry',
    v_after.id,
    jsonb_build_object(
      'status', v_before.status,
      'net_payable', v_before.net_payable,
      'paid_at', v_before.paid_at,
      'payment_reference', v_before.payment_reference
    ),
    jsonb_build_object(
      'status', v_after.status,
      'net_payable', v_after.net_payable,
      'reversed_at', v_after.reversed_at
    ),
    v_reason,
    null
  );

  return query select v_after.id, v_after.status, v_after.reversed_at;
end;
$$;

notify pgrst, 'reload schema';
