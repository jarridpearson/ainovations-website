update public.organizations
set
  stripe_customer_id = 'cus_UxsTL0URP3K7xk',
  stripe_subscription_id = 'sub_1TxwinDBB5irv1eWThIvj45D',
  subscription_status = 'active',
  stripe_billing_error = null,
  stripe_billing_synced_at = now()
where id = '4a45eed7-f5c1-4741-abc1-fc83c1ef8b9c';
