-- A Franchise Owner may access customer conversations within their own
-- franchise, including the safe Superfone capability status used by the
-- conversation screen. The provider secret remains Director-only.
do $migration$
declare
  v_definition text := pg_get_functiondef(
    'app_private.get_superfone_public_capabilities()'::regprocedure
  );
  v_original constant text :=
    '(''director'', ''manager'', ''sales_manager'', ''sales'')';
  v_replacement constant text :=
    '(''director'', ''franchise'', ''manager'', ''sales_manager'', ''sales'')';
begin
  if position(v_original in v_definition) = 0 then
    raise exception 'Superfone public capability role gate was not found';
  end if;

  execute replace(v_definition, v_original, v_replacement);
end
$migration$;

notify pgrst, 'reload schema';
