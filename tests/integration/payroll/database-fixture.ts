import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

// Runs the production payroll SQL on isolated PostgreSQL/WASM. Auth tables and
// the franchise columns are a minimal fixture; full Supabase policies are also
// covered by supabase/tests. No remote database or real employee data is used.
export async function createPayrollDatabase() {
  const root = process.cwd();
  const db = new PGlite();
  await db.exec(
    `create schema auth; create schema extensions; create role anon; create role authenticated; create role service_role; grant usage on schema auth to authenticated; create table auth.users(id uuid primary key); create table auth.sessions(id uuid primary key, user_id uuid); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$; create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id',auth.uid()) $$; create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;`,
  );
  for (const filename of [
    "202607230001_core_schema.sql",
    "202607230002_auth_helpers_and_rls.sql",
    "202607230010_payroll_workflow.sql",
  ]) {
    const sql = fs
      .readFileSync(`${root}/supabase/migrations/${filename}`, "utf8")
      .replace("create extension if not exists pgcrypto with schema extensions;", "");
    await db.exec(sql);
  }
  await db.exec(
    `alter type public.profile_role add value 'franchise'; create table public.franchises (id uuid primary key, organization_id uuid references organizations(id));`,
  );
  for (const table of [
    "profiles",
    "payroll_periods",
    "payroll_entries",
    "payroll_components",
    "attendance_shifts",
    "expenses",
    "temporary_workers",
  ])
    await db.exec(
      `alter table public.${table} add column franchise_id uuid references public.franchises(id);`,
    );
  await db.exec(
    `create function public.current_franchise_id() returns uuid language sql stable as $$ select franchise_id from profiles where id = auth.uid() $$; create function public.franchise_scope_allows(p_id uuid) returns boolean language sql stable as $$ select public.current_role() = 'director' or p_id = public.current_franchise_id() $$;`,
  );
  const franchise = fs.readFileSync(
    `${root}/supabase/migrations/202608050002_franchise_hierarchy.sql`,
    "utf8",
  );
  await db.exec(
    franchise.slice(
      franchise.indexOf("create or replace function public.apply_franchise_scope()"),
      franchise.indexOf("revoke all on function public.apply_franchise_scope()"),
    ),
  );
  for (const [table, args] of [
    ["payroll_periods", ""],
    ["payroll_entries", "'profiles','profile_id'"],
    ["payroll_components", "'payroll_entries','payroll_entry_id'"],
  ])
    await db.exec(
      `create trigger aa_franchise_scope before insert or update or delete on public.${table} for each row execute function public.apply_franchise_scope(${args});`,
    );
  for (const filename of [
    "202609050001_payroll_simple_design.sql",
    "202609050002_payroll_lock_reversal.sql",
    "202609050003_payroll_calendar_month_days.sql",
  ])
    await db.exec(fs.readFileSync(`${root}/supabase/migrations/${filename}`, "utf8"));
  await db.exec(`insert into organizations(id,name,slug) values('10000000-0000-4000-8000-000000000001','Payroll test','payroll-test');
insert into franchises values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
insert into auth.users values ('30000000-0000-4000-8000-000000000001'), ('30000000-0000-4000-8000-000000000002');
insert into profiles(id,organization_id,franchise_id,full_name,phone_e164,role,account_status,payment_type,payment_amount,joining_date) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','HR Test','+919876543211','hr','active',null,null,'2026-01-01'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Chef Test','+919876543212','chef','active','monthly',30000,'2026-01-01');
insert into auth.sessions select id,id from auth.users;`);

  await db.exec(`
  insert into franchises values ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
  insert into auth.users values ('30000000-0000-4000-8000-000000000003'), ('30000000-0000-4000-8000-000000000004');
  insert into profiles(id,organization_id,franchise_id,full_name,phone_e164,role,account_status,payment_type,payment_amount,joining_date) values
  ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',null,'Director','+919876543213','director','active',null,null,'2026-01-01'),
  ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Other Chef','+919876543214','chef','active','monthly',30000,'2026-01-01');
  insert into auth.sessions select id,id from auth.users on conflict do nothing;
  set request.jwt.claim.sub = '30000000-0000-4000-8000-000000000001';
`);

  return db;
}
