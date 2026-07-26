begin;

drop policy if exists organization_knowledge_bases_admin_insert
on public.organization_knowledge_bases;

create policy organization_knowledge_bases_admin_insert
on public.organization_knowledge_bases
for insert
to authenticated
with check (
  public.organization_has_company_knowledge_access(organization_id)
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_bases.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_bases_admin_update
on public.organization_knowledge_bases;

create policy organization_knowledge_bases_admin_update
on public.organization_knowledge_bases
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_bases.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
)
with check (
  public.organization_has_company_knowledge_access(organization_id)
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_bases.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_documents_admin_select
on public.organization_knowledge_documents;

create policy organization_knowledge_documents_admin_select
on public.organization_knowledge_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_documents.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_documents_admin_insert
on public.organization_knowledge_documents;

create policy organization_knowledge_documents_admin_insert
on public.organization_knowledge_documents
for insert
to authenticated
with check (
  public.organization_has_company_knowledge_access(organization_id)
  and uploaded_by_user_id = auth.uid()
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_documents.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_documents_admin_update
on public.organization_knowledge_documents;

create policy organization_knowledge_documents_admin_update
on public.organization_knowledge_documents
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_documents.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
)
with check (
  public.organization_has_company_knowledge_access(organization_id)
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_documents.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_documents_admin_delete
on public.organization_knowledge_documents;

create policy organization_knowledge_documents_admin_delete
on public.organization_knowledge_documents
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_documents.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_questions_authorized_select
on public.organization_knowledge_questions;

create policy organization_knowledge_questions_authorized_select
on public.organization_knowledge_questions
for select
to authenticated
using (
  public.organization_has_company_knowledge_access(organization_id)
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_questions.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
  )
  and (
    asked_by_user_id = auth.uid()
    or exists (
      select 1
      from public.organization_users organization_admin
      where organization_admin.organization_id =
        organization_knowledge_questions.organization_id
        and organization_admin.user_id = auth.uid()
        and organization_admin.is_active = true
        and organization_admin.role in (
          'organization_admin',
          'user_admin'
        )
    )
  )
);

drop policy if exists organization_knowledge_events_admin_select
on public.organization_knowledge_events;

create policy organization_knowledge_events_admin_select
on public.organization_knowledge_events
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_events.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_storage_admin_select
on storage.objects;

create policy organization_knowledge_storage_admin_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'organization-knowledge'
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id::text =
      (storage.foldername(name))[1]
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_storage_admin_insert
on storage.objects;

create policy organization_knowledge_storage_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'organization-knowledge'
  and public.organization_has_company_knowledge_access(
    ((storage.foldername(name))[1])::uuid
  )
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id::text =
      (storage.foldername(name))[1]
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_storage_admin_update
on storage.objects;

create policy organization_knowledge_storage_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'organization-knowledge'
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id::text =
      (storage.foldername(name))[1]
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
)
with check (
  bucket_id = 'organization-knowledge'
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id::text =
      (storage.foldername(name))[1]
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

drop policy if exists organization_knowledge_storage_admin_delete
on storage.objects;

create policy organization_knowledge_storage_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'organization-knowledge'
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id::text =
      (storage.foldername(name))[1]
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  )
);

commit;
