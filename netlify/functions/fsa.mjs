// Back end for the dog waste booking app (client build, name not chosen yet).
//
// One endpoint, action-dispatched, same shape as the CRM. No Supabase:
// everything lives in Netlify Blobs on this site.
//
//   Public (the app + the Venmo page):
//     availability   days off + the price list + which services are open to book
//     slots          open start times for a service on a date (blocks, other
//                    bookings and her travel buffer already taken out)
//     book           save a booking, email it to the owner
//     pay-info       what the Venmo page needs to render (booking must match its secret)
//     client-token   Braintree client token for the Venmo page
//     vault          turn the Venmo nonce into a saved payment method on the booking
//     push-register  save a phone's Expo push address so she can message it
//
//   Owner only (login cookie):
//     login / logout / me
//     bookings       list
//     block / unblock
//     settings       job length per service, travel buffer, start hours
//     charge         charge the saved Venmo for one visit
//     mark-paid      record a cash payment
//     set-status     cancel / reopen a booking
//     push-send      send one message to every phone that allowed notifications
//
// Braintree credentials live in env vars and never reach a browser or the app.

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const ADMIN_USER = (process.env.FSA_ADMIN_USER || '').trim().toLowerCase();
const ADMIN_PASS_HASH = process.env.FSA_ADMIN_PASS_HASH || ''; // scrypt$<salt hex>$<hash hex>
const SESSION_SECRET = process.env.FSA_SESSION_SECRET || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BOOKING_TO = process.env.FSA_BOOKING_TO || '';
const BOOKING_FROM = process.env.FSA_BOOKING_FROM || 'Booking Request <leads@ainovations.net>';
const SITE = process.env.URL || 'https://ainovations.net';
const TZ = 'America/New_York';

const BT = {
  merchantId: process.env.BRAINTREE_MERCHANT_ID || '',
  publicKey: process.env.BRAINTREE_PUBLIC_KEY || '',
  privateKey: process.env.BRAINTREE_PRIVATE_KEY || '',
  mode: process.env.BRAINTREE_MODE === 'production' ? 'production' : 'sandbox',
};

const SESSION_COOKIE = 'fsa_session';
const SESSION_HOURS = 24 * 14;

// Her price sheet, September 2026. Prices are for one dog and the first 1/8 acre.
// The extra-dog rate is not on the sheet, so the app never prices extra dogs.
const SERVICES = [
  { id: 'spring', name: 'Spring Clean-Up', cents: 10000, months: [1, 2, 3, 4, 5], per: 'one time' },
  { id: 'initial', name: 'Initial or One-Time Clean-Up', cents: 10000, months: [1, 2, 3, 4, 5], per: 'one time' },
  { id: 'onetime', name: 'One-Time Clean-Up', cents: 7500, months: [6, 7, 8, 9, 10, 11, 12], per: 'one time' },
  { id: 'twice_weekly', name: 'Twice-a-Week Service', cents: 1500, per: 'visit' },
  { id: 'weekly', name: 'Weekly Service', cents: 2000, per: 'visit', badge: 'Most Popular' },
  { id: 'biweekly', name: 'Bi-Weekly Service', cents: 2500, per: 'visit' },
  { id: 'monthly', name: 'Monthly Service', cents: 4000, per: 'visit' },
];
const PRICE_NOTES = [
  'Listed prices are for one dog. Additional dogs may affect pricing.',
  '+$7 per 1/8 acre.',
];

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function ok(body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...JSON_HEADERS, ...extraHeaders } });
}
function fail(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

const store = () => getStore({ name: 'fsa', consistency: 'strong' });

// --- dates ------------------------------------------------------------------

function todayLocal() {
  // YYYY-MM-DD in her time zone, not the server's.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

async function getBlocks() {
  return (await store().get('blocks', { type: 'json' })) || [];
}

// --- scheduling ---------------------------------------------------------------
//
// She sets these on her page; nothing here guesses them. A service with no
// length set cannot be booked, and nothing can be booked until the travel
// buffer and her start hours are set.
//
//   durations   minutes per service id
//   buffer      minutes she needs between any two appointments
//   firstStart  earliest start time offered, "HH:MM"
//   lastStart   latest start time offered, "HH:MM"

const SLOT_STEP = 30;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function getSettings() {
  return (await store().get('settings', { type: 'json' })) || { durations: {}, buffer: null, firstStart: null, lastStart: null };
}

function scheduleReady(settings, serviceId) {
  return Number.isInteger(settings.buffer) && isTime(settings.firstStart) && isTime(settings.lastStart)
    && Number.isInteger(settings.durations?.[serviceId]);
}

const RECURRING_DAYS = { weekly: 7, twice_weekly: 7, biweekly: 14 };

/** Does a booking put her at that address on that date? Recurring ones repeat until cancelled. */
function occursOn(b, date) {
  if (date < b.date) return false;
  if (date === b.date) return true;
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(b.date + 'T00:00:00Z')) / 86400000);
  if (RECURRING_DAYS[b.serviceId]) return days % RECURRING_DAYS[b.serviceId] === 0;
  if (b.serviceId === 'monthly') {
    // Same weekday, same week-of-month: the 2nd Tuesday stays the 2nd Tuesday.
    const a = new Date(b.date + 'T00:00:00Z');
    const d = new Date(date + 'T00:00:00Z');
    return a.getUTCDay() === d.getUTCDay() && Math.ceil(a.getUTCDate() / 7) === Math.ceil(d.getUTCDate() / 7);
  }
  return false;
}

/** Busy windows on a date, each one already padded by her travel buffer on both sides. */
function busyWindows(bookings, settings, date, ignoreId) {
  const out = [];
  for (const b of bookings) {
    if (b.status === 'cancelled' || b.id === ignoreId || !occursOn(b, date)) continue;
    const start = toMin(b.time);
    const len = b.durationMin ?? settings.durations?.[b.serviceId] ?? 0;
    out.push([start - settings.buffer, start + len + settings.buffer]);
  }
  return out;
}

/** Can a job of `len` minutes start at `time` on `date`? */
function fits(date, time, len, blocks, busy) {
  const s = toMin(time);
  const e = s + len;
  for (const b of blocks) {
    if (b.date !== date) continue;
    if (!b.from || !b.to) return false; // whole day off
    if (s < toMin(b.to) && toMin(b.from) < e) return false;
  }
  return busy.every(([bs, be]) => e <= bs || s >= be);
}

function nowLocalMinutes() {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date());
  return toMin(t);
}

function openSlots(date, serviceId, settings, blocks, bookings) {
  const len = settings.durations[serviceId];
  const busy = busyWindows(bookings, settings, date);
  // Today, nothing she couldn't drive to in time: the next start is at least one travel buffer away.
  const earliest = date === todayLocal() ? nowLocalMinutes() + settings.buffer : 0;
  const slots = [];
  for (let m = toMin(settings.firstStart); m <= toMin(settings.lastStart); m += SLOT_STEP) {
    if (m < earliest) continue;
    const t = toTime(m);
    if (fits(date, t, len, blocks, busy)) slots.push(t);
  }
  return slots;
}

async function allBookings() {
  const { blobs } = await store().list({ prefix: 'booking/' });
  const all = await Promise.all(blobs.map((x) => store().get(x.key, { type: 'json' })));
  return all.filter(Boolean);
}

// --- auth -------------------------------------------------------------------

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !SESSION_SECRET) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}
function cookieOf(req, name) {
  const raw = req.headers.get('cookie') || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}
function passwordMatches(password) {
  const [scheme, saltHex, hashHex] = ADMIN_PASS_HASH.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), want.length);
  return crypto.timingSafeEqual(got, want);
}
const ipOf = (req, context) =>
  context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
const ipKey = (ip) => crypto.createHash('sha256').update('fsa:' + ip).digest('hex').slice(0, 24);

/** Fixed-window counter. Returns true when the caller is over the limit. */
async function overLimit(bucket, ip, max, windowMinutes) {
  // One record per caller, overwritten each window, so these never pile up.
  const win = Math.floor(Date.now() / (windowMinutes * 60000));
  const key = `rl/${bucket}/${ipKey(ip)}`;
  const prev = await store().get(key, { type: 'json' });
  const n = prev?.win === win ? prev.n + 1 : 1;
  await store().setJSON(key, { win, n });
  return n > max;
}

// --- email ------------------------------------------------------------------

async function emailBooking(b) {
  if (!RESEND_API_KEY || !BOOKING_TO) {
    console.error('booking email skipped: RESEND_API_KEY or FSA_BOOKING_TO not set');
    return false;
  }
  const lines = [
    'New booking request from the app:',
    '',
    `Name:      ${b.name}`,
    `Phone:     ${b.phone}`,
    `Email:     ${b.email || '(not given)'}`,
    `Address:   ${b.address}`,
    '',
    `Service:   ${b.serviceName}`,
    `Dogs:      ${b.dogs}`,
    `Date:      ${b.date}`,
    `Time:      ${b.time}`,
    '',
    `Notes:     ${b.notes || '(none)'}`,
    '',
    `Manage bookings and charge Venmo: ${SITE}/fsa/`,
  ].join('\n');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: BOOKING_FROM,
        to: BOOKING_TO.split(',').map((s) => s.trim()).filter(Boolean),
        reply_to: b.email || undefined,
        subject: `New booking: ${b.name}, ${b.serviceName}, ${b.date} ${b.time}`,
        text: lines,
      }),
    });
    if (!res.ok) console.error('booking email failed', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('booking email failed', e.message);
    return false;
  }
}

// --- Braintree (GraphQL) ----------------------------------------------------

const btConfigured = () => !!(BT.merchantId && BT.publicKey && BT.privateKey);

async function bt(query, variables) {
  const url = BT.mode === 'production'
    ? 'https://payments.braintree-api.com/graphql'
    : 'https://payments.sandbox.braintree-api.com/graphql';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${BT.publicKey}:${BT.privateKey}`).toString('base64'),
      'Braintree-Version': '2019-01-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.errors?.length) {
    const msg = body?.errors?.[0]?.message || `Braintree returned ${res.status}`;
    throw new Error(msg);
  }
  return body.data;
}

function centsToAmount(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// --- bookings ---------------------------------------------------------------

async function getBooking(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return store().get(`booking/${id}`, { type: 'json' });
}
const saveBooking = (b) => store().setJSON(`booking/${b.id}`, b);

/** The app/Venmo page proves it owns a booking with the secret it was handed at booking time. */
async function bookingForPayer(id, secret) {
  const b = await getBooking(id);
  if (!b || typeof secret !== 'string') return null;
  const a = Buffer.from(secret);
  const w = Buffer.from(b.paySecret);
  return a.length === w.length && crypto.timingSafeEqual(a, w) ? b : null;
}

/** What the owner page sees: everything except the payer secret and the raw vault token. */
function ownerView(b) {
  const { paySecret, venmo, ...rest } = b;
  return { ...rest, venmo: venmo ? { username: venmo.username, linkedAt: venmo.linkedAt } : null };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// --- push -------------------------------------------------------------------
//
// Expo's push service (free) delivers to both iPhone and Android. Each phone's
// address lives at push/<hash of the address>, so registering twice is a no-op.

const PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;
const pushKey = (token) => 'push/' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);

async function pushTokens() {
  const { blobs } = await store().list({ prefix: 'push/' });
  const rows = await Promise.all(blobs.map((x) => store().get(x.key, { type: 'json' })));
  return rows.filter(Boolean).map((r) => r.token);
}

async function sendPush(title, body) {
  const tokens = await pushTokens();
  let sent = 0;
  let dropped = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch.map((to) => ({ to, title, body, sound: 'default' }))),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data?.data)) throw new Error(`Expo push returned ${res.status}`);
    await Promise.all(data.data.map(async (ticket, n) => {
      if (ticket.status === 'ok') { sent++; return; }
      // The app was deleted or notifications turned off: stop sending to it.
      if (ticket.details?.error === 'DeviceNotRegistered') {
        dropped++;
        await store().delete(pushKey(batch[n]));
      }
    }));
  }
  return { phones: tokens.length, sent, dropped };
}

// --- handler ----------------------------------------------------------------

export default async (req, context) => {
  if (req.method !== 'POST') return fail(405, 'method not allowed');
  let input;
  try {
    input = await req.json();
  } catch {
    return fail(400, 'bad json');
  }
  const action = input?.action;

  try {
    // ---------------- public ----------------
    if (action === 'availability') {
      const settings = await getSettings();
      const services = SERVICES.map((sv) => ({ ...sv, bookable: scheduleReady(settings, sv.id) }));
      // Whole days off only; partial blocks and other bookings come back per date from `slots`.
      const daysOff = [...new Set((await getBlocks()).filter((b) => !b.from).map((b) => b.date))];
      return ok({ today: todayLocal(), daysOff, services, priceNotes: PRICE_NOTES });
    }

    if (action === 'slots') {
      const date = str(input.date, 10);
      const serviceId = str(input.serviceId, 40);
      if (!isDate(date) || !SERVICES.some((sv) => sv.id === serviceId)) return fail(400, 'Pick a service and date.');
      if (date < todayLocal()) return ok({ slots: [] });
      const settings = await getSettings();
      if (!scheduleReady(settings, serviceId)) return ok({ slots: [] });
      return ok({ slots: openSlots(date, serviceId, settings, await getBlocks(), await allBookings()) });
    }

    if (action === 'book') {
      if (input.website) return ok({ ok: true }); // honeypot: bots fill every field
      if (await overLimit('book', ipOf(req, context), 8, 60)) return fail(429, 'Too many requests. Please try again later.');

      const b = {
        name: str(input.name, 120),
        phone: str(input.phone, 40),
        email: str(input.email, 160),
        address: str(input.address, 300),
        serviceId: str(input.serviceId, 40),
        dogs: Number.parseInt(input.dogs, 10),
        date: str(input.date, 10),
        time: str(input.time, 5),
        notes: str(input.notes, 1000),
      };
      if (!b.name || !b.phone || !b.address) return fail(400, 'Name, phone and address are required.');
      if (!Number.isInteger(b.dogs) || b.dogs < 1 || b.dogs > 20) return fail(400, 'Enter how many dogs.');
      if (!isDate(b.date) || !isTime(b.time)) return fail(400, 'Pick a date and time.');
      if (b.date < todayLocal()) return fail(400, 'That date has passed.');
      const service = SERVICES.find((s) => s.id === b.serviceId);
      if (!service) return fail(400, 'Pick a service.');
      const month = Number(b.date.slice(5, 7));
      if (service.months && !service.months.includes(month)) return fail(400, `${service.name} is not offered that month.`);
      const settings = await getSettings();
      if (!scheduleReady(settings, service.id)) return fail(409, `${service.name} is not open for booking yet.`);
      const blocks = await getBlocks();
      const taken = 'That time was just taken or is not available. Please pick another.';
      if (!openSlots(b.date, service.id, settings, blocks, await allBookings()).includes(b.time)) return fail(409, taken);

      const booking = {
        ...b,
        id: crypto.randomUUID(),
        serviceName: service.name,
        listCents: service.cents,
        durationMin: settings.durations[service.id],
        status: 'new',
        createdAt: new Date().toISOString(),
        paySecret: crypto.randomBytes(24).toString('hex'),
        venmo: null,
        payments: [],
      };
      await saveBooking(booking);

      // Two people tapping the same slot at the same moment both pass the check
      // above. Re-check against everything now saved; the later one backs out.
      const others = (await allBookings()).filter((x) => x.id !== booking.id && x.createdAt <= booking.createdAt);
      if (!fits(booking.date, booking.time, booking.durationMin, blocks, busyWindows(others, settings, booking.date))) {
        await store().delete(`booking/${booking.id}`);
        return fail(409, taken);
      }

      const emailed = await emailBooking(booking);
      if (!emailed) console.error('booking saved but not emailed', booking.id);
      return ok({
        ok: true,
        id: booking.id,
        payUrl: `${SITE}/fsa-pay/?b=${booking.id}&t=${booking.paySecret}`,
      });
    }

    if (action === 'pay-info') {
      const b = await bookingForPayer(input.id, input.secret);
      if (!b) return fail(404, 'Booking not found.');
      return ok({ name: b.name, serviceName: b.serviceName, date: b.date, linked: !!b.venmo, ready: btConfigured() });
    }

    if (action === 'client-token') {
      const b = await bookingForPayer(input.id, input.secret);
      if (!b) return fail(404, 'Booking not found.');
      if (!btConfigured()) return fail(503, 'Venmo is not set up yet.');
      const data = await bt(
        'mutation T($input: CreateClientTokenInput) { createClientToken(input: $input) { clientToken } }',
        { input: { clientToken: { merchantAccountId: BT.merchantId } } },
      );
      return ok({ clientToken: data.createClientToken.clientToken });
    }

    if (action === 'vault') {
      const b = await bookingForPayer(input.id, input.secret);
      if (!b) return fail(404, 'Booking not found.');
      if (!btConfigured()) return fail(503, 'Venmo is not set up yet.');
      if (typeof input.nonce !== 'string' || !input.nonce) return fail(400, 'missing nonce');
      const data = await bt(
        `mutation V($input: VaultPaymentMethodInput!) {
           vaultPaymentMethod(input: $input) {
             paymentMethod { id details { __typename ... on VenmoAccountDetails { username } } }
           }
         }`,
        { input: { paymentMethodId: input.nonce } },
      );
      const pm = data.vaultPaymentMethod.paymentMethod;
      if (pm.details?.__typename !== 'VenmoAccountDetails') return fail(400, 'Only Venmo is accepted here.');
      b.venmo = { token: pm.id, username: pm.details.username, linkedAt: new Date().toISOString() };
      await saveBooking(b);
      return ok({ ok: true, username: pm.details.username });
    }

    if (action === 'push-register') {
      if (await overLimit('push', ipOf(req, context), 20, 60)) return fail(429, 'Too many requests.');
      const token = str(input.token, 200);
      if (!PUSH_TOKEN_RE.test(token)) return fail(400, 'bad token');
      await store().setJSON(pushKey(token), { token, at: new Date().toISOString() });
      return ok({ ok: true });
    }

    // ---------------- owner ----------------
    if (action === 'login') {
      if (!ADMIN_USER || !ADMIN_PASS_HASH || !SESSION_SECRET) return fail(503, 'Login is not configured.');
      if (await overLimit('login', ipOf(req, context), 10, 15)) return fail(429, 'Too many tries. Wait 15 minutes.');
      const userOk = str(input.username, 120).toLowerCase() === ADMIN_USER;
      const passOk = passwordMatches(input.password || '');
      if (!userOk || !passOk) return fail(401, 'Wrong username or password.');
      const token = sign({ u: ADMIN_USER, exp: Date.now() + SESSION_HOURS * 3600000 });
      return ok({ ok: true }, {
        'set-cookie': `${SESSION_COOKIE}=${token}; Path=/api/fsa; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`,
      });
    }

    if (action === 'logout') {
      return ok({ ok: true }, { 'set-cookie': `${SESSION_COOKIE}=; Path=/api/fsa; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }

    const session = verify(cookieOf(req, SESSION_COOKIE));
    if (!session) return fail(401, 'Not signed in.');

    if (action === 'me') return ok({ user: session.u, venmoReady: btConfigured(), venmoMode: BT.mode });

    if (action === 'bookings') {
      const rows = (await allBookings()).map(ownerView).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const { blobs: phones } = await store().list({ prefix: 'push/' });
      const pushLog = (await store().get('pushlog', { type: 'json' })) || [];
      return ok({
        bookings: rows, blocks: await getBlocks(), today: todayLocal(), settings: await getSettings(), services: SERVICES,
        pushPhones: phones.length, pushLog,
      });
    }

    if (action === 'settings') {
      const buffer = Number(input.buffer);
      const firstStart = str(input.firstStart, 5);
      const lastStart = str(input.lastStart, 5);
      if (!Number.isInteger(buffer) || buffer < 0 || buffer > 240) return fail(400, 'Travel time must be 0 to 240 minutes.');
      if (!isTime(firstStart) || !isTime(lastStart) || firstStart > lastStart) return fail(400, 'Set the earliest start before the latest start.');
      const durations = {};
      for (const sv of SERVICES) {
        const v = input.durations?.[sv.id];
        if (v === '' || v === null || v === undefined) continue;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 5 || n > 600) return fail(400, `${sv.name}: length must be 5 to 600 minutes.`);
        durations[sv.id] = n;
      }
      const settings = { buffer, firstStart, lastStart, durations };
      await store().setJSON('settings', settings);
      return ok({ settings });
    }

    if (action === 'block') {
      const date = str(input.date, 10);
      const allDay = !!input.allDay;
      const from = allDay ? null : str(input.from, 5);
      const to = allDay ? null : str(input.to, 5);
      if (!isDate(date)) return fail(400, 'Pick a date.');
      if (!allDay && (!isTime(from) || !isTime(to) || from >= to)) return fail(400, 'Pick a start time before the end time.');
      const blocks = await getBlocks();
      blocks.push({ id: crypto.randomUUID(), date, from, to, note: str(input.note, 120) });
      blocks.sort((a, b) => (a.date + (a.from || '') < b.date + (b.from || '') ? -1 : 1));
      await store().setJSON('blocks', blocks);
      return ok({ blocks });
    }

    if (action === 'unblock') {
      const blocks = (await getBlocks()).filter((b) => b.id !== input.id);
      await store().setJSON('blocks', blocks);
      return ok({ blocks });
    }

    if (action === 'charge') {
      const b = await getBooking(input.id);
      if (!b) return fail(404, 'Booking not found.');
      if (!b.venmo) return fail(400, 'This customer has not linked Venmo.');
      if (!btConfigured()) return fail(503, 'Venmo is not set up yet.');
      const cents = Number(input.cents);
      if (!Number.isInteger(cents) || cents < 100 || cents > 100000) return fail(400, 'Enter an amount between $1 and $1,000.');
      const paymentId = crypto.randomUUID();
      try {
        const data = await bt(
          `mutation C($input: ChargePaymentMethodInput!) {
             chargePaymentMethod(input: $input) { transaction { id status } }
           }`,
          {
            input: {
              paymentMethodId: b.venmo.token,
              transaction: { amount: centsToAmount(cents), merchantAccountId: BT.merchantId, orderId: paymentId },
            },
          },
        );
        const t = data.chargePaymentMethod.transaction;
        b.payments.push({ id: paymentId, kind: 'venmo', cents, at: new Date().toISOString(), transactionId: t.id, status: t.status });
        await saveBooking(b);
        return ok({ booking: ownerView(b) });
      } catch (e) {
        b.payments.push({ id: paymentId, kind: 'venmo', cents, at: new Date().toISOString(), status: 'FAILED', error: e.message });
        await saveBooking(b);
        return fail(402, `Venmo charge failed: ${e.message}`);
      }
    }

    if (action === 'mark-paid') {
      const b = await getBooking(input.id);
      if (!b) return fail(404, 'Booking not found.');
      const cents = Number(input.cents);
      if (!Number.isInteger(cents) || cents < 1 || cents > 100000) return fail(400, 'Enter the amount received.');
      b.payments.push({ id: crypto.randomUUID(), kind: 'cash', cents, at: new Date().toISOString(), status: 'PAID' });
      await saveBooking(b);
      return ok({ booking: ownerView(b) });
    }

    if (action === 'push-send') {
      const title = str(input.title, 60);
      const body = str(input.body, 240);
      if (!title || !body) return fail(400, 'Write a title and a message.');
      const result = await sendPush(title, body);
      const pushLog = (await store().get('pushlog', { type: 'json' })) || [];
      pushLog.unshift({ at: new Date().toISOString(), title, body, ...result });
      await store().setJSON('pushlog', pushLog.slice(0, 50));
      return ok({ ...result, pushLog: pushLog.slice(0, 50) });
    }

    if (action === 'set-status') {
      const b = await getBooking(input.id);
      if (!b) return fail(404, 'Booking not found.');
      if (!['new', 'confirmed', 'cancelled'].includes(input.status)) return fail(400, 'bad status');
      b.status = input.status;
      await saveBooking(b);
      return ok({ booking: ownerView(b) });
    }

    return fail(400, 'unknown action');
  } catch (e) {
    console.error('fsa error', action, e);
    return fail(500, 'Something went wrong. Please try again.');
  }
};
