# Ringlatch — path to first dollar

## Status 2026-08-23 (cancellation): FULL SELF-SERVE LIFECYCLE
- Clients cancel themselves: /ringlatch-account (ownership = account email +
  forwarded number) opens a hosted billing portal (config
  bpc_1U7f5NDBB5irv1eWpiYXPB2V: card update, invoices, cancel at period end).
- Scheduled cancel -> courtesy email ("answering until DATE, undo any
  time"). Subscription ends -> automatic teardown: atomic claim, number
  deregistered from the backbone and released at the carrier, client row
  cancelled with both numbers nulled (frees them for future signups — the
  signup row also flips to 'cancelled' so the unique index releases),
  goodbye email with forwarding-off dial codes, ops FYI "nothing to do".
  Teardown failure is the only manual path and names the number to release.
- Webhook endpoint now subscribed to checkout.session.completed +
  customer.subscription.deleted + customer.subscription.updated.
- Welcome email now links /ringlatch-account; help page points billing
  questions there first.

## Status 2026-08-23 (final): ZERO-TOUCH PROVISIONING
- Payment now provisions the client with NO human involved: webhook claims
  the paid signup atomically (Stripe retries safe), buys a voice+SMS number
  in the client's area code (fallback: any US), attaches it to the trunk
  (TrunkSid on purchase) and the messaging service, registers it with the
  voice backbone bound to the shared agent (latest_published) + inbound
  webhook, creates the client row with a parse-validated 24/7 default
  profile (urgency pack inferred from business type; no-consent clients are
  email-only — parseProfile now allows sms OR email), and sends the welcome
  email (+ SMS if consented) with forwarding steps.
- Ops alert on success says "nothing to do". Failure is the ONLY manual
  path: signup -> 'failed', alert names the step; fix, set back to 'paid',
  resend the Stripe event (signup events flow past the dedupe; the claim
  keeps it single-shot).
- Owner's test with RINGLATCH100 now exercises the ENTIRE pipeline
  including a real ~$1.15 number purchase.

## Status 2026-08-23 (latest): GATEKEPT CHECKOUT, ONE NUMBER = ONE ACCOUNT
- Checkout moved from static payment links (deactivated) to server-created
  sessions via ringlatch-checkout: the signup form posts there, the HARD
  rules run BEFORE payment. One forwarded number = one account, ever
  (blocked at the form, DB-unique on clients + paid signups); one email =
  one subscription. Blocked signups are pointed at /ringlatch-add-business.
- Multi-business is ONE account: profile.businesses[] + the agent opens with
  "which business are you trying to reach?" and tags the lead. Self-serve
  add via /ringlatch-add-business (proves ownership with account email +
  forwarded number, owner gets an SMS notice — that notice is the tamper
  alarm). Same subscription, same minutes pool.
- Signups now live in OUR database (ringlatch_signups) with the A2P consent
  record (wording, IP, timestamp). Webhook marks them paid via metadata
  signup_id and the ops alert carries everything needed to provision.
- Verified live: taken number -> 409 with add-business path; clean signup ->
  live checkout session URL; add-business bad creds -> one generic error.
- Owner rule, learned the hard way and now absolute: every customer surface
  must be completable with zero humans involved. No "email us" ever.

## Status 2026-08-23 (later): SELF-SERVE BILLING LIVE, REVIEW FIXES SHIPPED
- Owner rules locked in hard: packs NEVER appear in the initial purchase flow
  (only surfaced by run-out alerts); everything customer-facing is self-serve —
  no "email us" anywhere; the owner's personal email is off every customer
  surface (help form at /ringlatch-help instead; sms-terms keeps the legally
  required contact).
- Live Stripe catalog (test-mode false start caught and redone): Standard
  $149/mo, Busy $299/mo, Minute pack $79/100min. Payment links with promo
  field; RINGLATCH100 = 100% off x3 months, 5 uses. Pack links save the card
  (customer_creation=always + setup_future_usage) so auto-refill can charge.
  Auto-refill is a checkbox on /ringlatch-minutes that routes through a
  metadata-flagged payment link; the billing webhook flips the client flag.
- Adversarial review (44 agents) confirmed 18 defects; all fixed same day:
  degrade ladder now measured on PLAN minutes only (pack minutes can never
  close a client); auto-refill: atomic one-claim-per-period, Stripe
  idempotency key, checked credits, ops alert on charge-without-credit;
  stripe webhook releases its event guard and 500s on failed credits so
  retries recredit; inbound webhook now signature-verified (was leaking owner
  cell + config to anonymous POSTs — NOTE: assumes the platform signs inbound
  webhooks per its docs; first live call after deploy confirms); GET recon
  endpoint removed; cap SMS no longer claims caller text-backs (Campaign B
  unfiled); closed-mode prompt no longer promises a text; trimTo uses ASCII
  (U+2026 was flipping alerts to UCS-2); stale early-list metas replaced.

## Status 2026-08-23: VOICE PATH WIRED, SIGNATURE BUG FIXED
- Twilio elastic SIP trunk "Ringlatch": termination `ringlatch.pstn.twilio.com`
  + credential list, origination `sip:sip.retellai.com`, number on the trunk,
  SIP REFER transfers enabled (caller ID shows the transferee)
- Number imported to Retell ("Ringlatch Demo Line"), agent bound to Latest
  Published, inbound webhook set; RETELL_WEBHOOK_SECRET pasted by owner
- First live call (1:19, 10:08 AM): agent answered correctly, but every event
  webhook bounced 401 — verification hashed the raw body alone, while the
  signature header is `v={unix_ms},d={digest}` with the digest computed over
  body + timestamp. No call row, no owner SMS.
- Fix shipped: verification moved to `_shared/ringlatch/verify.ts` matching the
  documented scheme (5-minute replay window, constant-time compare), 8 new
  tests (56 total, all green), redeployed; Retell's signed dashboard test event
  now returns 200. Rerun in Retell explicitly does not resend webhooks, so the
  10:08 notification is unrecoverable — next call proves the full pipeline.
- Second call (10:22, hung up early): full pipeline proven — webhook 200, call
  + lead + notification rows written, owner SMS delivered 2s after hangup.
  Email attempt logged "Email is not configured" (RESEND_API_KEY pending).
- Advanced opt-out enabled on "Ringlatch Owner Alerts" with one-name replies:
  STOP/START confirmations say "Ringlatch:", HELP says "Ringlatch by
  AInovations LLC" + jp@ainovations.net (matches the A2P filing).
- setup-stripe.sh: dropped the $199 setup product (setup fees were rejected);
  catalog is exactly Standard $149/mo and Busy $299/mo.
- RINGLATCH_EMAIL_FROM pinned to "Ringlatch <ringlatch@ainovations.net>".
  DNS for ainovations.net is Netlify-managed (zone 69c74575cdc7b5870c032b8a) —
  Resend DKIM/SPF records can be added via `netlify api createDnsRecord`.
- Email live: ainovations.net verified in Resend (DKIM TXT + rsend/send
  CNAMEs created in Netlify DNS via API; Enable Receiving deliberately OFF so
  the root MX keeps delivering the owner's existing mailbox). RESEND_API_KEY
  (sending-only key "ringlatch-server") set. Next call = SMS + email.
- Stripe live on account acct_1TFdU5DBB5irv1eW (CLI key expires ~2026-11-21):
  Standard prod_V7sUMIauYr3Ajw / price_1U7cjHDBB5irv1eW0DmRJnAz ($149/mo),
  Busy prod_V7sUsrEBXPBiUS / price_1U7cjIDBB5irv1eWG1iHAaMp ($299/mo).
  Recurring monthly, active, verified via prices list. No setup fee, no
  overage prices — brief mode is the cap, not a bill.
- Dashboard items still owner's: enable Customer portal (payment updates +
  cancellation), enable Stripe Tax + NY registration.

## Status 2026-08-22: LIVE INFRASTRUCTURE
- Brand approved; Campaign A approved (after one rejection, fixed + resubmitted)
- Number purchased: **+1 315 907 6170** (Syracuse) — attached to the
  "Ringlatch Owner Alerts" messaging service, linked to the approved campaign
- Migration applied to production (after repairing 10 out-of-sync Everward
  entries in migration history — objects already existed; history was stale)
- Both edge functions deployed (`--no-verify-jwt`; webhook does its own HMAC)
- Demo client seeded (`ringlatch-demo`) — live inbound test returns the full
  agent config for +13159076170
- Secrets set: TWILIO_ACCOUNT_SID, RINGLATCH_EMAIL_FROM
- Still needed: TWILIO_AUTH_TOKEN (owner pastes), Retell account +
  RETELL_WEBHOOK_SECRET, optional RESEND_API_KEY

One ordered list. Do these in order. Everything else is noise until a client is
paying.

## Today (starts the clocks you cannot rush)

1. **Deploy two pages.** `/ai-receptionist` and the intake form. The A2P
   reviewer opens them; if the consent checkbox is not live, the campaign is
   rejected and you wait another cycle.
2. **File A2P Campaign A only** — owner alerts. Clean consent, fast approval. Do
   NOT bundle the caller text-back; that is Campaign B, filed after A is live.
   Pack: `docs/a2p-10dlc-submission.md`.
3. **Register for NY sales tax.** Certificate of Authority, then Stripe Tax on
   from invoice one. Retrofitting this means chasing early clients for money.

## While A2P is in review (days)

4. **Retell account.** One agent. The config is generated:
   `deno run --allow-read ringlatch-src/setup-retell.ts > retell-agent.json` Paste
   it in, then set the inbound webhook to `ringlatch-inbound` and the call
   webhook to `ringlatch-call-webhook`.
5. **Twilio number** for the first client.
6. **Stripe**: `bash ringlatch-src/setup-stripe.sh` creates the products and prices.
   Then turn on the customer portal and Stripe Tax in the dashboard. No metered
   billing, no overage product — there is no overage.
7. **`supabase db push`** — the migration has never touched a real database.
   Expect to fix something.
8. **Deploy both functions** (`ringlatch-inbound`, `ringlatch-call-webhook`),
   point Retell at them, and make one real call end to end. This is the first
   moment anything is proven.

## First client

9. Send the intake form link. They fill it, you get a profile and a consent
   record.
10. `--validate` their file. It fails loudly on bad numbers, backwards hours, or
    a missing line type.
11. Create the client row, assign the real number, clone the agent.
12. **The forwarding call.** Ten minutes, on the phone. `--forwarding` prints
    exactly what to read them.
13. **Verify.** Ring out, then off-hook for busy, then have them answer one. Do
    not skip this — silent forwarding failure looks identical to working.
14. Stripe link. Live.

## What is deliberately not in v1

Cut on purpose. Each of these is a thing that can break at 9pm.

- Caller text-backs — until Campaign B is approved. Owner alerts alone are a
  product worth $99.
- The client dashboard — the portal is one switch. Leads arrive by text.
- Appointment booking, calendar sync, multi-line routing. Sell them later.
- Self-serve signup. You onboard the first ten by hand, on purpose. That is how
  you find out what the intake form is missing.

## Margin is capped, not hoped for

There is no overage billing. Overage bills after the damage, arrives as a
surprise, and surprise bills cause churn and chargebacks. Instead:

| Usage           | What happens                                           |
| --------------- | ------------------------------------------------------ |
| 80% of minutes  | Owner gets a heads-up                                  |
| 100%            | Agent drops to brief mode — name and number only, ~45s |
| 150%            | Stops answering, owner told loudly to upgrade          |
| Any single call | Hard stop at 5 minutes                                 |
| Robocalls       | Never billed at all                                    |

Worst reachable margin: **70% on Standard, 65% on Busy.** A client who tries to
use ten times their minutes costs exactly the same as one who stops at the
ceiling — that is the whole point, and a test enforces it.

Brief mode is the piece that makes this safe to sell. A client over their cap
still gets every lead caught; the assistant just stops chatting. Degrade, do not
die.

## The one number that matters

Calls caught per client per month. If it is under about five, the client will
churn no matter how good the product is, and you should find out why before
selling another one.
