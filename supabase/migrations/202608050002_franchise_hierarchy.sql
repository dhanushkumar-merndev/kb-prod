-- Khana Banao CRM: franchise tenancy.
--
-- One Director owns the organization. The Director creates franchises, and each
-- franchise runs its own Manager, HR, Sales Manager, Sales Executives and
-- kitchen staff. A franchise-scoped user must never read or write another
-- franchise's rows; only the Director sees the whole organization.
--
-- Isolation is enforced three times over, because each layer covers a gap the
-- others cannot:
--
--   1. a RESTRICTIVE RLS policy per tenant table  -> direct PostgREST access;
--   2. a row trigger per tenant table             -> SECURITY DEFINER RPC writes,
--                                                    which bypass RLS entirely;
--   3. explicit predicates in read-model RPCs     -> SECURITY DEFINER reads
--                                                    (added in the next migration).
--
-- Rows with a null franchise_id are organization-level and remain visible only
-- to the Director, so any derivation gap fails closed.

-- ---------------------------------------------------------------------------
-- 1. Franchise registry
-- ---------------------------------------------------------------------------

create table public.franchises (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  city text check (city is null or char_length(btrim(city)) between 2 and 120),
  contact_phone_e164 text
    check (contact_phone_e164 is null or contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  notes text check (notes is null or char_length(notes) <= 2000),
  is_active boolean not null default true,
  created_by_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint franchises_id_organization_key unique (id, organization_id)
);

create unique index franchise_code_per_org
  on public.franchises (organization_id, upper(code))
  where deleted_at is null;
create unique index franchise_name_per_org
  on public.franchises (organization_id, lower(btrim(name)))
  where deleted_at is null;
create index franchises_organization_active_idx
  on public.franchises (organization_id, is_active)
  where deleted_at is null;

create trigger set_updated_at
before update on public.franchises
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Profile membership
-- ---------------------------------------------------------------------------

alter table public.profiles add column franchise_id uuid;

alter table public.franchises
  add constraint franchises_created_by_organization_fk
  foreign key (created_by_profile_id, organization_id)
  references public.profiles(id, organization_id) on delete restrict;

alter table public.profiles
  add constraint profiles_franchise_organization_fk
  foreign key (franchise_id, organization_id)
  references public.franchises(id, organization_id) on delete restrict;

-- Existing organizations keep working: their current staff move into a single
-- "Head Office" franchise so no row is left without a franchise owner.
insert into public.franchises (organization_id, name, code, created_by_profile_id)
select
  o.id,
  'Head Office',
  'HO',
  (
    select d.id
    from public.profiles d
    where d.organization_id = o.id
      and d.role = 'director'
      and d.deleted_at is null
    order by d.created_at
    limit 1
  )
from public.organizations o
where exists (
  select 1
  from public.profiles p
  where p.organization_id = o.id
    and p.role <> 'director'
);

update public.profiles p
set franchise_id = f.id
from public.franchises f
where f.organization_id = p.organization_id
  and f.code = 'HO'
  and p.role <> 'director'
  and p.franchise_id is null;

alter table public.profiles
  add constraint profile_franchise_membership_check
  check (
    case
      when role = 'director' then franchise_id is null
      else franchise_id is not null
    end
  );

create index profiles_franchise_role_status_idx
  on public.profiles (franchise_id, role, account_status)
  where deleted_at is null;

-- Role holders are unique per franchise rather than per organization, so every
-- franchise runs a full team of its own.
drop index if exists public.one_active_manager_per_org;
drop index if exists public.one_active_hr_per_org;
drop index if exists public.one_active_sales_manager_per_org;

create unique index one_active_franchise_owner_per_franchise
  on public.profiles (franchise_id)
  where role = 'franchise' and account_status = 'active' and deleted_at is null;
create unique index one_active_manager_per_franchise
  on public.profiles (franchise_id)
  where role = 'manager' and account_status = 'active' and deleted_at is null;
create unique index one_active_hr_per_franchise
  on public.profiles (franchise_id)
  where role = 'hr' and account_status = 'active' and deleted_at is null;
create unique index one_active_sales_manager_per_franchise
  on public.profiles (franchise_id)
  where role = 'sales_manager' and account_status = 'active' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. Context helpers
-- ---------------------------------------------------------------------------

create or replace function app_private.current_franchise_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p.franchise_id
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null
  limit 1;
$$;

create or replace function public.current_franchise_id()
returns uuid
language sql
stable
set search_path = app_private, pg_temp
as $$
  select * from app_private.current_franchise_id()
$$;

create or replace function app_private.is_franchise_owner()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.has_any_role(array['franchise']::public.profile_role[]);
$$;

create or replace function public.is_franchise_owner()
returns boolean
language sql
stable
set search_path = app_private, pg_temp
as $$
  select * from app_private.is_franchise_owner()
$$;

-- True when the caller may touch a row belonging to p_franchise_id. The
-- Director is organization-wide; everybody else is pinned to one franchise.
create or replace function app_private.franchise_scope_allows(p_franchise_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_director()
    or (
      p_franchise_id is not null
      and p_franchise_id = public.current_franchise_id()
    );
$$;

create or replace function public.franchise_scope_allows(p_franchise_id uuid)
returns boolean
language sql
stable
set search_path = app_private, pg_temp
as $$
  select * from app_private.franchise_scope_allows(p_franchise_id)
$$;

-- A franchise owner is a Director for its own franchise, so it inherits the
-- operational role helpers every existing policy is already written against.
-- The restrictive policies below are what keep that power inside one franchise.
create or replace function app_private.is_manager_or_director()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.has_any_role(
    array['director', 'franchise', 'manager']::public.profile_role[]
  );
$$;

create or replace function app_private.is_hr_scope_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.has_any_role(
    array['director', 'franchise', 'manager', 'hr']::public.profile_role[]
  );
$$;

create or replace function app_private.is_sales_scope_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.has_any_role(
    array['director', 'franchise', 'manager', 'sales_manager']::public.profile_role[]
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Row-level franchise stamping and enforcement
-- ---------------------------------------------------------------------------

-- Trigger arguments are (parent_table, foreign_key_column) pairs, tried in
-- order. The first parent that resolves supplies the franchise; otherwise the
-- acting profile's own franchise is used. Directors leave it null, which keeps
-- the row organization-level.
create or replace function public.apply_franchise_scope()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_franchise uuid;
  v_row_franchise uuid;
  v_parent text;
  v_column text;
  v_key uuid;
  v_resolved uuid;
  v_index integer := 0;
  v_argc integer := coalesce(array_length(TG_ARGV, 1), 0);
  v_payload jsonb;
begin
  if TG_OP = 'DELETE' then
    v_row_franchise := old.franchise_id;
  else
    if new.franchise_id is null then
      v_payload := to_jsonb(new);

      while v_index + 1 < v_argc loop
        v_parent := TG_ARGV[v_index];
        v_column := TG_ARGV[v_index + 1];
        v_key := nullif(v_payload ->> v_column, '')::uuid;

        if v_key is not null then
          execute format('select franchise_id from public.%I where id = $1', v_parent)
            into v_resolved
            using v_key;

          if v_resolved is not null then
            new.franchise_id := v_resolved;
            exit;
          end if;
        end if;

        v_index := v_index + 2;
      end loop;

      if new.franchise_id is null then
        new.franchise_id := public.current_franchise_id();
      end if;
    end if;

    v_row_franchise := new.franchise_id;
  end if;

  -- Service-role and internal work carries no end-user identity.
  if auth.uid() is null then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_actor_franchise := public.current_franchise_id();

  -- The Director is organization-wide.
  if v_actor_franchise is null then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if v_row_franchise is distinct from v_actor_franchise then
    raise exception using errcode = '42501', message = 'FRANCHISE_SCOPE_VIOLATION';
  end if;

  if TG_OP = 'UPDATE' and old.franchise_id is distinct from new.franchise_id then
    raise exception using errcode = '42501', message = 'FRANCHISE_SCOPE_VIOLATION';
  end if;

  if TG_OP = 'UPDATE' and old.franchise_id is distinct from v_actor_franchise then
    raise exception using errcode = '42501', message = 'FRANCHISE_SCOPE_VIOLATION';
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.apply_franchise_scope() from public, anon, authenticated;

-- Every franchise-scoped table gets the column, the tenant foreign key, an
-- index, the stamping/enforcement trigger and the restrictive isolation policy.
-- The trigger name is prefixed so it sorts before the existing validation
-- triggers and franchise_id is populated before anything else inspects the row.
do $migration$
declare
  r record;
  v_args text;
begin
  for r in
    select *
    from (
      values
        ('leads', array[]::text[]),
        ('lead_activities', array['leads', 'lead_id']),
        ('lead_assignment_history', array['leads', 'lead_id']),
        ('follow_ups', array['leads', 'lead_id']),
        ('conversations', array['leads', 'lead_id']),
        ('conversation_assignments', array['conversations', 'conversation_id']),
        ('conversation_reads', array['conversations', 'conversation_id']),
        ('messages', array['conversations', 'conversation_id', 'leads', 'lead_id']),
        ('message_attempts', array['messages', 'message_id']),
        ('superfone_calls', array['conversations', 'conversation_id', 'leads', 'lead_id']),
        ('bookings', array['leads', 'lead_id']),
        ('booking_status_history', array['bookings', 'booking_id']),
        ('booking_assignments', array['bookings', 'booking_id']),
        ('booking_payments', array['bookings', 'booking_id']),
        ('invoices', array['bookings', 'booking_id']),
        ('email_outbox', array['bookings', 'booking_id']),
        ('email_delivery_events', array['email_outbox', 'email_outbox_id']),
        ('temporary_workers', array[]::text[]),
        ('temporary_worker_assignments',
          array['temporary_workers', 'temporary_worker_id', 'bookings', 'booking_id']),
        ('attendance_shifts',
          array['profiles', 'profile_id',
                'temporary_workers', 'temporary_worker_id',
                'bookings', 'booking_id']),
        ('break_sessions', array['profiles', 'profile_id']),
        ('expenses', array['profiles', 'submitted_by_profile_id', 'bookings', 'booking_id']),
        ('expense_attachments', array['expenses', 'expense_id']),
        ('leave_requests', array['profiles', 'profile_id']),
        ('tasks',
          array['profiles', 'assigned_to_profile_id',
                'bookings', 'booking_id',
                'leads', 'lead_id']),
        ('meetings', array[]::text[]),
        ('meeting_attendees', array['meetings', 'meeting_id']),
        ('payroll_periods', array[]::text[]),
        ('payroll_entries', array['payroll_periods', 'payroll_period_id', 'profiles', 'profile_id']),
        ('payroll_components', array['payroll_entries', 'payroll_entry_id']),
        ('notifications', array['profiles', 'recipient_profile_id']),
        ('announcements', array[]::text[]),
        ('announcement_recipients',
          array['announcements', 'announcement_id', 'profiles', 'profile_id']),
        ('login_sessions', array['profiles', 'profile_id']),
        ('role_assignment_history', array['profiles', 'profile_id']),
        ('audit_logs', array['profiles', 'actor_profile_id'])
    ) as t(table_name, parents)
  loop
    execute format(
      'alter table public.%I add column if not exists franchise_id uuid',
      r.table_name
    );

    execute format(
      'alter table public.%I add constraint %I foreign key (franchise_id, organization_id)
         references public.franchises(id, organization_id) on delete restrict',
      r.table_name,
      r.table_name || '_franchise_org_fk'
    );

    execute format(
      'create index if not exists %I on public.%I (franchise_id)',
      r.table_name || '_franchise_idx',
      r.table_name
    );

    select coalesce(string_agg(quote_literal(value), ', '), '')
    into v_args
    from unnest(r.parents) as value;

    execute format('drop trigger if exists aa_franchise_scope on public.%I', r.table_name);
    execute format(
      'create trigger aa_franchise_scope
         before insert or update or delete on public.%I
         for each row execute function public.apply_franchise_scope(%s)',
      r.table_name,
      v_args
    );

    execute format(
      'drop policy if exists %I on public.%I',
      r.table_name || '_franchise_isolation',
      r.table_name
    );
    execute format(
      'create policy %I on public.%I
         as restrictive for all to authenticated
         using (
           franchise_id = (select public.current_franchise_id())
           or (select public.is_director())
         )
         with check (
           franchise_id = (select public.current_franchise_id())
           or (select public.is_director())
         )',
      r.table_name || '_franchise_isolation',
      r.table_name
    );
  end loop;
end
$migration$;

-- ---------------------------------------------------------------------------
-- 5. Backfill existing rows, parents before children
-- ---------------------------------------------------------------------------

update public.leads l
set franchise_id = p.franchise_id
from public.profiles p
where p.id = coalesce(l.assigned_sales_profile_id, l.created_by_profile_id)
  and l.franchise_id is null
  and p.franchise_id is not null;

update public.leads l
set franchise_id = f.id
from public.franchises f
where f.organization_id = l.organization_id
  and f.code = 'HO'
  and l.franchise_id is null;

update public.lead_activities c set franchise_id = p.franchise_id
  from public.leads p where p.id = c.lead_id and c.franchise_id is null;
update public.lead_assignment_history c set franchise_id = p.franchise_id
  from public.leads p where p.id = c.lead_id and c.franchise_id is null;
update public.follow_ups c set franchise_id = p.franchise_id
  from public.leads p where p.id = c.lead_id and c.franchise_id is null;
update public.conversations c set franchise_id = p.franchise_id
  from public.leads p where p.id = c.lead_id and c.franchise_id is null;
update public.bookings c set franchise_id = p.franchise_id
  from public.leads p where p.id = c.lead_id and c.franchise_id is null;

update public.conversation_assignments c set franchise_id = p.franchise_id
  from public.conversations p where p.id = c.conversation_id and c.franchise_id is null;
update public.conversation_reads c set franchise_id = p.franchise_id
  from public.conversations p where p.id = c.conversation_id and c.franchise_id is null;
update public.messages c set franchise_id = p.franchise_id
  from public.conversations p where p.id = c.conversation_id and c.franchise_id is null;
update public.superfone_calls c set franchise_id = p.franchise_id
  from public.conversations p where p.id = c.conversation_id and c.franchise_id is null;
update public.message_attempts c set franchise_id = p.franchise_id
  from public.messages p where p.id = c.message_id and c.franchise_id is null;

update public.booking_status_history c set franchise_id = p.franchise_id
  from public.bookings p where p.id = c.booking_id and c.franchise_id is null;
update public.booking_assignments c set franchise_id = p.franchise_id
  from public.bookings p where p.id = c.booking_id and c.franchise_id is null;
update public.booking_payments c set franchise_id = p.franchise_id
  from public.bookings p where p.id = c.booking_id and c.franchise_id is null;
update public.invoices c set franchise_id = p.franchise_id
  from public.bookings p where p.id = c.booking_id and c.franchise_id is null;
update public.email_outbox c set franchise_id = p.franchise_id
  from public.bookings p where p.id = c.booking_id and c.franchise_id is null;
update public.email_delivery_events c set franchise_id = p.franchise_id
  from public.email_outbox p where p.id = c.email_outbox_id and c.franchise_id is null;

update public.temporary_workers c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.created_by_profile_id and c.franchise_id is null;
update public.temporary_worker_assignments c set franchise_id = p.franchise_id
  from public.temporary_workers p where p.id = c.temporary_worker_id and c.franchise_id is null;

update public.attendance_shifts c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.profile_id and c.franchise_id is null;
update public.attendance_shifts c set franchise_id = p.franchise_id
  from public.temporary_workers p where p.id = c.temporary_worker_id and c.franchise_id is null;
update public.break_sessions c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.profile_id and c.franchise_id is null;

update public.expenses c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.submitted_by_profile_id and c.franchise_id is null;
update public.expense_attachments c set franchise_id = p.franchise_id
  from public.expenses p where p.id = c.expense_id and c.franchise_id is null;
update public.leave_requests c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.profile_id and c.franchise_id is null;
update public.tasks c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.assigned_to_profile_id and c.franchise_id is null;
update public.meetings c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.created_by_profile_id and c.franchise_id is null;
update public.meeting_attendees c set franchise_id = p.franchise_id
  from public.meetings p where p.id = c.meeting_id and c.franchise_id is null;

update public.payroll_entries c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.profile_id and c.franchise_id is null;
update public.payroll_components c set franchise_id = p.franchise_id
  from public.payroll_entries p where p.id = c.payroll_entry_id and c.franchise_id is null;

update public.notifications c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.recipient_profile_id and c.franchise_id is null;
update public.announcement_recipients c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.profile_id and c.franchise_id is null;
update public.login_sessions c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.profile_id and c.franchise_id is null;
update public.role_assignment_history c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.profile_id and c.franchise_id is null;
update public.audit_logs c set franchise_id = p.franchise_id
  from public.profiles p where p.id = c.actor_profile_id and c.franchise_id is null;

-- ---------------------------------------------------------------------------
-- 6. Franchise-aware reporting hierarchy
-- ---------------------------------------------------------------------------

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
      when 'franchise' then 'director'::public.profile_role
      when 'manager' then 'franchise'::public.profile_role
      when 'hr' then 'manager'::public.profile_role
      when 'sales_manager' then 'manager'::public.profile_role
      when 'sales' then 'sales_manager'::public.profile_role
      when 'chef' then 'hr'::public.profile_role
      when 'part_time_chef' then 'hr'::public.profile_role
    end;

    -- Every parent except the Director must sit in the same franchise, which is
    -- what stops a franchise team from being wired to another franchise.
    if new.reports_to_profile_id is null
       or not exists (
         select 1
         from public.profiles parent
         where parent.id = new.reports_to_profile_id
           and parent.organization_id = new.organization_id
           and parent.role = v_expected_parent_role
           and parent.account_status = 'active'
           and parent.deleted_at is null
           and (
             v_expected_parent_role = 'director'
             or parent.franchise_id = new.franchise_id
           )
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

drop trigger if exists profiles_validate_hierarchy on public.profiles;
create trigger profiles_validate_hierarchy
before insert or update of
  organization_id,
  role,
  reports_to_profile_id,
  account_status,
  franchise_id,
  part_time_payment_proof_path
on public.profiles
for each row execute function public.validate_profile_hierarchy();

-- Profiles carry franchise_id directly, so they only need the guard, not the
-- parent-derived stamping used by operational tables.
create or replace function public.enforce_profile_franchise_scope()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_franchise uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_actor_franchise := public.current_franchise_id();

  if v_actor_franchise is null then
    return new;
  end if;

  if new.franchise_id is distinct from v_actor_franchise then
    raise exception using errcode = '42501', message = 'FRANCHISE_SCOPE_VIOLATION';
  end if;

  if TG_OP = 'UPDATE' and old.franchise_id is distinct from new.franchise_id then
    raise exception using errcode = '42501', message = 'FRANCHISE_SCOPE_VIOLATION';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_profile_franchise_scope() from public, anon, authenticated;

create trigger ab_enforce_franchise_scope
before insert or update on public.profiles
for each row execute function public.enforce_profile_franchise_scope();

create policy profiles_franchise_isolation
on public.profiles
as restrictive for all to authenticated
using (
  franchise_id = (select public.current_franchise_id())
  or (select public.is_director())
)
with check (
  franchise_id = (select public.current_franchise_id())
  or (select public.is_director())
);

-- A franchise owner reads its own team the way a Director reads the whole
-- organization; the restrictive policy above keeps that inside one franchise.
drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped
on public.profiles for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and deleted_at is null
  and (
    id = public.current_profile_id()
    or public.current_role() = 'director'
    or (public.current_role() = 'franchise' and role <> 'director')
    or (public.current_role() = 'manager' and role not in ('director', 'franchise'))
    or (public.current_role() = 'hr' and role in ('chef', 'part_time_chef'))
    or (public.current_role() = 'sales_manager' and role = 'sales')
  )
);

drop policy if exists role_history_select_scoped on public.role_assignment_history;
create policy role_history_select_scoped
on public.role_assignment_history for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or public.current_role() = 'director'
    or (public.current_role() = 'franchise' and role <> 'director')
    or (public.current_role() = 'manager' and role not in ('director', 'franchise'))
    or (public.current_role() = 'hr' and public.is_workforce_profile(profile_id))
    or (public.current_role() = 'sales_manager' and public.is_sales_profile(profile_id))
  )
);

drop policy if exists login_sessions_select_own_or_admin on public.login_sessions;
create policy login_sessions_select_own_or_admin
on public.login_sessions for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or public.current_role() = 'director'
    or (
      public.current_role() in ('franchise', 'manager')
      and exists (
        select 1
        from public.profiles target
        where target.id = public.login_sessions.profile_id
          and target.organization_id = public.login_sessions.organization_id
          and target.role <> 'director'
          and (public.current_role() = 'franchise' or target.role <> 'franchise')
      )
    )
  )
);

-- ---------------------------------------------------------------------------
-- 7. Franchise registry access
-- ---------------------------------------------------------------------------

alter table public.franchises enable row level security;

create policy franchises_select_scoped
on public.franchises for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and deleted_at is null
  and (
    public.is_director()
    or id = public.current_franchise_id()
  )
);

create policy franchises_manage_director
on public.franchises for all to authenticated
using (
  public.is_director()
  and organization_id = public.current_organization_id()
)
with check (
  public.is_director()
  and organization_id = public.current_organization_id()
);

grant select, insert, update on public.franchises to authenticated;

grant execute on function public.current_franchise_id() to authenticated;
grant execute on function public.is_franchise_owner() to authenticated;
grant execute on function public.franchise_scope_allows(uuid) to authenticated;
grant execute on function app_private.current_franchise_id() to authenticated;
grant execute on function app_private.is_franchise_owner() to authenticated;
grant execute on function app_private.franchise_scope_allows(uuid) to authenticated;

comment on table public.franchises is
  'Director-owned franchise units. Every non-Director profile belongs to exactly one.';
comment on function public.apply_franchise_scope() is
  'Stamps franchise_id from a parent row or the acting profile and blocks cross-franchise writes, including from SECURITY DEFINER RPCs.';
