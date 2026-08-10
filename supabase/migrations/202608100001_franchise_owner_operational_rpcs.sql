-- Allow a Franchise Owner to run the same operational workflows as a Manager,
-- but only for records belonging to that owner's franchise.  The application
-- already exposes these workflows to the Franchise role; these stored RPCs
-- must enforce the matching role and scope as well.

do $migration$
declare
  r record;
  v_definition text;
  v_patched text;
  v_after_role_patch text;
  v_role_patched boolean;
  v_scope_patched boolean;
  v_count integer := 0;
  v_expected constant integer := 27;
begin
  for r in
    select p.oid, n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private')
      and p.prosecdef
      and p.proname in (
        'add_conversation_internal_note',
        'add_lead_note',
        'assign_booking_chef',
        'assign_conversation',
        'assign_lead',
        'assign_temporary_worker_to_booking',
        'bulk_approve_attendance_shifts',
        'correct_attendance_shift',
        'create_sales_follow_up',
        'issue_booking_invoice',
        'log_manual_sales_call',
        'record_missed_attendance_shift',
        'resend_booking_invoice',
        'review_attendance_shift',
        'review_booking_payment',
        'review_expense_claim',
        'review_leave_request',
        'review_payroll_period',
        'set_conversation_status',
        'transition_lead_stage',
        'update_booking_customer_email',
        'update_booking_details',
        'update_employee_private_record',
        'update_sales_follow_up',
        'update_workforce_compensation',
        'void_and_reissue_invoice',
        'retry_customer_email'
      )
  loop
    v_definition := pg_get_functiondef(r.oid);
    v_patched := v_definition;

    -- Franchise Owner is the operational owner of the business unit.  These
    -- are the pre-existing Manager/Director role gates used by the selected
    -- workflows.  Director-only finance controls are deliberately not here.
    v_patched := regexp_replace(
      v_patched,
      '''director''\s*,\s*''manager''',
      '''director'', ''franchise'', ''manager''',
      'g'
    );
    v_patched := replace(
      v_patched,
      'elsif v_actor.role = ''manager'' then',
      'elsif v_actor.role in (''franchise'', ''manager'') then'
    );
    v_role_patched := v_patched <> v_definition;
    v_after_role_patch := v_patched;

    -- SECURITY DEFINER bypasses RLS.  Add an explicit franchise predicate to
    -- every tenant row lookup/update in these operational functions.  A
    -- Director retains organization-wide access; any other permitted actor is
    -- restricted to the franchise attached to their active profile.
    v_patched := regexp_replace(
      v_patched,
      '([a-z_][a-z_0-9]*)\.organization_id = v_actor\.organization_id',
      '\1.organization_id = v_actor.organization_id and (v_actor.role = ''director'' or \1.franchise_id = v_actor.franchise_id)',
      'g'
    );
    v_scope_patched := v_patched <> v_after_role_patch;

    if not v_role_patched then
      raise exception 'franchise role patch did not match %.%', r.nspname, r.proname;
    end if;

    -- add_lead_note is already constrained by the franchise-aware
    -- can_read_lead() helper before it writes anything.
    if not v_scope_patched
       and not (r.proname = 'add_lead_note' and position('public.can_read_lead' in v_patched) > 0) then
      raise exception 'franchise scope patch did not match %.%', r.nspname, r.proname;
    end if;

    execute v_patched;
    v_count := v_count + 1;
  end loop;

  if v_count <> v_expected then
    raise exception 'expected % operational RPCs, patched %', v_expected, v_count;
  end if;
end
$migration$;

notify pgrst, 'reload schema';
