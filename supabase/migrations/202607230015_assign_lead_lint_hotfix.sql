-- Qualify the remaining lead/conversation columns in assign_lead. Return-table
-- output names are PL/pgSQL variables, so unqualified table columns are
-- ambiguous at runtime even though CREATE FUNCTION accepts the body.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.assign_lead(uuid,uuid,integer,text)'::regprocedure
  )
  into v_definition;

  v_updated := regexp_replace(
    v_definition,
    'update public\.leads[[:space:]]+set[[:space:]]+assigned_sales_profile_id = p_assigned_sales_profile_id,[[:space:]]+last_activity_at = now\(\)[[:space:]]+where id = v_lead\.id[[:space:]]+and organization_id = v_actor\.organization_id[[:space:]]+returning \* into v_updated;',
    'update public.leads l
  set
    assigned_sales_profile_id = p_assigned_sales_profile_id,
    last_activity_at = now()
  where l.id = v_lead.id
    and l.organization_id = v_actor.organization_id
  returning l.* into v_updated;'
  );

  v_updated := regexp_replace(
    v_updated,
    'update public\.conversations[[:space:]]+set assigned_sales_profile_id = p_assigned_sales_profile_id[[:space:]]+where organization_id = v_actor\.organization_id[[:space:]]+and lead_id = v_lead\.id[[:space:]]+and assigned_sales_profile_id is distinct from p_assigned_sales_profile_id;',
    'update public.conversations c
  set assigned_sales_profile_id = p_assigned_sales_profile_id
  where c.organization_id = v_actor.organization_id
    and c.lead_id = v_lead.id
    and c.assigned_sales_profile_id is distinct from p_assigned_sales_profile_id;'
  );

  if v_updated is distinct from v_definition then
    execute v_updated;
  end if;
end;
$migration$;
