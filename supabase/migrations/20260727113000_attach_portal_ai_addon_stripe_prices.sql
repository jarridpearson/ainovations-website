begin;

update public.organization_billing_products
set
  stripe_product_id = 'prod_UxjMwyO2JcOron',
  stripe_price_id = 'price_1Txnu2DBB5irv1eWMxKboLcP',
  active = true,
  updated_at = now()
where product_key = 'organization_portal_ai_credits_50_monthly'
  and product_type = 'portal_credit_addon';

update public.organization_billing_products
set
  stripe_product_id = 'prod_UxjMroSIPlcRHl',
  stripe_price_id = 'price_1Txnu4DBB5irv1eW68ncPZxT',
  active = true,
  updated_at = now()
where product_key = 'organization_portal_ai_credits_100_monthly'
  and product_type = 'portal_credit_addon';

update public.organization_billing_products
set
  stripe_product_id = 'prod_UxjMxsVN8Jr5cu',
  stripe_price_id = 'price_1Txnu5DBB5irv1eW10l2A52d',
  active = true,
  updated_at = now()
where product_key = 'organization_portal_ai_credits_250_monthly'
  and product_type = 'portal_credit_addon';

do $$
begin
  if (
    select count(*)
    from public.organization_billing_products
    where product_type = 'portal_credit_addon'
      and product_key in (
        'organization_portal_ai_credits_50_monthly',
        'organization_portal_ai_credits_100_monthly',
        'organization_portal_ai_credits_250_monthly'
      )
      and stripe_product_id is not null
      and stripe_price_id is not null
  ) <> 3 then
    raise exception 'Not all portal AI credit products were mapped';
  end if;
end
$$;

commit;
