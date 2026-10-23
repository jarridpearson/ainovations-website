// Back end for the website revamp gift card (/website-gift-card).
//
//   POST /api/gift-card              save   the card details, keyed by its GC- code,
//                                           just before the buyer goes to Stripe
//   GET  /api/gift-card?code=GC-...  the card, once Stripe has confirmed payment
//                                    (the thanks page and the emailed link use this)
//   POST /api/gift-card?hook=stripe  Stripe webhook, checkout.session.completed:
//                                    marks the card paid and emails it to the buyer
//
// The GC- code rides to Stripe as the payment link's client_reference_id, which
// is how a payment finds its card. One Stripe account bills every product, so
// the webhook ignores any checkout that didn't come from a gift card link.
// Live and sandbox (test mode) each have their own signing secret and links.

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.GIFT_CARD_FROM || 'AInovations Gift Cards <giftcards@ainovations.net>';
const REPLY_TO = process.env.GIFT_CARD_REPLY_TO || 'jp@ainovations.net';
const SITE = 'https://ainovations.net';

const MODES = {
  live: {
    secret: process.env.GIFT_CARD_WEBHOOK_SECRET || '',
    links: ['plink_1UTnV5DBB5irv1eWeeqy4JVt', 'plink_1UTnV5DBB5irv1eWMC4VA8bD'],
  },
  test: {
    secret: process.env.GIFT_CARD_WEBHOOK_SECRET_TEST || '',
    links: (process.env.GIFT_CARD_TEST_LINKS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
};

const CODE_RE = /^GC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });

const store = () => getStore({ name: 'gift-cards', consistency: 'strong' });

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// What a buyer or recipient may see. Never the buyer's email.
const publicCard = (c) => ({
  code: c.code, card: c.card, to: c.to, biz: c.biz, from: c.from, msg: c.msg, paid: !!c.paidAt,
});

// --- Stripe signature (no SDK: HMAC-SHA256 over "<t>.<raw body>") -----------

function verifyStripe(raw, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const sigs = header.split(',').filter((kv) => kv.trim().startsWith('v1=')).map((kv) => kv.trim().slice(3));
  return sigs.some((s) => s.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// --- email --------------------------------------------------------------------

function cardEmail(c) {
  const amt = c.card === '10' ? '$150' : '$100';
  const pages = c.card === '10' ? '10' : '5';
  const view = `${SITE}/website-gift-card-thanks?code=${encodeURIComponent(c.code)}`;
  const forLine = [c.to, c.biz].filter(Boolean).join(' — ');
  const terms = `Pays for one revamp of one existing website, up to ${pages} pages. Not covered: online stores or e-sales, subscriptions or memberships, or anything needing a back end (logins, accounts, databases, booking systems). Never expires. No fees of any kind. All sales are final: no refunds, and not redeemable for cash. Hosting and domain names not included. AInovations never asks anyone to pay a bill or debt with a gift card — if someone does, it's a scam. Issued by AInovations LLC.`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#05121f;font-family:-apple-system,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="color:#f7fbff;font-size:22px;font-weight:800;padding:0 4px 6px">Here's your gift card.</td></tr>
<tr><td style="color:#b8cad7;font-size:15px;line-height:1.55;padding:0 4px 18px">Forward this email or show it to ${esc(c.to || 'them')} — the code below is all they need. Want a copy to print? <a href="${view}" style="color:#72e6df">Open and save your card</a>.</td></tr>
<tr><td style="background:#fff8e6;border:3px solid #e9b949;border-radius:20px;padding:26px;color:#071c2f">
  <table role="presentation" width="100%"><tr>
    <td style="font-size:20px;font-weight:800">Website Revamp Gift Card</td>
    <td align="right" style="font-size:40px;font-weight:900;color:#7a5a00">${amt}</td>
  </tr></table>
  <p style="margin:14px 0 4px;font-size:15px"><b style="color:#5b4a1e">For</b>&nbsp; ${esc(forLine)}</p>
  <p style="margin:4px 0;font-size:15px"><b style="color:#5b4a1e">From</b>&nbsp; ${esc(c.from)}</p>
  <p style="margin:4px 0;font-size:15px"><b style="color:#5b4a1e">Covers</b>&nbsp; One website revamp, up to ${pages} pages</p>
  ${c.msg ? `<p style="margin:14px 0 0;padding:10px 12px;border-left:4px solid #e9b949;background:#ffffff;font-style:italic">“${esc(c.msg)}”</p>` : ''}
  <p style="margin:18px 0 0;font-family:Menlo,Consolas,monospace;font-size:24px;font-weight:900;letter-spacing:2px">${esc(c.code)}</p>
  <p style="margin:12px 0 0;font-size:15px">To redeem: go to <a href="${SITE}/giftcardredeem" style="color:#0a6e74;font-weight:800">ainovations.net/giftcardredeem</a> and enter the code above.</p>
  <p style="margin:16px 0 0;padding-top:12px;border-top:1px dashed #d8b45a;font-size:11.5px;line-height:1.5;color:#4a4030"><b>TERMS AND CONDITIONS ARE APPLIED TO GIFT CERTIFICATES/GIFT CARDS.</b><br>${esc(terms)}</p>
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Here's your Website Revamp Gift Card (${amt}).`,
    '',
    `For:    ${forLine}`,
    `From:   ${c.from}`,
    `Covers: One website revamp, up to ${pages} pages`,
    c.msg ? `Message: "${c.msg}"` : null,
    '',
    `Code: ${c.code}`,
    `To redeem: go to ainovations.net/giftcardredeem and enter the code.`,
    '',
    `Open and save your card: ${view}`,
    '',
    'TERMS AND CONDITIONS ARE APPLIED TO GIFT CERTIFICATES/GIFT CARDS.',
    terms,
  ].filter((l) => l !== null).join('\n');

  return { html, text, subject: `Your ${amt} Website Revamp Gift Card — ${c.code}` };
}

async function sendCard(c, to) {
  if (!RESEND_API_KEY) {
    console.error('gift card email skipped: RESEND_API_KEY not set');
    return false;
  }
  const { html, text, subject } = cardEmail(c);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html, text }),
  });
  if (!res.ok) console.error('gift card email failed', res.status, await res.text().catch(() => ''));
  return res.ok;
}

// --- handlers -------------------------------------------------------------------

async function save(req) {
  let b;
  try { b = await req.json(); } catch { return fail(400, 'bad json'); }
  const code = clip(b.code, 12);
  if (!CODE_RE.test(code)) return fail(400, 'bad code');
  if (b.card !== '5' && b.card !== '10') return fail(400, 'bad card');
  const s = store();
  // A code is written once. Stops anyone overwriting a paid card's details.
  if (await s.get(code)) return fail(409, 'code in use');
  await s.setJSON(code, {
    code,
    card: b.card,
    to: clip(b.to, 120),
    biz: clip(b.biz, 160),
    from: clip(b.from, 120),
    msg: clip(b.msg, 140),
    site: clip(b.site, 400),
    buyerEmail: clip(b.email, 200),
    createdAt: new Date().toISOString(),
  });
  return ok({ saved: true });
}

async function get(url) {
  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return fail(400, 'bad code');
  const c = await store().get(code, { type: 'json' });
  if (!c) return fail(404, 'not found');
  if (!c.paidAt) return fail(402, 'not paid yet');
  return ok(publicCard(c));
}

async function stripeHook(req) {
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  let event;
  try { event = JSON.parse(raw); } catch { return fail(400, 'bad payload'); }
  const mode = event.livemode ? MODES.live : MODES.test;
  if (!verifyStripe(raw, sig, mode.secret)) return fail(400, 'invalid signature');

  // 200 for everything that isn't ours, or Stripe retries it for days.
  if (event.type !== 'checkout.session.completed') return ok({ ignored: true });
  const session = event.data?.object || {};
  if (!mode.links.includes(session.payment_link)) return ok({ ignored: true });
  if (session.payment_status !== 'paid') return ok({ ignored: true, reason: 'unpaid' });

  const code = String(session.client_reference_id || '').toUpperCase();
  const s = store();
  const c = CODE_RE.test(code) ? await s.get(code, { type: 'json' }) : null;
  if (!c) {
    // Paid with no card details saved: say so loudly, but don't make Stripe retry.
    console.error('gift card paid but no saved card', code, session.id);
    return ok({ received: true, missingCard: code });
  }

  const to = session.customer_details?.email || c.buyerEmail;
  c.paidAt = c.paidAt || new Date().toISOString();
  c.sessionId = session.id;
  c.amountTotal = session.amount_total;
  await s.setJSON(code, c);

  // Idempotent: Stripe can deliver the same event more than once.
  if (!c.emailedAt && to) {
    if (await sendCard(c, to)) {
      c.emailedAt = new Date().toISOString();
      c.emailedTo = to;
      await s.setJSON(code, c);
    } else {
      return fail(500, 'email failed'); // Stripe retries; the card is already marked paid
    }
  }
  return ok({ received: true, code, emailed: !!c.emailedAt });
}

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') return get(url);
  if (req.method !== 'POST') return fail(405, 'method not allowed');
  if (url.searchParams.get('hook') === 'stripe') return stripeHook(req);
  return save(req);
};
