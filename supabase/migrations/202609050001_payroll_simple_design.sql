-- Saved monthly salary components and immutable payroll snapshots.
-- Statutory amounts are employer-configured; no statutory rates are inferred.
create table public.payroll_salary_structures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  franchise_id uuid not null references public.franchises(id),
  profile_id uuid not null,
  effective_from date not null check (extract(day from effective_from) = 1),
  paid_leave boolean not null default false,
  version integer not null default 1,
  hra numeric(12,2) not null default 0 check (hra >= 0 and hra < 'Infinity'::numeric),
  allowances numeric(12,2) not null default 0 check (allowances >= 0 and allowances < 'Infinity'::numeric),
  incentives numeric(12,2) not null default 0 check (incentives >= 0 and incentives < 'Infinity'::numeric),
  pf numeric(12,2) not null default 0 check (pf >= 0 and pf < 'Infinity'::numeric),
  esic numeric(12,2) not null default 0 check (esic >= 0 and esic < 'Infinity'::numeric),
  professional_tax numeric(12,2) not null default 0 check (professional_tax >= 0 and professional_tax < 'Infinity'::numeric),
  tds numeric(12,2) not null default 0 check (tds >= 0 and tds < 'Infinity'::numeric),
  other_deductions numeric(12,2) not null default 0 check (other_deductions >= 0 and other_deductions < 'Infinity'::numeric),
  employer_pf numeric(12,2) not null default 0 check (employer_pf >= 0 and employer_pf < 'Infinity'::numeric),
  employer_esic numeric(12,2) not null default 0 check (employer_esic >= 0 and employer_esic < 'Infinity'::numeric),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, effective_from),
  foreign key (profile_id, organization_id) references public.profiles(id, organization_id)
);
alter table public.payroll_salary_structures enable row level security;
create policy salary_read on public.payroll_salary_structures for select to authenticated
using (organization_id = public.current_organization_id() and public.is_active_profile()
  and public.franchise_scope_allows(franchise_id)
  and (public.current_role() in ('director','franchise','manager','hr') or profile_id = auth.uid()));
revoke all on public.payroll_salary_structures from anon, authenticated;
grant select on public.payroll_salary_structures to authenticated;
create trigger aa_franchise_scope before insert or update or delete on public.payroll_salary_structures
for each row execute function public.apply_franchise_scope('profiles','profile_id');

alter table public.payroll_entries
  add column attendance_days integer check (attendance_days >= 0),
  add column payable_days integer check (payable_days >= 0);

create or replace function public.save_payroll_salary_structure(p_profile_id uuid, p_values jsonb, p_expected_version integer)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_actor public.profiles%rowtype;
  v_profile public.profiles%rowtype;
  v_before public.payroll_salary_structures%rowtype;
  v_after public.payroll_salary_structures%rowtype;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if not public.is_active_profile() or v_actor.role not in ('director','hr') then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = p_profile_id
    and organization_id = v_actor.organization_id and role in ('chef','part_time_chef')
    and (v_actor.role = 'director' or franchise_id = v_actor.franchise_id) for update;
  if not found then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into v_before from public.payroll_salary_structures where profile_id = p_profile_id order by version desc limit 1;
  if p_expected_version is null or coalesce(v_before.version, 0) <> p_expected_version then
    raise exception 'PAYROLL_STATUS_CONFLICT';
  end if;
  insert into public.payroll_salary_structures (organization_id, franchise_id, profile_id, effective_from, paid_leave, version,
hra, allowances, incentives, pf, esic, professional_tax, tds, other_deductions, employer_pf, employer_esic) values (
    v_profile.organization_id, v_profile.franchise_id, v_profile.id,
    (p_values->>'effectiveFrom')::date, (p_values->>'paidLeave')::boolean, coalesce(v_before.version,0) + 1,
(p_values->>'hra')::numeric, (p_values->>'allowances')::numeric, (p_values->>'incentives')::numeric, (p_values->>'pf')::numeric, (p_values->>'esic')::numeric, (p_values->>'professional_tax')::numeric, (p_values->>'tds')::numeric, (p_values->>'other_deductions')::numeric, (p_values->>'employer_pf')::numeric, (p_values->>'employer_esic')::numeric)
  on conflict (profile_id, effective_from) do update set
    effective_from = excluded.effective_from, paid_leave = excluded.paid_leave,
    hra = excluded.hra,
    allowances = excluded.allowances,
    incentives = excluded.incentives,
    pf = excluded.pf,
    esic = excluded.esic,
    professional_tax = excluded.professional_tax,
    tds = excluded.tds,
    other_deductions = excluded.other_deductions,
    employer_pf = excluded.employer_pf,
    employer_esic = excluded.employer_esic,
    version = coalesce(v_before.version, 0) + 1, updated_at = now()
  returning * into v_after;
  perform public.write_audit_log(v_actor.organization_id, v_actor.id, 'payroll.salary_structure_saved',
    'profile', v_profile.id, to_jsonb(v_before), to_jsonb(v_after), 'Saved salary structure for future drafts', null);
end;
$$;
revoke all on function public.save_payroll_salary_structure(uuid,jsonb,integer) from public, anon;
grant execute on function public.save_payroll_salary_structure(uuid,jsonb,integer) to authenticated;

create or replace function public.recalculate_payroll_entry(p_payroll_entry_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_totals record;
  v_net numeric(12,2);
begin
  select
    coalesce(sum(pc.amount) filter (where pc.component_type = 'base_salary'), 0)::numeric(12,2)
      as base_amount,
    coalesce(sum(pc.amount) filter (where pc.component_type = 'attendance_earning'), 0)::numeric(12,2)
      as attendance_amount,
    coalesce(sum(pc.amount) filter (where pc.component_type = 'booking_earning'), 0)::numeric(12,2)
      as booking_earnings,
    coalesce(sum(pc.amount) filter (where pc.component_type = 'overtime'), 0)::numeric(12,2)
      as overtime_amount,
    coalesce(sum(pc.amount) filter (where pc.component_type = 'expense_reimbursement'), 0)::numeric(12,2)
      as expense_reimbursement,
    coalesce(sum(pc.amount) filter (where pc.component_type in ('allowance','hra','incentive')), 0)::numeric(12,2)
      as allowances,
    coalesce(sum(pc.amount) filter (where pc.component_type in ('deduction','pf','esic','professional_tax','tds','other_deduction')), 0)::numeric(12,2)
      as deductions,
    coalesce(sum(pc.amount) filter (where pc.component_type = 'advance'), 0)::numeric(12,2)
      as advances
  into strict v_totals
  from public.payroll_components pc
  where pc.payroll_entry_id = p_payroll_entry_id;

  v_net := round(
    v_totals.base_amount
    + v_totals.attendance_amount
    + v_totals.booking_earnings
    + v_totals.overtime_amount
    + v_totals.expense_reimbursement
    + v_totals.allowances
    - v_totals.deductions
    - v_totals.advances,
    2
  );

  if v_net < 0 then
    raise exception using errcode = '22023', message = 'PAYROLL_NEGATIVE_NET';
  end if;

  update public.payroll_entries
  set
    base_amount = v_totals.base_amount,
    attendance_amount = v_totals.attendance_amount,
    booking_earnings = v_totals.booking_earnings,
    overtime_amount = v_totals.overtime_amount,
    expense_reimbursement = v_totals.expense_reimbursement,
    allowances = v_totals.allowances,
    deductions = v_totals.deductions,
    advances = v_totals.advances,
    net_payable = v_net
  where id = p_payroll_entry_id;
end;
$$;

drop function public.generate_payroll_period(date,date);
create function public.generate_payroll_period(
  p_period_start date,
  p_period_end date,
  p_franchise_id uuid default null
)
returns table (
  payroll_period_id uuid,
  status public.payroll_period_status,
  entry_count integer,
  net_payable numeric
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_period public.payroll_periods%rowtype;
  v_entry record;
  v_entry_count integer;
  v_net_payable numeric(12,2);
  v_franchise_id uuid;
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

  if not found or v_actor.role not in ('director', 'hr') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_period_start is null
     or p_period_end is null
     or p_period_end < p_period_start
     or date_trunc('month', p_period_start::timestamp)
        <> date_trunc('month', p_period_end::timestamp) then
    raise exception using errcode = '22023', message = 'PAYROLL_PERIOD_INVALID';
  end if;

  v_franchise_id := coalesce(p_franchise_id, v_actor.franchise_id);
  if v_actor.role = 'director' and v_franchise_id is null then
    select (array_agg(f.id))[1] into v_franchise_id from public.franchises f
      where f.organization_id = v_actor.organization_id having count(*) = 1;
  end if;
  if v_franchise_id is null or not exists (select 1 from public.franchises f
      where f.id = v_franchise_id and f.organization_id = v_actor.organization_id)
    or (v_actor.role <> 'director' and v_franchise_id is distinct from v_actor.franchise_id) then
    raise exception 'PAYROLL_FRANCHISE_REQUIRED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor.organization_id::text, 10));

  if exists (
    select 1
    from public.payroll_periods pp
    where pp.organization_id = v_actor.organization_id
      and (pp.franchise_id is null or pp.franchise_id = v_franchise_id)
      and daterange(pp.period_start, pp.period_end, '[]')
          && daterange(p_period_start, p_period_end, '[]')
  ) then
    raise exception using errcode = '23505', message = 'PAYROLL_PERIOD_OVERLAP';
  end if;

  insert into public.payroll_periods (
    organization_id, franchise_id,
    period_start,
    period_end,
    status,
    prepared_by_profile_id
  )
  values (
    v_actor.organization_id, v_franchise_id,
    p_period_start,
    p_period_end,
    'draft',
    v_actor.id
  )
  returning * into v_period;

  with eligible_profiles as (
    select p.id
    from public.profiles p
    where p.organization_id = v_actor.organization_id and p.franchise_id = v_franchise_id
      and p.role in ('chef', 'part_time_chef')
      and p.deleted_at is null
      and coalesce(p.joining_date, p_period_start) <= p_period_end
      and (
        p.account_status = 'active'
        or exists (
          select 1
          from public.attendance_shifts s
          where s.organization_id = p.organization_id
            and s.profile_id = p.id
            and s.payroll_eligible
            and s.status in ('approved', 'corrected')
            and s.shift_date between p_period_start and p_period_end
        )
        or exists (
          select 1
          from public.expenses e
          where e.organization_id = p.organization_id
            and e.submitted_by_profile_id = p.id
            and e.status = 'approved'
            and e.reviewed_at::date between p_period_start and p_period_end
        )
      )
  )
  insert into public.payroll_entries (
    organization_id,
    payroll_period_id,
    profile_id
  )
  select
    v_actor.organization_id,
    v_period.id,
    ep.id
  from eligible_profiles ep;

  with eligible_temporary_workers as (
    select distinct s.temporary_worker_id as id
    from public.attendance_shifts s
    where s.organization_id = v_actor.organization_id and s.franchise_id = v_franchise_id
      and s.temporary_worker_id is not null
      and s.payroll_eligible
      and s.status in ('approved', 'corrected')
      and s.shift_date between p_period_start and p_period_end
  )
  insert into public.payroll_entries (
    organization_id,
    payroll_period_id,
    temporary_worker_id
  )
  select
    v_actor.organization_id,
    v_period.id,
    etw.id
  from eligible_temporary_workers etw;

  update public.payroll_entries pe set
    attendance_days = (select count(distinct s.shift_date) from public.attendance_shifts s
      where s.organization_id = pe.organization_id
        and (s.profile_id = pe.profile_id or s.temporary_worker_id = pe.temporary_worker_id)
        and s.status in ('approved','corrected') and s.payroll_eligible
        and s.shift_date between p_period_start and p_period_end),
    payable_days = (select count(*) from generate_series(p_period_start::timestamp, p_period_end::timestamp, interval '1 day') d
      where exists (select 1 from public.attendance_shifts s
        where s.organization_id = pe.organization_id
          and (s.profile_id = pe.profile_id or s.temporary_worker_id = pe.temporary_worker_id)
          and s.shift_date = d::date and s.status in ('approved','corrected') and s.payroll_eligible)
      or exists (select 1 from public.leave_requests l
        join lateral (select st.* from public.payroll_salary_structures st where st.profile_id = l.profile_id and st.effective_from <= d::date order by st.effective_from desc limit 1) st on true
        join public.profiles p on p.id = l.profile_id
        where l.profile_id = pe.profile_id and l.organization_id = pe.organization_id
          and p.payment_type = 'monthly' and d::date >= coalesce(p.joining_date, p_period_start)
          and st.paid_leave and st.effective_from <= d::date
          and l.status = 'approved' and d::date between l.start_date and l.end_date))
    where pe.payroll_period_id = v_period.id;

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'base_salary',
    'profile_pay_structure',
    round(
      coalesce(p.payment_amount, 0)
      * pe.payable_days::numeric
      / extract(
        day from (
          date_trunc('month', p_period_start::timestamp)
          + interval '1 month - 1 day'
        )
      ),
      2
    ),
    'Monthly basic salary from approved payable days'
  from public.payroll_entries pe
  join public.profiles p
    on p.id = pe.profile_id
   and p.organization_id = pe.organization_id
  where pe.payroll_period_id = v_period.id
    and p.payment_type = 'monthly'
    and coalesce(p.payment_amount, 0) > 0;

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'attendance_earning',
    'attendance_shift',
    s.id,
    case p.payment_type
      when 'daily' then round(coalesce(p.payment_amount, 0), 2)
      when 'hourly' then round(
        coalesce(p.payment_amount, 0)
        * greatest(
          extract(epoch from (s.ended_at - s.started_at)) / 60 - s.overtime_minutes,
          0
        )
        / 60,
        2
      )
      else 0
    end,
    'Approved attendance earning for ' || s.shift_date::text
  from public.payroll_entries pe
  join public.profiles p
    on p.id = pe.profile_id
   and p.organization_id = pe.organization_id
  join public.attendance_shifts s
    on s.profile_id = p.id
   and s.organization_id = p.organization_id
  where pe.payroll_period_id = v_period.id
    and p.payment_type in ('daily', 'hourly')
    and s.payroll_eligible
    and s.status in ('approved', 'corrected')
    and s.started_at is not null
    and s.ended_at is not null
    and s.shift_date between p_period_start and p_period_end
    and (
      s.booking_id is null
      or exists (
        select 1
        from public.bookings b
        where b.id = s.booking_id
          and b.organization_id = s.organization_id
          and b.service_status in ('service_completed', 'fully_completed')
      )
    )
    and not exists (
      select 1
      from public.booking_assignments ba
      where ba.organization_id = s.organization_id
        and ba.booking_id = s.booking_id
        and ba.chef_profile_id = s.profile_id
        and ba.unassigned_at is null
        and ba.agreed_pay_type in ('daily', 'hourly', 'per_booking')
    );

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'overtime',
    'attendance_overtime',
    s.id,
    round(
      case p.payment_type
        when 'monthly' then coalesce(p.payment_amount, 0) / (26 * 8 * 60)
        when 'daily' then coalesce(p.payment_amount, 0) / (8 * 60)
        when 'hourly' then coalesce(p.payment_amount, 0) / 60
        else 0
      end
      * s.overtime_minutes,
      2
    ),
    'Approved overtime for ' || s.shift_date::text
  from public.payroll_entries pe
  join public.profiles p
    on p.id = pe.profile_id
   and p.organization_id = pe.organization_id
  join public.attendance_shifts s
    on s.profile_id = p.id
   and s.organization_id = p.organization_id
  where pe.payroll_period_id = v_period.id
    and p.payment_type in ('monthly', 'daily', 'hourly')
    and s.payroll_eligible
    and s.status in ('approved', 'corrected')
    and s.started_at is not null
    and s.ended_at is not null
    and s.overtime_minutes > 0
    and s.shift_date between p_period_start and p_period_end
    and (
      s.booking_id is null
      or exists (
        select 1
        from public.bookings b
        where b.id = s.booking_id
          and b.organization_id = s.organization_id
          and b.service_status in ('service_completed', 'fully_completed')
      )
    )
    and not exists (
      select 1
      from public.booking_assignments ba
      where ba.organization_id = s.organization_id
        and ba.booking_id = s.booking_id
        and ba.chef_profile_id = s.profile_id
        and ba.unassigned_at is null
        and ba.agreed_pay_type in ('daily', 'hourly')
    );

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'booking_earning',
    'booking_assignment',
    ba.id,
    round(
      case ba.agreed_pay_type
        when 'per_booking' then coalesce(ba.agreed_pay_amount, 0)
        when 'daily' then
          coalesce(ba.agreed_pay_amount, 0)
          * count(distinct s.shift_date)
        when 'hourly' then
          coalesce(ba.agreed_pay_amount, 0)
          * greatest(
            sum(extract(epoch from (s.ended_at - s.started_at)) / 60 - s.overtime_minutes),
            0
          )
          / 60
        else 0
      end,
      2
    ),
    'Completed booking ' || b.booking_code
  from public.payroll_entries pe
  join public.booking_assignments ba
    on ba.chef_profile_id = pe.profile_id
   and ba.organization_id = pe.organization_id
   and ba.unassigned_at is null
  join public.bookings b
    on b.id = ba.booking_id
   and b.organization_id = ba.organization_id
   and b.service_status in ('service_completed', 'fully_completed')
  join public.attendance_shifts s
    on s.organization_id = ba.organization_id
   and s.booking_id = ba.booking_id
   and s.profile_id = ba.chef_profile_id
   and s.payroll_eligible
   and s.status in ('approved', 'corrected')
   and s.started_at is not null
   and s.ended_at is not null
   and s.shift_date between p_period_start and p_period_end
  where pe.payroll_period_id = v_period.id
    and ba.agreed_pay_type in ('per_booking', 'daily', 'hourly')
    and coalesce(ba.agreed_pay_amount, 0) > 0
  group by
    pe.organization_id,
    pe.id,
    ba.id,
    ba.agreed_pay_type,
    ba.agreed_pay_amount,
    b.booking_code;

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'overtime',
    'booking_overtime',
    ba.id,
    round(
      case ba.agreed_pay_type
        when 'daily' then coalesce(ba.agreed_pay_amount, 0) / (8 * 60)
        when 'hourly' then coalesce(ba.agreed_pay_amount, 0) / 60
        else 0
      end
      * sum(s.overtime_minutes),
      2
    ),
    'Booking overtime for ' || b.booking_code
  from public.payroll_entries pe
  join public.booking_assignments ba
    on ba.chef_profile_id = pe.profile_id
   and ba.organization_id = pe.organization_id
   and ba.unassigned_at is null
  join public.bookings b
    on b.id = ba.booking_id
   and b.organization_id = ba.organization_id
   and b.service_status in ('service_completed', 'fully_completed')
  join public.attendance_shifts s
    on s.organization_id = ba.organization_id
   and s.booking_id = ba.booking_id
   and s.profile_id = ba.chef_profile_id
   and s.payroll_eligible
   and s.status in ('approved', 'corrected')
   and s.overtime_minutes > 0
   and s.shift_date between p_period_start and p_period_end
  where pe.payroll_period_id = v_period.id
    and ba.agreed_pay_type in ('daily', 'hourly')
    and coalesce(ba.agreed_pay_amount, 0) > 0
  group by
    pe.organization_id,
    pe.id,
    ba.id,
    ba.agreed_pay_type,
    ba.agreed_pay_amount,
    b.booking_code;

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'attendance_earning',
    'attendance_shift',
    s.id,
    round(
      case tw.payment_type
        when 'daily' then coalesce(tw.payment_amount, 0)
        when 'hourly' then
          coalesce(tw.payment_amount, 0)
          * greatest(
            extract(epoch from (s.ended_at - s.started_at)) / 60 - s.overtime_minutes,
            0
          )
          / 60
        else 0
      end,
      2
    ),
    'Approved temporary-worker attendance for ' || s.shift_date::text
  from public.payroll_entries pe
  join public.temporary_workers tw
    on tw.id = pe.temporary_worker_id
   and tw.organization_id = pe.organization_id
  join public.attendance_shifts s
    on s.temporary_worker_id = tw.id
   and s.organization_id = tw.organization_id
  where pe.payroll_period_id = v_period.id
    and tw.payment_type in ('daily', 'hourly')
    and s.payroll_eligible
    and s.status in ('approved', 'corrected')
    and s.started_at is not null
    and s.ended_at is not null
    and s.shift_date between p_period_start and p_period_end
    and not exists (
      select 1
      from public.temporary_worker_assignments twa
      where twa.organization_id = s.organization_id
        and twa.temporary_worker_id = s.temporary_worker_id
        and twa.booking_id = s.booking_id
        and twa.work_date = s.shift_date
    );

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'overtime',
    'attendance_overtime',
    s.id,
    round(
      case tw.payment_type
        when 'daily' then coalesce(tw.payment_amount, 0) / (8 * 60)
        when 'hourly' then coalesce(tw.payment_amount, 0) / 60
        else 0
      end
      * s.overtime_minutes,
      2
    ),
    'Approved temporary-worker overtime for ' || s.shift_date::text
  from public.payroll_entries pe
  join public.temporary_workers tw
    on tw.id = pe.temporary_worker_id
   and tw.organization_id = pe.organization_id
  join public.attendance_shifts s
    on s.temporary_worker_id = tw.id
   and s.organization_id = tw.organization_id
  where pe.payroll_period_id = v_period.id
    and tw.payment_type in ('daily', 'hourly')
    and s.payroll_eligible
    and s.status in ('approved', 'corrected')
    and s.overtime_minutes > 0
    and s.shift_date between p_period_start and p_period_end
    and not exists (
      select 1
      from public.temporary_worker_assignments twa
      where twa.organization_id = s.organization_id
        and twa.temporary_worker_id = s.temporary_worker_id
        and twa.booking_id = s.booking_id
        and twa.work_date = s.shift_date
    );

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'booking_earning',
    'temporary_worker_assignment',
    twa.id,
    round(
      case tw.payment_type
        when 'hourly' then
          coalesce(nullif(twa.agreed_payment, 0), tw.payment_amount)
          * greatest(
            sum(extract(epoch from (s.ended_at - s.started_at)) / 60 - s.overtime_minutes),
            0
          )
          / 60
        else coalesce(nullif(twa.agreed_payment, 0), tw.payment_amount)
      end,
      2
    ),
    'Temporary-worker assignment for ' || b.booking_code
  from public.payroll_entries pe
  join public.temporary_workers tw
    on tw.id = pe.temporary_worker_id
   and tw.organization_id = pe.organization_id
  join public.temporary_worker_assignments twa
    on twa.temporary_worker_id = tw.id
   and twa.organization_id = tw.organization_id
   and twa.work_date between p_period_start and p_period_end
  join public.bookings b
    on b.id = twa.booking_id
   and b.organization_id = twa.organization_id
  join public.attendance_shifts s
    on s.organization_id = twa.organization_id
   and s.temporary_worker_id = twa.temporary_worker_id
   and s.booking_id = twa.booking_id
   and s.shift_date = twa.work_date
   and s.payroll_eligible
   and s.status in ('approved', 'corrected')
   and s.started_at is not null
   and s.ended_at is not null
  where pe.payroll_period_id = v_period.id
  group by
    pe.organization_id,
    pe.id,
    twa.id,
    twa.agreed_payment,
    tw.payment_type,
    tw.payment_amount,
    b.booking_code;

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'overtime',
    'temporary_worker_overtime',
    twa.id,
    round(
      case tw.payment_type
        when 'daily' then
          coalesce(nullif(twa.agreed_payment, 0), tw.payment_amount) / (8 * 60)
        when 'hourly' then
          coalesce(nullif(twa.agreed_payment, 0), tw.payment_amount) / 60
        else 0
      end
      * sum(s.overtime_minutes),
      2
    ),
    'Temporary-worker overtime for ' || b.booking_code
  from public.payroll_entries pe
  join public.temporary_workers tw
    on tw.id = pe.temporary_worker_id
   and tw.organization_id = pe.organization_id
  join public.temporary_worker_assignments twa
    on twa.temporary_worker_id = tw.id
   and twa.organization_id = tw.organization_id
   and twa.work_date between p_period_start and p_period_end
  join public.bookings b
    on b.id = twa.booking_id
   and b.organization_id = twa.organization_id
  join public.attendance_shifts s
    on s.organization_id = twa.organization_id
   and s.temporary_worker_id = twa.temporary_worker_id
   and s.booking_id = twa.booking_id
   and s.shift_date = twa.work_date
   and s.payroll_eligible
   and s.status in ('approved', 'corrected')
   and s.overtime_minutes > 0
  where pe.payroll_period_id = v_period.id
    and tw.payment_type in ('daily', 'hourly')
  group by
    pe.organization_id,
    pe.id,
    twa.id,
    twa.agreed_payment,
    tw.payment_type,
    tw.payment_amount,
    b.booking_code;

  insert into public.payroll_components (
    organization_id,
    payroll_entry_id,
    component_type,
    source_type,
    source_id,
    amount,
    description
  )
  select
    pe.organization_id,
    pe.id,
    'expense_reimbursement',
    'expense',
    e.id,
    e.amount,
    'Approved expense: ' || e.category
  from public.payroll_entries pe
  join public.expenses e
    on e.submitted_by_profile_id = pe.profile_id
   and e.organization_id = pe.organization_id
   and e.status = 'approved'
   and e.reviewed_at::date between p_period_start and p_period_end
  where pe.payroll_period_id = v_period.id;

  insert into public.payroll_components (organization_id, payroll_entry_id, component_type, source_type, source_id, amount, description)
  select pe.organization_id, pe.id, c.kind, 'salary_structure', st.id,
    round(c.amount * (case when c.kind in ('hra','allowance','incentive','employer_pf','employer_esic')
      then pe.payable_days else (p_period_end - greatest(p_period_start, st.effective_from) + 1) end)::numeric
      / extract(day from (date_trunc('month', p_period_start::timestamp) + interval '1 month - 1 day')), 2),
    'Saved monthly salary component: ' || replace(c.kind, '_', ' ')
  from public.payroll_entries pe
  join lateral (select st.* from public.payroll_salary_structures st where st.profile_id = pe.profile_id and st.effective_from <= p_period_start order by st.effective_from desc limit 1) st on true
  cross join lateral (values
    ('hra', st.hra),
    ('allowance', st.allowances),
    ('incentive', st.incentives),
    ('pf', st.pf),
    ('esic', st.esic),
    ('professional_tax', st.professional_tax),
    ('tds', st.tds),
    ('other_deduction', st.other_deductions),
    ('employer_pf', st.employer_pf),
    ('employer_esic', st.employer_esic)  ) c(kind, amount)
  where pe.payroll_period_id = v_period.id and st.effective_from <= p_period_start
    and pe.payable_days > 0 and c.amount > 0;

  for v_entry in
    select pe.id
    from public.payroll_entries pe
    where pe.payroll_period_id = v_period.id
  loop
    perform public.recalculate_payroll_entry(v_entry.id);
  end loop;

  select count(*)::integer, coalesce(sum(pe.net_payable), 0)::numeric(12,2)
  into v_entry_count, v_net_payable
  from public.payroll_entries pe
  where pe.payroll_period_id = v_period.id;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.period_generated',
    'payroll_period',
    v_period.id,
    null,
    jsonb_build_object(
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'status', v_period.status,
      'entry_count', v_entry_count,
      'net_payable', v_net_payable
    ),
    'Payroll draft generated from eligible source records',
    null
  );

  return query
  select v_period.id, v_period.status, v_entry_count, v_net_payable;
end;
$$;


notify pgrst, 'reload schema';

alter table public.payroll_periods drop constraint payroll_periods_range_unique;
create unique index payroll_periods_franchise_range_unique
  on public.payroll_periods (organization_id, franchise_id, period_start, period_end) nulls not distinct;

create or replace function public.enforce_payroll_day_snapshot()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status <> 'draft' and
    (new.payable_days is distinct from old.payable_days or new.attendance_days is distinct from old.attendance_days) then
    raise exception 'PAYROLL_HISTORY_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger payroll_day_snapshot before update on public.payroll_entries
for each row execute function public.enforce_payroll_day_snapshot();

revoke all on function public.generate_payroll_period(date,date,uuid) from public, anon;
grant execute on function public.generate_payroll_period(date,date,uuid) to authenticated;
create policy payroll_salary_structures_franchise_isolation on public.payroll_salary_structures
  as restrictive for all to authenticated using (public.franchise_scope_allows(franchise_id))
  with check (public.franchise_scope_allows(franchise_id));
notify pgrst, 'reload schema';
