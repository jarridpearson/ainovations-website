begin;

create or replace function public.get_authorized_everward_user_data(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  result jsonb;
begin
  if p_user_id is null then
    raise exception 'A user ID is required.';
  end if;

  select jsonb_build_object(
    'priorities',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(priority_row) - 'user_id'
          order by priority_row.created_at desc
        )
        from public.priorities as priority_row
        where priority_row.user_id = p_user_id
      ),
      '[]'::jsonb
    ),

    'decisions',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(decision_row) - 'user_id'
          order by decision_row.created_at desc
        )
        from (
          select *
          from public.decisions
          where user_id = p_user_id
          order by created_at desc
          limit 100
        ) as decision_row
      ),
      '[]'::jsonb
    ),

    'trackables',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(metric_row) - 'user_id'
          order by metric_row.created_at desc
        )
        from public.metrics as metric_row
        where metric_row.user_id = p_user_id
      ),
      '[]'::jsonb
    ),

    'trackableEntries',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(observation_row) - 'user_id'
          order by observation_row.recorded_at desc
        )
        from (
          select *
          from public.metric_observations
          where user_id = p_user_id
          order by recorded_at desc
          limit 200
        ) as observation_row
      ),
      '[]'::jsonb
    )
  )
  into result;

  return result;
end;
$function$;

revoke all
on function public.get_authorized_everward_user_data(uuid)
from public, anon, authenticated;

grant execute
on function public.get_authorized_everward_user_data(uuid)
to service_role;

commit;
