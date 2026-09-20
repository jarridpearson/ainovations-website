---
name: outbound
description: Run AInovations outbound sales prospecting — find CNY businesses with no website, qualify them, capture evidence, draft personalized email, and stage it in a review queue for Jarrid to approve. Use when asked to do outbound, prospecting, lead gen, or "find customers" for Rent-a-Site / Chalkline.
---

# AInovations outbound prospecting

Goal: fill the **first 20 Rent-a-Site clients** (Hero Program — 50% off any plan, from $100/mo,
no setup fee, the rate held for as long as they stay subscribed)
and feed Chalkline ($20/mo base) from the same pool.

**I research, qualify, evidence and draft. Jarrid approves and sends. I never send cold mail
myself.** Two reasons: outbound messages need his explicit go-ahead, and cold volume from
`ainovations.net` would damage the deliverability of his real M365 inbox.

## Ideal customer (in priority order)

**Lead with the five trades that have their own landing page** — a prospect who gets a link to a
page written about his exact trade converts far better than one sent to the generic offer:

| Vertical | Trades | Send them to |
|---|---|---|
| Ground services | septic pumping, excavating, dumpsters, porta-potties, fence | `/site-services` |
| Collision | body shops, collision repair, towing & impound | `/auto-body` |
| Well & water | well drilling, pump service, water testing, treatment | `/well-water` |
| Marine | marinas, boatyards, boat storage, boat repair | `/marinas` |
| Rental yards | equipment rental, tool rental, dealers who also rent | `/rental-yards` |

**THE RULE THAT MAKES THESE CONVERT: never pitch "more customers."** Every one of these trades is
booked solid and proud of it — "why would I want more calls?" is the first thing they say. Sell
(a) taking repeated phone calls off them and (b) capturing the money they already lose to whoever
answered first. Never concede that a website might not be a priority for them.

Then, secondarily: **CNY trades & contractors** — framing, siding, roofing, remodeling, decking,
GC, concrete, HVAC, plumbing, electrical. Small residential crews ~2-10 people. These are
dual-purpose: Rent-a-Site AND Chalkline prospects.

Geography: Syracuse metro, Watertown, Fort Drum, Lewis County / Tug Hill.
(Same service areas as the Google Business Profile.)

**Do NOT prospect these** — researched and ruled out: campgrounds and RV parks (Campspot gives
them a free site funded by booking fees), solo one- or two-person small-engine repair shops (can't
carry a monthly fee, and Facebook genuinely covers them), funeral homes, orchards and farm stands,
large-animal vets, farriers, bulk maple producers, and OEM-subsidized equipment dealers (approach
those only about their rental side).
3. **The qualifying signal is an EMPTY `websiteUri` field**, or a website that is:
   - dead / parked / 404
   - Facebook-page-only (this is the strongest hook — see Part 4 of the Honest Guide,
     "Your Facebook page is a trap")
   - visibly broken on mobile
   - last updated years ago / placeholder text still on the page

## Hard rules — never violate

- **NEVER contact anyone with any PuzzleHR association.** Vet work history before adding to the
  list. This is absolute (see `no-puzzlehr-invites` memory).
- **NEVER use Jarrid's personal LinkedIn profile** for anything.
- **Never invent pricing, and never do arithmetic on a price.** Source of truth is
  `netlify/functions/kb.mjs` — read it before quoting anything. Rent-a-Site has THREE plans and
  each has THREE numbers that are never interchangeable:

  | Plan | 1-year | 3-year | Hero (first 20) |
  |---|---|---|---|
  | Presence | $200/mo | $170/mo | **$100/mo** |
  | Growth | $400/mo | $340/mo | **$200/mo** |
  | Commerce | $700/mo | $595/mo | **$350/mo** |

  The Hero price is ALREADY the 50%-off figure — never halve it again, never present it as the
  list rate, and there is no separate Hero price for a 3-year term. No setup fee on any plan,
  ever. The lock is **"for as long as you stay subscribed"** — never "for life" or "forever".
  It is a 1-year or 3-year term, **not month-to-month**; if asked what leaving early costs, say
  you don't have that and point to support@ainovations.net.
  Also real: +$50/mo AI Chat Agent on Presence only (included in Growth/Commerce).
  Chalkline $20/mo base, +$10 full seat, +$3 crew seat. Rent-an-App Presence $299 / Mid $699 /
  Pro $1,299 (1-yr), setup $500/$1,000/$2,000 waived on 3-yr; Founding Five $149/$349/$649.
- **Never promise Google rankings.** Nobody honestly can. This is a core brand position.
- **Never say a competitor is greedy** or frame standard processing rates as gouging.
- American spelling only.
- No public phone number exists for AInovations — don't invent one. Contact is jp@ainovations.net.

## Cost ceiling — Jarrid's rule: THIS MUST STAY FREE

Verified against Google's live price list, 14 Sep 2026. The old $200/month Maps credit
**expired 28 Feb 2025** — free usage caps are the only cushion now.

- `websiteUri` is a **Pro** field, and Google bills **at the highest SKU any requested
  field touches**. So every qualifying call lands on Pro pricing, not Essentials.
- **Places API Text Search Pro**: 5,000 free/month, then **$32 per 1,000**.
- **Places API Place Details Pro**: 5,000 free/month, then **$17 per 1,000**.
- Free caps are **per billing account, not per project** — they are shared with
  Everward Play Billing, Reef Tank Copilot and My First Project. Another project
  consuming Places SKUs eats the same 5,000.

**Hard rules:**
1. Keep total Pro calls **under 5,000/month**. A 200-400 prospect run is ~1,000 — fine.
2. The API **quota limit** is the real enforcement: set requests/day so the monthly
   total cannot reach the cap. Excess calls then **fail instead of billing**.
3. Never request Pro fields you do not need. Ask for the minimum field mask.
4. Text Search **IDs Only** and Place Details **IDs Only** are **unlimited free** — use
   them for any pass that does not need `websiteUri`.
5. If a run would exceed the cap, **stop and tell Jarrid**. Do not spend without asking.

## The prospecting script

`~/Projects/ainovations-sales/prospect.py` does steps 1-3 of the pipeline below.

```
export PLACES_API_KEY='...'                       # never committed
python3 prospect.py --plan all --dry-run          # show the query plan, spend nothing
python3 prospect.py --plan ground --limit-searches 40
```

`--plan` is one of `ground`, `autobody`, `well`, `marina`, `rental`, or `all`. It uses Text Search
ONLY (Place Details is never called), tracks its own daily spend in `.prospect-state.json`, and
refuses to exceed 150 searches/day — matching the Google Cloud quota, so it cannot silently bill.
Each search returns up to 20 businesses. Website probing is plain HTTP and costs nothing.

Output is `runs/prospects-<plan>-<stamp>.json` with three buckets: **prime** (no website, social
only, dead domain, parked, broken cert, near-empty, or no mobile setting), **maybe** (unreachable),
and **dropped** (a genuinely good site — we do not pitch these). Insert prime rows into
`public.prospects` via the Supabase MCP tool, so no service-role key is needed locally.

## Research pipeline

1. **Source**: Google Places API (Text Search / Nearby Search). Query by trade + town.
   Request the `websiteUri` field. Businesses returning **no** `websiteUri` are the primary list.
   Prefer the API over browser scraping — browser automation is expensive and slow.
   Use a minimal field mask; every extra Pro field costs the same call more.
2. **Qualify**: for each candidate, confirm the gap is real. If a site exists, load it and judge:
   dead? parked? mobile-broken? placeholder? If it's a genuinely good site, **drop the prospect** —
   do not pitch someone who doesn't need it. Honesty is the brand.
3. **Evidence**: capture one concrete, specific observation ("your Google listing has no website
   link", "the site 404s", "it's a Facebook page"). This line is what makes the email land.
4. **Stage**: insert into `public.prospects` with status `staged`.
5. **Never bulk-insert unqualified rows.** A short verified list beats a long unverified one.

## Email drafting

Tone: plain, specific, honest, short. The Honest Guide voice — no hype, no fake urgency,
no "I was just browsing your website and was blown away."

Structure:
- One line naming the **specific** thing you observed about *their* business.
- One line on what it costs them (a customer who looked at 9PM and found nothing).
- The offer in one sentence: a managed site built and run for them, from $100/month on the Hero
  Program (half off, first 20 clients, held for as long as they stay subscribed), no setup fee.
  Quote the plan that actually fits — most of these trades want Growth, which is $200/mo on the
  Hero Program, not $100. Do not undersell the plan to make the number look smaller.
- One low-friction ask ("want me to send a mockup?" beats "book a call").
- Signature: Jarrid, AInovations, ainovations.net.

Never send the same body twice. The observation line must be unique per prospect.

## Review queue

Present staged prospects as a compact table: business, town, trade, the gap, the draft.
Jarrid approves, edits, or kills each. Only approved rows move to `approved`, then `sent`
once he confirms the send.

## Follow-ups

Two, maximum. +4 days, +11 days. Shorter each time. Stop permanently on any reply,
on an unsubscribe request, or after the second follow-up. Mark `status='closed'` and never
re-add that business.

## Compliance

Cold email must include a real physical mailing address and a working opt-out. Sending domain
is a **separate** lookalike domain (not ainovations.net), warmed 2-3 weeks before volume,
with SPF/DKIM/DMARC configured in Resend.
