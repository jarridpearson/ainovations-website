begin;

-- ============================================================
-- RESTORE THE ORIGINAL 50 / 100 / 250 PRODUCTS AS PORTAL AI
-- PRODUCTS. Their existing Stripe products are retained.
-- ============================================================

update public.organization_billing_products
set
  product_key =
    'organization_portal_ai_credits_50_monthly',
  product_name =
    '50 Organization Portal AI Credits',
  product_type =
    'portal_credit_addon',
  portal_credits_per_unit =
    50,
  app_pool_credits_per_unit =
    null,
  updated_at =
    now()
where stripe_price_id =
  'price_1Txnu2DBB5irv1eWMxKboLcP';

update public.organization_billing_products
set
  product_key =
    'organization_portal_ai_credits_100_monthly',
  product_name =
    '100 Organization Portal AI Credits',
  product_type =
    'portal_credit_addon',
  portal_credits_per_unit =
    100,
  app_pool_credits_per_unit =
    null,
  updated_at =
    now()
where stripe_price_id =
  'price_1Txnu4DBB5irv1eW68ncPZxT';

update public.organization_billing_products
set
  product_key =
    'organization_portal_ai_credits_250_monthly',
  product_name =
    '250 Organization Portal AI Credits',
  product_type =
    'portal_credit_addon',
  portal_credits_per_unit =
    250,
  app_pool_credits_per_unit =
    null,
  updated_at =
    now()
where stripe_price_id =
  'price_1Txnu5DBB5irv1eW10l2A52d';

-- ============================================================
-- ADD THREE SEPARATE STRIPE PRODUCTS FOR THE ORGANIZATION'S
-- SHARED APP-USER AI CREDIT POOL.
-- ============================================================

insert into public.organization_billing_products (
  product_key,
  product_name,
  product_type,
  billing_interval,
  unit_amount_cents,
  portal_credits_per_unit,
  app_pool_credits_per_unit,
  stripe_product_id,
  stripe_price_id,
  active
)
values
  (
    'organization_app_pool_ai_credits_50_monthly',
    '50 Organization Shared App AI Credits',
    'app_credit_addon',
    'monthly',
    299,
    null,
    50,
    'prod_Uxjyrrp3s5aghW',
    'price_1TxoU6DBB5irv1eWDPweb5J3',
    true
  ),
  (
    'organization_app_pool_ai_credits_100_monthly',
    '100 Organization Shared App AI Credits',
    'app_credit_addon',
    'monthly',
    499,
    null,
    100,
    'prod_UxjyPSFLBnAgAX',
    'price_1TxoU7DBB5irv1eWItOKbvtN',
    true
  ),
  (
    'organization_app_pool_ai_credits_250_monthly',
    '250 Organization Shared App AI Credits',
    'app_credit_addon',
    'monthly',
    1299,
    null,
    250,
    'prod_UxjyPDjATohNug',
    'price_1TxoU8DBB5irv1eWnRIpG0cT',
    true
  )
on conflict (product_key)
do update set
  product_name =
    excluded.product_name,
  product_type =
    'app_credit_addon',
  billing_interval =
    excluded.billing_interval,
  unit_amount_cents =
    excluded.unit_amount_cents,
  portal_credits_per_unit =
    null,
  app_pool_credits_per_unit =
    excluded.app_pool_credits_per_unit,
  stripe_product_id =
    excluded.stripe_product_id,
  stripe_price_id =
    excluded.stripe_price_id,
  active =
    true,
  updated_at =
    now();

do $$
begin
  if (
    select count(*)
    from public.organization_billing_products
    where product_type = 'portal_credit_addon'
      and portal_credits_per_unit in (50, 100, 250)
      and app_pool_credits_per_unit is null
  ) <> 3 then
    raise exception
      'The three portal AI credit products are not configured correctly';
  end if;

  if (
    select count(*)
    from public.organization_billing_products
    where product_type = 'app_credit_addon'
      and app_pool_credits_per_unit in (50, 100, 250)
      and portal_credits_per_unit is null
  ) <> 3 then
    raise exception
      'The three shared app-pool credit products are not configured correctly';
  end if;
end
$$;

commit;
