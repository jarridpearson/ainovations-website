begin;

revoke insert, update, delete
on table public.ai_credit_ledger
from anon, authenticated;

revoke insert, update, delete
on table public.user_subscription_settings
from anon, authenticated;

commit;
