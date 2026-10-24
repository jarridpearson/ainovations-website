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

// Her services and prices are HER data: she edits them on the Prices tab of her
// page, and they live in the store under `services`. These are only the opening
// values from her September 2026 price sheet, used until she saves her own.
// Prices are for one dog and the first 1/8 acre.
//
// `frequency` decides how a booking repeats on her calendar:
//   one_time | weekly | twice_weekly | biweekly | monthly
const FREQUENCIES = ['one_time', 'weekly', 'twice_weekly', 'biweekly', 'monthly'];
const DEFAULT_SERVICES = [
  { id: 'spring', name: 'Spring Clean-Up', cents: 10000, months: [1, 2, 3, 4, 5], frequency: 'one_time' },
  { id: 'initial', name: 'Initial or One-Time Clean-Up', cents: 10000, months: [1, 2, 3, 4, 5], frequency: 'one_time' },
  { id: 'onetime', name: 'One-Time Clean-Up', cents: 7500, months: [6, 7, 8, 9, 10, 11, 12], frequency: 'one_time' },
  { id: 'twice_weekly', name: 'Twice-a-Week Service', cents: 1500, frequency: 'twice_weekly' },
  { id: 'weekly', name: 'Weekly Service', cents: 2000, frequency: 'weekly', badge: 'Most Popular' },
  { id: 'biweekly', name: 'Bi-Weekly Service', cents: 2500, frequency: 'biweekly' },
  { id: 'monthly', name: 'Monthly Service', cents: 4000, frequency: 'monthly' },
];
const DEFAULT_PRICE_NOTES = [
  'Listed prices are for one dog. Additional dogs may affect pricing.',
  '+$7 per 1/8 acre.',
];

const perLabel = (sv) => (sv.frequency === 'one_time' ? 'one time' : 'visit');

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
// Time between two appointments = real drive time between the two addresses
// (Google Routes API) + her buffer (15 minutes unless she changes it).
//
// Job length = minutes for the service + extra minutes for each dog past the
// first. The defaults below come from published pet-waste-removal timings
// (routine weekly visits run ~10-30 min on site, first/catch-up cleanups ~30 min
// and up, each extra dog adds ~5-10 min). They are only starting values: she
// edits every one of them on the Schedule tab.
//
//   durations    minutes per service id
//   extraDogMin  minutes added per dog after the first
//   buffer       minutes added on top of drive time between appointments
//   firstStart   earliest start time offered, "HH:MM"  (her hours: she sets these)
//   lastStart    latest start time offered, "HH:MM"

const SLOT_STEP = 30;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const DEFAULT_DURATIONS = {
  spring: 60, initial: 45, onetime: 45, twice_weekly: 10, weekly: 15, biweekly: 20, monthly: 30,
};
const DEFAULT_BY_FREQUENCY = { one_time: 45, twice_weekly: 10, weekly: 15, biweekly: 20, monthly: 30 };
const DEFAULT_EXTRA_DOG_MIN = 5;
const DEFAULT_BUFFER = 15;
// If Google can't be reached, assume a long drive rather than double-book her.
const FALLBACK_DRIVE_MIN = 45;

async function getSettings() {
  const saved = (await store().get('settings', { type: 'json' })) || {};
  const services = await getServices();
  const durations = {};
  for (const sv of services) {
    const v = saved.durations?.[sv.id];
    durations[sv.id] = Number.isInteger(v) ? v : (DEFAULT_DURATIONS[sv.id] ?? DEFAULT_BY_FREQUENCY[sv.frequency] ?? 30);
  }
  return {
    durations,
    extraDogMin: Number.isInteger(saved.extraDogMin) ? saved.extraDogMin : DEFAULT_EXTRA_DOG_MIN,
    buffer: Number.isInteger(saved.buffer) ? saved.buffer : DEFAULT_BUFFER,
    firstStart: saved.firstStart || null,
    lastStart: saved.lastStart || null,
  };
}

async function getServices() {
  return (await store().get('services', { type: 'json' })) || DEFAULT_SERVICES;
}
async function getPriceNotes() {
  return (await store().get('pricenotes', { type: 'json' })) || DEFAULT_PRICE_NOTES;
}

function scheduleReady(settings, serviceId) {
  return isTime(settings.firstStart) && isTime(settings.lastStart) && Number.isInteger(settings.durations?.[serviceId]);
}

const jobLength = (settings, serviceId, dogs) =>
  settings.durations[serviceId] + settings.extraDogMin * Math.max(0, (Number(dogs) || 1) - 1);

const RECURRING_DAYS = { weekly: 7, twice_weekly: 7, biweekly: 14 };
// Bookings carry the frequency they were booked with, so editing or deleting a
// service later never changes an existing customer's schedule.
const freqOf = (b) => b.frequency || (RECURRING_DAYS[b.serviceId] || b.serviceId === 'monthly' ? b.serviceId : 'one_time');

/** Does a booking put her at that address on that date? Recurring ones repeat until cancelled. */
function occursOn(b, date) {
  if (date < b.date) return false;
  if (date === b.date) return true;
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(b.date + 'T00:00:00Z')) / 86400000);
  const f = freqOf(b);
  if (RECURRING_DAYS[f]) return days % RECURRING_DAYS[f] === 0;
  if (f === 'monthly') {
    // Same weekday, same week-of-month: the 2nd Tuesday stays the 2nd Tuesday.
    const a = new Date(b.date + 'T00:00:00Z');
    const d = new Date(date + 'T00:00:00Z');
    return a.getUTCDay() === d.getUTCDay() && Math.ceil(a.getUTCDate() / 7) === Math.ceil(d.getUTCDate() / 7);
  }
  return false;
}

// --- drive time ---------------------------------------------------------------
//
// One Routes API "element" per origin/destination pair. Results are cached by
// address pair for 30 days, so a customer's address is only looked up once per
// neighbor. The key is capped at 300 elements/day in Google Cloud, which keeps
// usage inside the 10,000/month free tier.

const ROUTES_KEY = process.env.FSA_ROUTES_KEY || '';
const normAddr = (a) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
const driveKey = (a, b) => 'drive/' + crypto.createHash('sha256').update(normAddr(a) + '|' + normAddr(b)).digest('hex').slice(0, 40);
const DRIVE_TTL_MS = 30 * 86400000;

class AddressNotFound extends Error {}

async function routeMatrix(origins, destinations) {
  if (!ROUTES_KEY) throw new Error('FSA_ROUTES_KEY not set');
  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': ROUTES_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition,status',
    },
    body: JSON.stringify({
      origins: origins.map((address) => ({ waypoint: { address } })),
      destinations: destinations.map((address) => ({ waypoint: { address } })),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) throw new Error(`Routes API ${res.status}`);
  return data;
}

/** Minutes to drive for each [from, to] pair. Throws AddressNotFound if Google can't place `mustResolve`. */
async function driveMinutes(pairs, mustResolve) {
  const out = new Map();
  const missing = [];
  await Promise.all(pairs.map(async ([a, b]) => {
    if (normAddr(a) === normAddr(b)) { out.set(a + '|' + b, 0); return; }
    const hit = await store().get(driveKey(a, b), { type: 'json' });
    if (hit && Date.now() - hit.at < DRIVE_TTL_MS) out.set(a + '|' + b, hit.min);
    else missing.push([a, b]);
  }));
  if (missing.length) {
    // Group by whichever side repeats, so A->many and many->A are one call each.
    const byOrigin = new Map();
    const byDest = new Map();
    for (const [a, b] of missing) {
      byOrigin.set(a, [...(byOrigin.get(a) || []), b]);
      byDest.set(b, [...(byDest.get(b) || []), a]);
    }
    const calls = byOrigin.size <= byDest.size
      ? [...byOrigin].map(([o, ds]) => [[o], ds])
      : [...byDest].map(([d, os]) => [os, [d]]);
    for (const [origins, dests] of calls) {
      let rows;
      try {
        rows = await routeMatrix(origins, dests);
      } catch (e) {
        console.error('drive time lookup failed, using fallback', e.message);
        for (const o of origins) for (const d of dests) out.set(o + '|' + d, FALLBACK_DRIVE_MIN);
        continue;
      }
      for (const r of rows) {
        const o = origins[r.originIndex ?? 0];
        const d = dests[r.destinationIndex ?? 0];
        if (r.condition === 'ROUTE_EXISTS') {
          const min = Math.ceil(parseInt(r.duration, 10) / 60);
          out.set(o + '|' + d, min);
          await store().setJSON(driveKey(o, d), { min, at: Date.now() });
        } else {
          const bad = r.status?.code === 5 && (normAddr(o) === normAddr(mustResolve) || normAddr(d) === normAddr(mustResolve));
          if (bad) throw new AddressNotFound('We could not find that address. Check it in your profile.');
          out.set(o + '|' + d, FALLBACK_DRIVE_MIN);
        }
      }
    }
  }
  return (a, b) => out.get(a + '|' + b) ?? FALLBACK_DRIVE_MIN;
}

/** The other appointments she has that day (recurring ones included). */
function jobsOn(bookings, settings, date, ignoreId) {
  return bookings
    .filter((b) => b.status !== 'cancelled' && b.id !== ignoreId && occursOn(b, date))
    .map((b) => {
      const start = toMin(b.time);
      return { start, end: start + (b.durationMin ?? settings.durations?.[b.serviceId] ?? 30), address: b.address };
    });
}

/** Can a job at `address` of `len` minutes start at minute `s`, given her blocks and the day's other jobs? */
function fitsDay(date, s, len, blocks, jobs, address, drive, buffer) {
  const e = s + len;
  for (const b of blocks) {
    if (b.date !== date) continue;
    if (!b.from || !b.to) return false; // whole day off
    if (s < toMin(b.to) && toMin(b.from) < e) return false;
  }
  return jobs.every((j) =>
    e + drive(address, j.address) + buffer <= j.start   // finish here, drive there, buffer, before it starts
    || s >= j.end + drive(j.address, address) + buffer, // or it ends, drive here, buffer, then start
  );
}

function nowLocalMinutes() {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date());
  return toMin(t);
}

async function openSlots(date, serviceId, settings, blocks, bookings, { address, dogs }) {
  const len = jobLength(settings, serviceId, dogs);
  const jobs = jobsOn(bookings, settings, date);
  const pairs = jobs.flatMap((j) => [[address, j.address], [j.address, address]]);
  const drive = pairs.length ? await driveMinutes(pairs, address) : () => 0;
  // Today: nothing earlier than now plus her buffer.
  const earliest = date === todayLocal() ? nowLocalMinutes() + settings.buffer : 0;
  const slots = [];
  for (let m = toMin(settings.firstStart); m <= toMin(settings.lastStart); m += SLOT_STEP) {
    if (m < earliest) continue;
    if (fitsDay(date, m, len, blocks, jobs, address, drive, settings.buffer)) slots.push(toTime(m));
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
      const services = (await getServices()).map((sv) => ({ ...sv, per: perLabel(sv), bookable: scheduleReady(settings, sv.id) }));
      // Whole days off only; partial blocks and other bookings come back per date from `slots`.
      const daysOff = [...new Set((await getBlocks()).filter((b) => !b.from).map((b) => b.date))];
      return ok({ today: todayLocal(), daysOff, services, priceNotes: await getPriceNotes() });
    }

    if (action === 'slots') {
      const date = str(input.date, 10);
      const serviceId = str(input.serviceId, 40);
      const address = str(input.address, 300);
      const dogs = Number.parseInt(input.dogs, 10) || 1;
      if (!isDate(date) || !(await getServices()).some((sv) => sv.id === serviceId)) return fail(400, 'Pick a service and date.');
      if (!address) return fail(400, 'Add your address in your profile first.');
      if (date < todayLocal()) return ok({ slots: [] });
      const settings = await getSettings();
      if (!scheduleReady(settings, serviceId)) return ok({ slots: [] });
      try {
        return ok({ slots: await openSlots(date, serviceId, settings, await getBlocks(), await allBookings(), { address, dogs }) });
      } catch (e) {
        if (e instanceof AddressNotFound) return fail(400, e.message);
        throw e;
      }
    }

    if (action === 'check-address') {
      if (await overLimit('addr', ipOf(req, context), 20, 60)) return fail(429, 'Too many tries. Please wait a bit.');
      const address = str(input.address, 300);
      if (!address) return fail(400, 'Enter your address.');
      try {
        const rows = await routeMatrix([address], [address]);
        if (rows[0]?.condition !== 'ROUTE_EXISTS') return fail(400, 'We could not find that address. Include street, town and ZIP.');
      } catch (e) {
        console.error('check-address failed', e.message);
      }
      return ok({ ok: true });
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
      const service = (await getServices()).find((s) => s.id === b.serviceId);
      if (!service) return fail(400, 'Pick a service.');
      const month = Number(b.date.slice(5, 7));
      if (service.months && !service.months.includes(month)) return fail(400, `${service.name} is not offered that month.`);
      const settings = await getSettings();
      if (!scheduleReady(settings, service.id)) return fail(409, `${service.name} is not open for booking yet.`);
      const blocks = await getBlocks();
      const taken = 'That time was just taken or is not available. Please pick another.';
      let open;
      try {
        open = await openSlots(b.date, service.id, settings, blocks, await allBookings(), { address: b.address, dogs: b.dogs });
      } catch (e) {
        if (e instanceof AddressNotFound) return fail(400, e.message);
        throw e;
      }
      if (!open.includes(b.time)) return fail(409, taken);

      const booking = {
        ...b,
        id: crypto.randomUUID(),
        serviceName: service.name,
        listCents: service.cents,
        frequency: service.frequency,
        durationMin: jobLength(settings, service.id, b.dogs),
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
      const otherJobs = jobsOn(others, settings, booking.date);
      const recheckDrive = otherJobs.length
        ? await driveMinutes(otherJobs.flatMap((j) => [[booking.address, j.address], [j.address, booking.address]]), booking.address)
        : () => 0;
      if (!fitsDay(booking.date, toMin(booking.time), booking.durationMin, blocks, otherJobs, booking.address, recheckDrive, settings.buffer)) {
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
        bookings: rows, blocks: await getBlocks(), today: todayLocal(), settings: await getSettings(), services: await getServices(), priceNotes: await getPriceNotes(), frequencies: FREQUENCIES,
        pushPhones: phones.length, pushLog,
      });
    }

    if (action === 'prices') {
      if (!Array.isArray(input.services) || !input.services.length || input.services.length > 40) return fail(400, 'Add at least one service.');
      const seen = new Set();
      const services = [];
      for (const raw of input.services) {
        const name = str(raw?.name, 80);
        const cents = Number(raw?.cents);
        const frequency = str(raw?.frequency, 20);
        if (!name) return fail(400, 'Every service needs a name.');
        if (!Number.isInteger(cents) || cents < 0 || cents > 1000000) return fail(400, `${name}: enter a price.`);
        if (!FREQUENCIES.includes(frequency)) return fail(400, `${name}: pick how often it repeats.`);
        let months = null;
        if (Array.isArray(raw?.months) && raw.months.length && raw.months.length < 12) {
          months = [...new Set(raw.months.map(Number))].filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).sort((a, b) => a - b);
          if (!months.length) months = null;
        }
        let id = str(raw?.id, 40);
        if (!/^[a-z0-9_-]{2,40}$/.test(id) || seen.has(id)) id = 'svc_' + crypto.randomBytes(5).toString('hex');
        seen.add(id);
        const sv = { id, name, cents, frequency };
        if (months) sv.months = months;
        const badge = str(raw?.badge, 30);
        if (badge) sv.badge = badge;
        services.push(sv);
      }
      const notes = Array.isArray(input.priceNotes)
        ? input.priceNotes.map((n) => str(n, 200)).filter(Boolean).slice(0, 10)
        : await getPriceNotes();
      await store().setJSON('services', services);
      await store().setJSON('pricenotes', notes);
      return ok({ services, priceNotes: notes });
    }

    if (action === 'settings') {
      const buffer = Number(input.buffer);
      const extraDogMin = Number(input.extraDogMin);
      const firstStart = str(input.firstStart, 5);
      const lastStart = str(input.lastStart, 5);
      if (!Number.isInteger(buffer) || buffer < 0 || buffer > 240) return fail(400, 'Buffer must be 0 to 240 minutes.');
      if (!Number.isInteger(extraDogMin) || extraDogMin < 0 || extraDogMin > 120) return fail(400, 'Extra time per dog must be 0 to 120 minutes.');
      if (!isTime(firstStart) || !isTime(lastStart) || firstStart > lastStart) return fail(400, 'Set the earliest start before the latest start.');
      const durations = {};
      for (const sv of await getServices()) {
        const v = input.durations?.[sv.id];
        if (v === '' || v === null || v === undefined) continue;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 5 || n > 600) return fail(400, `${sv.name}: length must be 5 to 600 minutes.`);
        durations[sv.id] = n;
      }
      await store().setJSON('settings', { buffer, extraDogMin, firstStart, lastStart, durations });
      return ok({ settings: await getSettings() });
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
