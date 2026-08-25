#!/usr/bin/env bash
#
# Creates the Ringlatch products and prices in Stripe.
#
# Prerequisites you have to do yourself (they need your identity and banking
# details): a Stripe account, `stripe login`, and NY sales tax registration
# with Stripe Tax enabled.
#
# No setup fee: onboarding is included in the subscription. The two plans below
# are the entire catalog.
#
#   bash ringlatch/setup-stripe.sh
#
# Idempotency: running this twice creates DUPLICATE products. Run it once, save
# the printed IDs, and use the dashboard after that.

set -euo pipefail

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLI not found. Install it, then run 'stripe login'." >&2
  exit 1
fi

echo "Creating Ringlatch products..."

STANDARD_PRODUCT=$(stripe products create \
  --name="Ringlatch Standard" \
  --description="AI phone receptionist. 150 answered minutes per month." \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

stripe prices create \
  --product="$STANDARD_PRODUCT" \
  --unit-amount=14900 \
  --currency=usd \
  -d "recurring[interval]=month" >/dev/null

echo "  standard: $STANDARD_PRODUCT  (\$149/mo, 150 min)"

BUSY_PRODUCT=$(stripe products create \
  --name="Ringlatch Busy" \
  --description="AI phone receptionist. 400 answered minutes per month." \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

stripe prices create \
  --product="$BUSY_PRODUCT" \
  --unit-amount=29900 \
  --currency=usd \
  -d "recurring[interval]=month" >/dev/null

echo "  busy:     $BUSY_PRODUCT  (\$299/mo, 400 min)"

cat <<'DONE'

Done. There is deliberately NO metered or overage price here — Ringlatch has no
overage. Past the included minutes the agent degrades to brief mode, so there is
never a surprise line item to bill or collect.

Still yours to do in the dashboard:
  1. Settings > Billing > Customer portal: turn it on, allow payment method
     updates and cancellation.
  2. Settings > Tax: enable Stripe Tax and add your NY registration.
DONE
