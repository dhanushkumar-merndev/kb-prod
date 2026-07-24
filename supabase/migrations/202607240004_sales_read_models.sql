-- RLS-safe sales read models. These functions authorize the caller once and
-- then execute tenant-scoped pagination inside the database. This avoids
-- evaluating nested RLS helpers hundreds of times for list/count requests.

create or replace function public.get_leads_page(
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
  v_result jsonb;
begin
  if p_page < 1 or p_page_size < 1 or p_page_size > 100
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

  with visible_leads as materialized (
    select l.*
    from public.leads l
    where l.organization_id = v_profile.organization_id
      and l.deleted_at is null
      and (
        v_profile.role in ('director', 'manager', 'sales_manager')
        or l.assigned_sales_profile_id = v_profile.id
      )
      and (
        v_search is null
        or l.client_name ilike '%' || v_search || '%'
        or l.phone_e164 ilike '%' || v_search || '%'
        or coalesce(l.source, '') ilike '%' || v_search || '%'
      )
  ),
  page_rows as (
    select
      l.id,
      l.client_name,
      l.phone_e164,
      l.source,
      l.requirement,
      l.event_date,
      l.guest_count,
      l.quote_amount,
      l.status,
      l.assigned_sales_profile_id,
      l.next_follow_up_at,
      l.notes,
      l.version,
      l.created_at,
      l.updated_at,
      l.last_activity_at
    from visible_leads l
    order by l.last_activity_at desc nulls last, l.id
    limit p_page_size
    offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from visible_leads),
    'rows', coalesce(
      (
        select jsonb_agg(
          to_jsonb(page_row) - 'last_activity_at'
          order by page_row.last_activity_at desc nulls last, page_row.id
        )
        from page_rows page_row
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.get_sales_operations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_result jsonb;
begin
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

  select jsonb_build_object(
    'leads',
    coalesce(
      (
        select jsonb_agg(to_jsonb(lead_row) - 'last_activity_at'
          order by lead_row.last_activity_at desc nulls last, lead_row.id)
        from (
          select
            l.id,
            l.client_name,
            l.phone_e164,
            l.status,
            l.assigned_sales_profile_id,
            l.version,
            l.last_activity_at
          from public.leads l
          where l.organization_id = v_profile.organization_id
            and l.deleted_at is null
            and (
              v_profile.role in ('director', 'manager', 'sales_manager')
              or l.assigned_sales_profile_id = v_profile.id
            )
          order by l.last_activity_at desc nulls last, l.id
          limit 100
        ) lead_row
      ),
      '[]'::jsonb
    ),
    'sales_profiles',
    coalesce(
      (
        select jsonb_agg(to_jsonb(profile_row) order by profile_row.full_name, profile_row.id)
        from (
          select p.id, p.full_name
          from public.profiles p
          where p.organization_id = v_profile.organization_id
            and p.role = 'sales'
            and p.account_status = 'active'
            and p.deleted_at is null
            and (v_profile.role <> 'sales' or p.id = v_profile.id)
          order by p.full_name, p.id
        ) profile_row
      ),
      '[]'::jsonb
    ),
    'follow_ups',
    coalesce(
      (
        select jsonb_agg(to_jsonb(follow_up_row) order by follow_up_row.due_at, follow_up_row.id)
        from (
          select
            f.id,
            f.lead_id,
            f.assigned_profile_id,
            f.due_at,
            f.status,
            f.outcome,
            f.completed_at,
            f.updated_at
          from public.follow_ups f
          where f.organization_id = v_profile.organization_id
            and (
              v_profile.role in ('director', 'manager', 'sales_manager')
              or f.assigned_profile_id = v_profile.id
            )
          order by f.due_at, f.id
          limit 150
        ) follow_up_row
      ),
      '[]'::jsonb
    ),
    'calls',
    coalesce(
      (
        select jsonb_agg(to_jsonb(call_row)
          order by call_row.started_at desc nulls last, call_row.id)
        from (
          select
            c.id,
            c.lead_id,
            c.direction,
            c.status,
            c.started_at,
            c.duration_seconds,
            c.agent_profile_id
          from public.superfone_calls c
          join public.leads l
            on l.id = c.lead_id
           and l.organization_id = c.organization_id
          where c.organization_id = v_profile.organization_id
            and l.deleted_at is null
            and (
              v_profile.role in ('director', 'manager', 'sales_manager')
              or l.assigned_sales_profile_id = v_profile.id
            )
          order by c.started_at desc nulls last, c.id
          limit 100
        ) call_row
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_leads_page(integer, integer, text)
  from public, anon;
grant execute on function public.get_leads_page(integer, integer, text)
  to authenticated, service_role;

revoke all on function public.get_sales_operations_snapshot()
  from public, anon;
grant execute on function public.get_sales_operations_snapshot()
  to authenticated, service_role;

