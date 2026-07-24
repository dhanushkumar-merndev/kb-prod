-- Supabase Security Advisor 0029 hardening.
--
-- Authenticated clients intentionally call transactional workflow RPCs, but
-- privileged implementations should not live in the exposed `public` schema.
-- Move every authenticated SECURITY DEFINER implementation into a non-exposed
-- schema and recreate the public API as SECURITY INVOKER wrappers. The private
-- implementation still validates auth.uid(), active status, tenant and role.

create schema if not exists app_private;

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

-- These account-administration functions are Edge/service-role only.
revoke all on function public.update_account_status(
  uuid,
  public.account_status,
  text,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.update_account_status(
  uuid,
  public.account_status,
  text,
  uuid,
  text
) to service_role;

revoke all on function public.replace_role_holder(
  uuid,
  public.profile_role,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.replace_role_holder(
  uuid,
  public.profile_role,
  text,
  uuid,
  uuid,
  text
) to service_role;

-- Trigger functions never need direct API execution. PostgreSQL executes them
-- through their trigger bindings without an EXECUTE grant to the table caller.
do $migration$
declare
  v_function record;
begin
  for v_function in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      v_function.proname,
      v_function.identity_arguments
    );
  end loop;
end;
$migration$;

-- Move the remaining authenticated privileged functions and generate wrappers
-- from PostgreSQL's own catalog metadata so overloads, defaults and table
-- return signatures are preserved exactly.
do $migration$
declare
  v_function record;
  v_call_arguments text;
  v_volatility text;
begin
  for v_function in
    select
      p.oid,
      p.proname,
      p.pronargs,
      p.proargnames,
      p.provolatile,
      pg_get_function_arguments(p.oid) as declaration_arguments,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_get_function_result(p.oid) as result_type
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    order by p.proname, pg_get_function_identity_arguments(p.oid)
  loop
    if v_function.pronargs = 0 then
      v_call_arguments := '';
    else
      select string_agg(
        format('%I', (v_function.proargnames)[argument_position]),
        ', '
        order by argument_position
      )
      into v_call_arguments
      from generate_series(1, v_function.pronargs) as positions(argument_position);

      if v_call_arguments is null then
        raise exception using
          errcode = '22023',
          message = 'PRIVILEGED_FUNCTION_ARGUMENT_NAMES_REQUIRED',
          detail = v_function.proname;
      end if;
    end if;

    v_volatility := case v_function.provolatile
      when 'i' then 'immutable'
      when 's' then 'stable'
      else 'volatile'
    end;

    execute format(
      'alter function public.%I(%s) set schema app_private',
      v_function.proname,
      v_function.identity_arguments
    );

    execute format(
      $wrapper$
        create function public.%I(%s)
        returns %s
        language sql
        %s
        security invoker
        set search_path = app_private, pg_temp
        as $body$
          select *
          from app_private.%I(%s)
        $body$
      $wrapper$,
      v_function.proname,
      v_function.declaration_arguments,
      v_function.result_type,
      v_volatility,
      v_function.proname,
      v_call_arguments
    );

    execute format(
      'revoke all on function app_private.%I(%s) from public, anon',
      v_function.proname,
      v_function.identity_arguments
    );
    execute format(
      'grant execute on function app_private.%I(%s) to authenticated, service_role',
      v_function.proname,
      v_function.identity_arguments
    );
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated, service_role',
      v_function.proname,
      v_function.identity_arguments
    );
    execute format(
      'grant execute on function public.%I(%s) to authenticated, service_role',
      v_function.proname,
      v_function.identity_arguments
    );
  end loop;
end;
$migration$;

revoke create on schema app_private from public, anon, authenticated;

comment on schema app_private is
  'Non-exposed implementations for authenticated, role-checked CRM workflow RPCs.';
