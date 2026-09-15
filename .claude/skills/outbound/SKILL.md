---
name: outbound
description: Run AInovations outbound sales prospecting — find CNY businesses with no website, qualify them, capture evidence, draft personalized email, and stage it in a review queue for Jarrid to approve. Use when asked to do outbound, prospecting, lead gen, or "find customers" for Rent-a-Site / Chalkline.
---

# AInovations outbound prospecting

Goal: fill the **first 20 Rent-a-Site clients** ($100/mo, no setup fee, rate locked for life)
and feed Chalkline ($20/mo base) from the same pool.

**I research, qualify, evidence and draft. Jarrid approves and sends. I never send cold mail
myself.** Two reasons: outbound messages need his explicit go-ahead, and cold volume from
`ainovations.net` would damage the deliverability of his real M365 inbox.

## Ideal customer (in priority order)

1. **CNY trades & contractors** — framing, siding, roofing, remodeling, decking, GC, concrete,
   excavation, HVAC, plumbing, electrical. Small residential crews ~2-10 people.
   These are dual-purpose: Rent-a-Site AND Chalkline prospects.
2. Geography: Syracuse metro, Watertown, Fort Drum, Lewis County / Tug Hill.
   (Same service areas as the Google Business Profile.)
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
- **Never invent pricing.** Only these are real: Rent-a-Site $100/mo, no setup fee, first 20 keep
  it for life; +$50/mo AI Chat Agent (250 chats). Chalkline $20/mo base, +$10 full seat,
  +$3 crew seat. Rent-an-App Presence $299 / Mid $699 / Pro $1,299 (1-yr) with per-plan setup
  ($500/$1,000/$2,000) waived on 3-yr; Founding Five $149/$349/$649. Source of truth:
  `netlify/functions/kb.mjs`.
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
- The offer in one sentence: a managed site, $100/month, no setup fee, first 20 clients keep
  that rate for life.
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
