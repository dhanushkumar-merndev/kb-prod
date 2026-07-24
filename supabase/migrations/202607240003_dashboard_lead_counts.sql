-- Aggregate lead dashboard counts after one authenticated-session check.
-- Counting through the row policy evaluates the security helper for every lead
-- and can exceed the statement timeout once the sales queue grows.

create or replace function public.get_dashboard_lead_counts()
returns table (
  total_count bigint,
  new_count bigint,
  unassigned_count bigint,
  qualified_count bigint,
  booking_payment_pending_count bigint
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select p.*
  into v_profile
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null
    and o.is_active
    and public.current_auth_session_is_valid();

  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if v_profile.role not in ('director', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'AUTHORIZATION_FAILED';
  end if;

  return query
  select
    count(*)::bigint,
    count(*) filter (where l.status = 'new')::bigint,
    count(*) filter (where l.assigned_sales_profile_id is null)::bigint,
    count(*) filter (where l.status = 'qualified')::bigint,
    count(*) filter (where l.status = 'booking_payment_pending')::bigint
  from public.leads l
  where l.organization_id = v_profile.organization_id
    and l.deleted_at is null
    and (
      v_profile.role in ('director', 'manager', 'sales_manager')
      or l.assigned_sales_profile_id = v_profile.id
    );
end;
$$;

revoke all on function public.get_dashboard_lead_counts() from public, anon;
grant execute on function public.get_dashboard_lead_counts() to authenticated, service_role;

