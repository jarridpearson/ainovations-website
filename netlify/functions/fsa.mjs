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
//   hours        her hours by weekday (0 = Sunday ... 6 = Saturday):
//                { open: bool, firstStart: "HH:MM", lastStart: "HH:MM" }
//                firstStart/lastStart are the earliest and latest START times
//                offered that day. A closed day offers nothing. She sets these;
//                one-off days/times off are separate blocks.
//   dateHours    per-date changes to the weekly hours, keyed "YYYY-MM-DD":
//                { open: bool, firstStart, lastStart } — custom hours for that
//                date, or closed. Wins over the weekly hours for that date.
//
// So her schedule is: weekly hours -> date changes -> blocks (time ranges or
// whole days off) -> other bookings + drive time.

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
    hours: normalizeHours(saved),
    dateHours: (await store().get('datehours', { type: 'json' })) || {},
  };
}

async function getServices() {
  return (await store().get('services', { type: 'json' })) || DEFAULT_SERVICES;
}
async function getPriceNotes() {
  return (await store().get('pricenotes', { type: 'json' })) || DEFAULT_PRICE_NOTES;
}

function normalizeHours(saved) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const h = saved.hours?.[d];
    if (h) out[d] = { open: !!h.open, firstStart: isTime(h.firstStart) ? h.firstStart : null, lastStart: isTime(h.lastStart) ? h.lastStart : null };
    // Settings saved before hours went per-day: same window every day.
    else if (isTime(saved.firstStart) && isTime(saved.lastStart)) out[d] = { open: true, firstStart: saved.firstStart, lastStart: saved.lastStart };
    else out[d] = { open: false, firstStart: null, lastStart: null };
  }
  return out;
}

const weekdayOf = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
const dayHours = (settings, date) => {
  const h = settings.dateHours?.[date] || settings.hours[weekdayOf(date)];
  return h?.open && isTime(h.firstStart) && isTime(h.lastStart) ? h : null;
};
const closedWeekdays = (settings) => [0, 1, 2, 3, 4, 5, 6].filter((d) => {
  const h = settings.hours[d];
  return !(h?.open && isTime(h.firstStart) && isTime(h.lastStart));
});

function scheduleReady(settings, serviceId) {
  const anyDateOpen = Object.values(settings.dateHours || {}).some((h) => h.open);
  return (closedWeekdays(settings).length < 7 || anyDateOpen) && Number.isInteger(settings.durations?.[serviceId]);
}

const jobLength = (settings, serviceId, dogs) =>
  settings.durations[serviceId] + settings.extraDogMin * Math.max(0, (Number(dogs) || 1) - 1);

const RECURRING_DAYS = { weekly: 7, twice_weekly: 7, biweekly: 14 };
// Bookings carry the frequency they were booked with, so editing or deleting a
// service later never changes an existing customer's schedule.
const freqOf = (b) => b.frequency || (RECURRING_DAYS[b.serviceId] || b.serviceId === 'monthly' ? b.serviceId : 'one_time');

/** Does a repeating pattern anchored on `anchor` land on `date`? */
function patternHits(anchor, f, date) {
  if (date < anchor) return false;
  if (date === anchor) return true;
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(anchor + 'T00:00:00Z')) / 86400000);
  if (RECURRING_DAYS[f]) return days % RECURRING_DAYS[f] === 0;
  if (f === 'monthly') {
    // Same weekday, same week-of-month: the 2nd Tuesday stays the 2nd Tuesday.
    const a = new Date(anchor + 'T00:00:00Z');
    const d = new Date(date + 'T00:00:00Z');
    return a.getUTCDay() === d.getUTCDay() && Math.ceil(a.getUTCDate() / 7) === Math.ceil(d.getUTCDate() / 7);
  }
  return false;
}

/** The slots a booking holds on `date` before any moves: its regular day(s) and time(s). */
function naturalOn(b, date) {
  const f = freqOf(b);
  const out = [];
  if (f === 'one_time' ? date === b.date : patternHits(b.date, f, date)) out.push({ origDate: date, time: b.time });
  // Twice a week: the second weekly day has its own anchor and time.
  if (b.second && patternHits(b.second.date, 'weekly', date)) out.push({ origDate: date, time: b.second.time });
  return out;
}

// A visit moved by her or by the system is stored under moves["<bookingId>|<origDate>"]
// = { date, time, by }. The original slot is freed and the new one is held.
const moveKey = (id, origDate) => `${id}|${origDate}`;
async function getMoves() {
  return (await store().get('moves', { type: 'json' })) || {};
}
const saveMoves = (m) => store().setJSON('moves', m);

/** Every visit a booking actually has on `date`, after moves. */
function occurrences(b, date, moves) {
  const out = naturalOn(b, date).filter((o) => !moves[moveKey(b.id, o.origDate)]);
  for (const [k, m] of Object.entries(moves)) {
    const [id, origDate] = k.split('|');
    if (id === b.id && m.date === date) out.push({ origDate, time: m.time, moved: true, by: m.by });
  }
  return out;
}
const occursOn = (b, date, moves = {}) => occurrences(b, date, moves).length > 0;
// Cancelled bookings free their slots. On-hold ones keep them until she decides.
const holdsSlots = (b) => b.status !== 'cancelled';

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

/** The other appointments she has that day (recurring + moved ones included). */
function jobsOn(bookings, settings, date, moves = {}, ignore = null) {
  const jobs = [];
  for (const b of bookings) {
    if (!holdsSlots(b)) continue;
    if (ignore && ignore.id === b.id && !ignore.origDate) continue;
    for (const o of occurrences(b, date, moves)) {
      if (ignore && ignore.id === b.id && ignore.origDate === o.origDate) continue;
      const start = toMin(o.time);
      jobs.push({ start, end: start + (b.durationMin ?? settings.durations?.[b.serviceId] ?? 30), address: b.address });
    }
  }
  return jobs;
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

async function openSlots(date, serviceId, settings, blocks, bookings, { address, dogs, moves = {}, ignore = null, len = null, after = null }) {
  const hours = dayHours(settings, date);
  if (!hours) return []; // she's closed that day
  const jobLen = len ?? jobLength(settings, serviceId, dogs);
  const jobs = jobsOn(bookings, settings, date, moves, ignore);
  const pairs = jobs.flatMap((j) => [[address, j.address], [j.address, address]]);
  const drive = pairs.length ? await driveMinutes(pairs, address) : () => 0;
  // Today: nothing earlier than now plus her buffer.
  let earliest = date === todayLocal() ? nowLocalMinutes() + settings.buffer : 0;
  if (after) earliest = Math.max(earliest, toMin(after));
  const slots = [];
  for (let m = toMin(hours.firstStart); m <= toMin(hours.lastStart); m += SLOT_STEP) {
    if (m < earliest) continue;
    if (fitsDay(date, m, jobLen, blocks, jobs, address, drive, settings.buffer)) slots.push(toTime(m));
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

// --- payments & visits ---------------------------------------------------------
//
// His rules (2026-10-23):
//   one-time visits   charged in full the moment the customer links Venmo at booking
//   recurring plans   first visit charged when she marks it complete; every visit
//                     after that is charged automatically on its visit day
// Every visit of a recurring plan also lands on her calendar and in her email.

const isRecurring = (b) => freqOf(b) !== 'one_time';
const addDaysStr = (ymd, n) => {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const visitKey = (bookingId, date) => `visit/${bookingId}/${date}`;
async function getVisit(bookingId, date) {
  return (await store().get(visitKey(bookingId, date), { type: 'json' })) || { bookingId, date, status: 'scheduled' };
}
const saveVisit = (v) => store().setJSON(visitKey(v.bookingId, v.date), v);

/** Charge the booking's saved Venmo for one visit. Records the result either way. */
async function chargeVisit(b, cents, visitDate, reason) {
  const paymentId = crypto.randomUUID();
  const at = new Date().toISOString();
  try {
    const data = await bt(
      `mutation C($input: ChargePaymentMethodInput!) {
         chargePaymentMethod(input: $input) { transaction { id status } }
       }`,
      { input: { paymentMethodId: b.venmo.token, transaction: { amount: centsToAmount(cents), orderId: paymentId } } },
    );
    const t = data.chargePaymentMethod.transaction;
    const pay = { id: paymentId, kind: 'venmo', cents, at, visitDate, reason, transactionId: t.id, status: t.status };
    b.payments.push(pay);
    await saveBooking(b);
    return { ok: true, pay };
  } catch (e) {
    const pay = { id: paymentId, kind: 'venmo', cents, at, visitDate, reason, status: 'FAILED', error: e.message };
    b.payments.push(pay);
    await saveBooking(b);
    return { ok: false, pay, error: e.message };
  }
}
const visitPaid = (b, date) => b.payments.some((p) => p.visitDate === date && p.status !== 'FAILED');

async function emailOwner(subject, lines) {
  if (!RESEND_API_KEY || !BOOKING_TO) {
    console.error('owner email skipped: RESEND_API_KEY or FSA_BOOKING_TO not set');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: BOOKING_FROM, to: BOOKING_TO.split(',').map((x) => x.trim()).filter(Boolean), subject, text: lines.join('\n') }),
    });
    if (!res.ok) console.error('owner email failed', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('owner email failed', e.message);
    return false;
  }
}

/** Everything on her calendar for one date, after moves. */
async function dayEntries(bookings, date, moves) {
  const out = [];
  for (const b of bookings) {
    if (!holdsSlots(b)) continue;
    for (const o of occurrences(b, date, moves)) {
      const v = await getVisit(b.id, o.origDate);
      out.push({
        bookingId: b.id, origDate: o.origDate, date, time: o.time, moved: !!o.moved, movedBy: o.by || null,
        name: b.name, phone: b.phone, email: b.email, address: b.address, notes: b.notes,
        serviceName: b.serviceName, dogs: b.dogs, recurring: isRecurring(b), status: b.status, cents: b.listCents,
        visitStatus: v.status, paid: visitPaid(b, o.origDate), venmo: !!b.venmo,
      });
    }
  }
  return out.sort((a, c) => (a.time < c.time ? -1 : 1));
}

async function emailCustomer(b, subject, lines) {
  if (!RESEND_API_KEY || !b.email) {
    console.error('customer email skipped: no RESEND_API_KEY or customer email', b.id);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: BOOKING_FROM, to: [b.email], reply_to: BOOKING_TO ? BOOKING_TO.split(',')[0].trim() : undefined,
        subject, text: lines.join('\n'),
      }),
    });
    if (!res.ok) console.error('customer email failed', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('customer email failed', e.message);
    return false;
  }
}

const niceDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const niceTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

async function notifyMoved(b, fromDate, fromTime, to, why) {
  return emailCustomer(b, `Your ${b.serviceName} visit has moved to ${niceDate(to.date)} at ${niceTime(to.time)}`, [
    `Hi ${b.name},`, '',
    `Your visit on ${niceDate(fromDate)} at ${niceTime(fromTime)} has moved to:`, '',
    `   ${niceDate(to.date)} at ${niceTime(to.time)}`, '',
    why, '',
    'Nothing else changes. Reply to this email with any questions.',
  ]);
}

/** Is this slot inside her hours and clear of her blocks? (Other bookings don't matter here.) */
function slotStillOpen(settings, blocks, date, time, len) {
  const hours = dayHours(settings, date);
  if (!hours) return false;
  const s = toMin(time);
  if (s < toMin(hours.firstStart) || s > toMin(hours.lastStart)) return false;
  return fitsDay(date, s, len, blocks, [], '', () => 0, 0);
}

const AUTO_MOVE_DAYS = 21;
const SEARCH_DAYS = 30;

/**
 * Any visit in the next three weeks that now falls on a closed day or a blocked
 * time is moved to the next available slot (later that day, else the next open
 * day), and the customer is emailed. Runs every morning and whenever she
 * changes her hours or blocks time.
 */
async function autoMoveAll() {
  const today = todayLocal();
  const settings = await getSettings();
  const blocks = await getBlocks();
  const bookings = await allBookings();
  const moves = await getMoves();
  let moved = 0;
  for (let i = 0; i <= AUTO_MOVE_DAYS; i++) {
    const date = addDaysStr(today, i);
    for (const b of bookings) {
      if (!holdsSlots(b)) continue;
      for (const o of occurrences(b, date, moves)) {
        // A visit she placed herself stays exactly where she put it.
        if (o.moved && o.by === 'owner') continue;
        const len = b.durationMin ?? jobLength(settings, b.serviceId, b.dogs);
        if (slotStillOpen(settings, blocks, date, o.time, len)) continue;
        if (visitPaid(b, o.origDate) && date < today) continue;
        let target = null;
        for (let k = 0; k <= SEARCH_DAYS && !target; k++) {
          const d = addDaysStr(date, k);
          const slots = await openSlots(d, b.serviceId, settings, blocks, bookings, {
            address: b.address, dogs: b.dogs, moves, ignore: { id: b.id, origDate: o.origDate }, len, after: k === 0 ? o.time : null,
          });
          if (slots.length) target = { date: d, time: slots[0] };
        }
        if (!target) { console.error('auto-move: no slot found', b.id, o.origDate); continue; }
        moves[moveKey(b.id, o.origDate)] = { ...target, by: 'auto', at: new Date().toISOString() };
        await saveMoves(moves);
        await notifyMoved(b, date, o.time, target,
          'That time became unavailable, so your visit was moved to the next available time, as our booking terms explain.');
        moved++;
      }
    }
  }
  return moved;
}

async function holdForPayment(b, date, error) {
  b.status = 'on-hold';
  b.holdReason = `Payment failed for the ${date} visit: ${error}`;
  await saveBooking(b);
  await emailOwner(`Payment failed: ${b.name}, ${b.serviceName}`, [
    `The Venmo payment for ${b.name}'s ${date} visit did not go through.`, '',
    `Reason:    ${error}`, '',
    `Name:      ${b.name}`, `Phone:     ${b.phone}`, `Email:     ${b.email}`, `Address:   ${b.address}`, '',
    'Their plan is ON HOLD: their slot is still held, but no more automatic charges will run.',
    `Check with them, then resume or end the plan on your page: ${SITE}/fsa/`,
  ]);
}

/** Every morning: move anything that no longer fits, then charge today's repeat visits. */
async function morningRun() {
  const moved = await autoMoveAll();
  const today = todayLocal();
  const moves = await getMoves();
  const report = { moved, charged: 0, failed: 0 };
  if (!btConfigured()) return report;
  for (const b of await allBookings()) {
    if (b.status === 'cancelled' || b.status === 'on-hold' || !isRecurring(b) || !b.venmo) continue;
    for (const o of occurrences(b, today, moves)) {
      // The first visit is charged when she marks it complete; every one after that today, automatically.
      if (o.origDate === b.date || visitPaid(b, o.origDate)) continue;
      const r = await chargeVisit(b, b.listCents, o.origDate, 'recurring auto-charge');
      if (r.ok) report.charged++;
      else { report.failed++; await holdForPayment(b, o.origDate, r.error); break; }
    }
  }
  return report;
}

/** Every evening: one email to her with tomorrow's visits. */
async function eveningDigest() {
  const tomorrow = addDaysStr(todayLocal(), 1);
  const entries = await dayEntries(await allBookings(), tomorrow, await getMoves());
  const lines = entries.length
    ? entries.flatMap((e, i) => [
      `${i + 1}. ${niceTime(e.time)}  ${e.name}${e.status === 'on-hold' ? '  (ON HOLD)' : ''}${e.moved ? '  (moved)' : ''}`,
      `   ${e.address}`,
      `   ${e.phone} · ${e.serviceName} · ${e.dogs} dog${e.dogs === 1 ? '' : 's'}`,
      ...(e.notes ? [`   Notes: ${e.notes}`] : []),
      '',
    ])
    : ['No visits tomorrow.', ''];
  await emailOwner(`Tomorrow, ${niceDate(tomorrow)}: ${entries.length} visit${entries.length === 1 ? '' : 's'}`,
    [`Your visits for ${niceDate(tomorrow)}:`, '', ...lines, `Calendar: ${SITE}/fsa/`]);
  return { visits: entries.length };
}

// --- handler ----------------------------------------------------------------// --- handler ----------------------------------------------------------------

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
      const dh = settings.dateHours || {};
      const daysOff = [...new Set([
        ...(await getBlocks()).filter((b) => !b.from).map((b) => b.date),
        ...Object.keys(dh).filter((d) => !dh[d].open),
      ])];
      const openDates = Object.keys(dh).filter((d) => dh[d].open);
      return ok({ today: todayLocal(), daysOff, openDates, closedWeekdays: closedWeekdays(settings), services, priceNotes: await getPriceNotes() });
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
        return ok({ slots: await openSlots(date, serviceId, settings, await getBlocks(), await allBookings(), { address, dogs, moves: await getMoves() }) });
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
      if (!b.name || !b.phone || !b.address || !b.email) return fail(400, 'Name, email, phone and address are required.');
      if (!Number.isInteger(b.dogs) || b.dogs < 1 || b.dogs > 20) return fail(400, 'Enter how many dogs.');
      if (!isDate(b.date) || !isTime(b.time)) return fail(400, 'Pick a date and time.');
      if (b.date < todayLocal()) return fail(400, 'That date has passed.');
      const service = (await getServices()).find((x) => x.id === b.serviceId);
      if (!service) return fail(400, 'Pick a service.');
      const month = Number(b.date.slice(5, 7));
      if (service.months && !service.months.includes(month)) return fail(400, `${service.name} is not offered that month.`);

      // Twice a week: a second weekday with its own time, within the same week.
      let second = null;
      if (service.frequency === 'twice_weekly') {
        const d2 = str(input.second?.date, 10);
        const t2 = str(input.second?.time, 5);
        if (!isDate(d2) || !isTime(t2)) return fail(400, 'Pick your second day and time.');
        const gap = Math.round((Date.parse(d2) - Date.parse(b.date)) / 86400000);
        if (gap < 1 || gap > 6) return fail(400, 'Pick a second day within the same week as the first.');
        second = { date: d2, time: t2 };
      }

      const settings = await getSettings();
      if (!scheduleReady(settings, service.id)) return fail(409, `${service.name} is not open for booking yet.`);
      const blocks = await getBlocks();
      const moves = await getMoves();
      const all = await allBookings();
      const taken = 'That time was just taken or is not available. Please pick another.';
      const len = jobLength(settings, service.id, b.dogs);
      try {
        const open1 = await openSlots(b.date, service.id, settings, blocks, all, { address: b.address, dogs: b.dogs, moves });
        if (!open1.includes(b.time)) return fail(409, taken);
        if (second) {
          const open2 = await openSlots(second.date, service.id, settings, blocks, all, { address: b.address, dogs: b.dogs, moves });
          if (!open2.includes(second.time)) return fail(409, 'Your second day and time was just taken or is not available. Please pick another.');
        }
        // A regular slot is held every week, so it must not collide with anyone already
        // booked in the coming weeks. (Her future time off is handled by auto-moving.)
        if (service.frequency !== 'one_time') {
          const draft = { id: '_new', date: b.date, time: b.time, frequency: service.frequency, second };
          for (let k = 1; k <= 56; k++) {
            const d = addDaysStr(b.date, k);
            for (const o of naturalOn(draft, d)) {
              const jobs = jobsOn(all, settings, d, moves);
              if (!jobs.length) continue;
              const drive = await driveMinutes(jobs.flatMap((j) => [[b.address, j.address], [j.address, b.address]]), b.address);
              if (!fitsDay(d, toMin(o.time), len, [], jobs, b.address, drive, settings.buffer)) {
                return fail(409, `That regular time is already taken on ${niceDate(d)}. Please pick another time.`);
              }
            }
          }
        }
      } catch (e) {
        if (e instanceof AddressNotFound) return fail(400, e.message);
        throw e;
      }

      const booking = {
        ...b,
        second,
        id: crypto.randomUUID(),
        serviceName: service.name,
        listCents: service.cents,
        frequency: service.frequency,
        durationMin: len,
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
      for (const o of [{ date: booking.date, time: booking.time }, ...(second ? [second] : [])]) {
        const otherJobs = jobsOn(others, settings, o.date, moves);
        const recheckDrive = otherJobs.length
          ? await driveMinutes(otherJobs.flatMap((j) => [[booking.address, j.address], [j.address, booking.address]]), booking.address)
          : () => 0;
        if (!fitsDay(o.date, toMin(o.time), booking.durationMin, blocks, otherJobs, booking.address, recheckDrive, settings.buffer)) {
          await store().delete(`booking/${booking.id}`);
          return fail(409, taken);
        }
      }

      const emailed = await emailBooking(booking);
      if (!emailed) console.error('booking saved but not emailed', booking.id);
      return ok({
        ok: true,
        id: booking.id,
        secret: booking.paySecret,
        recurring: isRecurring(booking),
        cents: booking.listCents,
        payUrl: `${SITE}/fsa-pay/?b=${booking.id}&t=${booking.paySecret}`,
      });
    }

    if (action === 'my-bookings') {
      const items = Array.isArray(input.items) ? input.items.slice(0, 20) : [];
      const moves = await getMoves();
      const today = todayLocal();
      const out = [];
      for (const it of items) {
        const b = await bookingForPayer(it?.id, it?.secret);
        if (!b) continue;
        const next = [];
        for (let i = 0; i <= 62 && next.length < 3; i++) {
          const d = addDaysStr(today, i);
          if (b.status === 'cancelled') break;
          for (const o of occurrences(b, d, moves)) next.push({ date: d, time: o.time, moved: !!o.moved });
        }
        out.push({ id: b.id, serviceName: b.serviceName, status: b.status, recurring: isRecurring(b), next, venmo: !!b.venmo });
      }
      return ok({ bookings: out });
    }

    if (action === 'customer-cancel') {
      const b = await bookingForPayer(input.id, input.secret);
      if (!b) return fail(404, 'Booking not found.');
      if (b.status !== 'cancelled') {
        b.status = 'cancelled';
        b.cancelledAt = new Date().toISOString();
        b.cancelledBy = 'customer';
        await saveBooking(b);
        await emailOwner(`Cancelled: ${b.name}, ${b.serviceName}`, [
          `${b.name} cancelled their ${isRecurring(b) ? 'regular plan' : 'visit'} in the app.`, '',
          `Service:   ${b.serviceName}`, `Was:       ${niceDate(b.date)} at ${niceTime(b.time)}${b.second ? ` and ${niceTime(b.second.time)} on their second day` : ''}`, '',
          `Name:      ${b.name}`, `Phone:     ${b.phone}`, `Address:   ${b.address}`, '',
          'Their slot is free again. No need to go.',
        ]);
      }
      return ok({ ok: true });
    }

    if (action === 'pay-info') {
      const b = await bookingForPayer(input.id, input.secret);
      if (!b) return fail(404, 'Booking not found.');
      return ok({
        name: b.name, serviceName: b.serviceName, date: b.date, linked: !!b.venmo, ready: btConfigured(),
        recurring: isRecurring(b), cents: b.listCents, paid: visitPaid(b, b.date),
      });
    }

    if (action === 'client-token') {
      const b = await bookingForPayer(input.id, input.secret);
      if (!b) return fail(404, 'Booking not found.');
      if (!btConfigured()) return fail(503, 'Venmo is not set up yet.');
      const data = await bt(
        'mutation T($input: CreateClientTokenInput) { createClientToken(input: $input) { clientToken } }',
        { input: {} },
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
      // One-time visits are paid at booking. Recurring plans are charged per visit.
      if (!isRecurring(b) && !visitPaid(b, b.date)) {
        const r = await chargeVisit(b, b.listCents, b.date, 'paid at booking');
        if (!r.ok) return fail(402, `Venmo is linked, but the payment did not go through: ${r.error}`);
        return ok({ ok: true, username: pm.details.username, charged: b.listCents, recurring: false });
      }
      return ok({ ok: true, username: pm.details.username, recurring: true });
    }

    if (action === 'push-register') {
      if (await overLimit('push', ipOf(req, context), 20, 60)) return fail(429, 'Too many requests.');
      const token = str(input.token, 200);
      if (!PUSH_TOKEN_RE.test(token)) return fail(400, 'bad token');
      await store().setJSON(pushKey(token), { token, at: new Date().toISOString() });
      return ok({ ok: true });
    }

    if (action === 'daily-run') {
      const key = req.headers.get('x-fsa-cron') || '';
      if (!SESSION_SECRET || key.length !== SESSION_SECRET.length
        || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(SESSION_SECRET))) return fail(401, 'no');
      return ok(input.kind === 'evening' ? await eveningDigest() : await morningRun());
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
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const hours = {};
      for (let d = 0; d < 7; d++) {
        const h = input.hours?.[d] || {};
        const open = !!h.open;
        const firstStart = str(h.firstStart, 5) || null;
        const lastStart = str(h.lastStart, 5) || null;
        if (open && (!isTime(firstStart) || !isTime(lastStart) || firstStart > lastStart)) {
          return fail(400, `${names[d]}: set the earliest start before the latest start.`);
        }
        hours[d] = { open, firstStart, lastStart };
      }
      if (!Number.isInteger(buffer) || buffer < 0 || buffer > 240) return fail(400, 'Buffer must be 0 to 240 minutes.');
      if (!Number.isInteger(extraDogMin) || extraDogMin < 0 || extraDogMin > 120) return fail(400, 'Extra time per dog must be 0 to 120 minutes.');
      const durations = {};
      for (const sv of await getServices()) {
        const v = input.durations?.[sv.id];
        if (v === '' || v === null || v === undefined) continue;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 5 || n > 600) return fail(400, `${sv.name}: length must be 5 to 600 minutes.`);
        durations[sv.id] = n;
      }
      await store().setJSON('settings', { buffer, extraDogMin, hours, durations });
      const moved = await autoMoveAll();
      return ok({ settings: await getSettings(), moved });
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
      const moved = await autoMoveAll();
      return ok({ blocks, moved });
    }

    if (action === 'date-hours') {
      const date = str(input.date, 10);
      if (!isDate(date)) return fail(400, 'Pick a date.');
      const open = !!input.open;
      const firstStart = open ? str(input.firstStart, 5) : null;
      const lastStart = open ? str(input.lastStart, 5) : null;
      if (open && (!isTime(firstStart) || !isTime(lastStart) || firstStart > lastStart)) return fail(400, 'Set the earliest start before the latest start.');
      const dh = (await store().get('datehours', { type: 'json' })) || {};
      dh[date] = { open, firstStart, lastStart, note: str(input.note, 120) };
      // Drop past dates so this never grows forever.
      for (const d of Object.keys(dh)) if (d < todayLocal()) delete dh[d];
      await store().setJSON('datehours', dh);
      const moved = await autoMoveAll();
      return ok({ dateHours: dh, moved });
    }

    if (action === 'date-hours-clear') {
      const dh = (await store().get('datehours', { type: 'json' })) || {};
      delete dh[str(input.date, 10)];
      await store().setJSON('datehours', dh);
      return ok({ dateHours: dh });
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
              transaction: { amount: centsToAmount(cents), orderId: paymentId },
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

    if (action === 'calendar') {
      const from = str(input.from, 10);
      const to = str(input.to, 10);
      if (!isDate(from) || !isDate(to) || to < from) return fail(400, 'bad range');
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
      if (days > 62) return fail(400, 'range too long');
      const bookings = await allBookings();
      const moves = await getMoves();
      const out = {};
      for (let i = 0; i <= days; i++) {
        const d = addDaysStr(from, i);
        const e = await dayEntries(bookings, d, moves);
        if (e.length) out[d] = e;
      }
      return ok({ days: out, today: todayLocal() });
    }

    if (action === 'visit-complete') {
      const b = await getBooking(input.id);
      const origDate = str(input.origDate, 10);
      if (!b || !isDate(origDate)) return fail(404, 'Visit not found.');
      const v = await getVisit(b.id, origDate);
      v.status = 'completed';
      v.completedAt = new Date().toISOString();
      await saveVisit(v);
      // The first visit of a regular plan is charged when she marks it complete.
      let charge = null;
      if (isRecurring(b) && origDate === b.date && b.venmo && btConfigured() && !visitPaid(b, origDate) && b.status !== 'on-hold') {
        charge = await chargeVisit(b, b.listCents, origDate, 'first visit, on completion');
        if (!charge.ok) await holdForPayment(b, origDate, charge.error);
      }
      return ok({ visit: v, charged: charge?.ok || false, chargeError: charge && !charge.ok ? charge.error : null });
    }

    // She can move any visit anywhere. The customer is always emailed.
    if (action === 'move-visit') {
      const b = await getBooking(input.id);
      const origDate = str(input.origDate, 10);
      const date = str(input.date, 10);
      const time = str(input.time, 5);
      if (!b || !isDate(origDate) || !isDate(date) || !isTime(time)) return fail(400, 'Pick a new date and time.');
      const moves = await getMoves();
      const key = moveKey(b.id, origDate);
      const fromNow = moves[key] || naturalOn(b, origDate)[0];
      if (!fromNow) return fail(404, 'Visit not found.');
      const fromDate = moves[key]?.date || origDate;
      const fromTime = fromNow.time;
      const natural = naturalOn(b, origDate)[0];
      if (natural && natural.time === time && origDate === date) delete moves[key];
      else moves[key] = { date, time, by: 'owner', at: new Date().toISOString() };
      await saveMoves(moves);
      const emailed = await notifyMoved(b, fromDate, fromTime, { date, time }, 'We needed to adjust the schedule.');
      return ok({ ok: true, emailed });
    }

    // Change a regular plan's day and/or time from now on.
    if (action === 'change-plan') {
      const b = await getBooking(input.id);
      const date = str(input.date, 10);
      const time = str(input.time, 5);
      if (!b || !isDate(date) || !isTime(time)) return fail(400, 'Pick the new first date and time.');
      const was = `${niceDate(b.date)} at ${niceTime(b.time)}`;
      b.planHistory = [...(b.planHistory || []), { date: b.date, time: b.time, second: b.second, changedAt: new Date().toISOString() }];
      b.date = date;
      b.time = time;
      if (b.second && isDate(str(input.secondDate, 10)) && isTime(str(input.secondTime, 5))) {
        b.second = { date: str(input.secondDate, 10), time: str(input.secondTime, 5) };
      }
      await saveBooking(b);
      // Clear moves for visits from the new start date on; the new pattern replaces them.
      const moves = await getMoves();
      for (const k of Object.keys(moves)) if (k.startsWith(b.id + '|') && k.split('|')[1] >= date) delete moves[k];
      await saveMoves(moves);
      const emailed = await emailCustomer(b, `Your regular ${b.serviceName} time has changed`, [
        `Hi ${b.name},`, '',
        `Your regular visits (previously ${was}) now start ${niceDate(date)} at ${niceTime(time)}${b.second ? `, plus ${niceDate(b.second.date)} at ${niceTime(b.second.time)}` : ''}, and repeat on that schedule.`, '',
        'Reply to this email with any questions.',
      ]);
      return ok({ ok: true, emailed });
    }

    if (action === 'mark-paid') {
      const b = await getBooking(input.id);
      if (!b) return fail(404, 'Booking not found.');
      const cents = Number(input.cents);
      if (!Number.isInteger(cents) || cents < 1 || cents > 100000) return fail(400, 'Enter the amount received.');
      const visitDate = isDate(str(input.date, 10)) ? str(input.date, 10) : undefined;
      b.payments.push({ id: crypto.randomUUID(), kind: 'cash', cents, at: new Date().toISOString(), visitDate, status: 'PAID' });
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
      if (!['new', 'confirmed', 'cancelled', 'on-hold'].includes(input.status)) return fail(400, 'bad status');
      b.status = input.status;
      if (input.status !== 'on-hold') delete b.holdReason;
      await saveBooking(b);
      return ok({ booking: ownerView(b) });
    }

    return fail(400, 'unknown action');
  } catch (e) {
    console.error('fsa error', action, e);
    return fail(500, 'Something went wrong. Please try again.');
  }
};
