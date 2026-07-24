-- Khana Banao CRM: private Storage buckets/policies and scoped Realtime tables.
-- Object naming conventions:
--   employee-private:   <org-id>/<profile-id>/<kind>/<random-file>
--   payment-proofs:     <org-id>/<submitter-profile-id>/<booking-id>/<random-file>
--   expense-bills:      <org-id>/<submitter-profile-id>/<expense-id>/<random-file>
--   conversation-media: <org-id>/<conversation-id>/<sender-profile-id>/<random-file>

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'employee-private',
    'employee-private',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'payment-proofs',
    'payment-proofs',
    false,
    8388608,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'expense-bills',
    'expense-bills',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'conversation-media',
    'conversation-media',
    false,
    15728640,
    array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'audio/ogg',
      'video/mp4'
    ]
  )
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_path_is_current_organization(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.is_active_profile()
    and split_part(p_name, '/', 1) = public.current_organization_id()::text;
$$;

create or replace function public.can_read_expense_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.storage_path_is_current_organization(p_name)
    and exists (
      select 1
      from public.expense_attachments ea
      where ea.organization_id = public.current_organization_id()
        and ea.storage_path = p_name
        and public.can_read_expense(ea.expense_id)
    );
$$;

create or replace function public.can_read_conversation_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.storage_path_is_current_organization(p_name)
    and exists (
      select 1
      from public.conversations c
      where c.organization_id = public.current_organization_id()
        and c.id::text = split_part(p_name, '/', 2)
        and public.can_read_conversation(c.id)
    );
$$;

-- Essential employee records are visible only to HR-scope administrators.
create policy employee_private_select_hr_scope
on storage.objects for select to authenticated
using (
  bucket_id = 'employee-private'
  and public.storage_path_is_current_organization(name)
  and public.is_hr_scope_admin()
);

create policy employee_private_insert_hr_scope
on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-private'
  and public.storage_path_is_current_organization(name)
  and public.is_hr_scope_admin()
  and exists (
    select 1
    from public.profiles p
    where p.organization_id = public.current_organization_id()
      and p.id::text = split_part(name, '/', 2)
      and p.role in ('chef', 'part_time_chef')
      and p.deleted_at is null
  )
  and split_part(name, '/', 3) in ('aadhaar', 'part-time-payment-proof')
);

create policy employee_private_update_hr_scope
on storage.objects for update to authenticated
using (
  bucket_id = 'employee-private'
  and public.storage_path_is_current_organization(name)
  and public.is_hr_scope_admin()
)
with check (
  bucket_id = 'employee-private'
  and public.storage_path_is_current_organization(name)
  and public.is_hr_scope_admin()
  and split_part(name, '/', 3) in ('aadhaar', 'part-time-payment-proof')
  and exists (
    select 1
    from public.profiles p
    where p.organization_id = public.current_organization_id()
      and p.id::text = split_part(name, '/', 2)
      and p.role in ('chef', 'part_time_chef')
      and p.deleted_at is null
  )
);

create policy employee_private_delete_unreferenced_hr_scope
on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-private'
  and public.storage_path_is_current_organization(name)
  and public.is_hr_scope_admin()
  and not exists (
    select 1
    from public.profiles p
    where p.organization_id = public.current_organization_id()
      and (p.aadhaar_storage_path = name or p.part_time_payment_proof_path = name)
  )
);

-- Sales proofs are never public; submitters see their own path while Sales
-- Manager/Manager/Director can verify every proof in the tenant.
create policy payment_proofs_select_sales_scope
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.storage_path_is_current_organization(name)
  and (
    public.is_sales_scope_admin()
    or split_part(name, '/', 2) = public.current_profile_id()::text
  )
);

create policy payment_proofs_insert_submitter
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and public.storage_path_is_current_organization(name)
  and public.current_role() in ('director', 'manager', 'sales_manager', 'sales')
  and split_part(name, '/', 2) = public.current_profile_id()::text
  and exists (
    select 1
    from public.bookings b
    where b.organization_id = public.current_organization_id()
      and b.id::text = split_part(name, '/', 3)
      and (
        public.is_sales_scope_admin()
        or b.sold_by_profile_id = public.current_profile_id()
      )
  )
);

create policy payment_proofs_delete_unreferenced_submitter
on storage.objects for delete to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.storage_path_is_current_organization(name)
  and split_part(name, '/', 2) = public.current_profile_id()::text
  and not exists (
    select 1
    from public.booking_payments bp
    where bp.organization_id = public.current_organization_id()
      and bp.proof_storage_path = name
  )
);

-- Expense objects become readable through their normalized attachment/expense
-- rows. Before metadata is committed only the uploader can access the path.
create policy expense_bills_select_scoped
on storage.objects for select to authenticated
using (
  bucket_id = 'expense-bills'
  and (
    public.can_read_expense_storage_object(name)
    or (
      public.storage_path_is_current_organization(name)
      and split_part(name, '/', 2) = public.current_profile_id()::text
    )
  )
);

create policy expense_bills_insert_submitter
on storage.objects for insert to authenticated
with check (
  bucket_id = 'expense-bills'
  and public.storage_path_is_current_organization(name)
  and split_part(name, '/', 2) = public.current_profile_id()::text
);

create policy expense_bills_delete_unreferenced_submitter
on storage.objects for delete to authenticated
using (
  bucket_id = 'expense-bills'
  and public.storage_path_is_current_organization(name)
  and split_part(name, '/', 2) = public.current_profile_id()::text
  and not exists (
    select 1
    from public.expense_attachments ea
    where ea.organization_id = public.current_organization_id()
      and ea.storage_path = name
  )
);

-- Conversation uploads are constrained to an assigned/authorized conversation.
-- Provider send capability is still checked in the Edge Function adapter.
create policy conversation_media_select_scoped
on storage.objects for select to authenticated
using (
  bucket_id = 'conversation-media'
  and public.can_read_conversation_storage_object(name)
  and (
    split_part(name, '/', 3) = public.current_profile_id()::text
    or exists (
      select 1
      from public.messages m
      where m.organization_id = public.current_organization_id()
        and m.attachment_storage_path = name
        and public.can_read_conversation(m.conversation_id)
    )
  )
);

create policy conversation_media_insert_scoped
on storage.objects for insert to authenticated
with check (
  bucket_id = 'conversation-media'
  and public.storage_path_is_current_organization(name)
  and split_part(name, '/', 3) = public.current_profile_id()::text
  and exists (
    select 1
    from public.conversations c
    where c.organization_id = public.current_organization_id()
      and c.id::text = split_part(name, '/', 2)
      and public.can_read_conversation(c.id)
  )
);

create policy conversation_media_delete_unreferenced_submitter
on storage.objects for delete to authenticated
using (
  bucket_id = 'conversation-media'
  and public.storage_path_is_current_organization(name)
  and split_part(name, '/', 3) = public.current_profile_id()::text
  and not exists (
    select 1
    from public.messages m
    where m.organization_id = public.current_organization_id()
      and m.attachment_storage_path = name
  )
);

revoke all on function public.storage_path_is_current_organization(text) from public, anon;
grant execute on function public.storage_path_is_current_organization(text)
  to authenticated, service_role;
revoke all on function public.can_read_expense_storage_object(text) from public, anon;
grant execute on function public.can_read_expense_storage_object(text)
  to authenticated, service_role;
revoke all on function public.can_read_conversation_storage_object(text) from public, anon;
grant execute on function public.can_read_conversation_storage_object(text)
  to authenticated, service_role;

-- Postgres Changes uses row RLS at authorization time. Only focused, operational
-- tables are published; raw integration payloads, audit logs, and payroll stay out.
do $$
declare
  v_table text;
  v_tables text[] := array[
    'profiles',
    'leads',
    'lead_activities',
    'follow_ups',
    'conversations',
    'messages',
    'conversation_reads',
    'bookings',
    'booking_assignments',
    'booking_payments',
    'attendance_shifts',
    'expenses',
    'leave_requests',
    'tasks',
    'meetings',
    'meeting_attendees',
    'notifications',
    'announcements',
    'announcement_recipients'
  ];
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  foreach v_table in array v_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        v_table
      );
    end if;
  end loop;
end;
$$;

alter table public.profiles replica identity full;
alter table public.leads replica identity full;
alter table public.conversations replica identity full;
alter table public.messages replica identity full;
alter table public.bookings replica identity full;
alter table public.booking_assignments replica identity full;
alter table public.booking_payments replica identity full;
alter table public.attendance_shifts replica identity full;
alter table public.notifications replica identity full;
