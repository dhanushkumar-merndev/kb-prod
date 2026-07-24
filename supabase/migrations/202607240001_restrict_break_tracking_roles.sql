-- Break tracking is an individual contributor workflow. Leadership roles use
-- login activity and operational dashboards rather than personal break timers.
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

  if v_actor.role not in ('sales', 'chef', 'part_time_chef') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
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

  if not found or v_actor.role not in ('sales', 'chef', 'part_time_chef') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

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

revoke all on function public.start_break_session(public.break_type)
  from public, anon, authenticated;
grant execute on function public.start_break_session(public.break_type)
  to authenticated;

revoke all on function public.end_break_session(uuid)
  from public, anon, authenticated;
grant execute on function public.end_break_session(uuid)
  to authenticated;
