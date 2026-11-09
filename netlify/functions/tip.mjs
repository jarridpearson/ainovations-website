// Tips for TechSuggest (/tip).
//
//   POST /api/tip  { amount_cents }  ->  { url }   a Stripe Checkout Session
//
// TechSuggest is free and takes no commission, so a tip is the only money that
// ever comes out of it. The amount is whatever the person picks: the floor is
// $5 and there is no ceiling beyond the largest amount Stripe itself accepts.
//
// The floor is enforced HERE, not just in the page, because the page can be
// edited by anyone with a browser console.

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const SITE = 'https://ainovations.net';

const MIN_CENTS = 500;            // $5.00 — the floor Jarrid set.
const STRIPE_MAX_CENTS = 99999999; // $999,999.99 — Stripe's own ceiling, not ours.

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export default async (req) => {
  if (req.method !== 'POST') return fail(405, 'POST only.');

  let body;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON.');
  }

  const cents = Math.round(Number(body?.amount_cents));
  if (!Number.isFinite(cents) || !Number.isSafeInteger(cents)) {
    return fail(400, 'That amount is not a number.');
  }
  if (cents < MIN_CENTS) {
    return fail(400, `The smallest tip is ${money(MIN_CENTS)}.`);
  }
  if (cents > STRIPE_MAX_CENTS) {
    return fail(400, `Stripe will not take a single payment over ${money(STRIPE_MAX_CENTS)}.`);
  }

  // Checked after the amount, so the floor is provable from the outside even
  // before the key is in place.
  if (!STRIPE_KEY) {
    return fail(503, 'Tips are not switched on yet — STRIPE_SECRET_KEY is not set in Netlify.');
  }

  const params = new URLSearchParams({
    mode: 'payment',
    submit_type: 'pay',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': 'Tip for TechSuggest',
    'line_items[0][price_data][product_data][description]':
      'A voluntary thank-you for a TechSuggest recommendation. Not a purchase, and nothing is owed.',
    success_url: `${SITE}/tip-thanks`,
    cancel_url: `${SITE}/tip`,
    'metadata[source]': 'techsuggest-tip',
  });

  let session;
  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${STRIPE_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    session = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('stripe checkout session failed', res.status, session?.error?.message);
      return fail(502, session?.error?.message || `Stripe said ${res.status}.`);
    }
  } catch (err) {
    console.error('stripe checkout session threw', err);
    return fail(502, 'Could not reach Stripe.');
  }

  if (!session?.url) return fail(502, 'Stripe did not return a checkout URL.');
  return ok({ url: session.url });
};
