-- Khana Banao CRM: expose franchise membership to the application session.
--
-- The workspace shell needs to name the franchise a user belongs to, and the
-- Director's account screens need to show which franchise each profile sits in.
-- The return type changes, so the previous functions are dropped rather than
-- replaced.

drop function if exists public.get_my_auth_context();
drop function if exists app_private.get_my_auth_context();

create function app_private.get_my_auth_context()
returns table (
  id uuid,
  organization_id uuid,
  franchise_id uuid,
  franchise_name text,
  full_name text,
  phone_e164 text,
  role public.profile_role,
  account_status public.account_status,
  session_version integer
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    p.id,
    p.organization_id,
    p.franchise_id,
    f.name,
    p.full_name,
    p.phone_e164,
    p.role,
    p.account_status,
    p.session_version
  from public.profiles p
  left join public.franchises f on f.id = p.franchise_id
  where p.id = auth.uid()
    and p.deleted_at is null
    and public.current_supabase_auth_session_is_valid()
  limit 1;
$$;

create function public.get_my_auth_context()
returns table (
  id uuid,
  organization_id uuid,
  franchise_id uuid,
  franchise_name text,
  full_name text,
  phone_e164 text,
  role public.profile_role,
  account_status public.account_status,
  session_version integer
)
language sql
stable
set search_path = app_private, pg_temp
as $$
  select * from app_private.get_my_auth_context()
$$;

revoke all on function app_private.get_my_auth_context() from public, anon;
revoke all on function public.get_my_auth_context() from public, anon;
grant execute on function app_private.get_my_auth_context() to authenticated;
grant execute on function public.get_my_auth_context() to authenticated;
