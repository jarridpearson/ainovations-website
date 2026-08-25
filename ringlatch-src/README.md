# Ringlatch

AI phone receptionist for small businesses in Central and Northern New York —
contractors, clinics, shops, salons, offices. Catches the calls they miss,
captures the lead, texts the owner.

**Onboarding is 100% remote.** Nobody goes on site. That makes the carrier
forwarding walkthrough the single highest-risk step in the whole product, which
is why it has its own module and its own tests.

**Never miss another job.**

## The other one rule

**The portal has one switch: on or off.** Everything else an owner might want
changed, they email about and it gets handled. Hours, services, FAQs, what
counts as urgent — those are set once during onboarding and almost never touched
again. A settings panel for them is a support surface, a bug surface, and a way
to let a client silently break their own account.

If a second switch ever looks necessary, the honest question is whether the
default is wrong.

## The one rule

There is exactly one agent template and one webhook. A client is a **JSON
profile plus a phone number** — nothing else. If onboarding a client ever
requires editing code in here, the design has been broken and the 60-minute
onboarding is gone with it.

## Layout

| Path                                                             | What it is                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `supabase/functions/_shared/ringlatch-src/profile.ts`                | The `ClientProfile` type and its validator                     |
| `supabase/functions/_shared/ringlatch-src/prompt.ts`                 | The single agent template, rendered per client                 |
| `supabase/functions/_shared/ringlatch-src/triage.ts`                 | Spam screening, business hours, urgency packs                  |
| `supabase/functions/_shared/ringlatch-src/notify.ts`                 | Owner SMS, owner email, caller text-back                       |
| `supabase/functions/_shared/ringlatch-src/forwarding.ts`             | Forwarding codes per line type, and the verification checklist |
| `supabase/functions/ringlatch-inbound/`                          | Runs at call START: applies the on/off switch and the caps     |
| `supabase/functions/ringlatch-call-webhook/`                     | The post-call pipeline Retell posts to                         |
| `supabase/functions/_shared/ringlatch-src/limits.ts`                 | Plans, caps, unit economics                                    |
| `supabase/migrations/20260821120000_create_ringlatch_schema.sql` | Tables, indexes, RLS                                           |
| `ringlatch-src/profiles/`                                            | Client profiles (the example one is fictional)                 |
| `ringlatch-src/simulate.ts`                                          | Runs whole calls locally, no accounts needed                   |
| `ringlatch-src/portal/index.html`                                    | The client portal. One switch. Keep it that way.               |
| `ringlatch-src/intake/index.html`                                    | Client intake form. Emits a profile + consent record.          |
| `ringlatch-src/LAUNCH.md`                                            | The ordered path to first dollar. Start here.                  |
| `ringlatch-src/setup-retell.ts`                                      | Emits the one agent config to paste into Retell                |
| `ringlatch-src/setup-stripe.sh`                                      | Creates the Stripe products and prices                         |

The core library lives under `supabase/functions/_shared/` for two reasons: the
Supabase CLI can only bundle what is inside `supabase/`, and that path is
already blocked from public serving in `_redirects`.

## Run it without any accounts

```bash
deno run --allow-read ringlatch-src/simulate.ts
```

Five calls across two different businesses — an after-hours no-heat emergency, a
routine quote, a four-second hang-up, an urgent dental call, and a robocall —
through the real triage and notification code. The only thing missing is the
network. Single scenario:

```bash
deno run --allow-read ringlatch-src/simulate.ts emergency   # routine | hangup | dental | spam
```

See the caps and what they do to margin:

```bash
deno run --allow-read ringlatch-src/simulate.ts --caps
```

Print the forwarding walkthrough to read down the phone:

```bash
deno run --allow-read ringlatch-src/simulate.ts --forwarding
```

Check a profile from the intake form before it ever takes a call:

```bash
deno run --allow-read ringlatch-src/simulate.ts --validate path/to/profile.json
```

See the actual prompt a client's agent runs on:

```bash
deno run --allow-read ringlatch-src/simulate.ts --prompt
```

Tests:

```bash
deno test --allow-read supabase/functions/_shared/ringlatch-src/
```

## Onboarding a client (~60 minutes)

1. Send the client `ringlatch-src/intake/index.html`. They fill it in ten minutes
   and it emits a profile plus a timestamped SMS consent record. Save the
   profile and run `--validate` on it — bad phone formats, backwards hours and a
   missing line type all fail loudly here rather than on a live call.
2. Clone the agent template in Retell, paste the rendered prompt (`--prompt`),
   assign the client's dedicated number. (~15 min)
3. Insert the client row in `ringlatch_clients` with the profile JSON and the
   dedicated number.
4. **Walk the owner through conditional call forwarding.** Carrier star codes,
   Verizon dominates up here. This is the step DIY tools lose customers on, and
   it is the whole moat. (~10 min)
5. Three test calls together: an FAQ, a lead capture, an emergency. (~10 min)
6. Stripe subscription link — setup fee plus first month. Live.

## Environment

The webhook needs these set on the Supabase project:

| Variable                                     | Purpose                               |
| -------------------------------------------- | ------------------------------------- |
| `RETELL_WEBHOOK_SECRET`                      | HMAC verification of inbound webhooks |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`   | Outbound SMS                          |
| `RESEND_API_KEY` / `RINGLATCH_EMAIL_FROM`    | Owner email summaries                 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Injected by the platform              |

## Design notes worth keeping

- **Idempotency.** Retell retries any non-2xx. `provider_call_id` is unique and
  checked before anything sends, so a retry can never double-text an owner.
  Failures deliberately return 500 so the retry happens.
- **Spam never bills.** Screening runs on the caller's first two utterances and
  sets `billable_seconds = 0`. A robocall must never eat a client's cap.

- **Caps degrade, they do not kill.** Past included minutes the agent drops to
  brief mode (name and number, 45s); past 1.5x it says one line and the caller
  gets a text-back instead. A client over their cap still gets every lead. The
  worst reachable margin is enforced by a test — if a pricing or cost change
  drops it below 60%, the suite fails.

- **The inbound webhook fails open.** If usage cannot be read, the caller gets
  the full agent. Losing a lead is worse than a few cents of minutes.
- **Only the caller is screened.** The agent's own words are excluded from the
  spam and urgency text, or the greeting would classify itself.
- **A partial lead beats a hang-up.** Every field on `CapturedLead` is nullable
  on purpose, and the owner still gets a text when all we have is a number.
- **Never promise dispatch.** The prompt forbids arrival times, firm prices and
  "someone is on the way", and routes any danger-to-life call to 911 first. This
  is the liability line — do not soften it to sound more helpful. It matters
  most in the clinic and veterinary verticals: the agent must never assess,
  advise on, or reassure about a medical situation.

- **Nothing is vertical-specific.** What counts as urgent comes from
  `URGENCY_PACKS` (`trades`, `clinic`, `auto`, `property`, `appointment`, plus a
  `general` pack applied to everyone) selected per profile, and the agent
  describes the business from `business_type`. Serving a new vertical means
  adding a pack, never editing a client's setup. A business with no genuine
  emergencies can set `urgency.enabled: false`.

## Landlines are not cell phones

Plenty of businesses up here still run a copper or cable line, and it behaves
differently in two ways that both silently lose calls:

- **A cell sets busy and no-answer with one code. A landline needs two** — `*90`
  for busy and `*92` for no answer. Setting only `*90` misses every call that
  simply rings out, which is nearly all of them, and everything looks fine until
  leads go missing.
- **A landline keypad has no `+` key.** Reading a `+1315…` number to someone on
  a landline is a guaranteed failed setup. `formatForDialing()` keys it as
  `1315…` for those lines.

The intake form has to capture line type, and the biggest landline gotcha is
billing, not technical: _Call Forward Busy Line / Don't Answer_ is frequently a
paid add-on that is **not** on basic service. Find that out during intake, not
while the owner is standing at the phone dialing codes that get rejected. A
rotary phone cannot dial star codes at all.

Verification has to test the busy case too, by taking the phone off the hook —
that is the half people forget to set.

## Carrier codes are unverified

The codes in `forwarding.ts` are transcribed from public carrier documentation
and **have not been dialed and confirmed**. They also vary between postpaid,
prepaid and reseller plans on the same network. Confirm each against the
carrier's current support page before using it on a live client, and fix the
file when reality disagrees. Getting this wrong on a remote onboarding means
either no forwarding at all, or unconditional forwarding that stops the owner's
own phone from ringing.

## Not built yet

- Deploying `/ai-receptionist.html` (built, routed, and not yet published).
- Stripe subscription wiring and NY sales tax registration.
- A2P 10DLC brand and campaign registration — **start this first, it takes days,
  and text-backs do not send without it.** Paste-ready pack:
  `ringlatch-src/docs/a2p-10dlc-submission.md`.
- The monthly "we caught N calls / X leads" report. Build at ~10 clients; it is
  the retention feature.
- The online signup form with the SMS consent checkbox. The A2P filing describes
  it, so it has to exist before that filing is submitted.
