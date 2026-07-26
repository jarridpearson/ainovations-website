begin;

-- Remove the original table-level uniqueness rule that allowed only
-- one price for each plan/component/interval combination. That rule
-- prevents the 50, 100, and 250-credit add-ons from coexisting.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select constraint_definition.conname
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid =
      'public.stripe_billing_prices'::regclass
      and constraint_definition.contype = 'u'
      and (
        select array_agg(attribute_definition.attname order by key_column.ordinality)
        from unnest(constraint_definition.conkey)
          with ordinality as key_column(attribute_number, ordinality)
        join pg_attribute as attribute_definition
          on attribute_definition.attrelid = constraint_definition.conrelid
         and attribute_definition.attnum = key_column.attribute_number
      ) = array[
        'plan_key',
        'component_key',
        'billing_interval'
      ]::name[]
  loop
    execute format(
      'alter table public.stripe_billing_prices drop constraint %I',
      constraint_record.conname
    );
  end loop;
end;
$$;

-- Base-plan and seat prices must remain unique for each plan and interval.
create unique index if not exists
  stripe_billing_prices_base_component_unique
on public.stripe_billing_prices (
  plan_key,
  component_key,
  billing_interval
)
where component_key in ('portal_base', 'user_seat');

-- Each credit package is uniquely identified by its product key and interval.
create unique index if not exists
  stripe_billing_prices_product_key_interval_unique
on public.stripe_billing_prices (
  billing_product_key,
  billing_interval
)
where billing_product_key is not null;

commit;
