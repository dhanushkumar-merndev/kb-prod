-- One tenant-scoped aggregate call per role dashboard. Direct table counts
-- repeatedly evaluate nested RLS helpers and become slow as operational data grows.

create or replace function public.get_dashboard_metric_counts(
  p_today date,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_result jsonb;
begin
  if p_today is null or p_now is null then
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
    and public.current_auth_session_is_valid();

  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_today_start := p_today::timestamp at time zone 'Asia/Kolkata';
  v_today_end := (p_today + 1)::timestamp at time zone 'Asia/Kolkata';

  case v_profile.role
    when 'director' then
      select jsonb_build_object(
        'leads', count(*) filter (where metric = 'lead'),
        'upcoming_bookings', count(*) filter (where metric = 'upcoming_booking'),
        'active_staff', count(*) filter (where metric = 'active_staff'),
        'working_now', count(*) filter (where metric = 'working'),
        'pending_payments', count(*) filter (where metric = 'pending_payment'),
        'pending_attendance', count(*) filter (where metric = 'pending_attendance')
      )
      into v_result
      from (
        select 'lead'::text as metric
        from public.leads l
        where l.organization_id = v_profile.organization_id and l.deleted_at is null
        union all
        select 'upcoming_booking'
        from public.bookings b
        where b.organization_id = v_profile.organization_id
          and b.deleted_at is null
          and b.event_date >= p_today
          and b.service_status <> 'cancelled'
        union all
        select 'active_staff'
        from public.profiles p
        where p.organization_id = v_profile.organization_id
          and p.account_status = 'active'
          and p.deleted_at is null
        union all
        select 'working'
        from public.attendance_shifts a
        where a.organization_id = v_profile.organization_id and a.status = 'working'
        union all
        select 'pending_payment'
        from public.booking_payments bp
        where bp.organization_id = v_profile.organization_id
          and bp.verification_status = 'pending'
        union all
        select 'pending_attendance'
        from public.attendance_shifts a
        where a.organization_id = v_profile.organization_id
          and a.status = 'pending_approval'
      ) metrics;

    when 'manager' then
      select jsonb_build_object(
        'today_events', count(*) filter (where metric = 'today_event'),
        'active_staff', count(*) filter (where metric = 'active_staff'),
        'pending_payments', count(*) filter (where metric = 'pending_payment'),
        'pending_attendance', count(*) filter (where metric = 'pending_attendance'),
        'pending_expenses', count(*) filter (where metric = 'pending_expense'),
        'overdue_tasks', count(*) filter (where metric = 'overdue_task'),
        'payroll_review', count(*) filter (where metric = 'payroll_review')
      )
      into v_result
      from (
        select 'today_event'::text as metric
        from public.bookings b
        where b.organization_id = v_profile.organization_id
          and b.deleted_at is null
          and b.event_date = p_today
          and b.service_status <> 'cancelled'
        union all
        select 'active_staff'
        from public.profiles p
        where p.organization_id = v_profile.organization_id
          and p.account_status = 'active'
          and p.deleted_at is null
        union all
        select 'pending_payment'
        from public.booking_payments bp
        where bp.organization_id = v_profile.organization_id
          and bp.verification_status = 'pending'
        union all
        select 'pending_attendance'
        from public.attendance_shifts a
        where a.organization_id = v_profile.organization_id
          and a.status = 'pending_approval'
        union all
        select 'pending_expense'
        from public.expenses e
        where e.organization_id = v_profile.organization_id
          and e.status in ('pending', 'verified')
        union all
        select 'overdue_task'
        from public.tasks t
        where t.organization_id = v_profile.organization_id
          and t.status in ('open', 'in_progress')
          and t.due_at < p_now
        union all
        select 'payroll_review'
        from public.payroll_periods pp
        where pp.organization_id = v_profile.organization_id
          and pp.status = 'prepared'
      ) metrics;

    when 'hr' then
      select jsonb_build_object(
        'active_chefs', count(*) filter (where metric = 'active_chef'),
        'active_part_time_chefs', count(*) filter (where metric = 'active_part_time_chef'),
        'temporary_workers_today', count(*) filter (where metric = 'temporary_worker'),
        'working_now', count(*) filter (where metric = 'working'),
        'pending_attendance', count(*) filter (where metric = 'pending_attendance'),
        'pending_leave', count(*) filter (where metric = 'pending_leave'),
        'pending_expenses', count(*) filter (where metric = 'pending_expense')
      )
      into v_result
      from (
        select 'active_chef'::text as metric
        from public.profiles p
        where p.organization_id = v_profile.organization_id
          and p.role = 'chef'
          and p.account_status = 'active'
          and p.deleted_at is null
        union all
        select 'active_part_time_chef'
        from public.profiles p
        where p.organization_id = v_profile.organization_id
          and p.role = 'part_time_chef'
          and p.account_status = 'active'
          and p.deleted_at is null
        union all
        select 'temporary_worker'
        from public.temporary_worker_assignments twa
        where twa.organization_id = v_profile.organization_id and twa.work_date = p_today
        union all
        select 'working'
        from public.attendance_shifts a
        where a.organization_id = v_profile.organization_id and a.status = 'working'
        union all
        select 'pending_attendance'
        from public.attendance_shifts a
        where a.organization_id = v_profile.organization_id
          and a.status = 'pending_approval'
        union all
        select 'pending_leave'
        from public.leave_requests lr
        join public.profiles p on p.id = lr.profile_id and p.organization_id = lr.organization_id
        where lr.organization_id = v_profile.organization_id
          and lr.status = 'pending'
          and p.role in ('chef', 'part_time_chef')
        union all
        select 'pending_expense'
        from public.expenses e
        join public.profiles p
          on p.id = e.submitted_by_profile_id and p.organization_id = e.organization_id
        where e.organization_id = v_profile.organization_id
          and e.status = 'pending'
          and p.role in ('chef', 'part_time_chef')
      ) metrics;

    when 'sales_manager' then
      select jsonb_build_object(
        'new_leads', count(*) filter (where metric = 'new_lead'),
        'unassigned_leads', count(*) filter (where metric = 'unassigned_lead'),
        'qualified_leads', count(*) filter (where metric = 'qualified_lead'),
        'overdue_followups', count(*) filter (where metric = 'overdue_followup'),
        'pending_payments', count(*) filter (where metric = 'pending_payment'),
        'open_conversations', count(*) filter (where metric = 'open_conversation')
      )
      into v_result
      from (
        select 'new_lead'::text as metric
        from public.leads l
        where l.organization_id = v_profile.organization_id
          and l.deleted_at is null and l.status = 'new'
        union all
        select 'unassigned_lead'
        from public.leads l
        where l.organization_id = v_profile.organization_id
          and l.deleted_at is null and l.assigned_sales_profile_id is null
        union all
        select 'qualified_lead'
        from public.leads l
        where l.organization_id = v_profile.organization_id
          and l.deleted_at is null and l.status = 'qualified'
        union all
        select 'overdue_followup'
        from public.follow_ups f
        where f.organization_id = v_profile.organization_id
          and f.status in ('open', 'overdue') and f.due_at < v_today_start
        union all
        select 'pending_payment'
        from public.booking_payments bp
        where bp.organization_id = v_profile.organization_id
          and bp.verification_status = 'pending'
        union all
        select 'open_conversation'
        from public.conversations c
        where c.organization_id = v_profile.organization_id and c.status in ('open', 'pending')
      ) metrics;

    when 'sales' then
      select jsonb_build_object(
        'new_leads', count(*) filter (where metric = 'new_lead'),
        'followups_today', count(*) filter (where metric = 'followup_today'),
        'overdue_followups', count(*) filter (where metric = 'overdue_followup'),
        'qualified_leads', count(*) filter (where metric = 'qualified_lead'),
        'booking_payment_pending', count(*) filter (where metric = 'booking_payment_pending'),
        'confirmed_bookings', count(*) filter (where metric = 'confirmed_booking'),
        'pending_payments', count(*) filter (where metric = 'pending_payment')
      )
      into v_result
      from (
        select 'new_lead'::text as metric
        from public.leads l
        where l.organization_id = v_profile.organization_id
          and l.deleted_at is null
          and l.assigned_sales_profile_id = v_profile.id
          and l.status = 'new'
        union all
        select 'followup_today'
        from public.follow_ups f
        where f.organization_id = v_profile.organization_id
          and f.assigned_profile_id = v_profile.id
          and f.status in ('open', 'overdue')
          and f.due_at >= v_today_start and f.due_at < v_today_end
        union all
        select 'overdue_followup'
        from public.follow_ups f
        where f.organization_id = v_profile.organization_id
          and f.assigned_profile_id = v_profile.id
          and f.status in ('open', 'overdue')
          and f.due_at < v_today_start
        union all
        select 'qualified_lead'
        from public.leads l
        where l.organization_id = v_profile.organization_id
          and l.deleted_at is null
          and l.assigned_sales_profile_id = v_profile.id
          and l.status = 'qualified'
        union all
        select 'booking_payment_pending'
        from public.leads l
        where l.organization_id = v_profile.organization_id
          and l.deleted_at is null
          and l.assigned_sales_profile_id = v_profile.id
          and l.status = 'booking_payment_pending'
        union all
        select 'confirmed_booking'
        from public.bookings b
        where b.organization_id = v_profile.organization_id
          and b.deleted_at is null
          and b.sold_by_profile_id = v_profile.id
          and b.event_date >= p_today
          and b.service_status in ('confirmed', 'chef_assigned', 'preparing')
        union all
        select 'pending_payment'
        from public.booking_payments bp
        where bp.organization_id = v_profile.organization_id
          and bp.submitted_by_profile_id = v_profile.id
          and bp.verification_status = 'pending'
      ) metrics;

    when 'chef', 'part_time_chef' then
      select jsonb_build_object(
        'total_assigned', count(*) filter (where metric = 'assigned'),
        'working_now', count(*) filter (where metric = 'working'),
        'pending_attendance', count(*) filter (where metric = 'pending_attendance'),
        'pending_expenses', count(*) filter (where metric = 'pending_expense')
      )
      into v_result
      from (
        select 'assigned'::text as metric
        from public.booking_assignments ba
        where ba.organization_id = v_profile.organization_id
          and ba.chef_profile_id = v_profile.id and ba.unassigned_at is null
        union all
        select 'working'
        from public.attendance_shifts a
        where a.organization_id = v_profile.organization_id
          and a.profile_id = v_profile.id and a.status = 'working'
        union all
        select 'pending_attendance'
        from public.attendance_shifts a
        where a.organization_id = v_profile.organization_id
          and a.profile_id = v_profile.id and a.status = 'pending_approval'
        union all
        select 'pending_expense'
        from public.expenses e
        where e.organization_id = v_profile.organization_id
          and e.submitted_by_profile_id = v_profile.id
          and e.status in ('pending', 'verified')
      ) metrics;
  end case;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_dashboard_metric_counts(date, timestamptz)
  from public, anon;
grant execute on function public.get_dashboard_metric_counts(date, timestamptz)
  to authenticated, service_role;

