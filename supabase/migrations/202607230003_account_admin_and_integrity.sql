-- Khana Banao CRM: atomic bootstrap/account administration support and
-- cross-row integrity guards used by the Auth Edge Functions.

create or replace function public.resolve_rpc_actor(p_actor_profile_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    if p_actor_profile_id is null then
      raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
    end if;
    return p_actor_profile_id;
  end if;

  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  return auth.uid();
end;
$$;

create or replace function public.bootstrap_organization(
  p_name text,
  p_slug text,
  p_director_user_id uuid,
  p_director_full_name text,
  p_director_phone_e164 text,
  p_timezone text default 'Asia/Kolkata',
  p_currency text default 'INR',
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_organization public.organizations%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  -- The deployment secret is one-time. The advisory lock closes the concurrent
  -- replay race before checking the durable organization row.
  perform pg_advisory_xact_lock(hashtextextended('khana-banao-bootstrap', 0));

  if exists (select 1 from public.organizations) then
    raise exception using errcode = '23505', message = 'ORGANIZATION_ALREADY_BOOTSTRAPPED';
  end if;

  if not exists (select 1 from auth.users where id = p_director_user_id) then
    raise exception using errcode = '23503', message = 'AUTH_USER_NOT_FOUND';
  end if;

  insert into public.organizations (name, slug, timezone, currency)
  values (
    btrim(p_name),
    lower(btrim(p_slug)),
    coalesce(nullif(btrim(p_timezone), ''), 'Asia/Kolkata'),
    upper(coalesce(nullif(btrim(p_currency), ''), 'INR'))
  )
  returning * into v_organization;

  insert into public.organization_settings (organization_id)
  values (v_organization.id);

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    phone_e164,
    role,
    account_status,
    joining_date
  )
  values (
    p_director_user_id,
    v_organization.id,
    btrim(p_director_full_name),
    p_director_phone_e164,
    'director',
    'active',
    current_date
  );

  insert into public.role_assignment_history (
    organization_id,
    role,
    profile_id,
    started_at,
    reason
  )
  values (
    v_organization.id,
    'director',
    p_director_user_id,
    now(),
    'Initial organization bootstrap'
  );

  perform public.write_audit_log(
    v_organization.id,
    p_director_user_id,
    'organization.bootstrapped',
    'organization',
    v_organization.id,
    null,
    jsonb_build_object(
      'organization_id', v_organization.id,
      'slug', v_organization.slug,
      'director_profile_id', p_director_user_id
    ),
    'Initial deployment bootstrap',
    p_request_id
  );

  return jsonb_build_object(
    'organization_id', v_organization.id,
    'organization_slug', v_organization.slug,
    'director_profile_id', p_director_user_id
  );
end;
$$;

create or replace function public.create_team_member_profile(
  p_auth_user_id uuid,
  p_full_name text,
  p_phone_e164 text,
  p_role public.profile_role,
  p_account_status public.account_status default 'active',
  p_reports_to_profile_id uuid default null,
  p_joining_date date default current_date,
  p_payment_type public.payment_type default null,
  p_payment_amount numeric default null,
  p_aadhaar_storage_path text default null,
  p_part_time_payment_proof_path text default null,
  p_part_time_payment_amount numeric default null,
  p_actor_profile_id uuid default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_profile public.profiles%rowtype;
  v_expected_manager uuid;
  v_settings public.organization_settings%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select *
  into strict v_actor
  from public.profiles
  where id = public.resolve_rpc_actor(p_actor_profile_id)
    and account_status = 'active'
    and deleted_at is null
  for update;

  if not exists (
    select 1
    from public.organizations o
    where o.id = v_actor.organization_id
      and o.is_active
  ) then
    raise exception using errcode = '42501', message = 'ORGANIZATION_INACTIVE';
  end if;

  if p_role = 'director'
    or not (
      v_actor.role = 'director'
      or (v_actor.role = 'manager' and p_role in ('hr', 'sales_manager'))
      or (v_actor.role = 'hr' and p_role in ('chef', 'part_time_chef'))
      or (v_actor.role = 'sales_manager' and p_role = 'sales')
    ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception using errcode = '23503', message = 'AUTH_USER_NOT_FOUND';
  end if;

  if p_account_status = 'payment_pending' and p_role <> 'part_time_chef' then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select *
  into strict v_settings
  from public.organization_settings
  where organization_id = v_actor.organization_id;

  if p_role = 'part_time_chef'
     and p_account_status = 'active'
     and v_settings.part_time_payment_proof_required
     and nullif(btrim(p_part_time_payment_proof_path), '') is null then
    raise exception using errcode = '23514', message = 'PAYMENT_PROOF_REQUIRED';
  end if;

  select p.id
  into v_expected_manager
  from public.profiles p
  where p.organization_id = v_actor.organization_id
    and p.account_status = 'active'
    and p.deleted_at is null
    and p.role = case p_role
      when 'manager' then 'director'::public.profile_role
      when 'hr' then 'manager'::public.profile_role
      when 'sales_manager' then 'manager'::public.profile_role
      when 'sales' then 'sales_manager'::public.profile_role
      when 'chef' then 'hr'::public.profile_role
      when 'part_time_chef' then 'hr'::public.profile_role
      else null
    end
  limit 1;

  if v_expected_manager is null then
    raise exception using errcode = '23514', message = 'REPORTING_MANAGER_REQUIRED';
  end if;

  if p_reports_to_profile_id is not null
     and p_reports_to_profile_id <> v_expected_manager then
    raise exception using errcode = '23514', message = 'INVALID_REPORTING_HIERARCHY';
  end if;

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    phone_e164,
    role,
    reports_to_profile_id,
    account_status,
    joining_date,
    payment_type,
    payment_amount,
    aadhaar_storage_path,
    part_time_payment_proof_path,
    part_time_payment_amount,
    created_by_profile_id
  )
  values (
    p_auth_user_id,
    v_actor.organization_id,
    btrim(p_full_name),
    p_phone_e164,
    p_role,
    v_expected_manager,
    p_account_status,
    p_joining_date,
    p_payment_type,
    p_payment_amount,
    nullif(btrim(p_aadhaar_storage_path), ''),
    nullif(btrim(p_part_time_payment_proof_path), ''),
    p_part_time_payment_amount,
    v_actor.id
  )
  returning * into v_profile;

  insert into public.role_assignment_history (
    organization_id,
    role,
    profile_id,
    assigned_by_profile_id,
    reason
  )
  values (
    v_actor.organization_id,
    p_role,
    p_auth_user_id,
    v_actor.id,
    'Team member account created'
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'profile.created',
    'profile',
    v_profile.id,
    null,
    jsonb_build_object(
      'id', v_profile.id,
      'role', v_profile.role,
      'account_status', v_profile.account_status,
      'reports_to_profile_id', v_profile.reports_to_profile_id,
      'joining_date', v_profile.joining_date,
      'payment_type', v_profile.payment_type,
      'payment_amount', v_profile.payment_amount
    ),
    'Team member account created',
    p_request_id
  );

  return jsonb_build_object(
    'id', v_profile.id,
    'organization_id', v_profile.organization_id,
    'full_name', v_profile.full_name,
    'phone_e164', v_profile.phone_e164,
    'role', v_profile.role,
    'account_status', v_profile.account_status,
    'session_version', v_profile.session_version,
    'reports_to_profile_id', v_profile.reports_to_profile_id
  );
exception
  when unique_violation then
    if sqlerrm like '%profile_phone_per_org%' then
      raise exception using errcode = '23505', message = 'DUPLICATE_PHONE';
    end if;
    raise;
end;
$$;

create or replace function public.update_account_status(
  p_target_profile_id uuid,
  p_account_status public.account_status,
  p_reason text,
  p_actor_profile_id uuid default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_before jsonb;
  v_settings public.organization_settings%rowtype;
begin
  select *
  into strict v_actor
  from public.profiles
  where id = public.resolve_rpc_actor(p_actor_profile_id)
    and account_status = 'active'
    and deleted_at is null
  for update;

  if not exists (
    select 1
    from public.organizations o
    where o.id = v_actor.organization_id
      and o.is_active
  ) then
    raise exception using errcode = '42501', message = 'ORGANIZATION_INACTIVE';
  end if;

  select *
  into strict v_target
  from public.profiles
  where id = p_target_profile_id
    and organization_id = v_actor.organization_id
    and deleted_at is null
  for update;

  if v_target.id = v_actor.id
    or v_target.role = 'director'
    or not (
      v_actor.role = 'director'
      or (
        v_actor.role = 'manager'
        and v_target.role in ('hr', 'sales_manager', 'sales', 'chef', 'part_time_chef')
      )
      or (v_actor.role = 'hr' and v_target.role in ('chef', 'part_time_chef'))
      or (v_actor.role = 'sales_manager' and v_target.role = 'sales')
    ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;

  if p_account_status = 'payment_pending' and v_target.role <> 'part_time_chef' then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if p_account_status = 'active' and v_target.role = 'part_time_chef' then
    select *
    into strict v_settings
    from public.organization_settings
    where organization_id = v_actor.organization_id;

    if v_settings.part_time_payment_proof_required
       and nullif(btrim(v_target.part_time_payment_proof_path), '') is null then
      raise exception using errcode = '23514', message = 'PAYMENT_PROOF_REQUIRED';
    end if;
  end if;

  if v_target.account_status = p_account_status then
    return jsonb_build_object(
      'id', v_target.id,
      'account_status', v_target.account_status,
      'session_version', v_target.session_version,
      'changed', false
    );
  end if;

  v_before := jsonb_build_object(
    'account_status', v_target.account_status,
    'session_version', v_target.session_version
  );

  update public.profiles
  set
    account_status = p_account_status,
    session_version = session_version + 1
  where id = v_target.id
  returning * into v_target;

  -- Every status transition revokes both application and Auth refresh sessions.
  -- This includes reactivation: credentials obtained while inactive must not
  -- become usable later without a fresh login.
  update public.login_sessions
  set
    logout_at = now(),
    logout_reason = 'account_status_' || p_account_status::text
  where profile_id = v_target.id
    and logout_at is null;

  delete from auth.sessions
  where user_id = v_target.id;

  if p_account_status <> 'active' then
    if v_target.role in ('manager', 'hr', 'sales_manager') then
      update public.role_assignment_history
      set
        ended_at = now(),
        reason = concat_ws('; ', nullif(reason, ''), btrim(p_reason))
      where organization_id = v_actor.organization_id
        and profile_id = v_target.id
        and role = v_target.role
        and ended_at is null;
    end if;
  elsif v_target.role in ('manager', 'hr', 'sales_manager')
    and not exists (
      select 1
      from public.role_assignment_history rah
      where rah.organization_id = v_actor.organization_id
        and rah.profile_id = v_target.id
        and rah.role = v_target.role
        and rah.ended_at is null
    ) then
    insert into public.role_assignment_history (
      organization_id,
      role,
      profile_id,
      assigned_by_profile_id,
      reason
    )
    values (
      v_actor.organization_id,
      v_target.role,
      v_target.id,
      v_actor.id,
      btrim(p_reason)
    );
  end if;

  if p_account_status = 'active' then
    if v_target.role = 'manager' then
      update public.profiles
      set reports_to_profile_id = v_target.id
      where organization_id = v_actor.organization_id
        and role in ('hr', 'sales_manager')
        and id <> v_target.id
        and deleted_at is null;
    elsif v_target.role = 'hr' then
      update public.profiles
      set reports_to_profile_id = v_target.id
      where organization_id = v_actor.organization_id
        and role in ('chef', 'part_time_chef')
        and id <> v_target.id
        and deleted_at is null;
    elsif v_target.role = 'sales_manager' then
      update public.profiles
      set reports_to_profile_id = v_target.id
      where organization_id = v_actor.organization_id
        and role = 'sales'
        and id <> v_target.id
        and deleted_at is null;
    end if;
  end if;

  insert into public.notifications (
    organization_id,
    recipient_profile_id,
    notification_type,
    title,
    body,
    entity_type,
    entity_id
  )
  values (
    v_actor.organization_id,
    v_target.id,
    'account_status',
    'Account status changed',
    'Your account status is now ' || replace(p_account_status::text, '_', ' ') || '.',
    'profile',
    v_target.id
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'profile.account_status_changed',
    'profile',
    v_target.id,
    v_before,
    jsonb_build_object(
      'account_status', v_target.account_status,
      'session_version', v_target.session_version
    ),
    btrim(p_reason),
    p_request_id
  );

  return jsonb_build_object(
    'id', v_target.id,
    'account_status', v_target.account_status,
    'session_version', v_target.session_version,
    'changed', true
  );
end;
$$;

create or replace function public.replace_role_holder(
  p_target_profile_id uuid,
  p_role public.profile_role,
  p_reason text,
  p_expected_current_holder_id uuid default null,
  p_actor_profile_id uuid default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_outgoing public.profiles%rowtype;
  v_expected_manager uuid;
  v_target_before jsonb;
  v_outgoing_id uuid;
begin
  if p_role not in ('manager', 'hr', 'sales_manager') then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'REASON_REQUIRED';
  end if;

  select *
  into strict v_actor
  from public.profiles
  where id = public.resolve_rpc_actor(p_actor_profile_id)
    and account_status = 'active'
    and deleted_at is null
  for update;

  if not exists (
    select 1
    from public.organizations o
    where o.id = v_actor.organization_id
      and o.is_active
  ) then
    raise exception using errcode = '42501', message = 'ORGANIZATION_INACTIVE';
  end if;

  if not (
    (v_actor.role = 'director' and p_role in ('manager', 'hr', 'sales_manager'))
    or (v_actor.role = 'manager' and p_role in ('hr', 'sales_manager'))
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select *
  into strict v_target
  from public.profiles
  where id = p_target_profile_id
    and organization_id = v_actor.organization_id
    and deleted_at is null
  for update;

  if v_target.role <> p_role then
    raise exception using errcode = '22023', message = 'ROLE_CANDIDATE_MISMATCH';
  end if;

  select *
  into v_outgoing
  from public.profiles
  where organization_id = v_actor.organization_id
    and role = p_role
    and account_status = 'active'
    and deleted_at is null
  for update;

  v_outgoing_id := v_outgoing.id;

  if p_expected_current_holder_id is not null
     and v_outgoing_id is distinct from p_expected_current_holder_id then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if v_outgoing_id = v_target.id then
    return jsonb_build_object(
      'role', p_role,
      'profile_id', v_target.id,
      'outgoing_profile_id', v_outgoing_id,
      'changed', false
    );
  end if;

  if v_target.account_status <> 'inactive' then
    raise exception using errcode = '23514', message = 'ROLE_CANDIDATE_NOT_INACTIVE';
  end if;

  if p_role = 'manager' then
    select id
    into v_expected_manager
    from public.profiles
    where organization_id = v_actor.organization_id
      and role = 'director'
      and account_status = 'active'
      and deleted_at is null
    limit 1;
  else
    select id
    into v_expected_manager
    from public.profiles
    where organization_id = v_actor.organization_id
      and role = 'manager'
      and account_status = 'active'
      and deleted_at is null
      and id <> v_target.id
    limit 1;
  end if;

  if v_expected_manager is null then
    raise exception using errcode = '23514', message = 'REPORTING_MANAGER_REQUIRED';
  end if;

  if v_outgoing_id is not null then
    update public.profiles
    set
      account_status = 'inactive',
      session_version = session_version + 1
    where id = v_outgoing_id;

    update public.login_sessions
    set
      logout_at = now(),
      logout_reason = 'role_replaced'
    where profile_id = v_outgoing_id
      and logout_at is null;

    delete from auth.sessions
    where user_id = v_outgoing_id;

    update public.role_assignment_history
    set
      ended_at = now(),
      reason = concat_ws('; ', nullif(reason, ''), btrim(p_reason))
    where organization_id = v_actor.organization_id
      and profile_id = v_outgoing_id
      and role = p_role
      and ended_at is null;

    perform public.write_audit_log(
      v_actor.organization_id,
      v_actor.id,
      'role_holder.deactivated',
      'profile',
      v_outgoing_id,
      jsonb_build_object('role', p_role, 'account_status', 'active'),
      jsonb_build_object('role', p_role, 'account_status', 'inactive'),
      btrim(p_reason),
      p_request_id
    );
  end if;

  v_target_before := jsonb_build_object(
    'role', v_target.role,
    'account_status', v_target.account_status,
    'reports_to_profile_id', v_target.reports_to_profile_id,
    'session_version', v_target.session_version
  );

  update public.role_assignment_history
  set
    ended_at = now(),
    reason = concat_ws('; ', nullif(reason, ''), 'Reassigned to ' || p_role::text)
  where organization_id = v_actor.organization_id
    and profile_id = v_target.id
    and ended_at is null;

  update public.profiles
  set
    role = p_role,
    reports_to_profile_id = v_expected_manager,
    account_status = 'active',
    session_version = session_version + 1
  where id = v_target.id
  returning * into v_target;

  -- Reparent the whole branch even if the former holder was deactivated in an
  -- earlier account-status transaction and is therefore no longer "active".
  if p_role = 'manager' then
    update public.profiles
    set reports_to_profile_id = v_target.id
    where organization_id = v_actor.organization_id
      and role in ('hr', 'sales_manager')
      and id <> v_target.id
      and deleted_at is null;
  elsif p_role = 'hr' then
    update public.profiles
    set reports_to_profile_id = v_target.id
    where organization_id = v_actor.organization_id
      and role in ('chef', 'part_time_chef')
      and id <> v_target.id
      and deleted_at is null;
  else
    update public.profiles
    set reports_to_profile_id = v_target.id
    where organization_id = v_actor.organization_id
      and role = 'sales'
      and id <> v_target.id
      and deleted_at is null;
  end if;

  update public.login_sessions
  set
    logout_at = now(),
    logout_reason = 'role_changed'
  where profile_id = v_target.id
    and logout_at is null;

  delete from auth.sessions
  where user_id = v_target.id;

  insert into public.role_assignment_history (
    organization_id,
    role,
    profile_id,
    assigned_by_profile_id,
    reason
  )
  values (
    v_actor.organization_id,
    p_role,
    v_target.id,
    v_actor.id,
    btrim(p_reason)
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'role_holder.replaced',
    'role_assignment',
    v_target.id,
    v_target_before || jsonb_build_object('outgoing_profile_id', v_outgoing_id),
    jsonb_build_object(
      'role', v_target.role,
      'account_status', v_target.account_status,
      'reports_to_profile_id', v_target.reports_to_profile_id,
      'session_version', v_target.session_version,
      'outgoing_profile_id', v_outgoing_id
    ),
    btrim(p_reason),
    p_request_id
  );

  return jsonb_build_object(
    'role', p_role,
    'profile_id', v_target.id,
    'outgoing_profile_id', v_outgoing_id,
    'session_version', v_target.session_version,
    'changed', true
  );
end;
$$;

-- Cross-row role checks keep service-role ingestion and RPCs from ever linking a
-- valid tenant row to an invalid role holder.
create or replace function public.validate_sales_assignee()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  if tg_table_name = 'leads' then
    v_profile_id := new.assigned_sales_profile_id;
  else
    v_profile_id := new.assigned_sales_profile_id;
  end if;

  if v_profile_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = v_profile_id
      and p.organization_id = new.organization_id
      and p.role = 'sales'
      and p.account_status = 'active'
      and p.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'INVALID_SALES_ASSIGNEE';
  end if;

  return new;
end;
$$;

create trigger leads_validate_sales_assignee
before insert or update of assigned_sales_profile_id, organization_id on public.leads
for each row execute function public.validate_sales_assignee();
create trigger conversations_validate_sales_assignee
before insert or update of assigned_sales_profile_id, organization_id on public.conversations
for each row execute function public.validate_sales_assignee();

create or replace function public.validate_follow_up_assignee()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = new.assigned_profile_id
      and p.organization_id = new.organization_id
      and p.role = 'sales'
      and p.account_status = 'active'
      and p.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'INVALID_SALES_ASSIGNEE';
  end if;
  return new;
end;
$$;

create trigger follow_ups_validate_sales_assignee
before insert or update of assigned_profile_id, organization_id on public.follow_ups
for each row execute function public.validate_follow_up_assignee();

create or replace function public.validate_booking_seller()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = new.sold_by_profile_id
      and p.organization_id = new.organization_id
      and p.role in ('sales', 'sales_manager')
      and p.account_status = 'active'
      and p.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'INVALID_SALES_OWNER';
  end if;
  return new;
end;
$$;

create trigger bookings_validate_seller
before insert or update of sold_by_profile_id, organization_id on public.bookings
for each row execute function public.validate_booking_seller();

create or replace function public.validate_booking_chef()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = new.chef_profile_id
      and p.organization_id = new.organization_id
      and p.role in ('chef', 'part_time_chef')
      and p.account_status = 'active'
      and p.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'INVALID_CHEF_ASSIGNEE';
  end if;
  return new;
end;
$$;

create trigger booking_assignments_validate_chef
before insert or update of chef_profile_id, organization_id on public.booking_assignments
for each row execute function public.validate_booking_chef();

create or replace function public.validate_profile_private_storage_paths()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.aadhaar_storage_path is not null
     and new.aadhaar_storage_path not like
       new.organization_id::text || '/' || new.id::text || '/aadhaar/%' then
    raise exception using errcode = '23514', message = 'INVALID_EMPLOYEE_STORAGE_PATH';
  end if;

  if new.part_time_payment_proof_path is not null
     and new.part_time_payment_proof_path not like
       new.organization_id::text || '/' || new.id::text || '/part-time-payment-proof/%' then
    raise exception using errcode = '23514', message = 'INVALID_EMPLOYEE_STORAGE_PATH';
  end if;

  return new;
end;
$$;

create trigger profiles_validate_private_storage_paths
before insert or update of
  organization_id,
  aadhaar_storage_path,
  part_time_payment_proof_path
on public.profiles
for each row execute function public.validate_profile_private_storage_paths();

create or replace function public.validate_booking_payment_proof_path()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.proof_storage_path is not null
     and new.proof_storage_path is distinct from old.proof_storage_path then
    raise exception using errcode = '23514', message = 'PAYMENT_PROOF_IMMUTABLE';
  end if;

  if new.proof_storage_path is not null
     and new.proof_storage_path not like
       new.organization_id::text || '/' ||
       new.submitted_by_profile_id::text || '/' ||
       new.booking_id::text || '/%' then
    raise exception using errcode = '23514', message = 'INVALID_PAYMENT_PROOF_PATH';
  end if;

  return new;
end;
$$;

create trigger booking_payments_validate_proof_path
before insert or update of
  organization_id,
  booking_id,
  submitted_by_profile_id,
  proof_storage_path
on public.booking_payments
for each row execute function public.validate_booking_payment_proof_path();

create or replace function public.validate_expense_attachment_path()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_submitter_id uuid;
begin
  select e.submitted_by_profile_id
  into strict v_submitter_id
  from public.expenses e
  where e.id = new.expense_id
    and e.organization_id = new.organization_id;

  if new.storage_path not like
    new.organization_id::text || '/' ||
    v_submitter_id::text || '/' ||
    new.expense_id::text || '/%' then
    raise exception using errcode = '23514', message = 'INVALID_EXPENSE_ATTACHMENT_PATH';
  end if;

  return new;
end;
$$;

create trigger expense_attachments_validate_path
before insert or update of organization_id, expense_id, storage_path
on public.expense_attachments
for each row execute function public.validate_expense_attachment_path();

create or replace function public.validate_message_conversation_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_lead_id uuid;
  v_channel text;
begin
  select c.lead_id, c.channel
  into strict v_lead_id, v_channel
  from public.conversations c
  where c.id = new.conversation_id
    and c.organization_id = new.organization_id;

  if new.lead_id <> v_lead_id then
    raise exception using errcode = '23514', message = 'MESSAGE_LEAD_CONVERSATION_MISMATCH';
  end if;

  if new.reply_to_message_id is not null and not exists (
    select 1
    from public.messages m
    where m.id = new.reply_to_message_id
      and m.organization_id = new.organization_id
      and m.conversation_id = new.conversation_id
  ) then
    raise exception using errcode = '23514', message = 'REPLY_CONVERSATION_MISMATCH';
  end if;

  if new.direction = 'internal' then
    new.provider := 'internal';
    new.provider_message_id := null;
    new.provider_event_id := null;
    new.channel := v_channel;
    new.status := 'sent';
    new.recipient_phone_e164 := null;
    new.provider_created_at := null;
    new.sent_at := coalesce(new.sent_at, now());
    new.delivered_at := null;
    new.read_at := null;
    new.failed_at := null;
    new.failure_code := null;
    new.failure_message_safe := null;
    new.idempotency_key := null;
    new.created_at := now();
    new.updated_at := now();

    if new.attachment_storage_path is not null
       and new.attachment_storage_path not like
         new.organization_id::text || '/' ||
         new.conversation_id::text || '/' ||
       new.sender_profile_id::text || '/%' then
      raise exception using errcode = '23514', message = 'INVALID_CONVERSATION_MEDIA_PATH';
    end if;
  end if;

  if new.direction = 'outbound'
     and new.attachment_storage_path is not null
     and (
       new.sender_profile_id is null
       or new.attachment_storage_path not like
         new.organization_id::text || '/' ||
         new.conversation_id::text || '/' ||
         new.sender_profile_id::text || '/%'
     ) then
    raise exception using errcode = '23514', message = 'INVALID_CONVERSATION_MEDIA_PATH';
  end if;

  if new.direction = 'inbound'
     and new.attachment_storage_path is not null
     and new.attachment_storage_path not like
       new.organization_id::text || '/' ||
       new.conversation_id::text || '/provider/%' then
    raise exception using errcode = '23514', message = 'INVALID_CONVERSATION_MEDIA_PATH';
  end if;

  return new;
end;
$$;

create trigger messages_validate_conversation_integrity
before insert or update of
  conversation_id,
  lead_id,
  reply_to_message_id,
  direction,
  provider,
  provider_message_id,
  provider_event_id,
  channel,
  status
on public.messages
for each row execute function public.validate_message_conversation_integrity();

create or replace function public.validate_conversation_read_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.last_read_message_id is not null and not exists (
    select 1
    from public.messages m
    where m.id = new.last_read_message_id
      and m.organization_id = new.organization_id
      and m.conversation_id = new.conversation_id
  ) then
    raise exception using errcode = '23514', message = 'READ_MESSAGE_CONVERSATION_MISMATCH';
  end if;
  new.last_read_at := now();
  return new;
end;
$$;

create trigger conversation_reads_validate_message
before insert or update of
  conversation_id,
  last_read_message_id,
  organization_id
on public.conversation_reads
for each row execute function public.validate_conversation_read_integrity();

create or replace function public.enforce_task_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if old.assigned_to_profile_id = auth.uid()
     and old.assigned_by_profile_id <> auth.uid()
     and not public.is_manager_or_director()
     and (
       new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.assigned_to_profile_id is distinct from old.assigned_to_profile_id
       or new.assigned_by_profile_id is distinct from old.assigned_by_profile_id
       or new.booking_id is distinct from old.booking_id
       or new.lead_id is distinct from old.lead_id
       or new.due_at is distinct from old.due_at
       or new.priority is distinct from old.priority
     ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  return new;
end;
$$;

create trigger tasks_enforce_update_scope
before update on public.tasks
for each row execute function public.enforce_task_update_scope();

create or replace function public.enforce_expense_review_scope()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_role public.profile_role;
  v_limit numeric(12,2);
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if (
    new.booking_id is distinct from old.booking_id
    or new.category is distinct from old.category
    or new.amount is distinct from old.amount
    or new.reason is distinct from old.reason
  ) and not (
    old.submitted_by_profile_id = auth.uid()
    and old.status = 'pending'
    and new.status = 'pending'
  ) then
    raise exception using errcode = '42501', message = 'EXPENSE_SUBMISSION_LOCKED';
  end if;

  if new.status = old.status then
    if new.reviewed_by_profile_id is distinct from old.reviewed_by_profile_id
       or new.reviewed_at is distinct from old.reviewed_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception using errcode = '42501', message = 'EXPENSE_REVIEW_STATE_LOCKED';
    end if;
    return new;
  end if;

  v_role := public.current_role();

  if v_role = 'hr' then
    if new.status not in ('verified', 'rejected') then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
  elsif v_role = 'manager' then
    if new.status not in ('verified', 'approved', 'rejected') then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
    if new.status = 'approved' then
      select manager_expense_limit
      into strict v_limit
      from public.organization_settings
      where organization_id = new.organization_id;
      if new.amount > v_limit then
        raise exception using errcode = '42501', message = 'EXPENSE_ABOVE_MANAGER_LIMIT';
      end if;
    end if;
  elsif v_role <> 'director' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  new.reviewed_by_profile_id := auth.uid();
  new.reviewed_at := now();
  return new;
end;
$$;

create trigger expenses_enforce_review_scope
before update on public.expenses
for each row execute function public.enforce_expense_review_scope();

create or replace function public.audit_expense_review()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.status is distinct from old.status
     or new.reviewed_by_profile_id is distinct from old.reviewed_by_profile_id
     or new.reviewed_at is distinct from old.reviewed_at
     or new.rejection_reason is distinct from old.rejection_reason then
    perform public.write_audit_log(
      new.organization_id,
      auth.uid(),
      'expense.reviewed',
      'expense',
      new.id,
      jsonb_build_object(
        'status', old.status,
        'reviewed_by_profile_id', old.reviewed_by_profile_id,
        'reviewed_at', old.reviewed_at,
        'rejection_reason', old.rejection_reason,
        'amount', old.amount
      ),
      jsonb_build_object(
        'status', new.status,
        'reviewed_by_profile_id', new.reviewed_by_profile_id,
        'reviewed_at', new.reviewed_at,
        'rejection_reason', new.rejection_reason,
        'amount', new.amount
      )
    );
  end if;
  return new;
end;
$$;

create trigger expenses_audit_review
after update on public.expenses
for each row execute function public.audit_expense_review();

revoke all on function public.resolve_rpc_actor(uuid) from public, anon, authenticated;
revoke all on function public.bootstrap_organization(text, text, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_organization(text, text, uuid, text, text, text, text, text)
  to service_role;
revoke all on function public.create_team_member_profile(
  uuid,
  text,
  text,
  public.profile_role,
  public.account_status,
  uuid,
  date,
  public.payment_type,
  numeric,
  text,
  text,
  numeric,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.create_team_member_profile(
  uuid,
  text,
  text,
  public.profile_role,
  public.account_status,
  uuid,
  date,
  public.payment_type,
  numeric,
  text,
  text,
  numeric,
  uuid,
  text
) to service_role;
revoke all on function public.update_account_status(
  uuid,
  public.account_status,
  text,
  uuid,
  text
) from public, anon;
grant execute on function public.update_account_status(
  uuid,
  public.account_status,
  text,
  uuid,
  text
) to service_role;
revoke all on function public.replace_role_holder(
  uuid,
  public.profile_role,
  text,
  uuid,
  uuid,
  text
) from public, anon;
grant execute on function public.replace_role_holder(
  uuid,
  public.profile_role,
  text,
  uuid,
  uuid,
  text
) to service_role;

comment on function public.bootstrap_organization(text, text, uuid, text, text, text, text, text)
  is 'Service-role-only, globally one-time organization/Director bootstrap transaction.';
comment on function public.create_team_member_profile(
  uuid,
  text,
  text,
  public.profile_role,
  public.account_status,
  uuid,
  date,
  public.payment_type,
  numeric,
  text,
  text,
  numeric,
  uuid,
  text
) is 'Service-role companion for Auth Admin user creation; validates caller hierarchy and creates the normalized profile atomically.';
