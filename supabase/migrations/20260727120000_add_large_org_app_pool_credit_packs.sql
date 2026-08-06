begin;

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
    'organization_app_pool_ai_credits_500_monthly',
    '500 Organization Shared App AI Credits',
    'app_credit_addon',
    'monthly',
    2499,
    null,
    500,
    'prod_UxjmbrGMQytLnq',
    'price_1TxoIdDBB5irv1eWvudspFkO',
    true
  ),
  (
    'organization_app_pool_ai_credits_1000_monthly',
    '1,000 Organization Shared App AI Credits',
    'app_credit_addon',
    'monthly',
    4499,
    null,
    1000,
    'prod_UxjmbWwTtX2OT5',
    'price_1TxoIeDBB5irv1eW97Pt1JLF',
    true
  ),
  (
    'organization_app_pool_ai_credits_5000_monthly',
    '5,000 Organization Shared App AI Credits',
    'app_credit_addon',
    'monthly',
    19999,
    null,
    5000,
    'prod_Uxjm4YCTZc7Bew',
    'price_1TxoIfDBB5irv1eWU2UiF1y1',
    true
  ),
  (
    'organization_app_pool_ai_credits_10000_monthly',
    '10,000 Organization Shared App AI Credits',
    'app_credit_addon',
    'monthly',
    34999,
    null,
    10000,
    'prod_UxjmlifBfTFESr',
    'price_1TxoIgDBB5irv1eW6FyY2cFS',
    true
  )
on conflict (product_key)
do update set
  product_name = excluded.product_name,
  product_type = 'app_credit_addon',
  billing_interval = excluded.billing_interval,
  unit_amount_cents = excluded.unit_amount_cents,
  portal_credits_per_unit = null,
  app_pool_credits_per_unit =
    excluded.app_pool_credits_per_unit,
  stripe_product_id = excluded.stripe_product_id,
  stripe_price_id = excluded.stripe_price_id,
  active = true,
  updated_at = now();

commit;
