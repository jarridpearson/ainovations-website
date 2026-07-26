begin;

-- ============================================================
-- ORGANIZATION COMPANY KNOWLEDGE
-- Pro-only organization document knowledge base.
-- ============================================================

create table public.organization_knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,
  openai_vector_store_id text,
  status text not null default 'active',
  created_by_user_id uuid
    references auth.users(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_knowledge_bases_organization_unique
    unique (organization_id),

  constraint organization_knowledge_bases_status_check
    check (
      status in (
        'active',
        'provisioning',
        'failed',
        'disabled'
      )
    )
);

create table public.organization_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,
  knowledge_base_id uuid not null
    references public.organization_knowledge_bases(id)
    on delete cascade,
  uploaded_by_user_id uuid
    references auth.users(id)
    on delete set null,

  file_name text not null,
  storage_bucket text not null default 'organization-knowledge',
  storage_path text not null,
  mime_type text not null,
  file_size_bytes bigint not null,

  document_status text not null default 'uploaded',
  is_active boolean not null default true,

  openai_file_id text,
  openai_vector_store_file_id text,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  deleted_at timestamptz,

  constraint organization_knowledge_documents_storage_path_unique
    unique (storage_path),

  constraint organization_knowledge_documents_size_check
    check (file_size_bytes > 0),

  constraint organization_knowledge_documents_status_check
    check (
      document_status in (
        'uploaded',
        'processing',
        'ready',
        'failed',
        'deleting',
        'deleted'
      )
    ),

  constraint organization_knowledge_documents_bucket_check
    check (storage_bucket = 'organization-knowledge')
);

create table public.organization_knowledge_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,
  asked_by_user_id uuid not null
    references auth.users(id)
    on delete cascade,

  question_text text not null,
  answer_text text,
  citations jsonb not null default '[]'::jsonb,

  answer_status text not null default 'pending',
  model_used text,

  credits_used integer not null default 0,
  credit_status text not null default 'not_charged',
  request_id uuid,

  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,

  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  credit_refunded_at timestamptz,

  constraint organization_knowledge_questions_question_check
    check (
      char_length(btrim(question_text)) between 1 and 4000
    ),

  constraint organization_knowledge_questions_answer_status_check
    check (
      answer_status in (
        'pending',
        'processing',
        'completed',
        'failed'
      )
    ),

  constraint organization_knowledge_questions_credit_status_check
    check (
      credit_status in (
        'not_charged',
        'charged',
        'refunded'
      )
    ),

  constraint organization_knowledge_questions_credits_check
    check (credits_used >= 0),

  constraint organization_knowledge_questions_prompt_tokens_check
    check (prompt_tokens >= 0),

  constraint organization_knowledge_questions_completion_tokens_check
    check (completion_tokens >= 0),

  constraint organization_knowledge_questions_citations_check
    check (jsonb_typeof(citations) = 'array')
);

create table public.organization_knowledge_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,
  actor_user_id uuid
    references auth.users(id)
    on delete set null,
  document_id uuid
    references public.organization_knowledge_documents(id)
    on delete set null,
  question_id uuid
    references public.organization_knowledge_questions(id)
    on delete set null,

  event_type text not null,
  event_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint organization_knowledge_events_type_check
    check (
      event_type in (
        'knowledge_base_created',
        'knowledge_base_failed',
        'document_upload_prepared',
        'document_uploaded',
        'document_processing_started',
        'document_ready',
        'document_failed',
        'document_deleted',
        'question_started',
        'question_completed',
        'question_failed',
        'question_credit_charged',
        'question_credit_refunded'
      )
    ),

  constraint organization_knowledge_events_metadata_check
    check (jsonb_typeof(event_metadata) = 'object')
);

-- ============================================================
-- INDEXES
-- ============================================================

create index organization_knowledge_documents_organization_idx
  on public.organization_knowledge_documents (
    organization_id,
    created_at desc
  );

create index organization_knowledge_documents_active_idx
  on public.organization_knowledge_documents (
    organization_id,
    document_status
  )
  where is_active = true;

create index organization_knowledge_documents_base_idx
  on public.organization_knowledge_documents (
    knowledge_base_id
  );

create index organization_knowledge_questions_user_idx
  on public.organization_knowledge_questions (
    asked_by_user_id,
    created_at desc
  );

create index organization_knowledge_questions_organization_idx
  on public.organization_knowledge_questions (
    organization_id,
    created_at desc
  );

create unique index organization_knowledge_questions_request_unique
  on public.organization_knowledge_questions (
    organization_id,
    asked_by_user_id,
    request_id
  )
  where request_id is not null;

create index organization_knowledge_events_organization_idx
  on public.organization_knowledge_events (
    organization_id,
    created_at desc
  );

create index organization_knowledge_events_document_idx
  on public.organization_knowledge_events (
    document_id,
    created_at desc
  )
  where document_id is not null;

create index organization_knowledge_events_question_idx
  on public.organization_knowledge_events (
    question_id,
    created_at desc
  )
  where question_id is not null;

-- ============================================================
-- ENTITLEMENT AND DOCUMENT-LIMIT ENFORCEMENT
-- These checks still run when Edge Functions use service role.
-- ============================================================

create or replace function public.organization_has_company_knowledge_access(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations organization_record
    join public.subscription_plans plan_record
      on plan_record.plan_key = organization_record.current_plan_key
    where organization_record.id = p_organization_id
      and organization_record.subscription_status = 'active'
      and organization_record.current_plan_key = 'organization_pro'
      and plan_record.active = true
      and plan_record.account_level = 'organization'
      and plan_record.allows_company_document_questions = true
      and plan_record.company_document_limit > 0
  );
$$;

revoke all
on function public.organization_has_company_knowledge_access(uuid)
from public;

grant execute
on function public.organization_has_company_knowledge_access(uuid)
to authenticated, service_role;

create or replace function public.enforce_organization_knowledge_base_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.organization_has_company_knowledge_access(
    new.organization_id
  ) then
    raise exception
      'Company Knowledge AI requires an active Organization Pro plan.';
  end if;

  return new;
end;
$$;

create trigger enforce_organization_knowledge_base_access_trigger
before insert or update of organization_id
on public.organization_knowledge_bases
for each row
execute function public.enforce_organization_knowledge_base_access();

create or replace function public.enforce_organization_knowledge_document_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_document_count integer;
  current_document_count integer;
begin
  select plan_record.company_document_limit
  into allowed_document_count
  from public.organizations organization_record
  join public.subscription_plans plan_record
    on plan_record.plan_key = organization_record.current_plan_key
  where organization_record.id = new.organization_id
    and organization_record.subscription_status = 'active'
    and organization_record.current_plan_key = 'organization_pro'
    and plan_record.active = true
    and plan_record.account_level = 'organization'
    and plan_record.allows_company_document_questions = true;

  if allowed_document_count is null or allowed_document_count <= 0 then
    raise exception
      'Company Knowledge AI requires an active Organization Pro plan.';
  end if;

  if new.is_active = true
     and new.document_status <> 'deleted' then

    select count(*)
    into current_document_count
    from public.organization_knowledge_documents existing_document
    where existing_document.organization_id = new.organization_id
      and existing_document.is_active = true
      and existing_document.document_status <> 'deleted'
      and existing_document.id <> new.id;

    if current_document_count >= allowed_document_count then
      raise exception
        'This organization has reached its active company document limit of %.',
        allowed_document_count;
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_organization_knowledge_document_limit_trigger
before insert or update of
  organization_id,
  is_active,
  document_status
on public.organization_knowledge_documents
for each row
execute function public.enforce_organization_knowledge_document_limit();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.organization_knowledge_bases
  enable row level security;

alter table public.organization_knowledge_documents
  enable row level security;

alter table public.organization_knowledge_questions
  enable row level security;

alter table public.organization_knowledge_events
  enable row level security;

-- Active organization users may read the knowledge-base record.
create policy organization_knowledge_bases_member_select
on public.organization_knowledge_bases
for select
to authenticated
using (
  public.organization_has_company_knowledge_access(organization_id)
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_bases.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
  )
);

-- Only Organization Admins may create or change the knowledge base.
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
      and organization_user.role = 'organization_admin'
  )
);

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
      and organization_user.role = 'organization_admin'
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
      and organization_user.role = 'organization_admin'
  )
);

-- Active organization users may read approved document metadata.
create policy organization_knowledge_documents_member_select
on public.organization_knowledge_documents
for select
to authenticated
using (
  public.organization_has_company_knowledge_access(organization_id)
  and is_active = true
  and document_status = 'ready'
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_documents.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
  )
);

-- Organization Admins may see every document state.
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
      and organization_user.role = 'organization_admin'
  )
);

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
      and organization_user.role = 'organization_admin'
  )
);

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
      and organization_user.role = 'organization_admin'
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
      and organization_user.role = 'organization_admin'
  )
);

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
      and organization_user.role = 'organization_admin'
  )
);

-- Users may read their own Company Knowledge questions.
-- Organization Admins may read all questions for their organization.
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
        and organization_admin.role = 'organization_admin'
    )
  )
);

-- Direct authenticated inserts are allowed only for the asking user.
-- The final Edge Function will still validate and charge the personal credit.
create policy organization_knowledge_questions_user_insert
on public.organization_knowledge_questions
for insert
to authenticated
with check (
  public.organization_has_company_knowledge_access(organization_id)
  and asked_by_user_id = auth.uid()
  and exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id =
      organization_knowledge_questions.organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
  )
);

-- Audit events are visible only to Organization Admins.
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
      and organization_user.role = 'organization_admin'
  )
);

-- ============================================================
-- PRIVATE STORAGE BUCKET
-- Expected object path:
-- organization_id/document_id/original-file-name.ext
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'organization-knowledge',
  'organization-knowledge',
  false,
  52428800
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

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
      and organization_user.role = 'organization_admin'
  )
);

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
      and organization_user.role = 'organization_admin'
  )
);

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
      and organization_user.role = 'organization_admin'
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
      and organization_user.role = 'organization_admin'
  )
);

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
      and organization_user.role = 'organization_admin'
  )
);

commit;
