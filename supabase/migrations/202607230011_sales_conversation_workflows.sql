-- Khana Banao CRM: transactional sales operations and conversation workspaces.

create unique index if not exists one_active_lead_assignment
  on public.lead_assignment_history (organization_id, lead_id)
  where unassigned_at is null;

create unique index if not exists one_active_conversation_assignment
  on public.conversation_assignments (organization_id, conversation_id)
  where unassigned_at is null;

create unique index if not exists provider_call_unique
  on public.superfone_calls (organization_id, provider_call_id);

-- PostgREST upsert conflict targets cannot infer migration 009's partial index.
-- A full unique index remains nullable-safe in PostgreSQL and gives the provider
-- adapter an atomic on-conflict target.
create unique index if not exists provider_conversation_on_conflict_unique
  on public.conversations (organization_id, provider, provider_conversation_id);

create unique index if not exists provider_message_full_unique
  on public.messages (organization_id, provider, provider_message_id);

create unique index if not exists provider_account_identifier_unique
  on public.integration_connections (provider, account_identifier_safe)
  where account_identifier_safe is not null;

create unique index if not exists one_active_provider_sync
  on public.integration_sync_runs (organization_id, provider)
  where status in ('queued', 'running');

create index if not exists follow_ups_sales_queue_idx
  on public.follow_ups (organization_id, assigned_profile_id, status, due_at);

create index if not exists conversations_sales_inbox_idx
  on public.conversations (
    organization_id,
    assigned_sales_profile_id,
    status,
    last_message_at desc
  );

create index if not exists messages_conversation_unread_idx
  on public.messages (organization_id, conversation_id, created_at desc)
  where direction = 'inbound';

create index if not exists messages_conversation_failed_idx
  on public.messages (organization_id, conversation_id, created_at desc)
  where direction = 'outbound' and status = 'failed';

create or replace function public.capture_initial_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.assigned_sales_profile_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = new.assigned_sales_profile_id
      and p.organization_id = new.organization_id
      and p.role = 'sales'
      and p.account_status = 'active'
      and p.deleted_at is null
  ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  insert into public.lead_assignment_history (
    organization_id,
    lead_id,
    assigned_to_profile_id,
    assigned_by_profile_id,
    reason
  )
  values (
    new.organization_id,
    new.id,
    new.assigned_sales_profile_id,
    coalesce(new.created_by_profile_id, new.assigned_sales_profile_id),
    'Initial lead assignment'
  );

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
    new.organization_id,
    new.assigned_sales_profile_id,
    'lead_assignment',
    'Lead assigned',
    new.client_name || ' was assigned to you.',
    'lead',
    new.id
  );

  perform public.write_audit_log(
    new.organization_id,
    coalesce(new.created_by_profile_id, new.assigned_sales_profile_id),
    'lead.assigned',
    'lead_assignment',
    new.id,
    null,
    jsonb_build_object(
      'assigned_sales_profile_id', new.assigned_sales_profile_id,
      'version', new.version
    ),
    'Initial lead assignment',
    null
  );

  return new;
end;
$$;

drop trigger if exists leads_capture_initial_assignment on public.leads;
create trigger leads_capture_initial_assignment
after insert on public.leads
for each row execute function public.capture_initial_lead_assignment();

create or replace function public.capture_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor_id uuid;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  select p.id
  into v_actor_id
  from public.profiles p
  where p.id = auth.uid()
    and p.organization_id = new.organization_id
    and p.deleted_at is null;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata
  )
  values (
    new.organization_id,
    new.id,
    v_actor_id,
    'status_change',
    'Lead status changed from ' || replace(old.status::text, '_', ' ')
      || ' to ' || replace(new.status::text, '_', ' '),
    jsonb_build_object(
      'from_status', old.status,
      'to_status', new.status,
      'version', new.version
    )
  );

  perform public.write_audit_log(
    new.organization_id,
    v_actor_id,
    'lead.status_changed',
    'lead',
    new.id,
    jsonb_build_object('status', old.status, 'version', old.version),
    jsonb_build_object('status', new.status, 'version', new.version)
  );

  return new;
end;
$$;

drop trigger if exists leads_capture_status_change on public.leads;
create trigger leads_capture_status_change
after update of status on public.leads
for each row execute function public.capture_lead_status_change();

create or replace function public.assign_lead(
  p_lead_id uuid,
  p_assigned_sales_profile_id uuid,
  p_expected_version integer,
  p_reason text
)
returns table (
  lead_id uuid,
  assigned_sales_profile_id uuid,
  version integer,
  changed boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_updated public.leads%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
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

  if not found or v_actor.role not in ('director', 'manager', 'sales_manager') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_expected_version is null or v_reason is null or char_length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select l.*
  into v_lead
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = v_actor.organization_id
    and l.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if v_lead.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if p_assigned_sales_profile_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = p_assigned_sales_profile_id
      and p.organization_id = v_actor.organization_id
      and p.role = 'sales'
      and p.account_status = 'active'
      and p.deleted_at is null
  ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if v_lead.assigned_sales_profile_id is not distinct from p_assigned_sales_profile_id then
    return query
    select v_lead.id, v_lead.assigned_sales_profile_id, v_lead.version, false;
    return;
  end if;

  update public.lead_assignment_history lah
  set unassigned_at = now()
  where lah.organization_id = v_actor.organization_id
    and lah.lead_id = v_lead.id
    and lah.unassigned_at is null;

  update public.conversation_assignments ca
  set unassigned_at = now()
  where ca.organization_id = v_actor.organization_id
    and ca.conversation_id in (
      select c.id
      from public.conversations c
      where c.organization_id = v_actor.organization_id
        and c.lead_id = v_lead.id
    )
    and ca.unassigned_at is null;

  update public.leads l
  set
    assigned_sales_profile_id = p_assigned_sales_profile_id,
    last_activity_at = now()
  where l.id = v_lead.id
    and l.organization_id = v_actor.organization_id
  returning l.* into v_updated;

  update public.conversations c
  set assigned_sales_profile_id = p_assigned_sales_profile_id
  where c.organization_id = v_actor.organization_id
    and c.lead_id = v_lead.id
    and c.assigned_sales_profile_id is distinct from p_assigned_sales_profile_id;

  if p_assigned_sales_profile_id is not null then
    insert into public.lead_assignment_history (
      organization_id,
      lead_id,
      assigned_to_profile_id,
      assigned_by_profile_id,
      reason
    )
    values (
      v_actor.organization_id,
      v_lead.id,
      p_assigned_sales_profile_id,
      v_actor.id,
      v_reason
    );

    insert into public.conversation_assignments (
      organization_id,
      conversation_id,
      assigned_to_profile_id,
      assigned_by_profile_id,
      reason
    )
    select
      v_actor.organization_id,
      c.id,
      p_assigned_sales_profile_id,
      v_actor.id,
      v_reason
    from public.conversations c
    where c.organization_id = v_actor.organization_id
      and c.lead_id = v_lead.id;

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
      p_assigned_sales_profile_id,
      'lead_assignment',
      'Lead assigned',
      v_lead.client_name || ' was assigned to you.',
      'lead',
      v_lead.id
    );
  end if;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata
  )
  values (
    v_actor.organization_id,
    v_lead.id,
    v_actor.id,
    'assignment',
    case
      when p_assigned_sales_profile_id is null then 'Lead moved to the unassigned queue'
      when v_lead.assigned_sales_profile_id is null then 'Lead assigned to a Sales Member'
      else 'Lead reassigned to another Sales Member'
    end,
    jsonb_build_object(
      'from_profile_id', v_lead.assigned_sales_profile_id,
      'to_profile_id', p_assigned_sales_profile_id,
      'reason', v_reason
    )
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    case
      when v_lead.assigned_sales_profile_id is null then 'lead.assigned'
      when p_assigned_sales_profile_id is null then 'lead.unassigned'
      else 'lead.reassigned'
    end,
    'lead_assignment',
    v_lead.id,
    jsonb_build_object(
      'assigned_sales_profile_id', v_lead.assigned_sales_profile_id,
      'version', v_lead.version
    ),
    jsonb_build_object(
      'assigned_sales_profile_id', p_assigned_sales_profile_id,
      'version', v_updated.version
    ),
    v_reason,
    null
  );

  return query
  select v_updated.id, v_updated.assigned_sales_profile_id, v_updated.version, true;
end;
$$;

create or replace function public.reassign_lead(
  p_lead_id uuid,
  p_assigned_sales_profile_id uuid,
  p_expected_version integer,
  p_reason text
)
returns table (
  lead_id uuid,
  assigned_sales_profile_id uuid,
  version integer,
  changed boolean
)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select *
  from public.assign_lead(
    p_lead_id,
    p_assigned_sales_profile_id,
    p_expected_version,
    p_reason
  );
$$;

create or replace function public.assign_conversation(
  p_conversation_id uuid,
  p_assigned_sales_profile_id uuid,
  p_expected_version integer,
  p_reason text
)
returns table (
  conversation_id uuid,
  assigned_sales_profile_id uuid,
  version integer,
  changed boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_conversation public.conversations%rowtype;
  v_updated public.conversations%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
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

  if not found or v_actor.role not in ('director', 'manager', 'sales_manager') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_expected_version is null or v_reason is null or char_length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select c.*
  into v_conversation
  from public.conversations c
  where c.id = p_conversation_id
    and c.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if v_conversation.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if p_assigned_sales_profile_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = p_assigned_sales_profile_id
      and p.organization_id = v_actor.organization_id
      and p.role = 'sales'
      and p.account_status = 'active'
      and p.deleted_at is null
  ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if v_conversation.assigned_sales_profile_id is not distinct from p_assigned_sales_profile_id then
    return query
    select
      v_conversation.id,
      v_conversation.assigned_sales_profile_id,
      v_conversation.version,
      false;
    return;
  end if;

  update public.conversation_assignments ca
  set unassigned_at = now()
  where ca.organization_id = v_actor.organization_id
    and ca.conversation_id = v_conversation.id
    and ca.unassigned_at is null;

  update public.conversations
  set assigned_sales_profile_id = p_assigned_sales_profile_id
  where id = v_conversation.id
    and organization_id = v_actor.organization_id
  returning * into v_updated;

  if p_assigned_sales_profile_id is not null then
    insert into public.conversation_assignments (
      organization_id,
      conversation_id,
      assigned_to_profile_id,
      assigned_by_profile_id,
      reason
    )
    values (
      v_actor.organization_id,
      v_conversation.id,
      p_assigned_sales_profile_id,
      v_actor.id,
      v_reason
    );

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
      p_assigned_sales_profile_id,
      'customer_message',
      'Conversation assigned',
      coalesce(v_conversation.contact_name, v_conversation.contact_phone_e164)
        || ' was assigned to you.',
      'conversation',
      v_conversation.id
    );
  end if;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata
  )
  values (
    v_actor.organization_id,
    v_conversation.lead_id,
    v_actor.id,
    'assignment',
    'Conversation assignment changed',
    jsonb_build_object(
      'conversation_id', v_conversation.id,
      'from_profile_id', v_conversation.assigned_sales_profile_id,
      'to_profile_id', p_assigned_sales_profile_id,
      'reason', v_reason
    )
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'conversation.assignment_changed',
    'conversation_assignment',
    v_conversation.id,
    jsonb_build_object(
      'assigned_sales_profile_id', v_conversation.assigned_sales_profile_id,
      'version', v_conversation.version
    ),
    jsonb_build_object(
      'assigned_sales_profile_id', p_assigned_sales_profile_id,
      'version', v_updated.version
    ),
    v_reason,
    null
  );

  return query
  select v_updated.id, v_updated.assigned_sales_profile_id, v_updated.version, true;
end;
$$;

create or replace function public.create_sales_follow_up(
  p_lead_id uuid,
  p_assigned_profile_id uuid,
  p_due_at timestamptz
)
returns table (
  follow_up_id uuid,
  status public.follow_up_status,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_assignee uuid;
  v_follow_up public.follow_ups%rowtype;
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

  if not found or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_due_at is null then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select l.*
  into v_lead
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = v_actor.organization_id
    and l.deleted_at is null
  for update;

  if not found or not public.can_read_lead(v_lead.id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  v_assignee := v_lead.assigned_sales_profile_id;

  if p_assigned_profile_id is not null
     and p_assigned_profile_id is distinct from v_assignee then
    raise exception using
      errcode = '22023',
      message = 'FOLLOW_UP_ASSIGNEE_MUST_OWN_LEAD';
  end if;

  if v_actor.role = 'sales' and v_assignee is distinct from v_actor.id then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_assignee is null or not exists (
    select 1
    from public.profiles p
    where p.id = v_assignee
      and p.organization_id = v_actor.organization_id
      and p.role = 'sales'
      and p.account_status = 'active'
      and p.deleted_at is null
  ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  insert into public.follow_ups (
    organization_id,
    lead_id,
    assigned_profile_id,
    due_at,
    status,
    created_by_profile_id
  )
  values (
    v_actor.organization_id,
    v_lead.id,
    v_assignee,
    p_due_at,
    'open',
    v_actor.id
  )
  returning * into v_follow_up;

  update public.leads l
  set
    next_follow_up_at = p_due_at,
    status = case when l.status in ('new', 'contacted') then 'follow_up' else l.status end,
    last_activity_at = now()
  where l.id = v_lead.id
    and l.organization_id = v_actor.organization_id;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata
  )
  values (
    v_actor.organization_id,
    v_lead.id,
    v_actor.id,
    'follow_up',
    'Follow-up scheduled',
    jsonb_build_object(
      'follow_up_id', v_follow_up.id,
      'assigned_profile_id', v_assignee,
      'due_at', p_due_at
    )
  );

  if v_assignee <> v_actor.id then
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
      v_assignee,
      'follow_up_due',
      'Follow-up assigned',
      'A follow-up for ' || v_lead.client_name || ' was assigned to you.',
      'follow_up',
      v_follow_up.id
    );
  end if;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'follow_up.created',
    'follow_up',
    v_follow_up.id,
    null,
    jsonb_build_object(
      'lead_id', v_lead.id,
      'assigned_profile_id', v_assignee,
      'due_at', p_due_at,
      'status', v_follow_up.status
    )
  );

  return query
  select v_follow_up.id, v_follow_up.status, v_follow_up.updated_at;
end;
$$;

create or replace function public.update_sales_follow_up(
  p_follow_up_id uuid,
  p_expected_updated_at timestamptz,
  p_due_at timestamptz,
  p_status public.follow_up_status,
  p_outcome text default null
)
returns table (
  follow_up_id uuid,
  status public.follow_up_status,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_follow_up public.follow_ups%rowtype;
  v_updated public.follow_ups%rowtype;
  v_outcome text := nullif(btrim(p_outcome), '');
  v_next_due timestamptz;
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

  if not found or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select f.*
  into v_follow_up
  from public.follow_ups f
  where f.id = p_follow_up_id
    and f.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if v_actor.role = 'sales' and v_follow_up.assigned_profile_id <> v_actor.id then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_follow_up.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if p_due_at is null
     or (p_status = 'completed' and v_outcome is null)
     or (p_status = 'overdue' and p_due_at > now()) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  update public.follow_ups
  set
    due_at = p_due_at,
    status = p_status,
    outcome = v_outcome,
    completed_at = case when p_status = 'completed' then now() else null end
  where id = v_follow_up.id
    and organization_id = v_actor.organization_id
  returning * into v_updated;

  select min(f.due_at)
  into v_next_due
  from public.follow_ups f
  where f.organization_id = v_actor.organization_id
    and f.lead_id = v_follow_up.lead_id
    and f.status in ('open', 'overdue');

  update public.leads
  set
    next_follow_up_at = v_next_due,
    last_activity_at = now()
  where id = v_follow_up.lead_id
    and organization_id = v_actor.organization_id;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata
  )
  values (
    v_actor.organization_id,
    v_follow_up.lead_id,
    v_actor.id,
    'follow_up',
    case p_status
      when 'completed' then 'Follow-up completed'
      when 'cancelled' then 'Follow-up cancelled'
      when 'overdue' then 'Follow-up marked overdue'
      else 'Follow-up rescheduled'
    end,
    jsonb_build_object(
      'follow_up_id', v_follow_up.id,
      'due_at', p_due_at,
      'status', p_status,
      'outcome', v_outcome
    )
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'follow_up.updated',
    'follow_up',
    v_follow_up.id,
    jsonb_build_object(
      'due_at', v_follow_up.due_at,
      'status', v_follow_up.status,
      'outcome', v_follow_up.outcome,
      'updated_at', v_follow_up.updated_at
    ),
    jsonb_build_object(
      'due_at', v_updated.due_at,
      'status', v_updated.status,
      'outcome', v_updated.outcome,
      'updated_at', v_updated.updated_at
    )
  );

  return query
  select v_updated.id, v_updated.status, v_updated.updated_at;
end;
$$;

create or replace function public.add_lead_note(
  p_lead_id uuid,
  p_note text
)
returns table (
  activity_id uuid,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_activity public.lead_activities%rowtype;
  v_note text := nullif(btrim(p_note), '');
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

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales')
     or not public.can_read_lead(p_lead_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_note is null or char_length(v_note) > 4000 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary
  )
  values (
    v_actor.organization_id,
    p_lead_id,
    v_actor.id,
    'note',
    v_note
  )
  returning * into v_activity;

  update public.leads
  set last_activity_at = now()
  where id = p_lead_id
    and organization_id = v_actor.organization_id;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'lead.note_added',
    'lead',
    p_lead_id,
    null,
    jsonb_build_object('activity_id', v_activity.id)
  );

  return query
  select v_activity.id, v_activity.occurred_at;
end;
$$;

create or replace function public.log_manual_sales_call(
  p_lead_id uuid,
  p_conversation_id uuid,
  p_direction public.message_direction,
  p_status text,
  p_started_at timestamptz,
  p_duration_seconds integer,
  p_outcome text default null
)
returns table (
  call_id uuid,
  provider_call_id text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_call public.superfone_calls%rowtype;
  v_call_id uuid := gen_random_uuid();
  v_outcome text := nullif(btrim(p_outcome), '');
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

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales')
     or not public.can_read_lead(p_lead_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select l.*
  into v_lead
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = v_actor.organization_id
    and l.deleted_at is null;

  if not found
     or p_direction not in ('inbound', 'outbound')
     or p_status not in ('completed', 'no_answer', 'busy', 'failed', 'missed')
     or p_started_at is null
     or p_duration_seconds is null
     or p_duration_seconds < 0
     or p_duration_seconds > 86400 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if p_conversation_id is not null and not exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.organization_id = v_actor.organization_id
      and c.lead_id = v_lead.id
      and public.can_read_conversation(c.id)
  ) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  insert into public.superfone_calls (
    id,
    organization_id,
    conversation_id,
    lead_id,
    provider_call_id,
    direction,
    from_phone_e164,
    to_phone_e164,
    agent_profile_id,
    status,
    started_at,
    answered_at,
    ended_at,
    duration_seconds
  )
  values (
    v_call_id,
    v_actor.organization_id,
    p_conversation_id,
    v_lead.id,
    'manual:' || v_call_id::text,
    p_direction,
    case when p_direction = 'outbound' then v_actor.phone_e164 else v_lead.phone_e164 end,
    case when p_direction = 'outbound' then v_lead.phone_e164 else v_actor.phone_e164 end,
    v_actor.id,
    p_status,
    p_started_at,
    case when p_status = 'completed' then p_started_at else null end,
    p_started_at + make_interval(secs => p_duration_seconds),
    p_duration_seconds
  )
  returning * into v_call;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata,
    occurred_at
  )
  values (
    v_actor.organization_id,
    v_lead.id,
    v_actor.id,
    'call',
    coalesce(v_outcome, 'Call logged: ' || replace(p_status, '_', ' ')),
    jsonb_build_object(
      'call_id', v_call.id,
      'direction', p_direction,
      'status', p_status,
      'duration_seconds', p_duration_seconds,
      'conversation_id', p_conversation_id
    ),
    p_started_at
  );

  update public.leads l
  set
    status = case when l.status = 'new' then 'contacted' else l.status end,
    last_activity_at = greatest(l.last_activity_at, p_started_at)
  where l.id = v_lead.id
    and l.organization_id = v_actor.organization_id;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'sales_call.logged',
    'superfone_call',
    v_call.id,
    null,
    jsonb_build_object(
      'lead_id', v_lead.id,
      'direction', p_direction,
      'status', p_status,
      'duration_seconds', p_duration_seconds
    )
  );

  return query
  select v_call.id, v_call.provider_call_id, v_call.created_at;
end;
$$;

create or replace function public.add_conversation_internal_note(
  p_conversation_id uuid,
  p_note text
)
returns table (
  message_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_conversation public.conversations%rowtype;
  v_message public.messages%rowtype;
  v_note text := nullif(btrim(p_note), '');
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

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales')
     or not public.can_read_conversation(p_conversation_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_note is null or char_length(v_note) > 4000 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select c.*
  into strict v_conversation
  from public.conversations c
  where c.id = p_conversation_id
    and c.organization_id = v_actor.organization_id;

  insert into public.messages (
    organization_id,
    conversation_id,
    lead_id,
    provider,
    direction,
    channel,
    message_type,
    body,
    sender_profile_id,
    status,
    sent_at
  )
  values (
    v_actor.organization_id,
    v_conversation.id,
    v_conversation.lead_id,
    'internal',
    'internal',
    'internal',
    'note',
    v_note,
    v_actor.id,
    'sent',
    now()
  )
  returning * into v_message;

  update public.conversations
  set
    last_message_at = now(),
    last_message_preview = 'Internal note: ' || left(v_note, 180)
  where id = v_conversation.id
    and organization_id = v_actor.organization_id;

  update public.leads
  set last_activity_at = now()
  where id = v_conversation.lead_id
    and organization_id = v_actor.organization_id;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'conversation.note_added',
    'message',
    v_message.id,
    null,
    jsonb_build_object(
      'conversation_id', v_conversation.id,
      'message_type', 'note'
    )
  );

  return query
  select v_message.id, v_message.created_at;
end;
$$;

create or replace function public.set_conversation_status(
  p_conversation_id uuid,
  p_expected_version integer,
  p_status public.conversation_status
)
returns table (
  conversation_id uuid,
  status public.conversation_status,
  version integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_conversation public.conversations%rowtype;
  v_updated public.conversations%rowtype;
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

  if not found
     or v_actor.role not in ('director', 'manager', 'sales_manager', 'sales')
     or not public.can_read_conversation(p_conversation_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select c.*
  into v_conversation
  from public.conversations c
  where c.id = p_conversation_id
    and c.organization_id = v_actor.organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if v_conversation.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'CONFLICT_STALE_VERSION';
  end if;

  if v_conversation.status = p_status then
    return query
    select v_conversation.id, v_conversation.status, v_conversation.version;
    return;
  end if;

  update public.conversations
  set
    status = p_status,
    closed_at = case when p_status = 'closed' then now() else null end
  where id = v_conversation.id
    and organization_id = v_actor.organization_id
  returning * into v_updated;

  insert into public.lead_activities (
    organization_id,
    lead_id,
    actor_profile_id,
    activity_type,
    summary,
    metadata
  )
  values (
    v_actor.organization_id,
    v_conversation.lead_id,
    v_actor.id,
    'status_change',
    'Conversation marked ' || replace(p_status::text, '_', ' '),
    jsonb_build_object(
      'conversation_id', v_conversation.id,
      'from_status', v_conversation.status,
      'to_status', p_status
    )
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'conversation.status_changed',
    'conversation',
    v_conversation.id,
    jsonb_build_object(
      'status', v_conversation.status,
      'version', v_conversation.version
    ),
    jsonb_build_object(
      'status', v_updated.status,
      'version', v_updated.version
    )
  );

  return query
  select v_updated.id, v_updated.status, v_updated.version;
end;
$$;

create or replace function public.mark_conversation_read(
  p_conversation_id uuid
)
returns table (
  conversation_id uuid,
  unread_count bigint,
  last_read_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profile_id uuid := public.current_profile_id();
  v_organization_id uuid := public.current_organization_id();
  v_last_message_id uuid;
  v_read_at timestamptz := now();
begin
  if auth.uid() is null
     or not public.is_active_profile()
     or not public.can_read_conversation(p_conversation_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select m.id
  into v_last_message_id
  from public.messages m
  where m.organization_id = v_organization_id
    and m.conversation_id = p_conversation_id
  order by m.created_at desc, m.id desc
  limit 1;

  insert into public.conversation_reads (
    organization_id,
    conversation_id,
    profile_id,
    last_read_message_id,
    last_read_at
  )
  values (
    v_organization_id,
    p_conversation_id,
    v_profile_id,
    v_last_message_id,
    v_read_at
  )
  on conflict on constraint conversation_reads_pkey
  do update set
    last_read_message_id = excluded.last_read_message_id,
    last_read_at = excluded.last_read_at;

  return query
  select p_conversation_id, 0::bigint, v_read_at;
end;
$$;

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
  v_search text := nullif(btrim(p_search), '');
  v_filter text := lower(coalesce(nullif(btrim(p_filter), ''), 'all'));
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if public.current_role() not in ('director', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if v_filter not in ('all', 'unread', 'unassigned', 'mine', 'open', 'pending', 'resolved', 'failed')
     or p_limit < 1
     or p_limit > 100
     or p_offset < 0 then
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
    p.full_name,
    coalesce(unread.unread_count, 0),
    coalesce(failed.failed_count, 0),
    c.version
  from public.conversations c
  left join public.profiles p
    on p.id = c.assigned_sales_profile_id
   and p.organization_id = c.organization_id
  left join public.conversation_reads cr
    on cr.organization_id = c.organization_id
   and cr.conversation_id = c.id
   and cr.profile_id = public.current_profile_id()
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
  where c.organization_id = public.current_organization_id()
    and public.can_read_conversation(c.id)
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
      or (v_filter = 'mine' and c.assigned_sales_profile_id = public.current_profile_id())
      or (v_filter in ('open', 'pending', 'resolved') and c.status::text = v_filter)
      or (v_filter = 'failed' and coalesce(failed.failed_count, 0) > 0)
    )
  order by c.last_message_at desc nulls last, c.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.get_conversation_timeline(
  p_conversation_id uuid,
  p_limit integer default 200
)
returns table (
  event_id uuid,
  event_type text,
  direction text,
  body text,
  status text,
  occurred_at timestamptz,
  actor_profile_id uuid,
  actor_name text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_lead_id uuid;
begin
  if auth.uid() is null
     or not public.is_active_profile()
     or not public.can_read_conversation(p_conversation_id) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select c.lead_id
  into strict v_lead_id
  from public.conversations c
  where c.id = p_conversation_id
    and c.organization_id = v_organization_id;

  return query
  select timeline.*
  from (
    select
      m.id as event_id,
      case when m.direction = 'internal' then 'internal_note' else 'message' end as event_type,
      m.direction::text as direction,
      m.body,
      m.status::text as status,
      coalesce(m.provider_created_at, m.created_at) as occurred_at,
      m.sender_profile_id as actor_profile_id,
      sender.full_name as actor_name,
      jsonb_build_object(
        'message_type', m.message_type,
        'attachment_storage_path', m.attachment_storage_path,
        'failure_message_safe', m.failure_message_safe
      ) as metadata
    from public.messages m
    left join public.profiles sender
      on sender.id = m.sender_profile_id
     and sender.organization_id = m.organization_id
    where m.organization_id = v_organization_id
      and m.conversation_id = p_conversation_id

    union all

    select
      sc.id,
      'call',
      sc.direction::text,
      'Call ' || replace(sc.status, '_', ' '),
      sc.status,
      sc.started_at,
      sc.agent_profile_id,
      agent.full_name,
      jsonb_build_object(
        'duration_seconds', sc.duration_seconds,
        'answered_at', sc.answered_at,
        'ended_at', sc.ended_at
      )
    from public.superfone_calls sc
    left join public.profiles agent
      on agent.id = sc.agent_profile_id
     and agent.organization_id = sc.organization_id
    where sc.organization_id = v_organization_id
      and (
        sc.conversation_id = p_conversation_id
        or (sc.conversation_id is null and sc.lead_id = v_lead_id)
      )

    union all

    select
      la.id,
      case when la.activity_type = 'note' then 'internal_note' else 'activity' end,
      case when la.activity_type = 'note' then 'internal' else 'system' end,
      la.summary,
      la.activity_type,
      la.occurred_at,
      la.actor_profile_id,
      actor.full_name,
      la.metadata
    from public.lead_activities la
    left join public.profiles actor
      on actor.id = la.actor_profile_id
     and actor.organization_id = la.organization_id
    where la.organization_id = v_organization_id
      and la.lead_id = v_lead_id
      and la.activity_type <> 'call'

    union all

    select
      ca.id,
      'assignment',
      'system',
      'Conversation assigned to ' || assignee.full_name,
      case when ca.unassigned_at is null then 'active' else 'ended' end,
      ca.assigned_at,
      ca.assigned_by_profile_id,
      actor.full_name,
      jsonb_build_object(
        'assigned_to_profile_id', ca.assigned_to_profile_id,
        'reason', ca.reason,
        'unassigned_at', ca.unassigned_at
      )
    from public.conversation_assignments ca
    join public.profiles assignee
      on assignee.id = ca.assigned_to_profile_id
     and assignee.organization_id = ca.organization_id
    left join public.profiles actor
      on actor.id = ca.assigned_by_profile_id
     and actor.organization_id = ca.organization_id
    where ca.organization_id = v_organization_id
      and ca.conversation_id = p_conversation_id
  ) timeline
  order by timeline.occurred_at desc, timeline.event_id desc
  limit p_limit;
end;
$$;

create or replace function public.get_superfone_public_capabilities()
returns table (
  connection_status public.integration_connection_status,
  messaging_available boolean,
  media_available boolean,
  calls_available boolean,
  unavailable_reason text
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_connection public.integration_connections%rowtype;
begin
  if auth.uid() is null or not public.is_active_profile() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if public.current_role() not in ('director', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select ic.*
  into v_connection
  from public.integration_connections ic
  where ic.organization_id = public.current_organization_id()
    and ic.provider = 'superfone';

  if not found then
    return query
    select
      'disconnected'::public.integration_connection_status,
      false,
      false,
      false,
      'Superfone is not connected. Provider-backed actions are unavailable.';
    return;
  end if;

  return query
  select
    v_connection.status,
    v_connection.status = 'connected'
      and coalesce(v_connection.capabilities ->> 'sendMessage' = 'true', false),
    v_connection.status = 'connected'
      and coalesce(v_connection.capabilities ->> 'sendMedia' = 'true', false),
    v_connection.status = 'connected'
      and coalesce(v_connection.capabilities ->> 'calls' = 'true', false),
    case
      when v_connection.status <> 'connected' then
        'Superfone is not connected. Provider-backed actions are unavailable.'
      when not coalesce(v_connection.capabilities ->> 'sendMessage' = 'true', false) then
        'Messaging is waiting for the official Superfone API capability configuration.'
      else null
    end;
end;
$$;

-- These workflow changes must pass through the audited, concurrency-aware RPCs
-- above. Read access remains governed by the existing RLS policies.
revoke insert, update, delete on public.follow_ups from authenticated;
revoke update, delete on public.conversations from authenticated;

revoke all on function public.assign_lead(uuid, uuid, integer, text) from public, anon;
grant execute on function public.assign_lead(uuid, uuid, integer, text) to authenticated;

revoke all on function public.capture_initial_lead_assignment() from public, anon, authenticated;
revoke all on function public.capture_lead_status_change() from public, anon, authenticated;

revoke all on function public.reassign_lead(uuid, uuid, integer, text) from public, anon;
grant execute on function public.reassign_lead(uuid, uuid, integer, text) to authenticated;

revoke all on function public.assign_conversation(uuid, uuid, integer, text) from public, anon;
grant execute on function public.assign_conversation(uuid, uuid, integer, text) to authenticated;

revoke all on function public.create_sales_follow_up(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.create_sales_follow_up(uuid, uuid, timestamptz) to authenticated;

revoke all on function public.update_sales_follow_up(
  uuid,
  timestamptz,
  timestamptz,
  public.follow_up_status,
  text
) from public, anon;
grant execute on function public.update_sales_follow_up(
  uuid,
  timestamptz,
  timestamptz,
  public.follow_up_status,
  text
) to authenticated;

revoke all on function public.add_lead_note(uuid, text) from public, anon;
grant execute on function public.add_lead_note(uuid, text) to authenticated;

revoke all on function public.log_manual_sales_call(
  uuid,
  uuid,
  public.message_direction,
  text,
  timestamptz,
  integer,
  text
) from public, anon;
grant execute on function public.log_manual_sales_call(
  uuid,
  uuid,
  public.message_direction,
  text,
  timestamptz,
  integer,
  text
) to authenticated;

revoke all on function public.add_conversation_internal_note(uuid, text) from public, anon;
grant execute on function public.add_conversation_internal_note(uuid, text) to authenticated;

revoke all on function public.set_conversation_status(
  uuid,
  integer,
  public.conversation_status
) from public, anon;
grant execute on function public.set_conversation_status(
  uuid,
  integer,
  public.conversation_status
) to authenticated;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

revoke all on function public.get_conversation_inbox(text, text, uuid, integer, integer)
  from public, anon;
grant execute on function public.get_conversation_inbox(text, text, uuid, integer, integer)
  to authenticated;

revoke all on function public.get_conversation_timeline(uuid, integer) from public, anon;
grant execute on function public.get_conversation_timeline(uuid, integer) to authenticated;

revoke all on function public.get_superfone_public_capabilities() from public, anon;
grant execute on function public.get_superfone_public_capabilities() to authenticated;
