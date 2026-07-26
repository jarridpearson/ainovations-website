begin;

-- The portal now has a dedicated Analyze Company Data view.
-- Update the database constraint so questions from that view can be saved.

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select
      constraint_definition.conname
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid =
      'public.organization_ai_questions'::regclass
      and constraint_definition.contype = 'c'
      and pg_get_constraintdef(
        constraint_definition.oid
      ) ilike '%portal_view%'
  loop
    execute format(
      'alter table public.organization_ai_questions drop constraint %I',
      constraint_record.conname
    );
  end loop;
end;
$$;

alter table public.organization_ai_questions
  add constraint organization_ai_questions_portal_view_check
  check (
    portal_view in (
      'overview',
      'users',
      'groups',
      'billing',
      'reports',
      'analyze',
      'settings'
    )
  );

commit;
