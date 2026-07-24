-- Recompile functions that were accepted by PostgreSQL during migration but
-- whose PL/pgSQL bodies contained runtime-ambiguous output-column names. The
-- original migrations are also corrected so clean environments compile the
-- fixed definitions directly.

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
    'update public\.lead_assignment_history[[:space:]]+set unassigned_at = now\(\)[[:space:]]+where organization_id = v_actor\.organization_id[[:space:]]+and lead_id = v_lead\.id[[:space:]]+and unassigned_at is null;',
    'update public.lead_assignment_history lah
  set unassigned_at = now()
  where lah.organization_id = v_actor.organization_id
    and lah.lead_id = v_lead.id
    and lah.unassigned_at is null;'
  );

  if v_updated is distinct from v_definition then
    execute v_updated;
  end if;

  select pg_get_functiondef(
    'public.assign_conversation(uuid,uuid,integer,text)'::regprocedure
  )
  into v_definition;

  v_updated := regexp_replace(
    v_definition,
    'update public\.conversation_assignments[[:space:]]+set unassigned_at = now\(\)[[:space:]]+where organization_id = v_actor\.organization_id[[:space:]]+and conversation_id = v_conversation\.id[[:space:]]+and unassigned_at is null;',
    'update public.conversation_assignments ca
  set unassigned_at = now()
  where ca.organization_id = v_actor.organization_id
    and ca.conversation_id = v_conversation.id
    and ca.unassigned_at is null;'
  );

  if v_updated is distinct from v_definition then
    execute v_updated;
  end if;

  select pg_get_functiondef(
    'public.review_booking_payment(uuid,public.verification_status,text)'::regprocedure
  )
  into v_definition;

  v_updated := replace(
    replace(
      replace(
        v_definition,
        'then ''fully_paid''',
        'then ''fully_paid''::public.booking_payment_status'
      ),
      'then ''partial''',
      'then ''partial''::public.booking_payment_status'
    ),
    'else ''unpaid''',
    'else ''unpaid''::public.booking_payment_status'
  );

  if v_updated is distinct from v_definition then
    execute v_updated;
  end if;
end;
$migration$;
