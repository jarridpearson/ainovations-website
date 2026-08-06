alter table public.organization_checkout_requests
  drop constraint if exists organization_checkout_requests_app_addon_key_check;

alter table public.organization_checkout_requests
  drop constraint if exists organization_checkout_requests_portal_addon_key_check;

comment on column public.organization_checkout_requests.app_credit_addon_product_key is
  'Selected active shared mobile-app AI credit product key. Validated against organization_billing_products by the checkout function.';

comment on column public.organization_checkout_requests.portal_credit_addon_product_key is
  'Selected active portal AI credit product key. Validated against organization_billing_products by the checkout function.';
