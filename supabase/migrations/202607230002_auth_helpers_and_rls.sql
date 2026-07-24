-- Khana Banao CRM: authenticated context helpers, least-privilege grants, and RLS.

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
  limit 1;
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
    when auth.uid() is null or nullif(auth.jwt() ->> 'session_id', '') is null then false
    else exists (
      select 1
      from auth.sessions s
      where s.user_id = auth.uid()
        and s.id::text = auth.jwt() ->> 'session_id'
    )
  end;
$$;

create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.current_auth_session_is_valid() and coalesce((
    select p.account_status = 'active' and o.is_active
    from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.id = auth.uid()
      and p.deleted_at is null
  ), false);
$$;

create or replace function public.validate_current_auth_session()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile();
$$;

create or replace function public.has_any_role(p_roles public.profile_role[])
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile()
    and public.current_role() = any (p_roles);
$$;

create or replace function public.is_director()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.has_any_role(array['director']::public.profile_role[]);
$$;

create or replace function public.is_manager_or_director()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.has_any_role(array['director', 'manager']::public.profile_role[]);
$$;

create or replace function public.is_hr_scope_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.has_any_role(array['director', 'manager', 'hr']::public.profile_role[]);
$$;

create or replace function public.is_sales_scope_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.has_any_role(array['director', 'manager', 'sales_manager']::public.profile_role[]);
$$;

create or replace function public.profile_has_any_role(
  p_profile_id uuid,
  p_roles public.profile_role[],
  p_require_active boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile() and coalesce((
    select p.role = any (p_roles)
      and (not p_require_active or p.account_status = 'active')
    from public.profiles p
    where p.id = p_profile_id
      and p.organization_id = public.current_organization_id()
      and p.deleted_at is null
  ), false);
$$;

create or replace function public.is_workforce_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.profile_has_any_role(
    p_profile_id,
    array['chef', 'part_time_chef']::public.profile_role[]
  );
$$;

create or replace function public.is_sales_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.profile_has_any_role(
    p_profile_id,
    array['sales_manager', 'sales']::public.profile_role[]
  );
$$;

create or replace function public.can_read_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile() and coalesce((
    select
      public.is_sales_scope_admin()
      or (
        public.current_role() = 'sales'
        and l.assigned_sales_profile_id = public.current_profile_id()
      )
    from public.leads l
    where l.id = p_lead_id
      and l.organization_id = public.current_organization_id()
      and l.deleted_at is null
  ), false);
$$;

create or replace function public.can_read_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile() and coalesce((
    select
      public.is_sales_scope_admin()
      or (
        public.current_role() = 'sales'
        and c.assigned_sales_profile_id = public.current_profile_id()
      )
    from public.conversations c
    where c.id = p_conversation_id
      and c.organization_id = public.current_organization_id()
  ), false);
$$;

create or replace function public.can_read_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile() and coalesce((
    select
      public.current_role() in ('director', 'manager', 'sales_manager')
      or (
        public.current_role() = 'sales'
        and b.sold_by_profile_id = public.current_profile_id()
      )
    from public.bookings b
    where b.id = p_booking_id
      and b.organization_id = public.current_organization_id()
      and b.deleted_at is null
  ), false);
$$;

create or replace function public.can_read_workforce_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile() and coalesce((
    select
      public.is_manager_or_director()
      or (
        public.current_role() = 'hr'
        and b.service_status in (
          'confirmed',
          'chef_assigned',
          'preparing',
          'service_completed',
          'fully_completed'
        )
      )
      or (
        public.current_role() in ('chef', 'part_time_chef')
        and exists (
          select 1
          from public.booking_assignments ba
          where ba.booking_id = b.id
            and ba.organization_id = b.organization_id
            and ba.chef_profile_id = public.current_profile_id()
            and ba.unassigned_at is null
        )
      )
    from public.bookings b
    where b.id = p_booking_id
      and b.organization_id = public.current_organization_id()
      and b.deleted_at is null
  ), false);
$$;

create or replace function public.can_read_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile() and coalesce((
    select
      e.submitted_by_profile_id = public.current_profile_id()
      or public.is_manager_or_director()
      or (
        public.current_role() = 'hr'
        and public.is_workforce_profile(e.submitted_by_profile_id)
      )
      or (
        public.current_role() = 'sales_manager'
        and public.profile_has_any_role(
          e.submitted_by_profile_id,
          array['sales']::public.profile_role[]
        )
      )
    from public.expenses e
    where e.id = p_expense_id
      and e.organization_id = public.current_organization_id()
  ), false);
$$;

create or replace function public.can_read_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile() and coalesce((
    select
      public.is_manager_or_director()
      or m.created_by_profile_id = public.current_profile_id()
      or exists (
        select 1
        from public.meeting_attendees ma
        where ma.meeting_id = m.id
          and ma.organization_id = m.organization_id
          and ma.profile_id = public.current_profile_id()
      )
    from public.meetings m
    where m.id = p_meeting_id
      and m.organization_id = public.current_organization_id()
      and m.deleted_at is null
  ), false);
$$;

create or replace function public.can_read_audit_log(p_audit_log_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_log public.audit_logs%rowtype;
begin
  if not public.is_active_profile() then
    return false;
  end if;

  select *
  into v_log
  from public.audit_logs al
  where al.id = p_audit_log_id
    and al.organization_id = public.current_organization_id();

  if not found then
    return false;
  end if;

  if public.is_director() or v_log.actor_profile_id = public.current_profile_id() then
    return true;
  end if;

  if public.current_role() = 'manager' then
    return v_log.entity_type not in (
      'integration_connection',
      'integration_event',
      'integration_sync_run',
      'organization_secret'
    );
  end if;

  if public.current_role() = 'hr' then
    case
      when v_log.entity_type in ('profile', 'role_assignment') then
        return public.is_workforce_profile(v_log.entity_id);
      when v_log.entity_type = 'booking_assignment' then
        return exists (
          select 1 from public.booking_assignments ba
          where ba.id = v_log.entity_id
            and ba.organization_id = v_log.organization_id
            and public.is_workforce_profile(ba.chef_profile_id)
        );
      when v_log.entity_type = 'attendance_shift' then
        return exists (
          select 1 from public.attendance_shifts a
          where a.id = v_log.entity_id
            and a.organization_id = v_log.organization_id
            and (
              a.temporary_worker_id is not null
              or public.is_workforce_profile(a.profile_id)
            )
        );
      when v_log.entity_type in (
        'temporary_worker',
        'temporary_worker_assignment',
        'payroll_period'
      ) then
        return true;
      when v_log.entity_type = 'expense' then
        return exists (
          select 1 from public.expenses e
          where e.id = v_log.entity_id
            and e.organization_id = v_log.organization_id
            and public.is_workforce_profile(e.submitted_by_profile_id)
        );
      when v_log.entity_type = 'leave_request' then
        return exists (
          select 1 from public.leave_requests lr
          where lr.id = v_log.entity_id
            and lr.organization_id = v_log.organization_id
            and public.is_workforce_profile(lr.profile_id)
        );
      when v_log.entity_type = 'payroll_entry' then
        return exists (
          select 1 from public.payroll_entries pe
          where pe.id = v_log.entity_id
            and pe.organization_id = v_log.organization_id
            and (
              pe.temporary_worker_id is not null
              or public.is_workforce_profile(pe.profile_id)
            )
        );
      when v_log.entity_type = 'meeting' then
        return exists (
          select 1 from public.meetings m
          where m.id = v_log.entity_id
            and m.organization_id = v_log.organization_id
            and m.created_by_profile_id = public.current_profile_id()
        );
      when v_log.entity_type = 'task' then
        return exists (
          select 1 from public.tasks t
          where t.id = v_log.entity_id
            and t.organization_id = v_log.organization_id
            and (
              t.assigned_by_profile_id = public.current_profile_id()
              or public.is_workforce_profile(t.assigned_to_profile_id)
            )
        );
      else
        return false;
    end case;
  end if;

  if public.current_role() = 'sales_manager' then
    case
      when v_log.entity_type in (
        'lead',
        'lead_assignment',
        'follow_up',
        'conversation',
        'conversation_assignment',
        'message',
        'superfone_call',
        'booking',
        'booking_payment'
      ) then
        return true;
      when v_log.entity_type = 'expense' then
        return exists (
          select 1 from public.expenses e
          where e.id = v_log.entity_id
            and e.organization_id = v_log.organization_id
            and (
              e.submitted_by_profile_id = public.current_profile_id()
              or public.profile_has_any_role(
                e.submitted_by_profile_id,
                array['sales']::public.profile_role[]
              )
            )
        );
      when v_log.entity_type = 'leave_request' then
        return exists (
          select 1 from public.leave_requests lr
          where lr.id = v_log.entity_id
            and lr.organization_id = v_log.organization_id
            and public.profile_has_any_role(
              lr.profile_id,
              array['sales']::public.profile_role[]
            )
        );
      when v_log.entity_type = 'meeting' then
        return exists (
          select 1 from public.meetings m
          where m.id = v_log.entity_id
            and m.organization_id = v_log.organization_id
            and m.created_by_profile_id = public.current_profile_id()
        );
      when v_log.entity_type = 'task' then
        return exists (
          select 1 from public.tasks t
          where t.id = v_log.entity_id
            and t.organization_id = v_log.organization_id
            and (
              t.assigned_by_profile_id = public.current_profile_id()
              or public.is_sales_profile(t.assigned_to_profile_id)
            )
        );
      else
        return false;
    end case;
  end if;

  return false;
end;
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
  limit 1;
$$;

create or replace function public.write_audit_log(
  p_organization_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_reason text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    reason,
    request_id
  )
  values (
    p_organization_id,
    p_actor_profile_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_before_data,
    p_after_data,
    p_reason,
    p_request_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'AUDIT_LOG_IMMUTABLE';
end;
$$;

create trigger audit_logs_reject_update_delete
before update or delete on public.audit_logs
for each row execute function public.reject_audit_mutation();

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
begin
  if not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'ACCOUNT_INACTIVE';
  end if;

  if nullif(btrim(p_session_code), '') is null
     or char_length(p_session_code) < 16
     or char_length(p_session_code) > 256 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select *
  into strict v_profile
  from public.profiles
  where id = auth.uid()
    and deleted_at is null;

  insert into public.login_sessions (
    organization_id,
    profile_id,
    session_code,
    session_version,
    user_agent_safe,
    ip_hash
  )
  values (
    v_profile.organization_id,
    v_profile.id,
    p_session_code,
    v_profile.session_version,
    left(p_user_agent_safe, 300),
    left(p_ip_hash, 128)
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
    jsonb_build_object('session_version', v_session.session_version)
  );

  return jsonb_build_object(
    'id', v_session.id,
    'session_code', v_session.session_code,
    'session_version', v_session.session_version,
    'login_at', v_session.login_at
  );
end;
$$;

create or replace function public.touch_login_session(p_session_code text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_updated integer;
begin
  if not public.is_active_profile() then
    return false;
  end if;

  update public.login_sessions ls
  set last_seen_at = now()
  from public.profiles p
  where ls.profile_id = auth.uid()
    and ls.profile_id = p.id
    and ls.organization_id = p.organization_id
    and ls.session_code = p_session_code
    and ls.logout_at is null
    and ls.session_version = p.session_version;

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
  v_updated integer;
begin
  update public.login_sessions
  set
    logout_at = now(),
    logout_reason = coalesce(nullif(btrim(p_reason), ''), 'user_logout')
  where profile_id = auth.uid()
    and session_code = p_session_code
    and logout_at is null;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.validate_login_session(
  p_session_code text,
  p_session_version integer
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile() and exists (
    select 1
    from public.login_sessions ls
    join public.profiles p
      on p.id = ls.profile_id
     and p.organization_id = ls.organization_id
    where ls.profile_id = auth.uid()
      and ls.session_code = p_session_code
      and ls.session_version = p_session_version
      and p.session_version = p_session_version
      and ls.logout_at is null
      and p.account_status = 'active'
      and p.deleted_at is null
  );
$$;

create or replace function public.list_chef_availability(
  p_from_date date default current_date,
  p_to_date date default current_date + 30
)
returns table (
  profile_id uuid,
  full_name text,
  role public.profile_role,
  active_assignment_count bigint,
  next_event_date date
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.has_any_role(
    array['director', 'manager', 'hr', 'sales_manager', 'sales']::public.profile_role[]
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_to_date < p_from_date or p_to_date - p_from_date > 366 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.role,
    count(ba.id) filter (
      where ba.unassigned_at is null
        and b.event_date between p_from_date and p_to_date
        and b.service_status <> 'cancelled'
    ),
    min(b.event_date) filter (
      where ba.unassigned_at is null
        and b.event_date >= current_date
        and b.service_status <> 'cancelled'
    )
  from public.profiles p
  left join public.booking_assignments ba
    on ba.organization_id = p.organization_id
   and ba.chef_profile_id = p.id
   and ba.unassigned_at is null
  left join public.bookings b
    on b.organization_id = ba.organization_id
   and b.id = ba.booking_id
   and b.deleted_at is null
  where p.organization_id = public.current_organization_id()
    and p.role in ('chef', 'part_time_chef')
    and p.account_status = 'active'
    and p.deleted_at is null
  group by p.id, p.full_name, p.role
  order by p.full_name;
end;
$$;

create or replace function public.get_workforce_bookings(
  p_from_date date default current_date,
  p_to_date date default current_date + 90,
  p_service_status public.booking_service_status default null
)
returns table (
  booking_id uuid,
  booking_code text,
  client_name text,
  event_type text,
  event_date date,
  event_start_time time,
  reporting_time time,
  venue text,
  guest_count integer,
  menu text,
  instructions text,
  service_status public.booking_service_status,
  chef_profile_id uuid,
  chef_name text,
  agreed_pay_type public.payment_type,
  agreed_pay_amount numeric
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.has_any_role(
    array['director', 'manager', 'hr', 'chef', 'part_time_chef']::public.profile_role[]
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_to_date < p_from_date or p_to_date - p_from_date > 730 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  return query
  select
    b.id,
    b.booking_code,
    b.client_name,
    b.event_type,
    b.event_date,
    b.event_start_time,
    b.reporting_time,
    b.venue,
    b.guest_count,
    b.menu,
    b.instructions,
    b.service_status,
    ba.chef_profile_id,
    p.full_name,
    case
      when public.current_role() in ('director', 'manager', 'hr')
        or ba.chef_profile_id = public.current_profile_id()
      then ba.agreed_pay_type
      else null
    end,
    case
      when public.current_role() in ('director', 'manager', 'hr')
        or ba.chef_profile_id = public.current_profile_id()
      then ba.agreed_pay_amount
      else null
    end
  from public.bookings b
  left join public.booking_assignments ba
    on ba.booking_id = b.id
   and ba.organization_id = b.organization_id
   and ba.unassigned_at is null
   and ba.is_primary
  left join public.profiles p
    on p.id = ba.chef_profile_id
   and p.organization_id = ba.organization_id
  where b.organization_id = public.current_organization_id()
    and b.deleted_at is null
    and b.event_date between p_from_date and p_to_date
    and (p_service_status is null or b.service_status = p_service_status)
    and (
      public.is_manager_or_director()
      or (
        public.current_role() = 'hr'
        and b.service_status in (
          'confirmed',
          'chef_assigned',
          'preparing',
          'service_completed',
          'fully_completed'
        )
      )
      or (
        public.current_role() in ('chef', 'part_time_chef')
        and ba.chef_profile_id = public.current_profile_id()
      )
    )
  order by b.event_date, b.reporting_time nulls last, b.booking_code;
end;
$$;

create or replace function public.get_booking_assignee_summaries(p_booking_ids uuid[])
returns table (
  booking_id uuid,
  chef_profile_id uuid,
  chef_name text,
  chef_role public.profile_role
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.has_any_role(
    array['director', 'manager', 'hr', 'sales_manager', 'sales']::public.profile_role[]
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if coalesce(cardinality(p_booking_ids), 0) > 200 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  return query
  select ba.booking_id, p.id, p.full_name, p.role
  from public.booking_assignments ba
  join public.bookings b
    on b.id = ba.booking_id
   and b.organization_id = ba.organization_id
  join public.profiles p
    on p.id = ba.chef_profile_id
   and p.organization_id = ba.organization_id
  where ba.organization_id = public.current_organization_id()
    and ba.booking_id = any (p_booking_ids)
    and ba.unassigned_at is null
    and (
      public.current_role() in ('director', 'manager', 'hr', 'sales_manager')
      or b.sold_by_profile_id = public.current_profile_id()
    )
  order by ba.booking_id, ba.is_primary desc, ba.assigned_at;
end;
$$;

-- Only the small auth context/session surface is callable without an active profile.
revoke all on function public.write_audit_log(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.write_audit_log(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text)
  to service_role;
revoke all on function public.get_my_auth_context() from public, anon;
grant execute on function public.get_my_auth_context() to authenticated, service_role;
revoke all on function public.current_auth_session_is_valid() from anon;
grant execute on function public.current_auth_session_is_valid() to authenticated, service_role;
revoke all on function public.validate_current_auth_session() from public, anon;
grant execute on function public.validate_current_auth_session() to authenticated, service_role;
revoke all on function public.open_login_session(text, text, text) from public, anon;
grant execute on function public.open_login_session(text, text, text) to authenticated;
revoke all on function public.touch_login_session(text) from public, anon;
grant execute on function public.touch_login_session(text) to authenticated;
revoke all on function public.close_login_session(text, text) from public, anon;
grant execute on function public.close_login_session(text, text) to authenticated;
revoke all on function public.validate_login_session(text, integer) from public, anon;
grant execute on function public.validate_login_session(text, integer) to authenticated;
revoke all on function public.list_chef_availability(date, date) from public, anon;
grant execute on function public.list_chef_availability(date, date) to authenticated;
revoke all on function public.get_workforce_bookings(date, date, public.booking_service_status)
  from public, anon;
grant execute on function public.get_workforce_bookings(date, date, public.booking_service_status)
  to authenticated;
revoke all on function public.get_booking_assignee_summaries(uuid[]) from public, anon;
grant execute on function public.get_booking_assignee_summaries(uuid[]) to authenticated;

-- RLS is enabled on every business table. Service-role Edge Functions retain their
-- normal bypass; browser roles are governed by the policies below.
alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.role_assignment_history enable row level security;
alter table public.login_sessions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.leads enable row level security;
alter table public.lead_assignment_history enable row level security;
alter table public.lead_activities enable row level security;
alter table public.follow_ups enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_assignments enable row level security;
alter table public.messages enable row level security;
alter table public.message_attempts enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.superfone_calls enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_events enable row level security;
alter table public.integration_sync_runs enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_status_history enable row level security;
alter table public.booking_assignments enable row level security;
alter table public.booking_payments enable row level security;
alter table public.temporary_workers enable row level security;
alter table public.temporary_worker_assignments enable row level security;
alter table public.attendance_shifts enable row level security;
alter table public.break_sessions enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_attachments enable row level security;
alter table public.leave_requests enable row level security;
alter table public.tasks enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_components enable row level security;
alter table public.notifications enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;

grant usage on schema public to authenticated;
do $$
declare
  v_type_name text;
begin
  for v_type_name in
    select t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype = 'e'
  loop
    execute format(
      'grant usage on type public.%I to authenticated, service_role',
      v_type_name
    );
  end loop;
end;
$$;
grant select on all tables in schema public to authenticated;

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

-- Organization and profile directory.
create policy organizations_select_own
on public.organizations for select to authenticated
using (
  public.is_active_profile()
  and id = public.current_organization_id()
);
create policy organizations_director_update
on public.organizations for update to authenticated
using (public.is_director() and id = public.current_organization_id())
with check (public.is_director() and id = public.current_organization_id());

create policy organization_settings_select_own
on public.organization_settings for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
);
create policy organization_settings_director_update
on public.organization_settings for update to authenticated
using (public.is_director() and organization_id = public.current_organization_id())
with check (public.is_director() and organization_id = public.current_organization_id());

create policy profiles_select_scoped
on public.profiles for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and deleted_at is null
  and (
    id = public.current_profile_id()
    or public.is_manager_or_director()
    or (
      public.current_role() = 'hr'
      and role in ('chef', 'part_time_chef')
    )
    or (
      public.current_role() = 'sales_manager'
      and role = 'sales'
    )
  )
);
create policy profiles_update_self
on public.profiles for update to authenticated
using (
  public.is_active_profile()
  and id = public.current_profile_id()
  and organization_id = public.current_organization_id()
)
with check (
  public.is_active_profile()
  and id = public.current_profile_id()
  and organization_id = public.current_organization_id()
);

create policy role_history_select_scoped
on public.role_assignment_history for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or public.is_manager_or_director()
    or (public.current_role() = 'hr' and public.is_workforce_profile(profile_id))
    or (public.current_role() = 'sales_manager' and public.is_sales_profile(profile_id))
  )
);

create policy login_sessions_select_own_or_admin
on public.login_sessions for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (profile_id = public.current_profile_id() or public.is_manager_or_director())
);
create policy login_sessions_insert_own
on public.login_sessions for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
  and session_version = (
    select p.session_version from public.profiles p where p.id = public.current_profile_id()
  )
);
create policy login_sessions_update_own
on public.login_sessions for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
)
with check (
  organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
);

create policy audit_logs_select_scoped
on public.audit_logs for select to authenticated
using (public.can_read_audit_log(id));

-- Sales domain.
create policy leads_select_scoped
on public.leads for select to authenticated
using (public.can_read_lead(id));
create policy leads_insert_sales
on public.leads for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_sales_scope_admin()
    or (
      public.current_role() = 'sales'
      and created_by_profile_id = public.current_profile_id()
      and assigned_sales_profile_id = public.current_profile_id()
    )
  )
);
create policy leads_update_scoped
on public.leads for update to authenticated
using (public.can_read_lead(id))
with check (
  organization_id = public.current_organization_id()
  and (
    public.is_sales_scope_admin()
    or assigned_sales_profile_id = public.current_profile_id()
  )
);

create policy lead_assignment_history_select_scoped
on public.lead_assignment_history for select to authenticated
using (public.can_read_lead(lead_id));

create policy lead_activities_select_scoped
on public.lead_activities for select to authenticated
using (public.can_read_lead(lead_id));
create policy lead_activities_insert_scoped
on public.lead_activities for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and actor_profile_id = public.current_profile_id()
  and public.can_read_lead(lead_id)
);

create policy follow_ups_select_scoped
on public.follow_ups for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_active_profile()
  and (
    public.is_sales_scope_admin()
    or assigned_profile_id = public.current_profile_id()
  )
);
create policy follow_ups_insert_scoped
on public.follow_ups for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and created_by_profile_id = public.current_profile_id()
  and public.can_read_lead(lead_id)
  and (
    public.is_sales_scope_admin()
    or assigned_profile_id = public.current_profile_id()
  )
);
create policy follow_ups_update_scoped
on public.follow_ups for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_sales_scope_admin()
    or assigned_profile_id = public.current_profile_id()
  )
)
with check (
  organization_id = public.current_organization_id()
  and (
    public.is_sales_scope_admin()
    or assigned_profile_id = public.current_profile_id()
  )
);

create policy conversations_select_scoped
on public.conversations for select to authenticated
using (public.can_read_conversation(id));
create policy conversations_update_scoped
on public.conversations for update to authenticated
using (public.can_read_conversation(id))
with check (
  organization_id = public.current_organization_id()
  and (
    public.is_sales_scope_admin()
    or assigned_sales_profile_id = public.current_profile_id()
  )
);

create policy conversation_assignments_select_scoped
on public.conversation_assignments for select to authenticated
using (public.can_read_conversation(conversation_id));

create policy messages_select_scoped
on public.messages for select to authenticated
using (public.can_read_conversation(conversation_id));
create policy messages_insert_internal_note
on public.messages for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and public.can_read_conversation(conversation_id)
  and direction = 'internal'
  and provider = 'internal'
  and sender_profile_id = public.current_profile_id()
);

create policy message_attempts_select_scoped
on public.message_attempts for select to authenticated
using (
  exists (
    select 1
    from public.messages m
    where m.id = message_id
      and m.organization_id = organization_id
      and public.can_read_conversation(m.conversation_id)
  )
);

create policy conversation_reads_select_scoped
on public.conversation_reads for select to authenticated
using (
  organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
  and public.can_read_conversation(conversation_id)
);
create policy conversation_reads_insert_scoped
on public.conversation_reads for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
  and public.can_read_conversation(conversation_id)
);
create policy conversation_reads_update_scoped
on public.conversation_reads for update to authenticated
using (
  organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
  and public.can_read_conversation(conversation_id)
)
with check (
  organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
  and public.can_read_conversation(conversation_id)
);

create policy superfone_calls_select_scoped
on public.superfone_calls for select to authenticated
using (public.can_read_lead(lead_id));

-- Integration setup and raw provider payloads are Director-only.
create policy integration_connections_director_select
on public.integration_connections for select to authenticated
using (
  public.is_director()
  and organization_id = public.current_organization_id()
);
create policy integration_events_director_select
on public.integration_events for select to authenticated
using (
  public.is_director()
  and organization_id = public.current_organization_id()
);
create policy integration_sync_runs_director_select
on public.integration_sync_runs for select to authenticated
using (
  public.is_director()
  and organization_id = public.current_organization_id()
);

-- Bookings and customer payments.
create policy bookings_select_scoped
on public.bookings for select to authenticated
using (public.can_read_booking(id));

create policy booking_status_history_select_scoped
on public.booking_status_history for select to authenticated
using (public.can_read_booking(booking_id));

create policy booking_assignments_select_scoped
on public.booking_assignments for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_hr_scope_admin()
    or chef_profile_id = public.current_profile_id()
  )
);

create policy booking_payments_select_sales_scoped
on public.booking_payments for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_sales_scope_admin()
    or (
      public.current_role() = 'sales'
      and exists (
        select 1
        from public.bookings b
        where b.id = booking_id
          and b.organization_id = organization_id
          and b.sold_by_profile_id = public.current_profile_id()
      )
    )
  )
);
create policy booking_payments_insert_submitter
on public.booking_payments for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and verification_status = 'pending'
  and verified_by_profile_id is null
  and verified_at is null
  and submitted_by_profile_id = public.current_profile_id()
  and (
    public.is_sales_scope_admin()
    or exists (
      select 1
      from public.bookings b
      where b.id = booking_id
        and b.organization_id = organization_id
        and b.sold_by_profile_id = public.current_profile_id()
    )
  )
);

-- Workforce, shifts, and breaks.
create policy temporary_workers_select_hr_scope
on public.temporary_workers for select to authenticated
using (
  public.is_hr_scope_admin()
  and organization_id = public.current_organization_id()
);
create policy temporary_workers_insert_hr_scope
on public.temporary_workers for insert to authenticated
with check (
  public.is_hr_scope_admin()
  and organization_id = public.current_organization_id()
  and created_by_profile_id = public.current_profile_id()
);
create policy temporary_workers_update_hr_scope
on public.temporary_workers for update to authenticated
using (
  public.is_hr_scope_admin()
  and organization_id = public.current_organization_id()
)
with check (
  public.is_hr_scope_admin()
  and organization_id = public.current_organization_id()
);

create policy temporary_worker_assignments_select_hr_scope
on public.temporary_worker_assignments for select to authenticated
using (
  public.is_hr_scope_admin()
  and organization_id = public.current_organization_id()
);
create policy temporary_worker_assignments_insert_hr_scope
on public.temporary_worker_assignments for insert to authenticated
with check (
  public.is_hr_scope_admin()
  and organization_id = public.current_organization_id()
  and created_by_profile_id = public.current_profile_id()
);
create policy temporary_worker_assignments_update_hr_scope
on public.temporary_worker_assignments for update to authenticated
using (
  public.is_hr_scope_admin()
  and organization_id = public.current_organization_id()
)
with check (
  public.is_hr_scope_admin()
  and organization_id = public.current_organization_id()
);

create policy attendance_shifts_select_scoped
on public.attendance_shifts for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_hr_scope_admin()
    or profile_id = public.current_profile_id()
  )
);

create policy break_sessions_select_scoped
on public.break_sessions for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or public.is_manager_or_director()
  )
);
create policy break_sessions_insert_own
on public.break_sessions for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
);
create policy break_sessions_update_own
on public.break_sessions for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
)
with check (
  organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
);

-- Expenses and file metadata.
create policy expenses_select_scoped
on public.expenses for select to authenticated
using (public.can_read_expense(id));
create policy expenses_insert_own
on public.expenses for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and submitted_by_profile_id = public.current_profile_id()
  and status = 'pending'
  and reviewed_by_profile_id is null
  and reviewed_at is null
);
create policy expenses_update_own_pending
on public.expenses for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and submitted_by_profile_id = public.current_profile_id()
  and status = 'pending'
)
with check (
  organization_id = public.current_organization_id()
  and submitted_by_profile_id = public.current_profile_id()
  and status = 'pending'
);
create policy expenses_update_reviewer
on public.expenses for update to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_manager_or_director()
    or (
      public.current_role() = 'hr'
      and public.is_workforce_profile(submitted_by_profile_id)
    )
  )
)
with check (
  organization_id = public.current_organization_id()
  and (
    public.is_manager_or_director()
    or (
      public.current_role() = 'hr'
      and public.is_workforce_profile(submitted_by_profile_id)
    )
  )
);

create policy expense_attachments_select_scoped
on public.expense_attachments for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.can_read_expense(expense_id)
);
create policy expense_attachments_insert_own
on public.expense_attachments for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.expenses e
    where e.id = expense_id
      and e.organization_id = organization_id
      and e.submitted_by_profile_id = public.current_profile_id()
      and e.status = 'pending'
  )
);
create policy expense_attachments_delete_own_pending
on public.expense_attachments for delete to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.expenses e
    where e.id = expense_id
      and e.organization_id = organization_id
      and e.submitted_by_profile_id = public.current_profile_id()
      and e.status = 'pending'
  )
);

-- Leave approvals follow the HR and Sales branches.
create policy leave_requests_select_scoped
on public.leave_requests for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or public.is_manager_or_director()
    or (public.current_role() = 'hr' and public.is_workforce_profile(profile_id))
    or (
      public.current_role() = 'sales_manager'
      and public.profile_has_any_role(profile_id, array['sales']::public.profile_role[])
    )
  )
);
create policy leave_requests_insert_own
on public.leave_requests for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
  and status = 'pending'
);
create policy leave_requests_update_own_pending
on public.leave_requests for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
  and status = 'pending'
)
with check (
  organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
  and status in ('pending', 'cancelled')
);
create policy leave_requests_update_reviewer
on public.leave_requests for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_manager_or_director()
    or (public.current_role() = 'hr' and public.is_workforce_profile(profile_id))
    or (
      public.current_role() = 'sales_manager'
      and public.profile_has_any_role(profile_id, array['sales']::public.profile_role[])
    )
  )
)
with check (
  organization_id = public.current_organization_id()
  and (
    public.is_manager_or_director()
    or (public.current_role() = 'hr' and public.is_workforce_profile(profile_id))
    or (
      public.current_role() = 'sales_manager'
      and public.profile_has_any_role(profile_id, array['sales']::public.profile_role[])
    )
  )
);

-- Tasks are visible to their assignee/creator and the applicable branch leader.
create policy tasks_select_scoped
on public.tasks for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    assigned_to_profile_id = public.current_profile_id()
    or assigned_by_profile_id = public.current_profile_id()
    or public.is_manager_or_director()
    or (
      public.current_role() = 'hr'
      and public.is_workforce_profile(assigned_to_profile_id)
    )
    or (
      public.current_role() = 'sales_manager'
      and public.is_sales_profile(assigned_to_profile_id)
    )
  )
);
create policy tasks_insert_scoped
on public.tasks for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and assigned_by_profile_id = public.current_profile_id()
  and (
    public.is_manager_or_director()
    or (
      public.current_role() = 'hr'
      and public.is_workforce_profile(assigned_to_profile_id)
    )
    or (
      public.current_role() = 'sales_manager'
      and public.is_sales_profile(assigned_to_profile_id)
    )
  )
);
create policy tasks_update_scoped
on public.tasks for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    assigned_to_profile_id = public.current_profile_id()
    or assigned_by_profile_id = public.current_profile_id()
    or public.is_manager_or_director()
  )
)
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_manager_or_director()
    or assigned_to_profile_id = public.current_profile_id()
    or (
      assigned_by_profile_id = public.current_profile_id()
      and (
        (
          public.current_role() = 'hr'
          and public.is_workforce_profile(assigned_to_profile_id)
        )
        or (
          public.current_role() = 'sales_manager'
          and public.is_sales_profile(assigned_to_profile_id)
        )
        or public.is_manager_or_director()
      )
    )
  )
);

-- Meetings are normalized separately from their attendees.
create policy meetings_select_scoped
on public.meetings for select to authenticated
using (public.can_read_meeting(id));
create policy meetings_insert_scoped
on public.meetings for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and created_by_profile_id = public.current_profile_id()
  and public.has_any_role(
    array['director', 'manager', 'hr', 'sales_manager']::public.profile_role[]
  )
);
create policy meetings_update_scoped
on public.meetings for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_manager_or_director()
    or created_by_profile_id = public.current_profile_id()
  )
)
with check (
  organization_id = public.current_organization_id()
  and (
    public.is_manager_or_director()
    or created_by_profile_id = public.current_profile_id()
  )
);

create policy meeting_attendees_select_scoped
on public.meeting_attendees for select to authenticated
using (public.can_read_meeting(meeting_id));
create policy meeting_attendees_insert_creator
on public.meeting_attendees for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.meetings m
    where m.id = meeting_id
      and m.organization_id = organization_id
      and (
        m.created_by_profile_id = public.current_profile_id()
        or public.is_manager_or_director()
      )
  )
  and (
    public.is_manager_or_director()
    or (
      public.current_role() = 'hr'
      and (
        profile_id = public.current_profile_id()
        or public.is_workforce_profile(profile_id)
      )
    )
    or (
      public.current_role() = 'sales_manager'
      and (
        profile_id = public.current_profile_id()
        or public.is_sales_profile(profile_id)
      )
    )
  )
);
create policy meeting_attendees_update_self_or_creator
on public.meeting_attendees for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or exists (
      select 1
      from public.meetings m
      where m.id = meeting_id
        and m.organization_id = organization_id
        and (
          m.created_by_profile_id = public.current_profile_id()
          or public.is_manager_or_director()
        )
    )
  )
)
with check (organization_id = public.current_organization_id());
create policy meeting_attendees_delete_creator
on public.meeting_attendees for delete to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.meetings m
    where m.id = meeting_id
      and m.organization_id = organization_id
      and (
        m.created_by_profile_id = public.current_profile_id()
        or public.is_manager_or_director()
      )
  )
);

-- Payroll admins see the branch; an authenticated worker only sees their own entry.
create policy payroll_periods_select_scoped
on public.payroll_periods for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_hr_scope_admin()
);
create policy payroll_entries_select_scoped
on public.payroll_entries for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    public.is_hr_scope_admin()
    or profile_id = public.current_profile_id()
  )
);
create policy payroll_components_select_scoped
on public.payroll_components for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.payroll_entries pe
    where pe.id = payroll_entry_id
      and pe.organization_id = organization_id
      and (
        public.is_hr_scope_admin()
        or pe.profile_id = public.current_profile_id()
      )
  )
);

-- In-app notification and announcement rows never leave the CRM.
create policy notifications_select_own
on public.notifications for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and recipient_profile_id = public.current_profile_id()
);
create policy notifications_update_read_own
on public.notifications for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and recipient_profile_id = public.current_profile_id()
)
with check (
  organization_id = public.current_organization_id()
  and recipient_profile_id = public.current_profile_id()
);

create policy announcements_select_scoped
on public.announcements for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and deleted_at is null
  and starts_at <= now()
  and (expires_at is null or expires_at > now())
  and (
    created_by_profile_id = public.current_profile_id()
    or audience_role is null
    or audience_role = public.current_role()
    or exists (
      select 1
      from public.announcement_recipients ar
      where ar.announcement_id = id
        and ar.organization_id = organization_id
        and ar.profile_id = public.current_profile_id()
    )
  )
);
create policy announcements_insert_leaders
on public.announcements for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and created_by_profile_id = public.current_profile_id()
  and public.has_any_role(
    array['director', 'manager', 'hr', 'sales_manager']::public.profile_role[]
  )
  and (
    public.is_manager_or_director()
    or (
      public.current_role() = 'hr'
      and audience_role in ('chef', 'part_time_chef')
    )
    or (
      public.current_role() = 'sales_manager'
      and audience_role = 'sales'
    )
  )
);
create policy announcements_update_creator
on public.announcements for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    created_by_profile_id = public.current_profile_id()
    or public.is_manager_or_director()
  )
)
with check (organization_id = public.current_organization_id());

create policy announcement_recipients_select_scoped
on public.announcement_recipients for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or exists (
      select 1
      from public.announcements a
      where a.id = announcement_id
        and a.organization_id = organization_id
        and (
          a.created_by_profile_id = public.current_profile_id()
          or public.is_manager_or_director()
        )
    )
  )
);
create policy announcement_recipients_insert_creator
on public.announcement_recipients for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.announcements a
    where a.id = announcement_id
      and a.organization_id = organization_id
      and (
        a.created_by_profile_id = public.current_profile_id()
        or public.is_manager_or_director()
      )
  )
  and (
    public.is_manager_or_director()
    or (
      public.current_role() = 'hr'
      and public.is_workforce_profile(profile_id)
    )
    or (
      public.current_role() = 'sales_manager'
      and public.profile_has_any_role(
        profile_id,
        array['sales']::public.profile_role[]
      )
    )
  )
);
create policy announcement_recipients_update_own
on public.announcement_recipients for update to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
)
with check (
  organization_id = public.current_organization_id()
  and profile_id = public.current_profile_id()
);

-- Browser mutation privileges are deliberately narrower than table ownership.
grant update (name, slug, timezone, currency, is_active, updated_at)
  on public.organizations to authenticated;
grant update (
  manager_expense_limit,
  monthly_revenue_target,
  attendance_approval_required,
  part_time_payment_proof_required,
  lead_assignment_mode,
  booking_code_prefix,
  payroll_cutoff_day,
  updated_at
) on public.organization_settings to authenticated;
grant update (full_name, last_login_at, updated_at)
  on public.profiles to authenticated;
grant insert on public.login_sessions to authenticated;
grant update (last_seen_at, logout_at, logout_reason, updated_at)
  on public.login_sessions to authenticated;
grant insert on public.leads to authenticated;
grant update (
  client_name,
  phone_e164,
  phone_normalized,
  requirement,
  event_date,
  guest_count,
  quote_amount,
  status,
  next_follow_up_at,
  notes,
  last_activity_at,
  updated_at,
  version
) on public.leads to authenticated;
grant insert on public.lead_activities to authenticated;
grant insert on public.follow_ups to authenticated;
grant update (
  assigned_profile_id,
  due_at,
  status,
  outcome,
  completed_at,
  updated_at
) on public.follow_ups to authenticated;
grant update (status, closed_at, updated_at, version)
  on public.conversations to authenticated;
grant insert on public.messages to authenticated;
grant insert on public.conversation_reads to authenticated;
grant update (last_read_message_id, last_read_at, updated_at)
  on public.conversation_reads to authenticated;
grant insert on public.booking_payments to authenticated;
grant insert on public.temporary_workers to authenticated;
grant update (
  full_name,
  phone_e164,
  worker_type,
  payment_type,
  payment_amount,
  notes,
  is_active,
  deleted_at,
  updated_at
) on public.temporary_workers to authenticated;
grant insert on public.temporary_worker_assignments to authenticated;
grant update (
  temporary_worker_id,
  booking_id,
  work_date,
  reporting_time,
  agreed_payment,
  notes,
  updated_at
) on public.temporary_worker_assignments to authenticated;
grant insert on public.break_sessions to authenticated;
grant update (ended_at, updated_at) on public.break_sessions to authenticated;
grant insert on public.expenses to authenticated;
grant update (
  booking_id,
  category,
  amount,
  reason,
  status,
  reviewed_by_profile_id,
  reviewed_at,
  rejection_reason,
  updated_at
) on public.expenses to authenticated;
grant insert on public.expense_attachments to authenticated;
grant delete on public.expense_attachments to authenticated;
grant insert on public.leave_requests to authenticated;
grant update (
  start_date,
  end_date,
  reason,
  status,
  reviewed_by_profile_id,
  reviewed_at,
  review_note,
  updated_at
) on public.leave_requests to authenticated;
grant insert on public.tasks to authenticated;
grant update (
  title,
  description,
  assigned_to_profile_id,
  booking_id,
  lead_id,
  due_at,
  priority,
  status,
  completed_at,
  updated_at
) on public.tasks to authenticated;
grant insert on public.meetings to authenticated;
grant update (
  title,
  reason,
  starts_at,
  ends_at,
  location,
  meeting_url,
  status,
  deleted_at,
  updated_at
) on public.meetings to authenticated;
grant insert, delete on public.meeting_attendees to authenticated;
grant update (attendance_status, updated_at) on public.meeting_attendees to authenticated;
grant update (read_at, updated_at) on public.notifications to authenticated;
grant insert on public.announcements to authenticated;
grant update (
  title,
  body,
  audience_role,
  starts_at,
  expires_at,
  deleted_at,
  updated_at
) on public.announcements to authenticated;
grant insert on public.announcement_recipients to authenticated;
grant update (read_at, updated_at) on public.announcement_recipients to authenticated;

revoke insert, update, delete, truncate on public.audit_logs from authenticated;
revoke insert, update, delete, truncate on public.integration_connections from authenticated;
revoke insert, update, delete, truncate on public.integration_events from authenticated;
revoke insert, update, delete, truncate on public.integration_sync_runs from authenticated;
revoke delete on public.bookings, public.booking_payments, public.attendance_shifts,
  public.expenses, public.payroll_periods, public.payroll_entries, public.payroll_components
  from authenticated;
