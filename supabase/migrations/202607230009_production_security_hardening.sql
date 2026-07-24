-- Khana Banao CRM: cross-cutting production security hardening.
--
-- This migration intentionally invalidates legacy application-session rows.
-- New rows are bound to the Supabase Auth session that opened them, enforce a
-- 12-hour inactivity timeout, and enforce a seven-day absolute lifetime.

alter table public.login_sessions
  add column auth_session_id uuid;

update public.login_sessions
set
  logout_at = coalesce(logout_at, now()),
  logout_reason = coalesce(logout_reason, 'security_migration_reauthentication_required')
where logout_at is null;

delete from auth.sessions auth_session
using public.profiles profile
where auth_session.user_id = profile.id;

alter table public.login_sessions
  add constraint login_sessions_active_auth_session_check
  check (logout_at is not null or auth_session_id is not null);

create unique index login_sessions_auth_session_unique
  on public.login_sessions (auth_session_id)
  where auth_session_id is not null;

create unique index one_active_app_session_per_profile
  on public.login_sessions (organization_id, profile_id)
  where logout_at is null;

create index login_sessions_auth_validation_idx
  on public.login_sessions (
    profile_id,
    auth_session_id,
    session_version,
    login_at,
    last_seen_at
  )
  where logout_at is null;

create or replace function public.current_supabase_auth_session_is_valid()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select case
    when auth.role() = 'service_role' then true
    when auth.uid() is null or nullif(auth.jwt() ->> 'session_id', '') is null then false
    else exists (
      select 1
      from auth.sessions s
      where s.user_id = auth.uid()
        and s.id::text = auth.jwt() ->> 'session_id'
    )
  end;
$$;

create or replace function public.current_auth_session_is_valid()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select case
    when auth.role() = 'service_role' then true
    when not public.current_supabase_auth_session_is_valid() then false
    else exists (
      select 1
      from public.login_sessions ls
      join public.profiles p
        on p.id = ls.profile_id
       and p.organization_id = ls.organization_id
      join public.organizations o
        on o.id = p.organization_id
      where ls.profile_id = auth.uid()
        and ls.auth_session_id::text = auth.jwt() ->> 'session_id'
        and ls.session_version = p.session_version
        and ls.logout_at is null
        and ls.login_at >= now() - interval '7 days'
        and ls.last_seen_at >= now() - interval '12 hours'
        and p.account_status = 'active'
        and p.deleted_at is null
        and o.is_active
    )
  end;
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p.id
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null
    and public.current_auth_session_is_valid()
  limit 1;
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null
    and public.current_auth_session_is_valid()
  limit 1;
$$;

create or replace function public.current_role()
returns public.profile_role
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null
    and public.current_auth_session_is_valid()
  limit 1;
$$;

create or replace function public.get_my_auth_context()
returns table (
  id uuid,
  organization_id uuid,
  full_name text,
  phone_e164 text,
  role public.profile_role,
  account_status public.account_status,
  session_version integer
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    p.id,
    p.organization_id,
    p.full_name,
    p.phone_e164,
    p.role,
    p.account_status,
    p.session_version
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null
    and public.current_supabase_auth_session_is_valid()
  limit 1;
$$;

create or replace function public.open_login_session(
  p_session_code text,
  p_user_agent_safe text default null,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_session public.login_sessions%rowtype;
  v_auth_session_id uuid;
  v_closed_count integer := 0;
begin
  if auth.uid() is null
     or nullif(auth.jwt() ->> 'session_id', '') is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if nullif(btrim(p_session_code), '') is null
     or char_length(p_session_code) < 16
     or char_length(p_session_code) > 256 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  -- Serialize competing sign-ins before invalidating the prior Auth/app pair.
  perform pg_advisory_xact_lock(hashtextextended('login:' || auth.uid()::text, 0));

  select s.id
  into v_auth_session_id
  from auth.sessions s
  where s.user_id = auth.uid()
    and s.id::text = auth.jwt() ->> 'session_id'
  for update;

  if v_auth_session_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null
    and o.is_active
  for update of p;

  if not found then
    raise exception using errcode = '42501', message = 'ACCOUNT_INACTIVE';
  end if;

  if exists (
    select 1
    from public.login_sessions ls
    where ls.auth_session_id = v_auth_session_id
  ) then
    raise exception using errcode = '42501', message = 'AUTH_SESSION_ALREADY_BOUND';
  end if;

  update public.login_sessions
  set
    logout_at = now(),
    logout_reason = 'superseded_by_new_login'
  where profile_id = v_profile.id
    and logout_at is null;

  get diagnostics v_closed_count = row_count;

  -- A user has one live Supabase Auth session as well as one application row.
  -- The currently authenticated session is retained so this transaction can
  -- create its bound application session.
  delete from auth.sessions
  where user_id = v_profile.id
    and id <> v_auth_session_id;

  insert into public.login_sessions (
    organization_id,
    profile_id,
    session_code,
    session_version,
    auth_session_id,
    user_agent_safe,
    ip_hash
  )
  values (
    v_profile.organization_id,
    v_profile.id,
    p_session_code,
    v_profile.session_version,
    v_auth_session_id,
    left(nullif(btrim(p_user_agent_safe), ''), 300),
    left(nullif(btrim(p_ip_hash), ''), 128)
  )
  returning * into v_session;

  update public.profiles
  set last_login_at = now()
  where id = v_profile.id;

  perform public.write_audit_log(
    v_profile.organization_id,
    v_profile.id,
    'session.opened',
    'login_session',
    v_session.id,
    null,
    jsonb_build_object(
      'session_version', v_session.session_version,
      'prior_sessions_closed', v_closed_count,
      'maximum_lifetime_hours', 168,
      'inactivity_timeout_hours', 12
    ),
    'Authenticated application session opened'
  );

  return jsonb_build_object(
    'id', v_session.id,
    'session_code', v_session.session_code,
    'session_version', v_session.session_version,
    'login_at', v_session.login_at
  );
end;
$$;

create or replace function public.validate_login_session(
  p_session_code text,
  p_session_version integer
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_expired_count integer := 0;
  v_valid boolean := false;
begin
  if auth.uid() is null
     or not public.current_supabase_auth_session_is_valid()
     or nullif(p_session_code, '') is null
     or p_session_version is null then
    return false;
  end if;

  select p.*
  into v_profile
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null
    and o.is_active;

  if not found then
    return false;
  end if;

  update public.login_sessions ls
  set
    logout_at = now(),
    logout_reason = case
      when ls.session_version <> v_profile.session_version
        or ls.session_version <> p_session_version
      then 'session_version_mismatch'
      when ls.login_at < now() - interval '7 days'
      then 'session_max_lifetime_exceeded'
      else 'session_inactivity_timeout'
    end
  where ls.profile_id = v_profile.id
    and ls.organization_id = v_profile.organization_id
    and ls.session_code = p_session_code
    and ls.auth_session_id::text = auth.jwt() ->> 'session_id'
    and ls.logout_at is null
    and (
      ls.session_version <> v_profile.session_version
      or ls.session_version <> p_session_version
      or ls.login_at < now() - interval '7 days'
      or ls.last_seen_at < now() - interval '12 hours'
    );

  get diagnostics v_expired_count = row_count;

  if v_expired_count > 0 then
    perform public.write_audit_log(
      v_profile.organization_id,
      v_profile.id,
      'session.expired',
      'login_session',
      null,
      null,
      jsonb_build_object('session_version', p_session_version),
      'Application session exceeded its validity window'
    );

    delete from auth.sessions
    where user_id = v_profile.id
      and id::text = auth.jwt() ->> 'session_id';

    return false;
  end if;

  select exists (
    select 1
    from public.login_sessions ls
    where ls.profile_id = v_profile.id
      and ls.organization_id = v_profile.organization_id
      and ls.session_code = p_session_code
      and ls.auth_session_id::text = auth.jwt() ->> 'session_id'
      and ls.session_version = p_session_version
      and ls.session_version = v_profile.session_version
      and ls.logout_at is null
      and ls.login_at >= now() - interval '7 days'
      and ls.last_seen_at >= now() - interval '12 hours'
  )
  into v_valid;

  return v_valid;
end;
$$;

create or replace function public.touch_login_session(p_session_code text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_updated integer := 0;
begin
  if auth.uid() is null
     or not public.current_supabase_auth_session_is_valid()
     or nullif(p_session_code, '') is null then
    return false;
  end if;

  select p.*
  into v_profile
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null
    and o.is_active;

  if not found then
    return false;
  end if;

  update public.login_sessions ls
  set
    logout_at = now(),
    logout_reason = case
      when ls.login_at < now() - interval '7 days'
      then 'session_max_lifetime_exceeded'
      else 'session_inactivity_timeout'
    end
  where ls.profile_id = v_profile.id
    and ls.organization_id = v_profile.organization_id
    and ls.session_code = p_session_code
    and ls.auth_session_id::text = auth.jwt() ->> 'session_id'
    and ls.logout_at is null
    and (
      ls.login_at < now() - interval '7 days'
      or ls.last_seen_at < now() - interval '12 hours'
    );

  get diagnostics v_updated = row_count;
  if v_updated > 0 then
    delete from auth.sessions
    where user_id = v_profile.id
      and id::text = auth.jwt() ->> 'session_id';

    return false;
  end if;

  update public.login_sessions ls
  set last_seen_at = now()
  where ls.profile_id = v_profile.id
    and ls.organization_id = v_profile.organization_id
    and ls.session_code = p_session_code
    and ls.auth_session_id::text = auth.jwt() ->> 'session_id'
    and ls.session_version = v_profile.session_version
    and ls.logout_at is null
    and ls.login_at >= now() - interval '7 days'
    and ls.last_seen_at >= now() - interval '12 hours';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.close_login_session(
  p_session_code text,
  p_reason text default 'user_logout'
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_session_id uuid;
  v_auth_session_id uuid;
  v_reason text;
begin
  if auth.uid() is null or not public.current_supabase_auth_session_is_valid() then
    return false;
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null;

  if not found then
    return false;
  end if;

  v_reason := left(coalesce(nullif(btrim(p_reason), ''), 'user_logout'), 120);

  update public.login_sessions ls
  set
    logout_at = now(),
    logout_reason = v_reason
  where ls.profile_id = v_profile.id
    and ls.organization_id = v_profile.organization_id
    and ls.session_code = p_session_code
    and ls.auth_session_id::text = auth.jwt() ->> 'session_id'
    and ls.logout_at is null
  returning ls.id, ls.auth_session_id
  into v_session_id, v_auth_session_id;

  if v_session_id is null then
    return false;
  end if;

  perform public.write_audit_log(
    v_profile.organization_id,
    v_profile.id,
    'session.closed',
    'login_session',
    v_session_id,
    null,
    jsonb_build_object('reason', v_reason),
    v_reason
  );

  delete from auth.sessions
  where user_id = v_profile.id
    and id = v_auth_session_id;

  return true;
end;
$$;

create or replace function public.close_all_my_login_sessions(
  p_reason text default 'user_logout_all_devices'
)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_closed_count integer := 0;
  v_reason text;
begin
  if auth.uid() is null or not public.current_supabase_auth_session_is_valid() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null;

  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_reason := left(
    coalesce(nullif(btrim(p_reason), ''), 'user_logout_all_devices'),
    120
  );

  update public.login_sessions
  set
    logout_at = now(),
    logout_reason = v_reason
  where profile_id = v_profile.id
    and organization_id = v_profile.organization_id
    and logout_at is null;

  get diagnostics v_closed_count = row_count;

  perform public.write_audit_log(
    v_profile.organization_id,
    v_profile.id,
    'session.closed_all',
    'login_session',
    null,
    null,
    jsonb_build_object('closed_session_count', v_closed_count),
    v_reason
  );

  delete from auth.sessions
  where user_id = v_profile.id;

  return v_closed_count;
end;
$$;

-- Session rows are mutated only through the security-definer RPCs. In
-- particular, users and Managers must never be able to read reusable session
-- codes while viewing login activity.
revoke select, insert, update, delete, truncate
  on public.login_sessions from authenticated;
grant select (
  id,
  organization_id,
  profile_id,
  session_version,
  login_at,
  last_seen_at,
  logout_at,
  logout_reason,
  user_agent_safe,
  ip_hash,
  created_at,
  updated_at
) on public.login_sessions to authenticated;

revoke all on function public.current_supabase_auth_session_is_valid()
  from public, anon, authenticated;
grant execute on function public.current_supabase_auth_session_is_valid()
  to service_role;

revoke all on function public.open_login_session(text, text, text)
  from public, anon, authenticated;
grant execute on function public.open_login_session(text, text, text)
  to authenticated;

revoke all on function public.validate_login_session(text, integer)
  from public, anon, authenticated;
grant execute on function public.validate_login_session(text, integer)
  to authenticated;

revoke all on function public.touch_login_session(text)
  from public, anon, authenticated;
grant execute on function public.touch_login_session(text)
  to authenticated;

revoke all on function public.close_login_session(text, text)
  from public, anon, authenticated;
grant execute on function public.close_login_session(text, text)
  to authenticated;

revoke all on function public.close_all_my_login_sessions(text)
  from public, anon, authenticated;
grant execute on function public.close_all_my_login_sessions(text)
  to authenticated;

-- A Manager operates below the Director and cannot enumerate Director profile
-- details, Director sessions, or Director audit actions.
drop policy profiles_select_scoped on public.profiles;
create policy profiles_select_scoped
on public.profiles for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and deleted_at is null
  and (
    id = public.current_profile_id()
    or public.current_role() = 'director'
    or (public.current_role() = 'manager' and role <> 'director')
    or (public.current_role() = 'hr' and role in ('chef', 'part_time_chef'))
    or (public.current_role() = 'sales_manager' and role = 'sales')
  )
);

drop policy role_history_select_scoped on public.role_assignment_history;
create policy role_history_select_scoped
on public.role_assignment_history for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or public.current_role() = 'director'
    or (public.current_role() = 'manager' and role <> 'director')
    or (public.current_role() = 'hr' and public.is_workforce_profile(profile_id))
    or (public.current_role() = 'sales_manager' and public.is_sales_profile(profile_id))
  )
);

drop policy login_sessions_select_own_or_admin on public.login_sessions;
create policy login_sessions_select_own_or_admin
on public.login_sessions for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or public.current_role() = 'director'
    or (
      public.current_role() = 'manager'
      and exists (
        select 1
        from public.profiles target
        where target.id = public.login_sessions.profile_id
          and target.organization_id = public.login_sessions.organization_id
          and target.role <> 'director'
      )
    )
  )
);

drop policy audit_logs_select_scoped on public.audit_logs;
create policy audit_logs_select_scoped
on public.audit_logs for select to authenticated
using (
  public.can_read_audit_log(id)
  and (
    public.current_role() <> 'manager'
    or (
      entity_type not in (
        'organization',
        'organization_setting',
        'organization_secret',
        'integration_connection',
        'integration_event',
        'integration_sync_run'
      )
      and not exists (
        select 1
        from public.profiles actor
        where actor.id = public.audit_logs.actor_profile_id
          and actor.organization_id = public.audit_logs.organization_id
          and actor.role = 'director'
      )
      and not (
        entity_type in ('profile', 'role_assignment')
        and exists (
          select 1
          from public.profiles target
          where target.id = public.audit_logs.entity_id
            and target.organization_id = public.audit_logs.organization_id
            and target.role = 'director'
        )
      )
    )
  )
);

-- Keep the same-tenant foreign keys and add invariants that a service-role bug
-- must not be able to bypass.
create unique index one_active_director_per_org
  on public.profiles (organization_id)
  where role = 'director' and account_status = 'active' and deleted_at is null;

with ranked as (
  select
    lah.id,
    row_number() over (
      partition by lah.organization_id, lah.lead_id
      order by lah.assigned_at desc, lah.id desc
    ) as assignment_rank
  from public.lead_assignment_history lah
  where lah.unassigned_at is null
)
update public.lead_assignment_history lah
set
  unassigned_at = greatest(lah.assigned_at, now()),
  reason = concat_ws(
    '; ',
    nullif(lah.reason, ''),
    'Closed duplicate active assignment during security migration'
  )
from ranked r
where r.id = lah.id
  and r.assignment_rank > 1;

create unique index one_active_lead_assignment
  on public.lead_assignment_history (organization_id, lead_id)
  where unassigned_at is null;

with ranked as (
  select
    ca.id,
    row_number() over (
      partition by ca.organization_id, ca.conversation_id
      order by ca.assigned_at desc, ca.id desc
    ) as assignment_rank
  from public.conversation_assignments ca
  where ca.unassigned_at is null
)
update public.conversation_assignments ca
set
  unassigned_at = greatest(ca.assigned_at, now()),
  reason = concat_ws(
    '; ',
    nullif(ca.reason, ''),
    'Closed duplicate active assignment during security migration'
  )
from ranked r
where r.id = ca.id
  and r.assignment_rank > 1;

create unique index one_active_conversation_assignment
  on public.conversation_assignments (organization_id, conversation_id)
  where unassigned_at is null;

create unique index provider_conversation_unique
  on public.conversations (organization_id, provider, provider_conversation_id)
  where provider_conversation_id is not null;

create unique index provider_message_event_unique
  on public.messages (organization_id, provider, provider_event_id)
  where provider_event_id is not null;

create index conversation_reads_profile_idx
  on public.conversation_reads (organization_id, profile_id, last_read_at desc);

create index expenses_submitter_status_idx
  on public.expenses (organization_id, submitted_by_profile_id, status, created_at desc);

create index expenses_booking_idx
  on public.expenses (organization_id, booking_id, created_at desc)
  where booking_id is not null;

create index leave_requests_profile_dates_idx
  on public.leave_requests (organization_id, profile_id, start_date desc, end_date);

create index meeting_attendees_profile_idx
  on public.meeting_attendees (organization_id, profile_id, created_at desc);

create index announcement_recipients_profile_idx
  on public.announcement_recipients (organization_id, profile_id, created_at desc);

create index payroll_entries_temp_worker_status_idx
  on public.payroll_entries (
    organization_id,
    temporary_worker_id,
    status,
    payroll_period_id
  )
  where temporary_worker_id is not null;

alter table public.booking_payments
  add constraint booking_payments_positive_amount_check
  check (amount > 0);

alter table public.booking_payments
  add constraint booking_payments_proof_required_check
  check (
    payment_stage = 'refund'
    or nullif(btrim(proof_storage_path), '') is not null
  );

alter table public.expense_attachments
  add constraint expense_attachments_supported_file_check
  check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and size_bytes <= 10485760
  );

alter table public.messages
  add constraint messages_provider_state_timestamp_check
  check (
    (status <> 'delivered' or delivered_at is not null)
    and (status <> 'read' or read_at is not null)
    and (status <> 'failed' or failed_at is not null)
  );

create or replace function public.validate_profile_hierarchy()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_expected_parent_role public.profile_role;
  v_payment_proof_required boolean;
begin
  if new.account_status = 'payment_pending' and new.role <> 'part_time_chef' then
    raise exception using errcode = '23514', message = 'INVALID_ACCOUNT_STATUS_FOR_ROLE';
  end if;

  if new.role = 'director' then
    if new.reports_to_profile_id is not null then
      raise exception using errcode = '23514', message = 'INVALID_REPORTING_HIERARCHY';
    end if;
  else
    v_expected_parent_role := case new.role
      when 'manager' then 'director'::public.profile_role
      when 'hr' then 'manager'::public.profile_role
      when 'sales_manager' then 'manager'::public.profile_role
      when 'sales' then 'sales_manager'::public.profile_role
      when 'chef' then 'hr'::public.profile_role
      when 'part_time_chef' then 'hr'::public.profile_role
    end;

    if new.reports_to_profile_id is null
       or not exists (
         select 1
         from public.profiles parent
         where parent.id = new.reports_to_profile_id
           and parent.organization_id = new.organization_id
           and parent.role = v_expected_parent_role
           and parent.account_status = 'active'
           and parent.deleted_at is null
       ) then
      raise exception using errcode = '23514', message = 'INVALID_REPORTING_HIERARCHY';
    end if;
  end if;

  if new.role = 'part_time_chef' and new.account_status = 'active' then
    select os.part_time_payment_proof_required
    into strict v_payment_proof_required
    from public.organization_settings os
    where os.organization_id = new.organization_id;

    if v_payment_proof_required
       and nullif(btrim(new.part_time_payment_proof_path), '') is null then
      raise exception using errcode = '23514', message = 'PAYMENT_PROOF_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_validate_hierarchy
before insert or update of
  organization_id,
  role,
  reports_to_profile_id,
  account_status,
  part_time_payment_proof_path
on public.profiles
for each row execute function public.validate_profile_hierarchy();

-- Storage object names use exactly four safe path components. This prevents
-- ambiguous names and keeps every policy aligned with the normalized metadata.
create or replace function public.storage_path_is_structurally_safe(p_name text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_name is not null
    and octet_length(p_name) between 1 and 1024
    and array_length(string_to_array(p_name, '/'), 1) = 4
    and p_name !~ '[[:cntrl:]]'
    and position(chr(92) in p_name) = 0
    and split_part(p_name, '/', 1) not in ('', '.', '..')
    and split_part(p_name, '/', 2) not in ('', '.', '..')
    and split_part(p_name, '/', 3) not in ('', '.', '..')
    and split_part(p_name, '/', 4) not in ('', '.', '..');
$$;

create or replace function public.storage_path_is_current_organization(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile()
    and public.storage_path_is_structurally_safe(p_name)
    and split_part(p_name, '/', 1) = public.current_organization_id()::text
  ;
$$;

alter table public.profiles
  add constraint profiles_employee_storage_path_structure_check
  check (
    (
      aadhaar_storage_path is null
      or (
        public.storage_path_is_structurally_safe(aadhaar_storage_path)
        and split_part(aadhaar_storage_path, '/', 1) = organization_id::text
        and split_part(aadhaar_storage_path, '/', 2) = id::text
        and split_part(aadhaar_storage_path, '/', 3) = 'aadhaar'
      )
    )
    and (
      part_time_payment_proof_path is null
      or (
        public.storage_path_is_structurally_safe(part_time_payment_proof_path)
        and split_part(part_time_payment_proof_path, '/', 1) = organization_id::text
        and split_part(part_time_payment_proof_path, '/', 2) = id::text
        and split_part(part_time_payment_proof_path, '/', 3) =
          'part-time-payment-proof'
      )
    )
  );

alter table public.booking_payments
  add constraint booking_payments_storage_path_structure_check
  check (
    proof_storage_path is null
    or (
      public.storage_path_is_structurally_safe(proof_storage_path)
      and split_part(proof_storage_path, '/', 1) = organization_id::text
      and split_part(proof_storage_path, '/', 2) = submitted_by_profile_id::text
      and split_part(proof_storage_path, '/', 3) = booking_id::text
    )
  );

alter table public.expense_attachments
  add constraint expense_attachments_storage_path_structure_check
  check (public.storage_path_is_structurally_safe(storage_path));

alter table public.messages
  add constraint messages_storage_path_structure_check
  check (
    attachment_storage_path is null
    or (
      public.storage_path_is_structurally_safe(attachment_storage_path)
      and split_part(attachment_storage_path, '/', 1) = organization_id::text
      and split_part(attachment_storage_path, '/', 2) = conversation_id::text
      and (
        (
          direction in ('outbound', 'internal')
          and sender_profile_id is not null
          and split_part(attachment_storage_path, '/', 3) =
            sender_profile_id::text
        )
        or (
          direction = 'inbound'
          and split_part(attachment_storage_path, '/', 3) = 'provider'
        )
      )
    )
  );

drop policy if exists employee_private_update_hr_scope on storage.objects;

drop policy expense_bills_insert_submitter on storage.objects;
create policy expense_bills_insert_submitter
on storage.objects for insert to authenticated
with check (
  bucket_id = 'expense-bills'
  and public.storage_path_is_current_organization(name)
  and split_part(name, '/', 2) = public.current_profile_id()::text
  -- The file is staged before submit_expense_claim atomically creates the
  -- expense and attachment rows. Limit that staging surface to the caller's
  -- tenant/profile prefix and a UUID expense identifier.
  and split_part(name, '/', 3) ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
);

-- Payment proof and financial/audit history are immutable through direct API
-- table operations. Approved workflow functions remain security-definer RPCs.
revoke update, delete, truncate on public.audit_logs from service_role;
revoke insert on public.audit_logs from service_role;
grant select on public.audit_logs to service_role;

create trigger audit_logs_reject_truncate
before truncate on public.audit_logs
for each statement execute function public.reject_audit_mutation();

revoke update, delete, truncate on public.booking_status_history,
  public.lead_assignment_history,
  public.conversation_assignments,
  public.role_assignment_history
  from authenticated;

-- Remove implicit function execution. Explicit browser RPC grants above and in
-- earlier migrations remain in place. Policy helpers need authenticated execute
-- because PostgreSQL evaluates them as the querying role.
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public
  revoke execute on functions from public;

grant execute on function public.current_profile_id() to authenticated, service_role;
grant execute on function public.current_organization_id() to authenticated, service_role;
grant execute on function public.current_role() to authenticated, service_role;
grant execute on function public.current_auth_session_is_valid()
  to authenticated, service_role;
grant execute on function public.validate_current_auth_session()
  to authenticated, service_role;
grant execute on function public.is_active_profile() to authenticated, service_role;
grant execute on function public.has_any_role(public.profile_role[])
  to authenticated, service_role;
grant execute on function public.is_director() to authenticated, service_role;
grant execute on function public.is_manager_or_director()
  to authenticated, service_role;
grant execute on function public.is_hr_scope_admin() to authenticated, service_role;
grant execute on function public.is_sales_scope_admin() to authenticated, service_role;
grant execute on function public.profile_has_any_role(
  uuid,
  public.profile_role[],
  boolean
) to authenticated, service_role;
grant execute on function public.is_workforce_profile(uuid)
  to authenticated, service_role;
grant execute on function public.is_sales_profile(uuid)
  to authenticated, service_role;
grant execute on function public.can_read_lead(uuid) to authenticated, service_role;
grant execute on function public.can_read_conversation(uuid)
  to authenticated, service_role;
grant execute on function public.can_read_booking(uuid)
  to authenticated, service_role;
grant execute on function public.can_read_workforce_booking(uuid)
  to authenticated, service_role;
grant execute on function public.can_read_expense(uuid)
  to authenticated, service_role;
grant execute on function public.can_read_meeting(uuid)
  to authenticated, service_role;
grant execute on function public.can_read_audit_log(uuid)
  to authenticated, service_role;
grant execute on function public.storage_path_is_current_organization(text)
  to authenticated, service_role;
grant execute on function public.storage_path_is_structurally_safe(text)
  to authenticated, service_role;
grant execute on function public.can_read_expense_storage_object(text)
  to authenticated, service_role;
grant execute on function public.can_read_conversation_storage_object(text)
  to authenticated, service_role;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke usage on schema public from anon;

comment on column public.login_sessions.auth_session_id is
  'Supabase Auth session bound to this application session; never exposed to browser table reads.';
comment on function public.close_all_my_login_sessions(text) is
  'Closes every application session, revokes every Supabase Auth session for the caller, and writes an audit event.';
