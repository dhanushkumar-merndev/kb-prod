-- Correct the E.164 validation introduced with create_manual_lead.
-- With standard_conforming_strings enabled, two backslashes make the regular
-- expression match backslashes instead of escaping the literal plus sign.
create or replace function app_private.create_manual_lead(
  p_client_name text,
  p_phone_e164 text,
  p_customer_email text default null,
  p_source text default 'manual',
  p_requirement text default null,
  p_event_date date default null,
  p_guest_count integer default null,
  p_quote_amount numeric default null,
  p_notes text default null,
  p_assigned_sales_profile_id uuid default null,
  p_tags text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_assignee public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_franchise_id uuid;
  v_assignee_id uuid := p_assigned_sales_profile_id;
  v_tag text;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and deleted_at is null;

  if not found
     or v_actor.role not in ('director', 'franchise', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if nullif(btrim(coalesce(p_client_name, '')), '') is null
     or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or (p_guest_count is not null and p_guest_count <= 0)
     or (p_quote_amount is not null and p_quote_amount < 0) then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  if v_actor.role = 'sales' then
    if v_assignee_id is not null and v_assignee_id <> v_actor.id then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
    v_assignee_id := v_actor.id;
  end if;

  if v_assignee_id is not null then
    select * into v_assignee
    from public.profiles
    where id = v_assignee_id
      and organization_id = v_actor.organization_id
      and role = 'sales'
      and account_status = 'active'
      and deleted_at is null;

    if not found then
      raise exception using errcode = '23514', message = 'INVALID_SALES_ASSIGNEE';
    end if;

    if v_actor.role <> 'director'
       and v_assignee.franchise_id is distinct from v_actor.franchise_id then
      raise exception using errcode = '42501', message = 'FRANCHISE_SCOPE_VIOLATION';
    end if;
  end if;

  v_franchise_id := case
    when v_actor.role = 'director' then v_assignee.franchise_id
    else v_actor.franchise_id
  end;

  insert into public.leads (
    organization_id,
    franchise_id,
    provider,
    source,
    client_name,
    customer_email,
    phone_e164,
    phone_normalized,
    requirement,
    event_date,
    guest_count,
    quote_amount,
    notes,
    assigned_sales_profile_id,
    created_by_profile_id
  ) values (
    v_actor.organization_id,
    v_franchise_id,
    'manual',
    coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'manual'),
    btrim(p_client_name),
    nullif(lower(btrim(coalesce(p_customer_email, ''))), ''),
    p_phone_e164,
    p_phone_e164,
    nullif(btrim(coalesce(p_requirement, '')), ''),
    p_event_date,
    p_guest_count,
    p_quote_amount,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_assignee_id,
    v_actor.id
  ) returning * into v_lead;

  foreach v_tag in array coalesce(p_tags, array[]::text[]) loop
    v_tag := left(btrim(v_tag), 40);
    if v_tag <> '' then
      insert into public.lead_tags (
        organization_id, franchise_id, lead_id, tag, added_by_profile_id
      ) values (
        v_actor.organization_id, v_franchise_id, v_lead.id, v_tag, v_actor.id
      ) on conflict do nothing;
    end if;
  end loop;

  insert into public.lead_activities (
    organization_id, franchise_id, lead_id, actor_profile_id,
    activity_type, summary, metadata, occurred_at
  ) values (
    v_actor.organization_id, v_franchise_id, v_lead.id, v_actor.id,
    'note', 'Manual lead created',
    jsonb_build_object('source', v_lead.source, 'assigned_sales_profile_id', v_assignee_id),
    now()
  );

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'lead.created',
    'lead',
    v_lead.id,
    null,
    jsonb_build_object(
      'id', v_lead.id,
      'franchise_id', v_lead.franchise_id,
      'assigned_sales_profile_id', v_lead.assigned_sales_profile_id,
      'source', v_lead.source
    ),
    'Manual lead created',
    null
  );

  return jsonb_build_object('id', v_lead.id, 'franchise_id', v_lead.franchise_id);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'DUPLICATE_LEAD_PHONE';
end;
$$;

notify pgrst, 'reload schema';
