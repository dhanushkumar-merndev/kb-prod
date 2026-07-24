-- Khana Banao CRM: transactional workforce payroll and permanent earnings ledger.

alter table public.payroll_periods
  add column if not exists prepared_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists payment_reference text,
  add column if not exists locked_at timestamptz;

alter table public.payroll_entries
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by_profile_id uuid,
  add column if not exists reversal_reason text;

alter table public.payroll_entries
  add constraint payroll_entries_reverser_organization_fk
    foreign key (reversed_by_profile_id, organization_id)
    references public.profiles(id, organization_id) on delete restrict;

update public.payroll_entries pe
set
  paid_at = coalesce(pe.paid_at, pe.updated_at),
  payment_reference = coalesce(
    nullif(btrim(pe.payment_reference), ''),
    'Migrated reversed payroll payment'
  ),
  reversed_at = coalesce(pe.reversed_at, pe.updated_at),
  reversed_by_profile_id = coalesce(
    pe.reversed_by_profile_id,
    pp.approved_by_profile_id,
    pp.prepared_by_profile_id
  ),
  reversal_reason = coalesce(
    nullif(btrim(pe.reversal_reason), ''),
    'Migrated reversed payroll record'
  )
from public.payroll_periods pp
where pe.payroll_period_id = pp.id
  and pe.organization_id = pp.organization_id
  and pe.status = 'reversed';

update public.payroll_periods
set prepared_at = coalesce(prepared_at, created_at)
where status in ('prepared', 'reviewed', 'approved', 'paid', 'locked');

update public.payroll_periods
set
  reviewed_at = coalesce(reviewed_at, updated_at),
  reviewed_by_profile_id = coalesce(reviewed_by_profile_id, prepared_by_profile_id)
where status in ('reviewed', 'approved', 'paid', 'locked');

update public.payroll_periods
set
  approved_at = coalesce(approved_at, updated_at),
  approved_by_profile_id = coalesce(approved_by_profile_id, prepared_by_profile_id)
where status in ('approved', 'paid', 'locked');

update public.payroll_periods
set
  paid_at = coalesce(paid_at, updated_at),
  payment_reference = coalesce(nullif(btrim(payment_reference), ''), 'Migrated payroll payment')
where status in ('paid', 'locked');

update public.payroll_periods
set locked_at = coalesce(locked_at, updated_at)
where status = 'locked';

alter table public.payroll_periods
  add constraint payroll_periods_lifecycle_check check (
    (status = 'draft'
      and prepared_at is null
      and reviewed_at is null
      and approved_at is null
      and paid_at is null
      and payment_reference is null
      and locked_at is null)
    or
    (status = 'prepared'
      and prepared_at is not null
      and reviewed_at is null
      and approved_at is null
      and paid_at is null
      and payment_reference is null
      and locked_at is null)
    or
    (status = 'reviewed'
      and prepared_at is not null
      and reviewed_at is not null
      and reviewed_by_profile_id is not null
      and approved_at is null
      and paid_at is null
      and payment_reference is null
      and locked_at is null)
    or
    (status = 'approved'
      and prepared_at is not null
      and reviewed_at is not null
      and reviewed_by_profile_id is not null
      and approved_at is not null
      and approved_by_profile_id is not null
      and paid_at is null
      and payment_reference is null
      and locked_at is null)
    or
    (status = 'paid'
      and prepared_at is not null
      and reviewed_at is not null
      and reviewed_by_profile_id is not null
      and approved_at is not null
      and approved_by_profile_id is not null
      and paid_at is not null
      and nullif(btrim(payment_reference), '') is not null
      and locked_at is null)
    or
    (status = 'locked'
      and prepared_at is not null
      and reviewed_at is not null
      and reviewed_by_profile_id is not null
      and approved_at is not null
      and approved_by_profile_id is not null
      and paid_at is not null
      and nullif(btrim(payment_reference), '') is not null
      and locked_at is not null)
  );

alter table public.payroll_entries
  add constraint payroll_entries_reversal_check check (
    (status = 'reversed'
      and reversed_at is not null
      and reversed_by_profile_id is not null
      and nullif(btrim(reversal_reason), '') is not null
      and paid_at is not null
      and nullif(btrim(payment_reference), '') is not null)
    or
    (status <> 'reversed'
      and reversed_at is null
      and reversed_by_profile_id is null
      and reversal_reason is null)
  );

alter table public.payroll_entries
  add constraint payroll_entries_finite_amounts_check check (
    base_amount not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and attendance_amount not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and booking_earnings not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and overtime_amount not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and expense_reimbursement not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and allowances not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and deductions not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and advances not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and net_payable not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  );

alter table public.payroll_components
  add constraint payroll_components_finite_amount_check check (
    amount not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  );

create unique index payroll_component_source_once
  on public.payroll_components (organization_id, source_type, source_id)
  where source_id is not null
    and source_type in (
      'attendance_shift',
      'attendance_overtime',
      'booking_assignment',
      'booking_overtime',
      'temporary_worker_assignment',
      'temporary_worker_overtime',
      'expense'
    );

create index payroll_entries_profile_paid_history_idx
  on public.payroll_entries (organization_id, profile_id, paid_at desc)
  where status in ('paid', 'reversed') and profile_id is not null;

create index payroll_components_entry_type_idx
  on public.payroll_components (organization_id, payroll_entry_id, component_type, created_at);

create or replace function public.enforce_payroll_period_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'PAYROLL_HISTORY_IMMUTABLE';
  end if;

  if old.status = 'locked' then
    raise exception using errcode = '42501', message = 'PAYROLL_PERIOD_LOCKED';
  end if;

  if old.status = 'paid'
     and (
       new.status <> 'locked'
       or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.prepared_by_profile_id is distinct from old.prepared_by_profile_id
       or new.reviewed_by_profile_id is distinct from old.reviewed_by_profile_id
       or new.approved_by_profile_id is distinct from old.approved_by_profile_id
       or new.prepared_at is distinct from old.prepared_at
       or new.reviewed_at is distinct from old.reviewed_at
       or new.approved_at is distinct from old.approved_at
       or new.paid_at is distinct from old.paid_at
       or new.payment_reference is distinct from old.payment_reference
     ) then
    raise exception using errcode = '42501', message = 'PAYROLL_PAID_IMMUTABLE';
  end if;

  if new.status is distinct from old.status
     and not (
       (old.status = 'draft' and new.status = 'prepared')
       or (old.status = 'prepared' and new.status = 'reviewed')
       or (old.status = 'reviewed' and new.status = 'approved')
       or (old.status = 'approved' and new.status = 'paid')
       or (old.status = 'paid' and new.status = 'locked')
     ) then
    raise exception using errcode = '22023', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_payroll_entry_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'PAYROLL_HISTORY_IMMUTABLE';
  end if;

  if old.status = 'reversed' then
    raise exception using errcode = '42501', message = 'PAYROLL_HISTORY_IMMUTABLE';
  end if;

  if old.status = 'paid' then
    if new.status <> 'reversed'
       or new.base_amount is distinct from old.base_amount
       or new.attendance_amount is distinct from old.attendance_amount
       or new.booking_earnings is distinct from old.booking_earnings
       or new.overtime_amount is distinct from old.overtime_amount
       or new.expense_reimbursement is distinct from old.expense_reimbursement
       or new.allowances is distinct from old.allowances
       or new.deductions is distinct from old.deductions
       or new.advances is distinct from old.advances
       or new.net_payable is distinct from old.net_payable
       or new.payment_reference is distinct from old.payment_reference
       or new.paid_at is distinct from old.paid_at then
      raise exception using errcode = '42501', message = 'PAYROLL_PAID_IMMUTABLE';
    end if;
  elsif new.status is distinct from old.status
    and not (
      (old.status = 'draft' and new.status = 'reviewed')
      or (old.status = 'reviewed' and new.status = 'approved')
      or (old.status = 'approved' and new.status = 'paid')
    ) then
    raise exception using errcode = '22023', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_payroll_component_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_entry_id uuid;
  v_status public.payroll_period_status;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using errcode = '42501', message = 'PAYROLL_COMPONENT_IMMUTABLE';
  end if;

  v_entry_id := new.payroll_entry_id;

  select pp.status
  into v_status
  from public.payroll_entries pe
  join public.payroll_periods pp
    on pp.id = pe.payroll_period_id
   and pp.organization_id = pe.organization_id
  where pe.id = v_entry_id
    and pe.organization_id = new.organization_id;

  if not found or v_status <> 'draft' then
    raise exception using errcode = '42501', message = 'PAYROLL_PERIOD_NOT_EDITABLE';
  end if;

  return new;
end;
$$;

create trigger payroll_periods_enforce_transition
before update or delete on public.payroll_periods
for each row execute function public.enforce_payroll_period_transition();

create trigger payroll_entries_enforce_transition
before update or delete on public.payroll_entries
for each row execute function public.enforce_payroll_entry_transition();

create trigger payroll_components_enforce_immutability
before insert or update or delete on public.payroll_components
for each row execute function public.enforce_payroll_component_immutability();

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
    coalesce(sum(pc.amount) filter (where pc.component_type = 'allowance'), 0)::numeric(12,2)
      as allowances,
    coalesce(sum(pc.amount) filter (where pc.component_type = 'deduction'), 0)::numeric(12,2)
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

create or replace function public.generate_payroll_period(
  p_period_start date,
  p_period_end date
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

  perform pg_advisory_xact_lock(hashtextextended(v_actor.organization_id::text, 10));

  if exists (
    select 1
    from public.payroll_periods pp
    where pp.organization_id = v_actor.organization_id
      and daterange(pp.period_start, pp.period_end, '[]')
          && daterange(p_period_start, p_period_end, '[]')
  ) then
    raise exception using errcode = '23505', message = 'PAYROLL_PERIOD_OVERLAP';
  end if;

  insert into public.payroll_periods (
    organization_id,
    period_start,
    period_end,
    status,
    prepared_by_profile_id
  )
  values (
    v_actor.organization_id,
    p_period_start,
    p_period_end,
    'draft',
    v_actor.id
  )
  returning * into v_period;

  with eligible_profiles as (
    select p.id
    from public.profiles p
    where p.organization_id = v_actor.organization_id
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
    where s.organization_id = v_actor.organization_id
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
      * (
        p_period_end
        - greatest(p_period_start, coalesce(p.joining_date, p_period_start))
        + 1
      )::numeric
      / extract(
        day from (
          date_trunc('month', p_period_start::timestamp)
          + interval '1 month - 1 day'
        )
      ),
      2
    ),
    'Prorated monthly base salary'
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

create or replace function public.adjust_payroll_entry(
  p_payroll_entry_id uuid,
  p_allowances numeric,
  p_deductions numeric,
  p_advances numeric,
  p_reason text
)
returns table (
  payroll_entry_id uuid,
  allowances numeric,
  deductions numeric,
  advances numeric,
  net_payable numeric
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_period public.payroll_periods%rowtype;
  v_before public.payroll_entries%rowtype;
  v_after public.payroll_entries%rowtype;
  v_reason text;
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

  v_reason := nullif(btrim(p_reason), '');
  if p_allowances is null
     or p_deductions is null
     or p_advances is null
     or p_allowances in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_deductions in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_advances in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_allowances < 0
     or p_deductions < 0
     or p_advances < 0
     or p_allowances > 999999999.99
     or p_deductions > 999999999.99
     or p_advances > 999999999.99
     or v_reason is null
     or char_length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select pe.*
  into v_before
  from public.payroll_entries pe
  where pe.id = p_payroll_entry_id
    and pe.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pp.*
  into strict v_period
  from public.payroll_periods pp
  where pp.id = v_before.payroll_period_id
    and pp.organization_id = v_actor.organization_id
  for update;

  if v_period.status <> 'draft' or v_before.status <> 'draft' then
    raise exception using errcode = '22023', message = 'PAYROLL_PERIOD_NOT_EDITABLE';
  end if;

  if p_allowances <> v_before.allowances then
    insert into public.payroll_components (
      organization_id,
      payroll_entry_id,
      component_type,
      source_type,
      amount,
      description
    )
    values (
      v_actor.organization_id,
      v_before.id,
      'allowance',
      'manual_adjustment',
      p_allowances - v_before.allowances,
      'Allowance correction: ' || v_reason
    );
  end if;

  if p_deductions <> v_before.deductions then
    insert into public.payroll_components (
      organization_id,
      payroll_entry_id,
      component_type,
      source_type,
      amount,
      description
    )
    values (
      v_actor.organization_id,
      v_before.id,
      'deduction',
      'manual_adjustment',
      p_deductions - v_before.deductions,
      'Deduction correction: ' || v_reason
    );
  end if;

  if p_advances <> v_before.advances then
    insert into public.payroll_components (
      organization_id,
      payroll_entry_id,
      component_type,
      source_type,
      amount,
      description
    )
    values (
      v_actor.organization_id,
      v_before.id,
      'advance',
      'manual_adjustment',
      p_advances - v_before.advances,
      'Advance correction: ' || v_reason
    );
  end if;

  perform public.recalculate_payroll_entry(v_before.id);

  select pe.*
  into strict v_after
  from public.payroll_entries pe
  where pe.id = v_before.id;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.entry_adjusted',
    'payroll_entry',
    v_after.id,
    jsonb_build_object(
      'allowances', v_before.allowances,
      'deductions', v_before.deductions,
      'advances', v_before.advances,
      'net_payable', v_before.net_payable
    ),
    jsonb_build_object(
      'allowances', v_after.allowances,
      'deductions', v_after.deductions,
      'advances', v_after.advances,
      'net_payable', v_after.net_payable
    ),
    v_reason,
    null
  );

  return query
  select
    v_after.id,
    v_after.allowances,
    v_after.deductions,
    v_after.advances,
    v_after.net_payable;
end;
$$;

create or replace function public.prepare_payroll_period(p_payroll_period_id uuid)
returns table (
  payroll_period_id uuid,
  status public.payroll_period_status
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.payroll_periods%rowtype;
  v_after public.payroll_periods%rowtype;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found or v_actor.role not in ('director', 'hr') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pp.* into v_before
  from public.payroll_periods pp
  where pp.id = p_payroll_period_id
    and pp.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status <> 'draft' then
    raise exception using errcode = '40001', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  update public.payroll_periods pp
  set
    status = 'prepared',
    prepared_by_profile_id = v_actor.id,
    prepared_at = now()
  where pp.id = v_before.id
  returning pp.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.period_prepared',
    'payroll_period',
    v_after.id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'prepared_at', v_after.prepared_at),
    'Payroll submitted for Manager review',
    null
  );

  return query select v_after.id, v_after.status;
end;
$$;

create or replace function public.review_payroll_period(p_payroll_period_id uuid)
returns table (
  payroll_period_id uuid,
  status public.payroll_period_status
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.payroll_periods%rowtype;
  v_after public.payroll_periods%rowtype;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found or v_actor.role not in ('director', 'manager') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pp.* into v_before
  from public.payroll_periods pp
  where pp.id = p_payroll_period_id
    and pp.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status <> 'prepared' then
    raise exception using errcode = '40001', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  update public.payroll_entries pe
  set status = 'reviewed'
  where pe.payroll_period_id = v_before.id
    and pe.organization_id = v_actor.organization_id
    and pe.status = 'draft';

  update public.payroll_periods pp
  set
    status = 'reviewed',
    reviewed_by_profile_id = v_actor.id,
    reviewed_at = now()
  where pp.id = v_before.id
  returning pp.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.period_reviewed',
    'payroll_period',
    v_after.id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'reviewed_at', v_after.reviewed_at),
    'Payroll reviewed by operations',
    null
  );

  return query select v_after.id, v_after.status;
end;
$$;

create or replace function public.approve_payroll_period(p_payroll_period_id uuid)
returns table (
  payroll_period_id uuid,
  status public.payroll_period_status
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.payroll_periods%rowtype;
  v_after public.payroll_periods%rowtype;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found or v_actor.role <> 'director' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pp.* into v_before
  from public.payroll_periods pp
  where pp.id = p_payroll_period_id
    and pp.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status <> 'reviewed' then
    raise exception using errcode = '40001', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  update public.payroll_entries pe
  set status = 'approved'
  where pe.payroll_period_id = v_before.id
    and pe.organization_id = v_actor.organization_id
    and pe.status = 'reviewed';

  update public.payroll_periods pp
  set
    status = 'approved',
    approved_by_profile_id = v_actor.id,
    approved_at = now()
  where pp.id = v_before.id
  returning pp.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.period_approved',
    'payroll_period',
    v_after.id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'approved_at', v_after.approved_at),
    'Payroll approved by Director',
    null
  );

  return query select v_after.id, v_after.status;
end;
$$;

create or replace function public.mark_payroll_paid(
  p_payroll_period_id uuid,
  p_payment_reference text
)
returns table (
  payroll_period_id uuid,
  status public.payroll_period_status,
  paid_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.payroll_periods%rowtype;
  v_after public.payroll_periods%rowtype;
  v_reference text;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found or v_actor.role <> 'director' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  v_reference := nullif(btrim(p_payment_reference), '');
  if v_reference is null or char_length(v_reference) > 160 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select pp.* into v_before
  from public.payroll_periods pp
  where pp.id = p_payroll_period_id
    and pp.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status <> 'approved' then
    raise exception using errcode = '40001', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  update public.payroll_entries pe
  set
    status = 'paid',
    payment_reference = v_reference,
    paid_at = now()
  where pe.payroll_period_id = v_before.id
    and pe.organization_id = v_actor.organization_id
    and pe.status = 'approved';

  update public.expenses e
  set status = 'paid'
  where e.organization_id = v_actor.organization_id
    and e.status = 'approved'
    and exists (
      select 1
      from public.payroll_components pc
      join public.payroll_entries pe
        on pe.id = pc.payroll_entry_id
       and pe.organization_id = pc.organization_id
      where pe.payroll_period_id = v_before.id
        and pc.organization_id = e.organization_id
        and pc.source_type = 'expense'
        and pc.source_id = e.id
    );

  update public.payroll_periods pp
  set
    status = 'paid',
    paid_at = now(),
    payment_reference = v_reference
  where pp.id = v_before.id
  returning pp.* into v_after;

  insert into public.notifications (
    organization_id,
    recipient_profile_id,
    notification_type,
    title,
    body,
    entity_type,
    entity_id
  )
  select
    pe.organization_id,
    pe.profile_id,
    'payroll_paid',
    'Payroll paid',
    'Your payroll for '
      || v_after.period_start::text
      || ' to '
      || v_after.period_end::text
      || ' has been paid.',
    'payroll_entry',
    pe.id
  from public.payroll_entries pe
  where pe.payroll_period_id = v_after.id
    and pe.profile_id is not null;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.period_paid',
    'payroll_period',
    v_after.id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object(
      'status', v_after.status,
      'paid_at', v_after.paid_at,
      'payment_reference', v_after.payment_reference
    ),
    'Payroll payment recorded',
    null
  );

  return query select v_after.id, v_after.status, v_after.paid_at;
end;
$$;

create or replace function public.lock_payroll_period(p_payroll_period_id uuid)
returns table (
  payroll_period_id uuid,
  status public.payroll_period_status,
  locked_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.payroll_periods%rowtype;
  v_after public.payroll_periods%rowtype;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found or v_actor.role <> 'director' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pp.* into v_before
  from public.payroll_periods pp
  where pp.id = p_payroll_period_id
    and pp.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status <> 'paid' then
    raise exception using errcode = '40001', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  update public.payroll_periods pp
  set
    status = 'locked',
    locked_at = now()
  where pp.id = v_before.id
  returning pp.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.period_locked',
    'payroll_period',
    v_after.id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'locked_at', v_after.locked_at),
    'Paid payroll period permanently locked',
    null
  );

  return query select v_after.id, v_after.status, v_after.locked_at;
end;
$$;

create or replace function public.reverse_payroll_entry(
  p_payroll_entry_id uuid,
  p_reason text
)
returns table (
  payroll_entry_id uuid,
  status public.payroll_entry_status,
  reversed_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_before public.payroll_entries%rowtype;
  v_after public.payroll_entries%rowtype;
  v_reason text;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.account_status = 'active'
    and p.deleted_at is null;

  if not found or v_actor.role <> 'director' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select pe.* into v_before
  from public.payroll_entries pe
  where pe.id = p_payroll_entry_id
    and pe.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_before.status <> 'paid' then
    raise exception using errcode = '40001', message = 'PAYROLL_STATUS_CONFLICT';
  end if;

  update public.payroll_entries pe
  set
    status = 'reversed',
    reversed_at = now(),
    reversed_by_profile_id = v_actor.id,
    reversal_reason = v_reason
  where pe.id = v_before.id
  returning pe.* into v_after;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'payroll.entry_reversed',
    'payroll_entry',
    v_after.id,
    jsonb_build_object(
      'status', v_before.status,
      'net_payable', v_before.net_payable,
      'paid_at', v_before.paid_at,
      'payment_reference', v_before.payment_reference
    ),
    jsonb_build_object(
      'status', v_after.status,
      'net_payable', v_after.net_payable,
      'reversed_at', v_after.reversed_at
    ),
    v_reason,
    null
  );

  return query select v_after.id, v_after.status, v_after.reversed_at;
end;
$$;

create or replace function public.get_my_payroll_earnings()
returns table (
  current_unpaid numeric,
  paid_this_month numeric,
  lifetime_paid numeric,
  last_payment_amount numeric,
  last_payment_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  return query
  with my_entries as (
    select pe.*
    from public.payroll_entries pe
    where pe.organization_id = public.current_organization_id()
      and pe.profile_id = public.current_profile_id()
  ),
  last_payment as (
    select pe.net_payable, pe.paid_at
    from my_entries pe
    where pe.status = 'paid'
      and pe.paid_at is not null
    order by pe.paid_at desc
    limit 1
  )
  select
    coalesce(sum(me.net_payable) filter (
      where me.status in ('draft', 'reviewed', 'approved')
    ), 0)::numeric(12,2),
    coalesce(sum(me.net_payable) filter (
      where me.status = 'paid'
        and me.paid_at >= date_trunc('month', now())
        and me.paid_at < date_trunc('month', now()) + interval '1 month'
    ), 0)::numeric(12,2),
    coalesce(sum(me.net_payable) filter (where me.status = 'paid'), 0)::numeric(12,2),
    (select lp.net_payable from last_payment lp),
    (select lp.paid_at from last_payment lp)
  from my_entries me;
end;
$$;

create or replace view public.payroll_earnings_summary
with (security_invoker = true)
as
select
  pe.organization_id,
  pe.profile_id,
  coalesce(sum(pe.net_payable) filter (
    where pe.status in ('draft', 'reviewed', 'approved')
  ), 0)::numeric(12,2) as current_unpaid,
  coalesce(sum(pe.net_payable) filter (
    where pe.status = 'paid'
      and pe.paid_at >= date_trunc('month', now())
      and pe.paid_at < date_trunc('month', now()) + interval '1 month'
  ), 0)::numeric(12,2) as paid_this_month,
  coalesce(sum(pe.net_payable) filter (where pe.status = 'paid'), 0)::numeric(12,2)
    as lifetime_paid,
  max(pe.paid_at) filter (where pe.status = 'paid') as last_payment_at
from public.payroll_entries pe
where pe.profile_id is not null
group by pe.organization_id, pe.profile_id;

create policy payroll_periods_select_own_entry
on public.payroll_periods for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.payroll_entries pe
    where pe.payroll_period_id = payroll_periods.id
      and pe.organization_id = payroll_periods.organization_id
      and pe.profile_id = public.current_profile_id()
  )
);

revoke all on public.payroll_earnings_summary from public, anon;
grant select on public.payroll_earnings_summary to authenticated;

revoke all on function public.recalculate_payroll_entry(uuid)
  from public, anon, authenticated;
grant execute on function public.recalculate_payroll_entry(uuid) to service_role;

revoke all on function public.generate_payroll_period(date, date)
  from public, anon, authenticated;
grant execute on function public.generate_payroll_period(date, date) to authenticated;

revoke all on function public.adjust_payroll_entry(uuid, numeric, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.adjust_payroll_entry(uuid, numeric, numeric, numeric, text)
  to authenticated;

revoke all on function public.prepare_payroll_period(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_payroll_period(uuid) to authenticated;

revoke all on function public.review_payroll_period(uuid)
  from public, anon, authenticated;
grant execute on function public.review_payroll_period(uuid) to authenticated;

revoke all on function public.approve_payroll_period(uuid)
  from public, anon, authenticated;
grant execute on function public.approve_payroll_period(uuid) to authenticated;

revoke all on function public.mark_payroll_paid(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_payroll_paid(uuid, text) to authenticated;

revoke all on function public.lock_payroll_period(uuid)
  from public, anon, authenticated;
grant execute on function public.lock_payroll_period(uuid) to authenticated;

revoke all on function public.reverse_payroll_entry(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reverse_payroll_entry(uuid, text) to authenticated;

revoke all on function public.get_my_payroll_earnings()
  from public, anon, authenticated;
grant execute on function public.get_my_payroll_earnings() to authenticated;

revoke insert, update, delete, truncate
  on public.payroll_periods, public.payroll_entries, public.payroll_components
  from anon, authenticated;
