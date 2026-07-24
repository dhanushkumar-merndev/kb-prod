-- Conversation read performance for large lead queues. Authorize once per RPC
-- instead of re-running nested session/RLS helpers for every conversation/lead.

create or replace function public.get_conversation_inbox(
  p_search text default null,
  p_filter text default 'all',
  p_assigned_profile_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  lead_id uuid,
  contact_name text,
  contact_phone_e164 text,
  channel text,
  status public.conversation_status,
  last_message_at timestamptz,
  last_message_preview text,
  assigned_sales_profile_id uuid,
  assigned_sales_name text,
  unread_count bigint,
  failed_count bigint,
  version integer
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_search text := nullif(btrim(p_search), '');
  v_filter text := lower(coalesce(nullif(btrim(p_filter), ''), 'all'));
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

  if v_filter not in ('all', 'unread', 'unassigned', 'mine', 'open', 'pending', 'resolved', 'failed')
     or p_limit < 1
     or p_limit > 100
     or p_offset < 0
     or char_length(coalesce(p_search, '')) > 120 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  return query
  select
    c.id,
    c.lead_id,
    c.contact_name,
    c.contact_phone_e164,
    c.channel,
    c.status,
    c.last_message_at,
    c.last_message_preview,
    c.assigned_sales_profile_id,
    assignee.full_name,
    coalesce(unread.unread_count, 0),
    coalesce(failed.failed_count, 0),
    c.version
  from public.conversations c
  left join public.profiles assignee
    on assignee.id = c.assigned_sales_profile_id
   and assignee.organization_id = c.organization_id
  left join public.conversation_reads cr
    on cr.organization_id = c.organization_id
   and cr.conversation_id = c.id
   and cr.profile_id = v_profile.id
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages m
    where m.organization_id = c.organization_id
      and m.conversation_id = c.id
      and m.direction = 'inbound'
      and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz)
  ) unread on true
  left join lateral (
    select count(*)::bigint as failed_count
    from public.messages m
    where m.organization_id = c.organization_id
      and m.conversation_id = c.id
      and m.direction = 'outbound'
      and m.status = 'failed'
  ) failed on true
  where c.organization_id = v_profile.organization_id
    and (
      v_profile.role in ('director', 'manager', 'sales_manager')
      or c.assigned_sales_profile_id = v_profile.id
    )
    and (
      v_search is null
      or c.contact_name ilike '%' || v_search || '%'
      or c.contact_phone_e164 ilike '%' || v_search || '%'
    )
    and (
      p_assigned_profile_id is null
      or c.assigned_sales_profile_id = p_assigned_profile_id
    )
    and (
      v_filter = 'all'
      or (v_filter = 'unread' and coalesce(unread.unread_count, 0) > 0)
      or (v_filter = 'unassigned' and c.assigned_sales_profile_id is null)
      or (v_filter = 'mine' and c.assigned_sales_profile_id = v_profile.id)
      or (v_filter in ('open', 'pending', 'resolved') and c.status::text = v_filter)
      or (v_filter = 'failed' and coalesce(failed.failed_count, 0) > 0)
    )
  order by c.last_message_at desc nulls last, c.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.get_conversation_reference_data()
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
        select jsonb_agg(to_jsonb(lead_row)
          order by lead_row.last_activity_at desc nulls last, lead_row.id)
        from (
          select
            l.id,
            l.client_name,
            l.phone_e164,
            l.status,
            l.requirement,
            l.event_date,
            l.guest_count,
            l.quote_amount,
            l.last_activity_at
          from public.leads l
          where l.organization_id = v_profile.organization_id
            and l.deleted_at is null
            and (
              v_profile.role in ('director', 'manager', 'sales_manager')
              or l.assigned_sales_profile_id = v_profile.id
            )
            and exists (
              select 1
              from public.conversations c
              where c.organization_id = l.organization_id
                and c.lead_id = l.id
                and (
                  v_profile.role in ('director', 'manager', 'sales_manager')
                  or c.assigned_sales_profile_id = v_profile.id
                )
            )
          order by l.last_activity_at desc nulls last, l.id
          limit 150
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
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_conversation_reference_data()
  from public, anon;
grant execute on function public.get_conversation_reference_data()
  to authenticated, service_role;

