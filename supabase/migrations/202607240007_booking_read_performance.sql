-- Fast, RLS-equivalent booking pagination. Authorize once, then keep every
-- booking and eligible-lead lookup scoped to the caller's organization.

create index if not exists bookings_org_event_page_idx
on public.bookings (organization_id, event_date desc, id)
where deleted_at is null;

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
      )
  ),
  page_rows as (
    select
      b.id,
      b.booking_code,
      b.lead_id,
      b.client_name,
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
      b.version
    from visible_bookings b
    order by b.event_date desc, b.id
    limit p_page_size
    offset v_offset
  )
  select
    (select count(*) from visible_bookings),
    coalesce(
      (select jsonb_agg(to_jsonb(page_rows) order by page_rows.event_date desc, page_rows.id)
       from page_rows),
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
        l.event_date,
        l.guest_count,
        l.quote_amount,
        l.updated_at
      from public.leads l
      where l.organization_id = v_profile.organization_id
        and l.deleted_at is null
        and l.status in ('qualified', 'booking_payment_pending', 'booking_in_process')
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

revoke all on function public.get_bookings_page(integer, integer, text) from public;
grant execute on function public.get_bookings_page(integer, integer, text) to authenticated;
