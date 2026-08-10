-- Franchise Owners use the Director metric layout, but the aggregate RPC
-- originally only handled the Director role. Franchise predicates were added
-- in the hierarchy migration; include the role in this branch as well.
do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.get_dashboard_metric_counts(date,timestamptz)'::regprocedure
  );
  v_original constant text := 'when ''director'' then';
  v_replacement constant text := 'when ''director'', ''franchise'' then';
begin
  if position(v_original in v_definition) = 0 then
    raise exception 'dashboard metric director branch was not found';
  end if;

  execute replace(v_definition, v_original, v_replacement);
end
$migration$;

notify pgrst, 'reload schema';
