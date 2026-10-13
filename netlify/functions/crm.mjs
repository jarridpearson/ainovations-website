// AInovations CRM back end.
//
// One endpoint, action-dispatched. Every request must carry a Supabase access
// token belonging to an allow-listed email; only then does this function touch
// the database, and it does so with the service-role key (the CRM tables have
// RLS on with no policies, so nothing else can read them).
//
// Stripe is PULL-ONLY. Nothing here writes to Stripe, creates webhooks, or
// changes account settings — it reads customers/subscriptions/invoices and
// mirrors them into crm_* tables.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

// Every processor the client might already use. A connector switches itself on
// as soon as its credentials are present, so adding a client's processor is an
// env-var change, never a code change. Adding a NEW processor is one object in
// the PROCESSORS array below — that is the whole point of the shape.
const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_ENV = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase();
const PAYPAL_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_ENV = (process.env.PAYPAL_ENVIRONMENT || 'live').toLowerCase();

const ALLOWED = (process.env.CRM_ALLOWED_EMAILS || 'jp@ainovations.net')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function ok(body) {
  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) };
}
function fail(statusCode, message) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
}

// --- Supabase REST helpers -------------------------------------------------

async function db(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  };
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function whoami(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.email) return null;
  if (!ALLOWED.includes(user.email.toLowerCase())) return null;
  return user;
}

async function logActivity(clientId, kind, summary, extra = {}) {
  try {
    await db('crm_activity', {
      method: 'POST',
      body: [{ client_id: clientId, kind, summary, ...extra }],
      prefer: 'return=minimal',
    });
  } catch (err) {
    console.error('activity log failed', err.message);
  }
}

// --- Stripe ---------------------------------------------------------------

async function stripe(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item));
    else qs.append(k, v);
  }
  const url = `https://api.stripe.com/v1/${path}${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${STRIPE_KEY}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `stripe ${res.status}`);
  return json;
}

// Walk every page of a Stripe list endpoint.
async function stripeAll(path, params = {}) {
  const out = [];
  let starting_after;
  for (let page = 0; page < 40; page++) {
    const query = { limit: 100, ...params };
    if (starting_after) query.starting_after = starting_after;
    const res = await stripe(path, query);
    out.push(...(res.data || []));
    if (!res.has_more || !res.data?.length) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return out;
}

const ts = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null);

// Normalize any billing interval to a monthly figure, in cents.
function monthlyCents(amountCents, interval, intervalCount = 1) {
  if (!amountCents) return 0;
  const per = amountCents / (intervalCount || 1);
  if (interval === 'year') return Math.round(per / 12);
  if (interval === 'week') return Math.round((per * 52) / 12);
  if (interval === 'day') return Math.round((per * 365) / 12);
  return Math.round(per);
}

// --- payment processors ----------------------------------------------------
//
// Every connector returns the SAME normalized payment shape, so the sync and
// the margin math never learn a processor's vocabulary:
//
//   { ref, customerRef, email, name, amountCents, feeCents,
//     currency, status, occurredAt, invoiceRef, url }
//
// amountCents is gross, feeCents is the processor's cut, both positive.

const centsFrom = (major) => Math.round(Number(major || 0) * 100);

// Square — GET /v2/payments, cursor paged. The fee is processing_fee[], an
// array because Square posts adjustments as additional entries; they all count.
async function squarePayments() {
  const base = SQUARE_ENV === 'sandbox'
    ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const headers = {
    authorization: `Bearer ${SQUARE_TOKEN}`,
    'Square-Version': '2026-09-16',
    'content-type': 'application/json',
  };
  const walk = async (path, key) => {
    const out = [];
    let cursor;
    for (let page = 0; page < 60; page++) {
      const qs = new URLSearchParams({ limit: '100' });
      if (cursor) qs.set('cursor', cursor);
      const res = await fetch(`${base}${path}?${qs}`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.errors?.[0]?.detail || `square ${res.status}`);
      out.push(...(json[key] || []));
      cursor = json.cursor;
      if (!cursor) break;
    }
    return out;
  };

  const [payments, customers] = await Promise.all([
    walk('/v2/payments', 'payments'),
    // Square puts only customer_id on a payment, so the email we match clients
    // on has to come from the customer list.
    walk('/v2/customers', 'customers').catch(() => []),
  ]);
  const byId = new Map(customers.map((c) => [c.id, c]));

  return payments.map((p) => {
    const c = p.customer_id ? byId.get(p.customer_id) : null;
    const fee = (p.processing_fee || [])
      .reduce((a, f) => a + (f.amount_money?.amount || 0), 0);
    return {
      ref: p.id,
      customerRef: p.customer_id || null,
      email: c?.email_address || null,
      name: [c?.given_name, c?.family_name].filter(Boolean).join(' ')
        || c?.company_name || null,
      amountCents: p.total_money?.amount ?? p.amount_money?.amount ?? 0,
      feeCents: fee,
      currency: (p.total_money?.currency || 'USD').toLowerCase(),
      status: (p.status || '').toLowerCase(),
      occurredAt: p.created_at || null,
      invoiceRef: p.order_id || null,
      url: p.receipt_url || null,
    };
  });
}

// PayPal — Transaction Search. Two things shape this: it takes an OAuth token
// rather than a static key, and it refuses any window wider than 31 days, so
// the history has to be walked a month at a time.
async function paypalPayments() {
  const base = PAYPAL_ENV === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${PAYPAL_ID}:${PAYPAL_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(tokenJson?.error_description || `paypal auth ${tokenRes.status}`);
  }
  const headers = { authorization: `Bearer ${tokenJson.access_token}` };

  const out = [];
  const now = Date.now();
  const DAY = 86400000;
  // Three years is as far back as PayPal will report.
  for (let w = 0; w < 37; w++) {
    const end = new Date(now - w * 30 * DAY);
    const start = new Date(end.getTime() - 30 * DAY);
    for (let page = 1; page <= 20; page++) {
      const qs = new URLSearchParams({
        start_date: start.toISOString().replace(/\.\d+Z$/, 'Z'),
        end_date: end.toISOString().replace(/\.\d+Z$/, 'Z'),
        fields: 'all',
        page_size: '100',
        page: String(page),
      });
      const res = await fetch(`${base}/v1/reporting/transactions?${qs}`, { headers });
      const json = await res.json();
      if (!res.ok) {
        // An empty month answers with an error rather than an empty list.
        if (res.status === 404) break;
        throw new Error(json?.message || `paypal ${res.status}`);
      }
      const rows = json.transaction_details || [];
      out.push(...rows);
      if (rows.length < 100) break;
    }
  }

  return out.map((t) => {
    const i = t.transaction_info || {};
    const p = t.payer_info || {};
    const gross = centsFrom(i.transaction_amount?.value);
    // PayPal reports the fee as a negative number; we store cost as positive.
    const fee = Math.abs(centsFrom(i.fee_amount?.value));
    return {
      ref: i.transaction_id,
      customerRef: p.account_id || null,
      email: p.email_address || null,
      name: [p.payer_name?.given_name, p.payer_name?.surname].filter(Boolean).join(' ')
        || p.payer_name?.alternate_full_name || null,
      amountCents: gross,
      feeCents: fee,
      currency: (i.transaction_amount?.currency_code || 'USD').toLowerCase(),
      status: i.transaction_status === 'S' ? 'completed' : (i.transaction_status || '').toLowerCase(),
      occurredAt: i.transaction_initiation_date || null,
      invoiceRef: i.invoice_id || null,
      url: null,
    };
  // Money going OUT of the account is not revenue.
  }).filter((r) => r.ref && r.amountCents > 0);
}

// Stripe — the fee lives on the balance transaction, not the charge, and we
// join through the ledger rather than ?expand= so a bare id in the response
// can never make every fee read as zero.
async function stripePayments() {
  const [charges, txns] = await Promise.all([
    stripeAll('charges'),
    stripeAll('balance_transactions'),
  ]);
  const txnById = new Map(txns.map((t) => [t.id, t]));

  const rows = charges.map((ch) => {
    const btId = typeof ch.balance_transaction === 'string'
      ? ch.balance_transaction : ch.balance_transaction?.id;
    const bt = txnById.get(btId)
      || (typeof ch.balance_transaction === 'object' ? ch.balance_transaction : null);
    return {
      ref: ch.id,
      customerRef: ch.customer || null,
      email: ch.billing_details?.email || ch.receipt_email || null,
      name: ch.billing_details?.name || null,
      amountCents: ch.amount || 0,
      feeCents: bt?.fee || 0,
      currency: (ch.currency || 'usd').toLowerCase(),
      status: ch.status || null,
      occurredAt: ts(ch.created),
      invoiceRef: ch.invoice || null,
      url: ch.receipt_url || null,
      unresolved: !!ch.balance_transaction && !bt,
    };
  });

  // Fees Stripe bills the account itself — invoicing fees, dispute fees. No
  // customer, still deductible.
  for (const t of txns) {
    if (t.type !== 'stripe_fee') continue;
    const amount = Math.abs(t.fee || t.amount || 0);
    if (!amount) continue;
    rows.push({
      ref: t.id,
      customerRef: null,
      email: null,
      name: null,
      amountCents: 0,
      feeCents: amount,
      currency: (t.currency || 'usd').toLowerCase(),
      status: 'account_fee',
      occurredAt: ts(t.created),
      invoiceRef: null,
      url: null,
      houseFee: true,
      description: t.description || 'Stripe account fee',
    });
  }
  return rows;
}

// Adding a processor means adding an entry here and nothing else. Any provider
// that exposes a read API for payments belongs on this list.
const PROCESSORS = [
  { id: 'stripe', label: 'Stripe', ready: () => !!STRIPE_KEY, fetch: stripePayments },
  { id: 'square', label: 'Square', ready: () => !!SQUARE_TOKEN, fetch: squarePayments },
  { id: 'paypal', label: 'PayPal', ready: () => !!(PAYPAL_ID && PAYPAL_SECRET), fetch: paypalPayments },
];

const activeProcessors = () => PROCESSORS.filter((p) => p.ready());

// Stripe's cut is a real cost and a real deduction, so it lands in the expense
// ledger like any other cost — but in its own category, and attributed to the
// client whose payment generated it. Pulled from Stripe rather than typed by
// hand so the figures reconcile to the cent.
const FEE_CATEGORY = 'Processing fees';

// Runs EVERY connected processor, not just the one we happen to know best.
// Each connector hands back the same normalized shape, so everything below is
// processor-agnostic: payments land in crm_payments, and the processor's cut
// lands in crm_expenses so it is deductible and attributable like any cost.
async function syncProcessors(byStripe) {
  const clients = await db('crm_clients?select=id,email,stripe_customer_id');
  const byEmail = new Map();
  for (const c of clients) if (c.email) byEmail.set(c.email.toLowerCase(), c.id);
  const matchClient = (row, processorId) => {
    if (processorId === 'stripe' && row.customerRef) {
      const viaStripe = byStripe.get(row.customerRef)?.id;
      if (viaStripe) return viaStripe;
    }
    if (row.email) return byEmail.get(row.email.toLowerCase()) || null;
    return null;
  };

  const results = [];
  const paymentRows = [];
  const feeRows = [];

  for (const proc of activeProcessors()) {
    try {
      const rows = await proc.fetch();
      let unresolved = 0;
      for (const r of rows) {
        if (!r.ref) continue;
        if (r.unresolved) unresolved++;
        const clientId = matchClient(r, proc.id);

        // A $0 house fee is not a payment, only a cost.
        if (!r.houseFee) {
          paymentRows.push({
            processor: proc.id,
            processor_ref: r.ref,
            client_id: clientId,
            processor_customer_ref: r.customerRef || null,
            customer_email: r.email || null,
            customer_name: r.name || null,
            amount_cents: r.amountCents || 0,
            fee_cents: r.feeCents || 0,
            net_cents: (r.amountCents || 0) - (r.feeCents || 0),
            currency: r.currency || 'usd',
            status: r.status || null,
            occurred_at: r.occurredAt || null,
            invoice_ref: r.invoiceRef || null,
            url: r.url || null,
            synced_at: new Date().toISOString(),
          });
        }

        if (r.feeCents > 0) {
          feeRows.push({
            source_ref: `${proc.id}:fee:${r.ref}`,
            spent_on: (r.occurredAt || '').slice(0, 10) || null,
            vendor: proc.label,
            category: FEE_CATEGORY,
            description: r.description
              || `Processing fee on ${money(r.amountCents)} collected`,
            amount_cents: r.feeCents,
            payment_method: 'Card',
            client_id: clientId,
            billable: false,
            notes: clientId ? null
              : `${proc.label} payer ${r.email || r.customerRef || 'unknown'} is not a CRM client.`,
          });
        }
      }
      results.push({ processor: proc.id, label: proc.label, payments: rows.length, unresolved });
    } catch (err) {
      console.error(`${proc.id} sync failed:`, err);
      results.push({ processor: proc.id, label: proc.label, error: err.message || 'failed' });
    }
  }

  // Payments: the (processor, processor_ref) index makes this a true upsert, so
  // a re-sync refreshes a payment rather than duplicating it.
  let payments = 0;
  for (let i = 0; i < paymentRows.length; i += 200) {
    await db('crm_payments?on_conflict=processor,processor_ref', {
      method: 'POST',
      body: paymentRows.slice(i, i + 200),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    payments += paymentRows.slice(i, i + 200).length;
  }

  // Fees: source_ref's unique index is partial, which PostgREST cannot infer
  // for an upsert, so skip what is already filed and insert the rest. A re-sync
  // must never double a fee.
  let fees = 0;
  let feeCents = 0;
  if (feeRows.length) {
    const have = new Set(
      (await db('crm_expenses?select=source_ref&source_ref=not.is.null'))
        .map((r) => r.source_ref),
    );
    const seen = new Set();
    const fresh = feeRows.filter((f) => {
      if (!f.amount_cents || !f.spent_on) return false;
      if (have.has(f.source_ref) || seen.has(f.source_ref)) return false;
      seen.add(f.source_ref);
      return true;
    });
    for (let i = 0; i < fresh.length; i += 200) {
      await db('crm_expenses', {
        method: 'POST', body: fresh.slice(i, i + 200), prefer: 'return=minimal',
      });
    }
    fees = fresh.length;
    feeCents = fresh.reduce((a, r) => a + r.amount_cents, 0);
  }

  return { processors: results, payments, fees, feeCents };
}

// Revenue, the processor's cut, and anything else booked against a client —
// summed per client id. Fees are split out of the other costs because they are
// tracked and deducted on their own.
// Revenue has two sources and they must not overlap. Stripe reports invoices,
// which is what we count for it — an invoice marked paid out of band has no
// charge behind it, and counting charges instead would silently lose it. Every
// other processor reports payments, so those come from crm_payments. Stripe
// rows in crm_payments are therefore deliberately NOT counted here.
function rollUp(paidInvoices, expenses, payments = []) {
  const revenue = new Map();
  const fees = new Map();
  const costs = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + (v || 0));
  for (const i of paidInvoices) {
    if (i.client_id) add(revenue, i.client_id, i.amount_paid_cents);
  }
  for (const pmt of payments) {
    if (pmt.processor === 'stripe') continue;
    if (pmt.client_id) add(revenue, pmt.client_id, pmt.amount_cents);
  }
  for (const e of expenses) {
    if (!e.client_id) continue;
    add(e.category === FEE_CATEGORY ? fees : costs, e.client_id, e.amount_cents);
  }
  return { revenue, fees, costs };
}

async function syncStripe() {
  if (!STRIPE_KEY) {
    return { ok: false, message: 'STRIPE_SECRET_KEY is not set in Netlify — nothing to sync yet.' };
  }

  const [customers, subs, invoices, products] = await Promise.all([
    stripeAll('customers'),
    stripeAll('subscriptions', { status: 'all', 'expand[]': 'data.items.data.price' }),
    stripeAll('invoices'),
    stripeAll('products'),
  ]);

  const productName = new Map(products.map((p) => [p.id, p.name]));

  // A Stripe customer is only "active" if something is actually billing. One
  // that used to bill is churned; one that never did is just a lead.
  const LIVE = ['active', 'trialing', 'past_due'];
  const statusByCustomer = new Map();
  for (const s of subs) {
    const prev = statusByCustomer.get(s.customer);
    if (LIVE.includes(s.status)) statusByCustomer.set(s.customer, 'active');
    else if (prev !== 'active') statusByCustomer.set(s.customer, 'churned');
  }

  // Customers deliberately removed from the CRM must never come back on a sync.
  const ignored = new Set(
    (await db('crm_stripe_ignored?select=stripe_customer_id'))
      .map((r) => r.stripe_customer_id),
  );

  // Existing clients, keyed by stripe id and by email, so we attach rather than duplicate.
  const clients = await db('crm_clients?select=id,client_no,business_name,email,stripe_customer_id,status');
  const byStripe = new Map();
  const byEmail = new Map();
  for (const c of clients) {
    if (c.stripe_customer_id) byStripe.set(c.stripe_customer_id, c);
    if (c.email) byEmail.set(c.email.toLowerCase(), c);
  }

  let created = 0;
  let linked = 0;

  for (const cust of customers) {
    if (byStripe.has(cust.id) || ignored.has(cust.id)) continue;

    const email = (cust.email || '').toLowerCase();
    const existing = email ? byEmail.get(email) : null;

    if (existing && !existing.stripe_customer_id) {
      const [row] = await db(`crm_clients?id=eq.${existing.id}`, {
        method: 'PATCH',
        body: { stripe_customer_id: cust.id },
        prefer: 'return=representation',
      });
      byStripe.set(cust.id, row);
      linked++;
      await logActivity(existing.id, 'stripe.linked', `Linked to Stripe customer ${cust.id}`);
      continue;
    }

    if (existing) continue; // already linked to a different Stripe customer — leave it alone

    const [row] = await db('crm_clients', {
      method: 'POST',
      body: [{
        business_name: cust.name || cust.email || cust.id,
        email: cust.email || null,
        phone: cust.phone || null,
        status: statusByCustomer.get(cust.id) || 'lead',
        source: 'stripe',
        stripe_customer_id: cust.id,
      }],
      prefer: 'return=representation',
    });
    byStripe.set(cust.id, row);
    if (row.email) byEmail.set(row.email.toLowerCase(), row);
    created++;
    await logActivity(row.id, 'stripe.imported', `Imported from Stripe as ${row.client_no}`);
  }

  // Subscriptions
  const subRows = subs.map((s) => {
    const item = s.items?.data?.[0];
    const price = item?.price;
    return {
      stripe_subscription_id: s.id,
      client_id: byStripe.get(s.customer)?.id || null,
      stripe_customer_id: s.customer,
      status: s.status,
      product_name: productName.get(price?.product) || null,
      price_id: price?.id || null,
      amount_cents: price?.unit_amount ?? null,
      interval: price?.recurring?.interval || null,
      quantity: item?.quantity || 1,
      current_period_end: ts(s.current_period_end),
      cancel_at_period_end: !!s.cancel_at_period_end,
      canceled_at: ts(s.canceled_at),
      started_at: ts(s.start_date || s.created),
      synced_at: new Date().toISOString(),
    };
  });
  if (subRows.length) {
    await db('crm_subscriptions?on_conflict=stripe_subscription_id', {
      method: 'POST',
      body: subRows,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  // Invoices
  const invRows = invoices.map((i) => ({
    stripe_invoice_id: i.id,
    client_id: byStripe.get(i.customer)?.id || null,
    stripe_customer_id: i.customer,
    number: i.number || null,
    status: i.status,
    amount_due_cents: i.amount_due ?? null,
    amount_paid_cents: i.amount_paid ?? null,
    currency: i.currency || 'usd',
    due_date: ts(i.due_date),
    paid_at: ts(i.status_transitions?.paid_at),
    created_at: ts(i.created),
    hosted_invoice_url: i.hosted_invoice_url || null,
    pdf_url: i.invoice_pdf || null,
    synced_at: new Date().toISOString(),
  }));
  if (invRows.length) {
    await db('crm_invoices?on_conflict=stripe_invoice_id', {
      method: 'POST',
      body: invRows,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  // Recompute MRR per client from its live subscriptions. Re-read the client
  // list so clients created above in this same run are included.
  const mrr = new Map();
  for (const s of subRows) {
    if (!s.client_id) continue;
    if (!['active', 'trialing', 'past_due'].includes(s.status)) continue;
    const m = monthlyCents(s.amount_cents, s.interval) * (s.quantity || 1);
    mrr.set(s.client_id, (mrr.get(s.client_id) || 0) + m);
  }
  // Statuses Stripe is allowed to drive. Anything Jarrid set by hand
  // (proposal, paused, won, lost, contacted) is his and stays put.
  const STRIPE_OWNED = new Set(['lead', 'active', 'churned']);

  const allClients = await db('crm_clients?select=id,mrr_cents,status,stripe_customer_id');
  for (const c of allClients) {
    const patch = {};
    // Only Stripe-linked clients get their MRR recomputed. A prospect priced by
    // hand from a proposal has no subscription yet, and zeroing it would quietly
    // empty the pipeline value every time this runs.
    if (c.stripe_customer_id) {
      const next = mrr.get(c.id) || 0;
      if (next !== (c.mrr_cents || 0)) patch.mrr_cents = next;
    }

    if (c.stripe_customer_id && STRIPE_OWNED.has(c.status)) {
      const fromStripe = statusByCustomer.get(c.stripe_customer_id) || 'lead';
      if (fromStripe !== c.status) {
        patch.status = fromStripe;
        await logActivity(c.id, 'status.change',
          `Stripe says ${fromStripe} — status updated from ${c.status}`);
      }
    }

    if (!Object.keys(patch).length) continue;
    await db(`crm_clients?id=eq.${c.id}`, {
      method: 'PATCH', body: patch, prefer: 'return=minimal',
    }).catch(() => {});
  }

  // Processors last: byStripe is only complete once every customer above has a
  // client. Fail soft — the sync above already succeeded, and losing all of it
  // over one processor would be worse than reporting the gap. Each connector
  // also catches its own errors, so one bad processor cannot take the others
  // down with it.
  let procResult = { processors: [], payments: 0, fees: 0, feeCents: 0 };
  let feeError = null;
  try {
    procResult = await syncProcessors(byStripe);
  } catch (err) {
    feeError = err.message || 'processor sync failed';
    console.error('processor sync failed:', err);
  }

  return {
    ok: true,
    customers: customers.length,
    subscriptions: subRows.length,
    invoices: invRows.length,
    created,
    linked,
    newPayments: procResult.payments,
    newFees: procResult.fees,
    newFeeCents: procResult.feeCents,
    processors: procResult.processors,
    feeError,
  };
}

// --- Actions --------------------------------------------------------------

const CLIENT_FIELDS = [
  'business_name', 'contact_name', 'email', 'phone', 'website', 'town', 'state',
  'status', 'product', 'plan', 'term', 'stripe_customer_id',
  'source', 'next_action', 'next_action_due',
  // Settable by hand for clients that have not started billing yet — a
  // proposal priced from a quote is what gives the pipeline a value.
  'mrr_cents',
];

const EXPENSE_FIELDS = [
  'spent_on', 'vendor', 'description', 'category', 'amount_cents',
  'payment_method', 'client_id', 'billable', 'reimbursed', 'receipt_url', 'notes',
  // Provenance: which email or vendor portal this row came from. Carries a
  // unique index, so re-running an import cannot double up.
  'source_ref',
];

const MILEAGE_FIELDS = [
  'drove_on', 'purpose', 'from_place', 'to_place', 'miles',
  'rate_cents', 'round_trip', 'client_id', 'notes',
];

const PERSONAL_FIELDS = [
  'spent_on', 'payee', 'description', 'category', 'amount_cents',
  'payment_method', 'property', 'notes', 'source_ref',
];

const NUMERIC_FIELDS = new Set(['amount_cents', 'miles', 'rate_cents', 'mrr_cents']);
const BOOLEAN_FIELDS = new Set(['billable', 'reimbursed', 'round_trip']);

// Receipts can hang off either ledger; the caller says which.
const receiptTable = (scope) => (scope === 'personal' ? 'personal_expenses' : 'crm_expenses');

function pickFields(input, allowed) {
  const out = {};
  for (const f of allowed) {
    if (!(f in input)) continue;
    let v = input[f];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === null || v === undefined) { out[f] = null; continue; }
    if (NUMERIC_FIELDS.has(f)) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      // Cent columns are integers; miles and rate keep their decimals.
      out[f] = (f === 'amount_cents' || f === 'mrr_cents') ? Math.round(n) : n;
      continue;
    }
    if (BOOLEAN_FIELDS.has(f)) { out[f] = !!v; continue; }
    out[f] = v;
  }
  return out;
}

function pickClientFields(input) {
  return pickFields(input, CLIENT_FIELDS);
}

const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

async function handleAction(action, payload, user) {
  switch (action) {
    case 'bootstrap': {
      const [clients, openInvoices, paidInvoices, allProspects, otherPayments] = await Promise.all([
        db('crm_clients?select=*&order=created_at.desc'),
        db('crm_invoices?select=stripe_invoice_id,client_id,number,status,amount_due_cents,due_date&status=in.(open,draft,uncollectible)&order=created_at.desc'),
        // Revenue counts ONLY from clients still in the CRM. Everything Stripe
        // collected before Go 4 Words was test billing, and those customers are
        // gone, so their invoices are unlinked and must not read as revenue.
        db('crm_invoices?select=client_id,amount_paid_cents,paid_at&amount_paid_cents=gt.0&client_id=not.is.null&order=paid_at.asc'),
        db('prospects?select=id&limit=2000'),
        // Non-Stripe processors report payments, not invoices.
        db('crm_payments?select=amount_cents,occurred_at&processor=neq.stripe&client_id=not.is.null'),
      ]);
      // "Waiting" means not yet pulled into the CRM, so discount the converted ones.
      const converted = new Set(
        clients.map((c) => c.prospect_id).filter(Boolean),
      );
      return {
        clients,
        openInvoices,
        // Every dollar Stripe has actually collected, all time.
        collectedCents: paidInvoices.reduce((s, i) => s + (i.amount_paid_cents || 0), 0)
          + otherPayments.reduce((s, p) => s + (p.amount_cents || 0), 0),
        firstPaymentAt: paidInvoices[0]?.paid_at || null,
        prospectCount: allProspects.filter((p) => !converted.has(p.id)).length,
        stripeConfigured: !!STRIPE_KEY,
        user: user.email,
      };
    }

    case 'client': {
      const id = payload.id;
      if (!id) return { error: 'missing id' };
      const [client, notes, activity, subs, invoices, expenses, allPaid, payments] = await Promise.all([
        db(`crm_clients?id=eq.${id}&select=*`),
        db(`crm_notes?client_id=eq.${id}&select=*&order=pinned.desc,created_at.desc`),
        db(`crm_activity?client_id=eq.${id}&select=*&order=occurred_at.desc&limit=100`),
        db(`crm_subscriptions?client_id=eq.${id}&select=*&order=started_at.desc`),
        db(`crm_invoices?client_id=eq.${id}&select=*&order=created_at.desc&limit=100`),
        db(`crm_expenses?client_id=eq.${id}&select=*&order=spent_on.desc`),
        // Unbounded on purpose: the invoice list above is capped for display,
        // but "since the start" has to mean every payment, not the last 100.
        db(`crm_invoices?client_id=eq.${id}&select=amount_paid_cents,paid_at&amount_paid_cents=gt.0&order=paid_at.asc`),
        db(`crm_payments?client_id=eq.${id}&select=*&order=occurred_at.desc`),
      ]);

      const sum = (rows, f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
      const feeRows = expenses.filter((e) => e.category === FEE_CATEGORY);
      const costRows = expenses.filter((e) => e.category !== FEE_CATEGORY);
      const otherPaid = payments.filter((p) => p.processor !== 'stripe');
      const revenueCents = sum(allPaid, 'amount_paid_cents') + sum(otherPaid, 'amount_cents');
      const feeCents = sum(feeRows, 'amount_cents');
      const costCents = sum(costRows, 'amount_cents');

      return {
        client: client[0] || null,
        notes,
        activity,
        subs,
        invoices,
        expenses,
        payments,
        rollup: {
          revenueCents,
          feeCents,
          costCents,
          marginCents: revenueCents - feeCents - costCents,
          firstPaymentAt: allPaid[0]?.paid_at || payments[payments.length - 1]?.occurred_at || null,
          payments: allPaid.length + otherPaid.length,
        },
      };
    }

    // Revenue, fees, other costs and margin for every client at once, plus the
    // business-wide totals underneath.
    case 'margins': {
      const [clients, paidInvoices, expenses, payments] = await Promise.all([
        db('crm_clients?select=id,client_no,business_name,status,product,mrr_cents&order=business_name.asc'),
        db('crm_invoices?select=client_id,amount_paid_cents&amount_paid_cents=gt.0&client_id=not.is.null'),
        db('crm_expenses?select=client_id,category,amount_cents'),
        db('crm_payments?select=client_id,processor,amount_cents&client_id=not.is.null'),
      ]);
      const { revenue, fees, costs } = rollUp(paidInvoices, expenses, payments);

      const rows = clients.map((c) => {
        const revenueCents = revenue.get(c.id) || 0;
        const feeCents = fees.get(c.id) || 0;
        const costCents = costs.get(c.id) || 0;
        return {
          id: c.id,
          client_no: c.client_no,
          business_name: c.business_name,
          status: c.status,
          product: c.product,
          mrr_cents: c.mrr_cents || 0,
          revenueCents,
          feeCents,
          costCents,
          marginCents: revenueCents - feeCents - costCents,
        };
      });

      // Costs with no client on them are shared overhead, not a client's margin.
      // They are reported separately so the page reconciles to the expense
      // ledger instead of quietly losing money that was really spent.
      const loose = expenses.filter((e) => !e.client_id);
      const sum = (rows2, f) => rows2.reduce((a, r) => a + (r[f] || 0), 0);
      const sharedFeeCents = sum(loose.filter((e) => e.category === FEE_CATEGORY), 'amount_cents');
      const sharedCostCents = sum(loose.filter((e) => e.category !== FEE_CATEGORY), 'amount_cents');

      const totals = {
        revenueCents: sum(rows, 'revenueCents'),
        feeCents: sum(rows, 'feeCents'),
        costCents: sum(rows, 'costCents'),
        marginCents: sum(rows, 'marginCents'),
        sharedFeeCents,
        sharedCostCents,
      };
      totals.netCents = totals.marginCents - sharedFeeCents - sharedCostCents;

      return { rows, totals };
    }

    case 'create_client': {
      const fields = pickClientFields(payload);
      if (!fields.business_name) return { error: 'business_name is required' };
      const [row] = await db('crm_clients', {
        method: 'POST', body: [fields], prefer: 'return=representation',
      });
      await logActivity(row.id, 'client.created', `Created ${row.client_no} — ${row.business_name}`);
      return { client: row };
    }

    case 'save_client': {
      const id = payload.id;
      if (!id) return { error: 'missing id' };
      const fields = pickClientFields(payload);
      const [before] = await db(`crm_clients?id=eq.${id}&select=status`);
      const [row] = await db(`crm_clients?id=eq.${id}`, {
        method: 'PATCH', body: fields, prefer: 'return=representation',
      });
      if (before && fields.status && fields.status !== before.status) {
        await logActivity(id, 'status.change', `Status ${before.status} → ${fields.status}`);
      }
      return { client: row };
    }

    case 'delete_client': {
      const id = payload.id;
      if (!id) return { error: 'missing id' };
      const [c] = await db(`crm_clients?id=eq.${id}&select=stripe_customer_id,business_name`);
      if (!c) return { error: 'client not found' };
      // Remember it, or the next Stripe sync would simply re-create the row.
      if (c.stripe_customer_id) {
        await db('crm_stripe_ignored?on_conflict=stripe_customer_id', {
          method: 'POST',
          body: [{ stripe_customer_id: c.stripe_customer_id, business_name: c.business_name }],
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
      }
      await db(`crm_clients?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
      return { deleted: true, suppressed: !!c.stripe_customer_id };
    }

    case 'add_note': {
      const { client_id, body } = payload;
      if (!client_id || !body?.trim()) return { error: 'missing client_id or body' };
      const [row] = await db('crm_notes', {
        method: 'POST',
        body: [{ client_id, body: body.trim() }],
        prefer: 'return=representation',
      });
      return { note: row };
    }

    case 'pin_note': {
      const { id, pinned } = payload;
      const [row] = await db(`crm_notes?id=eq.${id}`, {
        method: 'PATCH', body: { pinned: !!pinned }, prefer: 'return=representation',
      });
      return { note: row };
    }

    case 'delete_note': {
      await db(`crm_notes?id=eq.${payload.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      return { deleted: true };
    }

    case 'prospects': {
      const rows = await db(
        'prospects?select=id,business_name,trade,town,state,contact_name,email,phone,website_url,website_gap,fit,status'
        + '&order=fit.asc,business_name.asc&limit=500',
      );
      const claimed = await db('crm_clients?select=prospect_id&prospect_id=not.is.null');
      const taken = new Set(claimed.map((c) => c.prospect_id));
      return { prospects: rows.filter((p) => !taken.has(p.id)) };
    }

    case 'convert_prospect': {
      const [p] = await db(`prospects?id=eq.${payload.id}&select=*`);
      if (!p) return { error: 'prospect not found' };
      const [row] = await db('crm_clients', {
        method: 'POST',
        body: [{
          business_name: p.business_name,
          contact_name: p.contact_name,
          email: p.email,
          phone: p.phone,
          website: p.website_url,
          town: p.town,
          state: p.state || 'NY',
          status: p.sent_at ? 'contacted' : 'lead',
          source: 'outbound',
          prospect_id: p.id,
        }],
        prefer: 'return=representation',
      });
      if (p.evidence) {
        await db('crm_notes', {
          method: 'POST',
          body: [{ client_id: row.id, body: `Prospecting evidence: ${p.evidence}`, pinned: true }],
          prefer: 'return=minimal',
        });
      }
      await logActivity(row.id, 'client.created', `Converted from prospect queue — ${p.business_name}`);
      return { client: row };
    }

    // --- expenses & mileage -------------------------------------------------

    case 'money': {
      const year = String(payload.year || new Date().getFullYear());
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;
      const [expenses, mileage, settings, clients] = await Promise.all([
        db(`crm_expenses?select=*&spent_on=gte.${from}&spent_on=lte.${to}&order=spent_on.desc`),
        db(`crm_mileage?select=*&drove_on=gte.${from}&drove_on=lte.${to}&order=drove_on.desc`),
        db('crm_settings?select=*'),
        db('crm_clients?select=id,client_no,business_name&order=business_name.asc'),
      ]);
      const years = await db('crm_expenses?select=spent_on&order=spent_on.asc&limit=1');
      return {
        year: Number(year),
        expenses,
        mileage,
        clients,
        settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
        earliestExpense: years[0]?.spent_on || null,
      };
    }

    case 'add_expense':
    case 'save_expense': {
      const fields = pickFields(payload, EXPENSE_FIELDS);
      if (action === 'add_expense') {
        // Only a new row needs the full set; an edit may touch one field.
        if (!fields.vendor) return { error: 'vendor is required' };
        if (!fields.spent_on) return { error: 'date is required' };
        if (fields.amount_cents == null) return { error: 'amount is required' };
        const [row] = await db('crm_expenses', {
          method: 'POST', body: [fields], prefer: 'return=representation',
        });
        if (row.client_id) {
          await logActivity(row.client_id, 'expense.added',
            `Expense ${money(row.amount_cents)} — ${row.vendor}`, { amount_cents: row.amount_cents });
        }
        return { expense: row };
      }
      if (!payload.id) return { error: 'missing id' };
      const [row] = await db(`crm_expenses?id=eq.${payload.id}`, {
        method: 'PATCH', body: fields, prefer: 'return=representation',
      });
      return { expense: row };
    }

    // Receipts live in the private "receipts" bucket. The browser never gets a
    // bucket key — it asks for a short-lived signed URL when it wants to look.
    case 'upload_receipt': {
      const { expense_id, filename, content_type, data_base64 } = payload;
      if (!expense_id || !data_base64) return { error: 'missing expense_id or data' };
      const safe = String(filename || 'receipt')
        .replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
      const path = `${expense_id}/${safe}`;
      const bytes = Buffer.from(data_base64, 'base64');

      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${SERVICE_KEY}`,
          'content-type': content_type || 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: bytes,
      });
      if (!res.ok) return { error: `receipt upload failed: ${(await res.text()).slice(0, 200)}` };

      // Replacing a receipt with a differently-named file would otherwise leave
      // the old object stranded in the bucket.
      const tbl = receiptTable(payload.scope);
      const [prev] = await db(`${tbl}?id=eq.${expense_id}&select=receipt_path`);
      if (prev?.receipt_path && prev.receipt_path !== path) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${prev.receipt_path}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${SERVICE_KEY}` },
        }).catch(() => {});
      }

      const [row] = await db(`${tbl}?id=eq.${expense_id}`, {
        method: 'PATCH',
        body: { receipt_path: path, receipt_kind: content_type || null },
        prefer: 'return=representation',
      });
      return { expense: row, path, bytes: bytes.length };
    }

    case 'delete_receipt': {
      const { expense_id } = payload;
      if (!expense_id) return { error: 'missing expense_id' };
      const dtbl = receiptTable(payload.scope);
      const [e] = await db(`${dtbl}?id=eq.${expense_id}&select=receipt_path`);
      if (!e) return { error: 'expense not found' };
      if (e.receipt_path) {
        // Remove the object too, or replacing a receipt would orphan files in
        // the bucket forever.
        await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${e.receipt_path}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${SERVICE_KEY}` },
        }).catch(() => {});
      }
      const [row] = await db(`${dtbl}?id=eq.${expense_id}`, {
        method: 'PATCH',
        body: { receipt_path: null, receipt_kind: null },
        prefer: 'return=representation',
      });
      return { expense: row, removed: e.receipt_path || null };
    }

    case 'receipt_url': {
      if (!payload.path) return { error: 'missing path' };
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/receipts/${payload.path}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ expiresIn: 3600 }),
        },
      );
      if (!res.ok) return { error: `could not sign receipt: ${(await res.text()).slice(0, 200)}` };
      const { signedURL } = await res.json();
      return { url: `${SUPABASE_URL}/storage/v1${signedURL}` };
    }

    case 'delete_expense': {
      if (!payload.id) return { error: 'missing id' };
      await db(`crm_expenses?id=eq.${payload.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      return { deleted: true };
    }

    case 'add_mileage':
    case 'save_mileage': {
      const fields = pickFields(payload, MILEAGE_FIELDS);
      if (action === 'add_mileage') {
        if (!fields.purpose) return { error: 'purpose is required' };
        if (!fields.drove_on) return { error: 'date is required' };
        if (!fields.miles) return { error: 'miles is required' };
        if (fields.rate_cents == null) return { error: 'rate is required' };
        const [row] = await db('crm_mileage', {
          method: 'POST', body: [fields], prefer: 'return=representation',
        });
        return { trip: row };
      }
      if (!payload.id) return { error: 'missing id' };
      const [row] = await db(`crm_mileage?id=eq.${payload.id}`, {
        method: 'PATCH', body: fields, prefer: 'return=representation',
      });
      return { trip: row };
    }

    case 'delete_mileage': {
      if (!payload.id) return { error: 'missing id' };
      await db(`crm_mileage?id=eq.${payload.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      return { deleted: true };
    }

    case 'set_setting': {
      const { key, value } = payload;
      if (!key) return { error: 'missing key' };
      await db('crm_settings?on_conflict=key', {
        method: 'POST',
        body: [{ key, value: String(value), updated_at: new Date().toISOString() }],
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
      return { saved: true };
    }

    // --- personal portal ----------------------------------------------------
    // Separate table, separate page. Personal records never touch crm_expenses.

    case 'personal': {
      const year = String(payload.year || new Date().getFullYear());
      const rows = await db(
        `personal_expenses?select=*&tax_year=eq.${year}&order=spent_on.desc`,
      );
      const years = await db('personal_expenses?select=tax_year&order=tax_year.asc&limit=1');
      return { year: Number(year), expenses: rows, earliestYear: years[0]?.tax_year || null };
    }

    case 'add_personal':
    case 'save_personal': {
      const fields = pickFields(payload, PERSONAL_FIELDS);
      if (action === 'add_personal') {
        if (!fields.payee) return { error: 'payee is required' };
        if (!fields.spent_on) return { error: 'date is required' };
        if (fields.amount_cents == null) return { error: 'amount is required' };
        const [row] = await db('personal_expenses', {
          method: 'POST', body: [fields], prefer: 'return=representation',
        });
        return { expense: row };
      }
      if (!payload.id) return { error: 'missing id' };
      const [row] = await db(`personal_expenses?id=eq.${payload.id}`, {
        method: 'PATCH', body: fields, prefer: 'return=representation',
      });
      return { expense: row };
    }

    case 'delete_personal': {
      if (!payload.id) return { error: 'missing id' };
      await db(`personal_expenses?id=eq.${payload.id}`, {
        method: 'DELETE', prefer: 'return=minimal',
      });
      return { deleted: true };
    }

    case 'sync_stripe':
      return await syncStripe();

    case 'stripe_customers': {
      if (!STRIPE_KEY) return { error: 'STRIPE_SECRET_KEY is not set in Netlify.' };
      const customers = await stripeAll('customers');
      return {
        customers: customers.map((c) => ({
          id: c.id, name: c.name, email: c.email, created: ts(c.created),
        })),
      };
    }

    default:
      return { error: `unknown action: ${action}` };
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: JSON_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return fail(405, 'POST only');
  if (!SUPABASE_URL || !SERVICE_KEY || !PUBLISHABLE_KEY) {
    return fail(500, 'Supabase environment variables are missing.');
  }

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail(401, 'Not signed in.');

  const user = await whoami(token);
  if (!user) return fail(403, 'Not authorized.');

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return fail(400, 'Bad JSON.');
  }

  const action = payload.action;
  if (!action) return fail(400, 'Missing action.');

  try {
    const result = await handleAction(action, payload, user);
    if (result?.error) return fail(400, result.error);
    return ok(result);
  } catch (err) {
    console.error(`crm action ${action} failed:`, err);
    return fail(500, err.message || 'Server error.');
  }
}
