alter table public.organization_checkout_requests
  add column if not exists portal_credit_addon_product_key text,
  add column if not exists app_credit_addon_product_key text;

alter table public.organization_checkout_requests
  drop constraint if exists organization_checkout_requests_portal_addon_key_check;

alter table public.organization_checkout_requests
  add constraint organization_checkout_requests_portal_addon_key_check
  check (
    portal_credit_addon_product_key is null
    or portal_credit_addon_product_key like 'organization_portal_ai_credits_%'
  );

alter table public.organization_checkout_requests
  drop constraint if exists organization_checkout_requests_app_addon_key_check;

alter table public.organization_checkout_requests
  add constraint organization_checkout_requests_app_addon_key_check
  check (
    app_credit_addon_product_key is null
    or app_credit_addon_product_key like 'organization_shared_app_ai_credits_%'
  );
