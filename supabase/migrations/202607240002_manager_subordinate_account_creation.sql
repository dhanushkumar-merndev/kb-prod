-- Managers may create individual contributors as an operational override.
-- The existing reporting-hierarchy checks still require Sales Members to
-- report to the active Sales Manager and Chef roles to the active HR.
do $migration$
declare
  v_function regprocedure := to_regprocedure(
    'public.create_team_member_profile(uuid,text,text,public.profile_role,public.account_status,uuid,date,public.payment_type,numeric,text,text,numeric,uuid,text)'
  );
  v_definition text;
  v_original text := 'p_role in (''hr'', ''sales_manager'')';
  v_replacement text :=
    'p_role in (''hr'', ''sales_manager'', ''sales'', ''chef'', ''part_time_chef'')';
begin
  if v_function is null then
    raise exception 'create_team_member_profile function was not found';
  end if;

  select pg_get_functiondef(v_function)
  into v_definition;

  if position(v_original in v_definition) = 0 then
    raise exception 'create_team_member_profile permission clause was not found';
  end if;

  execute replace(v_definition, v_original, v_replacement);
end;
$migration$;
