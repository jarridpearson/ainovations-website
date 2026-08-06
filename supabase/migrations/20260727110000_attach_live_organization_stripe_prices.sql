begin;

insert into public.stripe_billing_prices (
  plan_key,
  component_key,
  billing_product_key,
  billing_interval,
  stripe_product_id,
  stripe_price_id,
  active
)
values
  (
    'organization_starter',
    'portal_base',
    null,
    'monthly',
    'prod_Uxj7mnuc5yWJnP',
    'price_1TxnfKDBB5irv1eWtK1A1D0v',
    true
  ),
  (
    'organization_starter',
    'portal_base',
    null,
    'annual',
    'prod_Uxj7mnuc5yWJnP',
    'price_1TxnfKDBB5irv1eWFJFC0PSf',
    true
  ),
  (
    'organization_starter',
    'user_seat',
    null,
    'monthly',
    'prod_Uxj73txJ7qrShz',
    'price_1TxnfLDBB5irv1eWCaS9IRCL',
    true
  ),
  (
    'organization_starter',
    'user_seat',
    null,
    'annual',
    'prod_Uxj73txJ7qrShz',
    'price_1TxnfMDBB5irv1eWAY850cOJ',
    true
  ),
  (
    'organization_pro',
    'portal_base',
    null,
    'monthly',
    'prod_Uxj7vIuE9ykQcv',
    'price_1TxnfNDBB5irv1eWzuWAms1g',
    true
  ),
  (
    'organization_pro',
    'portal_base',
    null,
    'annual',
    'prod_Uxj7vIuE9ykQcv',
    'price_1TxnfODBB5irv1eW7falcCpk',
    true
  ),
  (
    'organization_pro',
    'user_seat',
    null,
    'monthly',
    'prod_Uxj7qQsVup0Bnz',
    'price_1TxnfPDBB5irv1eWOHHPzoKY',
    true
  ),
  (
    'organization_pro',
    'user_seat',
    null,
    'annual',
    'prod_Uxj7qQsVup0Bnz',
    'price_1TxnfPDBB5irv1eWIDF9chG0',
    true
  )
on conflict (
  plan_key,
  component_key,
  billing_interval
)
where component_key in ('portal_base', 'user_seat')
do update set
  stripe_product_id = excluded.stripe_product_id,
  stripe_price_id = excluded.stripe_price_id,
  active = true,
  updated_at = now();

commit;
