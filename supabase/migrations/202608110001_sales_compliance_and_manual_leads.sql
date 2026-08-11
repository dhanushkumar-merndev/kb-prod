-- Reliable manual lead capture and the daily sales compliance leaderboard.
-- All writes are authorized in the database and remain franchise scoped.

create table public.lead_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  franchise_id uuid,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag text not null check (char_length(btrim(tag)) between 1 and 40),
  added_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_tags_franchise_org_fk foreign key (franchise_id, organization_id)
    references public.franchises(id, organization_id) on delete restrict
);

create unique index lead_tags_unique
  on public.lead_tags (lead_id, lower(btrim(tag)));
create index lead_tags_scope_idx
  on public.lead_tags (organization_id, franchise_id, lead_id);

create trigger lead_tags_set_updated_at
before update on public.lead_tags
for each row execute function public.set_updated_at();

create trigger aa_franchise_scope
before insert or update or delete on public.lead_tags
for each row execute function public.apply_franchise_scope('leads', 'lead_id');

alter table public.lead_tags enable row level security;

create policy lead_tags_franchise_isolation
on public.lead_tags
as restrictive for all to authenticated
using (
  franchise_id = (select public.current_franchise_id())
  or (select public.is_director())
)
with check (
  franchise_id = (select public.current_franchise_id())
  or (select public.is_director())
);

create policy lead_tags_select_scoped
on public.lead_tags for select to authenticated
using (public.can_read_lead(lead_id));

create policy lead_tags_insert_scoped
on public.lead_tags for insert to authenticated
with check (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and added_by_profile_id = public.current_profile_id()
  and public.can_read_lead(lead_id)
);

create policy lead_tags_delete_scoped
on public.lead_tags for delete to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and public.can_read_lead(lead_id)
);

grant select, insert, delete on public.lead_tags to authenticated;

create table public.sales_daily_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  franchise_id uuid,
  sales_profile_id uuid not null references public.profiles(id) on delete restrict,
  score_date date not null,
  manager_score smallint not null default 0 check (manager_score between 0 and 5),
  remarks text check (remarks is null or char_length(btrim(remarks)) between 3 and 1000),
  reviewed_by_profile_id uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_daily_reviews_franchise_org_fk foreign key (franchise_id, organization_id)
    references public.franchises(id, organization_id) on delete restrict,
  constraint sales_daily_reviews_one_per_day unique (sales_profile_id, score_date)
);

create index sales_daily_reviews_scope_idx
  on public.sales_daily_reviews (organization_id, franchise_id, score_date desc);

create trigger sales_daily_reviews_set_updated_at
before update on public.sales_daily_reviews
for each row execute function public.set_updated_at();

create trigger aa_franchise_scope
before insert or update or delete on public.sales_daily_reviews
for each row execute function public.apply_franchise_scope('profiles', 'sales_profile_id');

alter table public.sales_daily_reviews enable row level security;

create policy sales_daily_reviews_franchise_isolation
on public.sales_daily_reviews
as restrictive for all to authenticated
using (
  franchise_id = (select public.current_franchise_id())
  or (select public.is_director())
)
with check (
  franchise_id = (select public.current_franchise_id())
  or (select public.is_director())
);

create policy sales_daily_reviews_select_scoped
on public.sales_daily_reviews for select to authenticated
using (
  public.is_active_profile()
  and organization_id = public.current_organization_id()
  and (
    sales_profile_id = public.current_profile_id()
    or public.is_sales_scope_admin()
  )
);

-- Reviews are written only through the audited RPC below.
grant select on public.sales_daily_reviews to authenticated;

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

create or replace function public.create_manual_lead(
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
language sql
volatile
set search_path = app_private, pg_temp
as $$
  select app_private.create_manual_lead(
    p_client_name, p_phone_e164, p_customer_email, p_source, p_requirement,
    p_event_date, p_guest_count, p_quote_amount, p_notes,
    p_assigned_sales_profile_id, p_tags
  )
$$;

revoke all on function app_private.create_manual_lead(
  text, text, text, text, text, date, integer, numeric, text, uuid, text[]
) from public, anon;
revoke all on function public.create_manual_lead(
  text, text, text, text, text, date, integer, numeric, text, uuid, text[]
) from public, anon;
grant execute on function app_private.create_manual_lead(
  text, text, text, text, text, date, integer, numeric, text, uuid, text[]
) to authenticated;
grant execute on function public.create_manual_lead(
  text, text, text, text, text, date, integer, numeric, text, uuid, text[]
) to authenticated;

create or replace function app_private.review_daily_sales_compliance(
  p_sales_profile_id uuid,
  p_score_date date,
  p_manager_score integer,
  p_remarks text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_review public.sales_daily_reviews%rowtype;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and account_status = 'active' and deleted_at is null;

  if not found
     or v_actor.role not in ('director', 'franchise', 'manager', 'sales_manager') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_manager_score not between 0 and 5
     or nullif(btrim(coalesce(p_remarks, '')), '') is null
     or char_length(btrim(p_remarks)) > 1000
     or p_score_date > current_date then
    raise exception using errcode = '22023', message = 'VALIDATION_FAILED';
  end if;

  select * into v_target
  from public.profiles
  where id = p_sales_profile_id
    and organization_id = v_actor.organization_id
    and role = 'sales'
    and deleted_at is null;

  if not found then
    raise exception using errcode = '23503', message = 'PROFILE_NOT_FOUND';
  end if;

  if v_actor.role <> 'director'
     and v_target.franchise_id is distinct from v_actor.franchise_id then
    raise exception using errcode = '42501', message = 'FRANCHISE_SCOPE_VIOLATION';
  end if;

  insert into public.sales_daily_reviews (
    organization_id, franchise_id, sales_profile_id, score_date,
    manager_score, remarks, reviewed_by_profile_id, reviewed_at
  ) values (
    v_actor.organization_id, v_target.franchise_id, v_target.id, p_score_date,
    p_manager_score, btrim(p_remarks), v_actor.id, now()
  )
  on conflict (sales_profile_id, score_date) do update
  set manager_score = excluded.manager_score,
      remarks = excluded.remarks,
      reviewed_by_profile_id = excluded.reviewed_by_profile_id,
      reviewed_at = excluded.reviewed_at
  returning * into v_review;

  perform public.write_audit_log(
    v_actor.organization_id,
    v_actor.id,
    'sales.compliance_reviewed',
    'sales_daily_review',
    v_review.id,
    null,
    jsonb_build_object(
      'sales_profile_id', v_review.sales_profile_id,
      'score_date', v_review.score_date,
      'manager_score', v_review.manager_score
    ),
    v_review.remarks,
    null
  );

  return jsonb_build_object('id', v_review.id, 'manager_score', v_review.manager_score);
end;
$$;

create or replace function public.review_daily_sales_compliance(
  p_sales_profile_id uuid,
  p_score_date date,
  p_manager_score integer,
  p_remarks text
)
returns jsonb
language sql
volatile
set search_path = app_private, pg_temp
as $$
  select app_private.review_daily_sales_compliance(
    p_sales_profile_id, p_score_date, p_manager_score, p_remarks
  )
$$;

revoke all on function app_private.review_daily_sales_compliance(uuid, date, integer, text)
  from public, anon;
revoke all on function public.review_daily_sales_compliance(uuid, date, integer, text)
  from public, anon;
grant execute on function app_private.review_daily_sales_compliance(uuid, date, integer, text)
  to authenticated;
grant execute on function public.review_daily_sales_compliance(uuid, date, integer, text)
  to authenticated;

create or replace function public.get_daily_sales_compliance(
  p_score_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_timezone text;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_rows jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and account_status = 'active' and deleted_at is null;

  if not found
     or v_actor.role not in ('director', 'franchise', 'manager', 'sales_manager', 'sales') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select timezone into v_timezone
  from public.organizations where id = v_actor.organization_id;
  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');
  v_day_start := p_score_date::timestamp at time zone v_timezone;
  v_day_end := (p_score_date + 1)::timestamp at time zone v_timezone;

  with visible_sales as (
    select p.id, p.full_name, p.franchise_id
    from public.profiles p
    where p.organization_id = v_actor.organization_id
      and p.role = 'sales'
      and p.account_status = 'active'
      and p.deleted_at is null
      and (v_actor.role = 'director' or p.franchise_id = v_actor.franchise_id)
      and (v_actor.role <> 'sales' or p.id = v_actor.id)
  ),
  compliance as (
    select
      s.id as sales_profile_id,
      s.full_name,
      s.franchise_id,
      count(l.id)::integer as assigned_leads,
      coalesce(round(20 * count(l.id) filter (
        where l.updated_at >= v_day_start and l.updated_at < v_day_end
      )::numeric / nullif(count(l.id), 0)), 0)::integer as lead_stage_score,
      coalesce(round(15 * count(l.id) filter (
        where exists (select 1 from public.lead_tags lt where lt.lead_id = l.id)
      )::numeric / nullif(count(l.id), 0)), 0)::integer as tags_score,
      coalesce(round(15 * count(l.id) filter (
        where nullif(btrim(l.client_name), '') is not null
          and nullif(btrim(l.phone_e164), '') is not null
          and nullif(btrim(coalesce(l.requirement, '')), '') is not null
          and l.event_date is not null
          and l.guest_count is not null
          and l.quote_amount is not null
      )::numeric / nullif(count(l.id), 0)), 0)::integer as customer_details_score,
      coalesce(round(20 * count(l.id) filter (
        where exists (
          select 1 from public.superfone_calls sc
          where sc.lead_id = l.id and sc.agent_profile_id = s.id
            and sc.started_at >= v_day_start and sc.started_at < v_day_end
        )
      )::numeric / nullif(count(l.id), 0)), 0)::integer as call_logs_score,
      coalesce(round(10 * count(l.id) filter (
        where l.status in ('won', 'lost', 'unreachable')
           or l.next_follow_up_at is not null
           or exists (
             select 1 from public.follow_ups fu
             where fu.lead_id = l.id and fu.assigned_profile_id = s.id
               and fu.status in ('open', 'completed', 'overdue')
           )
      )::numeric / nullif(count(l.id), 0)), 0)::integer as follow_up_score,
      coalesce(round(5 * count(l.id) filter (
        where l.customer_email is not null
           or exists (
             select 1 from public.messages m
             where m.lead_id = l.id and m.sender_profile_id = s.id
               and m.direction = 'outbound'
               and m.created_at >= v_day_start and m.created_at < v_day_end
           )
      )::numeric / nullif(count(l.id), 0)), 0)::integer as communication_score,
      coalesce(round(10 * count(l.id) filter (
        where coalesce(
          (select min(sc.started_at) from public.superfone_calls sc
           where sc.lead_id = l.id and sc.agent_profile_id = s.id),
          (select min(m.created_at) from public.messages m
           where m.lead_id = l.id and m.sender_profile_id = s.id and m.direction = 'outbound')
        ) <= l.first_received_at + interval '15 minutes'
      )::numeric / nullif(count(l.id), 0)), 0)::integer as response_sla_score
    from visible_sales s
    left join public.leads l
      on l.assigned_sales_profile_id = s.id
     and l.organization_id = v_actor.organization_id
     and l.deleted_at is null
    group by s.id, s.full_name, s.franchise_id
  ),
  scored as (
    select
      c.*,
      coalesce(r.manager_score, 0)::integer as manager_score,
      r.remarks as manager_remarks,
      r.reviewed_at,
      (c.lead_stage_score + c.tags_score + c.customer_details_score
        + c.call_logs_score + c.follow_up_score + c.communication_score
        + c.response_sla_score + coalesce(r.manager_score, 0))::integer as total_score
    from compliance c
    left join public.sales_daily_reviews r
      on r.sales_profile_id = c.sales_profile_id and r.score_date = p_score_date
  ),
  ranked as (
    select scored.*, dense_rank() over (order by total_score desc, full_name asc)::integer as rank
    from scored
  )
  select coalesce(jsonb_agg(to_jsonb(ranked) order by rank, full_name), '[]'::jsonb)
  into v_rows
  from ranked;

  return jsonb_build_object(
    'score_date', p_score_date,
    'can_review', v_actor.role in ('director', 'franchise', 'manager', 'sales_manager'),
    'rows', v_rows
  );
end;
$$;

revoke all on function public.get_daily_sales_compliance(date) from public, anon;
grant execute on function public.get_daily_sales_compliance(date) to authenticated, service_role;

do $$
begin
  begin
    alter publication supabase_realtime add table public.lead_tags;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.sales_daily_reviews;
  exception when duplicate_object then null;
  end;
end;
$$;

comment on function public.create_manual_lead(
  text, text, text, text, text, date, integer, numeric, text, uuid, text[]
) is 'RLS-safe and franchise-safe manual lead capture for every sales-domain role.';
comment on function public.get_daily_sales_compliance(date) is
  'Daily 100-mark operational compliance ranking for visible Sales Executives.';
