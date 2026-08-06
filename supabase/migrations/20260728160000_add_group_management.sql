begin;

create or replace function
public.create_managed_organization_group(
  p_organization_id uuid,
  p_name text,
  p_parent_group_id uuid default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_group_id uuid;
  v_normalized_name text;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.organization_users as organization_user
    where organization_user.organization_id = p_organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  ) then
    raise exception
      'You do not have permission to manage organization groups.';
  end if;

  v_normalized_name := nullif(trim(p_name), '');

  if v_normalized_name is null then
    raise exception 'Enter a group name.';
  end if;

  if p_parent_group_id is not null
    and not exists (
      select 1
      from public.organization_groups as parent_group
      where parent_group.id = p_parent_group_id
        and parent_group.organization_id = p_organization_id
        and parent_group.is_active = true
    )
  then
    raise exception
      'The selected parent group is not available.';
  end if;

  if exists (
    select 1
    from public.organization_groups as existing_group
    where existing_group.organization_id = p_organization_id
      and existing_group.is_active = true
      and lower(trim(existing_group.name)) =
        lower(v_normalized_name)
  ) then
    raise exception
      'An active group with this name already exists.';
  end if;

  v_slug := trim(
    both '-'
    from regexp_replace(
      lower(v_normalized_name),
      '[^a-z0-9]+',
      '-',
      'g'
    )
  );

  insert into public.organization_groups (
    organization_id,
    name,
    slug,
    parent_group_id,
    description,
    is_active
  )
  values (
    p_organization_id,
    v_normalized_name,
    nullif(v_slug, ''),
    p_parent_group_id,
    nullif(trim(p_description), ''),
    true
  )
  returning id into v_group_id;

  return v_group_id;
end;
$function$;

create or replace function
public.update_managed_organization_group(
  p_organization_id uuid,
  p_group_id uuid,
  p_name text,
  p_parent_group_id uuid default null,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_normalized_name text;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.organization_users as organization_user
    where organization_user.organization_id = p_organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  ) then
    raise exception
      'You do not have permission to manage organization groups.';
  end if;

  if not exists (
    select 1
    from public.organization_groups as target_group
    where target_group.id = p_group_id
      and target_group.organization_id = p_organization_id
      and target_group.is_active = true
  ) then
    raise exception 'The group could not be found.';
  end if;

  v_normalized_name := nullif(trim(p_name), '');

  if v_normalized_name is null then
    raise exception 'Enter a group name.';
  end if;

  if p_parent_group_id = p_group_id then
    raise exception 'A group cannot report to itself.';
  end if;

  if p_parent_group_id is not null
    and not exists (
      select 1
      from public.organization_groups as parent_group
      where parent_group.id = p_parent_group_id
        and parent_group.organization_id = p_organization_id
        and parent_group.is_active = true
    )
  then
    raise exception
      'The selected parent group is not available.';
  end if;

  if p_parent_group_id is not null
    and exists (
      with recursive descendants as (
        select child_group.id
        from public.organization_groups as child_group
        where child_group.parent_group_id = p_group_id
          and child_group.organization_id = p_organization_id
          and child_group.is_active = true

        union all

        select nested_group.id
        from public.organization_groups as nested_group
        join descendants
          on nested_group.parent_group_id = descendants.id
        where nested_group.organization_id = p_organization_id
          and nested_group.is_active = true
      )
      select 1
      from descendants
      where descendants.id = p_parent_group_id
    )
  then
    raise exception
      'A group cannot report beneath one of its descendants.';
  end if;

  if exists (
    select 1
    from public.organization_groups as existing_group
    where existing_group.organization_id = p_organization_id
      and existing_group.id <> p_group_id
      and existing_group.is_active = true
      and lower(trim(existing_group.name)) =
        lower(v_normalized_name)
  ) then
    raise exception
      'An active group with this name already exists.';
  end if;

  v_slug := trim(
    both '-'
    from regexp_replace(
      lower(v_normalized_name),
      '[^a-z0-9]+',
      '-',
      'g'
    )
  );

  update public.organization_groups
  set
    name = v_normalized_name,
    slug = nullif(v_slug, ''),
    parent_group_id = p_parent_group_id,
    description = nullif(trim(p_description), '')
  where id = p_group_id
    and organization_id = p_organization_id;
end;
$function$;

create or replace function
public.deactivate_managed_organization_group(
  p_organization_id uuid,
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.organization_users as organization_user
    where organization_user.organization_id = p_organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  ) then
    raise exception
      'You do not have permission to manage organization groups.';
  end if;

  if not exists (
    select 1
    from public.organization_groups as target_group
    where target_group.id = p_group_id
      and target_group.organization_id = p_organization_id
      and target_group.is_active = true
  ) then
    raise exception 'The group could not be found.';
  end if;

  if exists (
    select 1
    from public.organization_groups as child_group
    where child_group.organization_id = p_organization_id
      and child_group.parent_group_id = p_group_id
      and child_group.is_active = true
  ) then
    raise exception
      'Move or deactivate this group''s child groups first.';
  end if;

  if exists (
    select 1
    from public.organization_users as assigned_user
    where assigned_user.organization_id = p_organization_id
      and assigned_user.primary_group_id = p_group_id
      and assigned_user.is_active = true
  ) then
    raise exception
      'Move active users out of this group before deactivating it.';
  end if;

  update public.organization_groups
  set is_active = false
  where id = p_group_id
    and organization_id = p_organization_id;
end;
$function$;

revoke all
on function
public.create_managed_organization_group(
  uuid,
  text,
  uuid,
  text
)
from public, anon;

revoke all
on function
public.update_managed_organization_group(
  uuid,
  uuid,
  text,
  uuid,
  text
)
from public, anon;

revoke all
on function
public.deactivate_managed_organization_group(
  uuid,
  uuid
)
from public, anon;

grant execute
on function
public.create_managed_organization_group(
  uuid,
  text,
  uuid,
  text
)
to authenticated, service_role;

grant execute
on function
public.update_managed_organization_group(
  uuid,
  uuid,
  text,
  uuid,
  text
)
to authenticated, service_role;

grant execute
on function
public.deactivate_managed_organization_group(
  uuid,
  uuid
)
to authenticated, service_role;

commit;
