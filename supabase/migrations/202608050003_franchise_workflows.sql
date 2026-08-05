-- Khana Banao CRM: franchise-aware RPCs and read models.
--
-- The previous migration isolated table access. SECURITY DEFINER functions run
-- as the owner and are not subject to RLS, so every read model that aggregates
-- tenant data needs its own franchise predicate. Those predicates are applied
-- here by rewriting the stored definition, the same asserted-patch technique
-- 202607240002 already uses, so a pattern that stops matching fails the
-- migration instead of silently leaking another franchise's rows.

-- ---------------------------------------------------------------------------
-- 1. Franchise predicates for SECURITY DEFINER read models
-- ---------------------------------------------------------------------------

-- Read models that resolve the caller into a `v_profile` record. A Director has
-- a null franchise_id and keeps organization-wide visibility.
do $migration$
declare
  r record;
  v_definition text;
  v_patched text;
  v_expected constant integer := 7;
  v_count integer := 0;
begin
  for r in
    select p.oid, n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'get_bookings_page',
        'get_conversation_inbox',
        'get_conversation_reference_data',
        'get_dashboard_lead_counts',
        'get_dashboard_metric_counts',
        'get_leads_page',
        'get_sales_operations_snapshot'
      )
  loop
    v_definition := pg_get_functiondef(r.oid);

    v_patched := regexp_replace(
      v_definition,
      '(\w+)\.organization_id = v_profile\.organization_id',
      '\1.organization_id = v_profile.organization_id and (v_profile.franchise_id is null or \1.franchise_id = v_profile.franchise_id)',
      'g'
    );

    if v_patched = v_definition then
      raise exception 'franchise scope patch did not match in %.%', r.nspname, r.proname;
    end if;

    -- A franchise owner reads its own franchise the way a Director reads the
    -- organization, so it joins every operational role gate.
    v_patched := regexp_replace(
      v_patched,
      '''director''(\s*),(\s*)''manager''',
      '''director'', ''franchise'', ''manager''',
      'g'
    );

    execute v_patched;
    v_count := v_count + 1;
  end loop;

  if v_count <> v_expected then
    raise exception 'expected % v_profile read models, patched %', v_expected, v_count;
  end if;
end
$migration$;

-- Row predicates and read models that resolve the caller through
-- public.current_organization_id().
do $migration$
declare
  r record;
  v_definition text;
  v_patched text;
  v_expected constant integer := 15;
  v_count integer := 0;
begin
  for r in
    select p.oid, n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and (n.nspname, p.proname) in (
        ('app_private', 'can_read_audit_log'),
        ('app_private', 'can_read_booking'),
        ('app_private', 'can_read_conversation'),
        ('app_private', 'can_read_conversation_storage_object'),
        ('app_private', 'can_read_expense'),
        ('app_private', 'can_read_expense_storage_object'),
        ('app_private', 'can_read_lead'),
        ('app_private', 'can_read_meeting'),
        ('app_private', 'can_read_workforce_booking'),
        ('app_private', 'get_booking_assignee_summaries'),
        ('app_private', 'get_conversation_inbox'),
        ('app_private', 'get_my_payroll_earnings'),
        ('app_private', 'get_workforce_bookings'),
        ('app_private', 'list_chef_availability'),
        ('public', 'can_read_invoice')
      )
  loop
    v_definition := pg_get_functiondef(r.oid);

    v_patched := regexp_replace(
      v_definition,
      '(\w+)\.organization_id = public\.current_organization_id\(\)',
      '\1.organization_id = public.current_organization_id() and (public.is_director() or \1.franchise_id = public.current_franchise_id())',
      'g'
    );

    if v_patched = v_definition then
      raise exception 'franchise scope patch did not match in %.%', r.nspname, r.proname;
    end if;

    v_patched := regexp_replace(
      v_patched,
      '''director''(\s*),(\s*)''manager''',
      '''director'', ''franchise'', ''manager''',
      'g'
    );

    execute v_patched;
    v_count := v_count + 1;
  end loop;

  if v_count <> v_expected then
    raise exception 'expected % current_organization_id read models, patched %', v_expected, v_count;
  end if;
end
$migration$;

-- can_read_audit_log branches on the Manager role; the franchise owner needs
-- the same organization-wide entity coverage inside its own franchise.
do $migration$
declare
  v_definition text := pg_get_functiondef('app_private.can_read_audit_log(uuid)'::regprocedure);
  v_original constant text := 'if public.current_role() = ''manager'' then';
  v_replacement constant text :=
    'if public.current_role() in (''franchise'', ''manager'') then';
begin
  if position(v_original in v_definition) = 0 then
    raise exception 'can_read_audit_log manager branch was not found';
  end if;

  execute replace(v_definition, v_original, v_replacement);
end
$migration$;

-- ---------------------------------------------------------------------------
-- 2. Franchise-aware account administration
-- ---------------------------------------------------------------------------

-- A franchise owner administers every role inside its own franchise. The
-- profile trigger from the previous migration is what confines it there.
do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.update_account_status(uuid,public.account_status,text,uuid,text)'::regprocedure
  );
  v_original constant text :=
    'or (v_actor.role = ''hr'' and v_target.role in (''chef'', ''part_time_chef''))';
  v_replacement constant text :=
    'or (v_actor.role = ''franchise'' and v_target.role in (''manager'', ''hr'', ''sales_manager'', ''sales'', ''chef'', ''part_time_chef''))'
    || E'\n      or (v_actor.role = ''hr'' and v_target.role in (''chef'', ''part_time_chef''))';
begin
  if position(v_original in v_definition) = 0 then
    raise exception 'update_account_status hr branch was not found';
  end if;

  execute replace(v_definition, v_original, v_replacement);
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.replace_role_holder(uuid,public.profile_role,text,uuid,uuid,text)'::regprocedure
  );
  v_role_gate constant text := 'if p_role not in (''manager'', ''hr'', ''sales_manager'') then';
  v_role_gate_new constant text :=
    'if p_role not in (''franchise'', ''manager'', ''hr'', ''sales_manager'') then';
  v_director constant text :=
    '(v_actor.role = ''director'' and p_role in (''manager'', ''hr'', ''sales_manager''))';
  v_director_new constant text :=
    '(v_actor.role = ''director'' and p_role in (''franchise'', ''manager'', ''hr'', ''sales_manager''))';
  v_manager constant text := 'or (v_actor.role = ''manager'' and p_role in (''hr'', ''sales_manager''))';
  v_manager_new constant text :=
    'or (v_actor.role = ''franchise'' and p_role in (''manager'', ''hr'', ''sales_manager''))'
    || E'\n    or (v_actor.role = ''manager'' and p_role in (''hr'', ''sales_manager''))';
begin
  if position(v_role_gate in v_definition) = 0
     or position(v_director in v_definition) = 0
     or position(v_manager in v_definition) = 0 then
    raise exception 'replace_role_holder permission clauses were not found';
  end if;

  v_definition := replace(v_definition, v_role_gate, v_role_gate_new);
  v_definition := replace(v_definition, v_director, v_director_new);
  v_definition := replace(v_definition, v_manager, v_manager_new);

  execute v_definition;
end
$migration$;

-- Team member creation needs the target franchise, so the parameter list
-- changes and the previous overload is removed rather than shadowed.
drop function if exists public.create_team_member_profile(
  uuid, text, text, public.profile_role, public.account_status, uuid, date,
  public.payment_type, numeric, text, text, numeric, uuid, text
);

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
  p_request_id text default null,
  p_franchise_id uuid default null
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
  v_franchise_id uuid;
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
      (v_actor.role = 'director' and p_role <> 'director')
      or (
        v_actor.role = 'franchise'
        and p_role in ('manager', 'hr', 'sales_manager', 'sales', 'chef', 'part_time_chef')
      )
      or (
        v_actor.role = 'manager'
        and p_role in ('hr', 'sales_manager', 'sales', 'chef', 'part_time_chef')
      )
      or (v_actor.role = 'hr' and p_role in ('chef', 'part_time_chef'))
      or (v_actor.role = 'sales_manager' and p_role = 'sales')
    ) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  -- Only the Director chooses a franchise. Everyone else stays inside theirs.
  if v_actor.role = 'director' then
    v_franchise_id := p_franchise_id;
  else
    v_franchise_id := v_actor.franchise_id;

    if p_franchise_id is not null and p_franchise_id <> v_franchise_id then
      raise exception using errcode = '42501', message = 'FRANCHISE_SCOPE_VIOLATION';
    end if;
  end if;

  if v_franchise_id is null then
    raise exception using errcode = '23514', message = 'FRANCHISE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.franchises f
    where f.id = v_franchise_id
      and f.organization_id = v_actor.organization_id
      and f.is_active
      and f.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'FRANCHISE_NOT_FOUND';
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

  -- The reporting parent must sit in the same franchise. Only a franchise owner
  -- reports upward to the organization-level Director.
  select p.id
  into v_expected_manager
  from public.profiles p
  where p.organization_id = v_actor.organization_id
    and p.account_status = 'active'
    and p.deleted_at is null
    and p.role = case p_role
      when 'franchise' then 'director'::public.profile_role
      when 'manager' then 'franchise'::public.profile_role
      when 'hr' then 'manager'::public.profile_role
      when 'sales_manager' then 'manager'::public.profile_role
      when 'sales' then 'sales_manager'::public.profile_role
      when 'chef' then 'hr'::public.profile_role
      when 'part_time_chef' then 'hr'::public.profile_role
      else null
    end
    and (p.role = 'director' or p.franchise_id = v_franchise_id)
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
    franchise_id,
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
    v_franchise_id,
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
    franchise_id,
    role,
    profile_id,
    assigned_by_profile_id,
    reason
  )
  values (
    v_actor.organization_id,
    v_franchise_id,
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
      'franchise_id', v_profile.franchise_id,
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
    'franchise_id', v_profile.franchise_id,
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

revoke all on function public.create_team_member_profile(
  uuid, text, text, public.profile_role, public.account_status, uuid, date,
  public.payment_type, numeric, text, text, numeric, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_team_member_profile(
  uuid, text, text, public.profile_role, public.account_status, uuid, date,
  public.payment_type, numeric, text, text, numeric, uuid, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Franchise registry workflows (Director only)
-- ---------------------------------------------------------------------------

create or replace function app_private.create_franchise(
  p_name text,
  p_code text,
  p_city text default null,
  p_contact_phone_e164 text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_franchise public.franchises%rowtype;
begin
  select *
  into v_actor
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and deleted_at is null;

  if not found or not public.is_director() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null
     or nullif(btrim(coalesce(p_code, '')), '') is null then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  insert into public.franchises (
    organization_id, name, code, city, contact_phone_e164, notes, created_by_profile_id
  )
  values (
    v_actor.organization_id,
    btrim(p_name),
    upper(btrim(p_code)),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_contact_phone_e164, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_actor.id
  )
  returning * into v_franchise;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'franchise.created',
    'franchise',
    v_franchise.id,
    null,
    jsonb_build_object('id', v_franchise.id, 'name', v_franchise.name, 'code', v_franchise.code),
    'Franchise created',
    null
  );

  return jsonb_build_object(
    'id', v_franchise.id,
    'name', v_franchise.name,
    'code', v_franchise.code,
    'is_active', v_franchise.is_active
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'DUPLICATE_FRANCHISE';
end;
$$;

create or replace function public.create_franchise(
  p_name text,
  p_code text,
  p_city text default null,
  p_contact_phone_e164 text default null,
  p_notes text default null
)
returns jsonb
language sql
volatile
set search_path = app_private, pg_temp
as $$
  select * from app_private.create_franchise(p_name, p_code, p_city, p_contact_phone_e164, p_notes)
$$;

create or replace function app_private.update_franchise(
  p_franchise_id uuid,
  p_name text default null,
  p_city text default null,
  p_contact_phone_e164 text default null,
  p_notes text default null,
  p_is_active boolean default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.franchises%rowtype;
  v_after public.franchises%rowtype;
begin
  select *
  into v_actor
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and deleted_at is null;

  if not found or not public.is_director() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select *
  into v_before
  from public.franchises
  where id = p_franchise_id
    and organization_id = v_actor.organization_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'FRANCHISE_NOT_FOUND';
  end if;

  -- Deactivating a franchise must not strand its staff with a live login.
  if p_is_active is false and v_before.is_active then
    if exists (
      select 1
      from public.profiles p
      where p.franchise_id = v_before.id
        and p.account_status = 'active'
        and p.deleted_at is null
    ) then
      raise exception using errcode = '23514', message = 'FRANCHISE_HAS_ACTIVE_STAFF';
    end if;
  end if;

  update public.franchises
  set
    name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    city = case when p_city is null then city else nullif(btrim(p_city), '') end,
    contact_phone_e164 = case
      when p_contact_phone_e164 is null then contact_phone_e164
      else nullif(btrim(p_contact_phone_e164), '')
    end,
    notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
    is_active = coalesce(p_is_active, is_active)
  where id = v_before.id
  returning * into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'franchise.updated',
    'franchise',
    v_after.id,
    jsonb_build_object('name', v_before.name, 'city', v_before.city, 'is_active', v_before.is_active),
    jsonb_build_object('name', v_after.name, 'city', v_after.city, 'is_active', v_after.is_active),
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Franchise updated'),
    null
  );

  return jsonb_build_object(
    'id', v_after.id,
    'name', v_after.name,
    'code', v_after.code,
    'is_active', v_after.is_active
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'DUPLICATE_FRANCHISE';
end;
$$;

create or replace function public.update_franchise(
  p_franchise_id uuid,
  p_name text default null,
  p_city text default null,
  p_contact_phone_e164 text default null,
  p_notes text default null,
  p_is_active boolean default null,
  p_reason text default null
)
returns jsonb
language sql
volatile
set search_path = app_private, pg_temp
as $$
  select * from app_private.update_franchise(
    p_franchise_id, p_name, p_city, p_contact_phone_e164, p_notes, p_is_active, p_reason
  )
$$;

-- Provider and manually captured leads can arrive before anybody decides which
-- franchise owns them. Those rows stay organization-level until the Director
-- routes them, and the whole lead timeline moves as one unit.
create or replace function app_private.assign_lead_to_franchise(
  p_lead_id uuid,
  p_franchise_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
begin
  select *
  into v_actor
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and deleted_at is null;

  if not found or not public.is_director() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select *
  into v_lead
  from public.leads
  where id = p_lead_id
    and organization_id = v_actor.organization_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'LEAD_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.franchises f
    where f.id = p_franchise_id
      and f.organization_id = v_actor.organization_id
      and f.is_active
      and f.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'FRANCHISE_NOT_FOUND';
  end if;

  -- Handing a lead to a different franchise would carry its assigned Sales
  -- Executive across the boundary, so ownership is cleared first.
  update public.leads
  set franchise_id = p_franchise_id,
      assigned_sales_profile_id = case
        when v_lead.franchise_id is distinct from p_franchise_id then null
        else assigned_sales_profile_id
      end
  where id = v_lead.id;

  update public.lead_activities set franchise_id = p_franchise_id where lead_id = v_lead.id;
  update public.lead_assignment_history set franchise_id = p_franchise_id where lead_id = v_lead.id;
  update public.follow_ups set franchise_id = p_franchise_id where lead_id = v_lead.id;
  update public.conversations set franchise_id = p_franchise_id where lead_id = v_lead.id;
  update public.messages set franchise_id = p_franchise_id where lead_id = v_lead.id;
  update public.superfone_calls set franchise_id = p_franchise_id where lead_id = v_lead.id;
  update public.bookings set franchise_id = p_franchise_id where lead_id = v_lead.id;

  update public.conversation_assignments ca
  set franchise_id = p_franchise_id
  from public.conversations c
  where c.id = ca.conversation_id and c.lead_id = v_lead.id;

  update public.conversation_reads cr
  set franchise_id = p_franchise_id
  from public.conversations c
  where c.id = cr.conversation_id and c.lead_id = v_lead.id;

  update public.booking_payments bp
  set franchise_id = p_franchise_id
  from public.bookings b
  where b.id = bp.booking_id and b.lead_id = v_lead.id;

  update public.booking_assignments ba
  set franchise_id = p_franchise_id
  from public.bookings b
  where b.id = ba.booking_id and b.lead_id = v_lead.id;

  update public.booking_status_history bh
  set franchise_id = p_franchise_id
  from public.bookings b
  where b.id = bh.booking_id and b.lead_id = v_lead.id;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'lead.franchise_assigned',
    'lead',
    v_lead.id,
    jsonb_build_object('franchise_id', v_lead.franchise_id),
    jsonb_build_object('franchise_id', p_franchise_id),
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Lead routed to franchise'),
    null
  );

  return jsonb_build_object('id', v_lead.id, 'franchise_id', p_franchise_id);
end;
$$;

create or replace function public.assign_lead_to_franchise(
  p_lead_id uuid,
  p_franchise_id uuid,
  p_reason text default null
)
returns jsonb
language sql
volatile
set search_path = app_private, pg_temp
as $$
  select * from app_private.assign_lead_to_franchise(p_lead_id, p_franchise_id, p_reason)
$$;

revoke all on function app_private.create_franchise(text, text, text, text, text)
  from public, anon;
revoke all on function app_private.update_franchise(uuid, text, text, text, text, boolean, text)
  from public, anon;
revoke all on function app_private.assign_lead_to_franchise(uuid, uuid, text)
  from public, anon;

grant execute on function app_private.create_franchise(text, text, text, text, text) to authenticated;
grant execute on function app_private.update_franchise(uuid, text, text, text, text, boolean, text) to authenticated;
grant execute on function app_private.assign_lead_to_franchise(uuid, uuid, text) to authenticated;
grant execute on function public.create_franchise(text, text, text, text, text) to authenticated;
grant execute on function public.update_franchise(uuid, text, text, text, text, boolean, text) to authenticated;
grant execute on function public.assign_lead_to_franchise(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Lead de-duplication becomes per franchise
-- ---------------------------------------------------------------------------

-- Two franchises may legitimately serve the same customer, so the phone key is
-- scoped to the franchise instead of the organization.
drop index if exists public.lead_phone_unique;
create unique index lead_phone_unique
  on public.leads (organization_id, franchise_id, phone_normalized)
  where deleted_at is null;

comment on function public.assign_lead_to_franchise(uuid, uuid, text) is
  'Director-only routing of an organization-level lead and its full timeline into one franchise.';
