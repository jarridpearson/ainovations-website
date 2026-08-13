do $$
declare
  updated_count integer;
begin
  update public.organizations
  set
    stripe_subscription_id = 'sub_1TxwinDBB5irv1eWThIvj45D',
    stripe_customer_id = 'cus_UxsTL0URP3K7xk',
    subscription_status = 'active'
  where id = '4a45eed7-f5c1-4741-abc1-fc83c1ef8b9c'
    and (
      stripe_subscription_id is distinct from
        'sub_1TxwinDBB5irv1eWThIvj45D'
      or stripe_customer_id is distinct from
        'cus_UxsTL0URP3K7xk'
      or subscription_status is distinct from 'active'
    );

  get diagnostics updated_count = row_count;

  raise notice
    'Restored Stripe subscription fields on % organization row(s).',
    updated_count;
end
$$;
