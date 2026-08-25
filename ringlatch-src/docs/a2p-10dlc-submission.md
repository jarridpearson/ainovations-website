# A2P 10DLC submission pack

**This is the launch critical path.** Brand vetting plus campaign review runs
several business days. Nothing else in Ringlatch is blocked by anything but
this, and text-backs do not send until it clears. Submit before writing another
line of code.

Fields marked **[you]** need your real business details and are deliberately
left blank — I don't have them and shouldn't guess at anything that goes on a
carrier filing.

---

## 1. Brand registration (Twilio → Messaging → Regulatory Compliance)

| Field              | Value                                            |
| ------------------ | ------------------------------------------------ |
| Legal company name | **[you]** — exactly as on the EIN letter, no DBA |
| Business type      | **[you]** — likely Sole Proprietor or LLC        |
| EIN / Tax ID       | **[you]**                                        |
| Business address   | **[you]** — must match IRS records exactly       |
| Website            | `https://ainovations.net/ringlatch`        |
| Vertical           | Professional Services                            |
| Business contact   | Jarrid Pearson, jp@ainovations.net               |

> **The single most common rejection** is a legal name or address that does not
> byte-match IRS records. "LLC" vs "L.L.C.", a suite number present in one and
> not the other — both fail vetting and cost you the full review cycle again.
> Copy from the EIN confirmation letter, not from memory.

If you register as a Sole Proprietor, throughput is capped hard and you cannot
run the caller text-back at volume. If the LLC exists, register the LLC.

---

## 2. Campaign registration — FILE TWO, NOT ONE

File the owner-alert campaign **by itself, first.** Its consent story is clean:
a paying customer who signed up and checked a box. It approves fast.

The caller text-back is the part carriers scrutinize, because the recipient
never opted in to anything. Bundling the two means one questionable flow can
sink the filing that your entire product depends on, and you eat a full review
cycle to find out.

Owner alerts alone are a shippable product. Text-backs are an upgrade you add in
week three when campaign A is already live and earning.

---

### Campaign A — REJECTED 2026-08-22 (Error 30882), remediated same day

**Why it was rejected, from Twilio's own documentation** (do not lose this):

1. **The reviewer clause was missing site-wide.** Twilio's onboarding guide says
   reviewers look for this exact language in the privacy policy — no page had it:
   *"All the above categories exclude text messaging originator opt-in data and
   consent; this information won't be shared with any third parties."*
2. **The privacy policy admitted sharing data with advertising providers** with
   no SMS carve-out. Twilio: "Any business with a terms of service or privacy
   policy that mentions sharing or selling consumer data/opt-in information is
   considered noncompliant."
3. **SMS consent was a required field on the signup form.** Twilio: "If
   customers have to opt-in to messaging to complete a purchase or create an
   account, your registration will be rejected." The checkbox is now optional
   and the label says "Consent is not a condition of signup."
4. **Sample #2 said "we texted them back"** — describing consumer text-backs,
   which is unregistered Campaign B traffic and smells like third-party
   messaging to a reviewer.

All four fixed and verified live (35-point checklist against error codes
30557–30564). The standalone terms page is
https://ainovations.net/ringlatch-sms-terms and now carries the full checklist:
brand + program name, description, "Message frequency varies", "Message and
data rates may apply" (verbatim — never the word "standard"), bold STOP with
the full keyword list (STOP/END/CANCEL/UNSUBSCRIBE/QUIT), bold HELP, support
contact, "Carriers are not liable for any delayed or undelivered messages"
(exact), privacy link, and the reviewer clause.

### Campaign A — owner alerts (FILED 2026-08-22)

Registered as **Low Volume Standard**, use case **Low Volume Mixed** ($1.50/mo
rather than $10/mo for Customer Care — only available to Low Volume Brands).

Every sample above ends in the opt-out, and `notify.ts` appends the same string
from the `OPT_OUT` constant. A test enforces that the two cannot drift apart.

**Use case:** Customer Care

**Campaign description** — paste verbatim:

> Ringlatch is an AI phone answering service for small businesses. Subscribing
> business owners receive a summary text after each call placed to their
> business, including the caller's name, callback number, and what they need,
> plus alerts for calls flagged urgent. Every recipient is a paying account
> holder who provided their own mobile number and consented at signup. All
> messages relate directly to phone calls placed to the recipient's own
> business.

**Sample message 1** (owner alert, urgent — this is the exact production
output):

> Ringlatch: URGENT - [Dave Hollenbeck] [315-555-1234] - [Sandy Creek] -
> [Furnace quit this afternoon, no heat] - [9:40 PM]. Reply STOP to opt out.

**Sample message 2** (owner alert, missed call):

> Ringlatch: missed call [2:05 PM] from [315-555-9876]. Caller hung up before
> leaving details. Reply STOP to opt out.

(The earlier version of this sample said "we texted them back" - that references
Campaign B traffic and was one plausible trigger for the 30882 rejection. Never
reference consumer text-backs anywhere in Campaign A.)

**Sample message 3** (minute-cap notice):

> Ringlatch: you've used [120] of your [150] monthly minutes. Past [150] we keep
> answering but just take a name and number. Reply STOP to opt out.

**Opt-in workflow** — paste verbatim:

> Business owners opt in through the signup form at
> https://ainovations.net/ringlatch-signup where they enter the mobile number to
> be used for call alerts and check an unchecked consent box agreeing to receive
> text messages about calls placed to their business. The exact consent wording
> shown at signup is stored with each submission, along with the mobile number,
> the submission timestamp and the originating IP address. Every message includes
> STOP opt-out instructions. Opt-in language and full messaging terms are published at
> https://ainovations.net/ringlatch#sms-terms

**Opt-out message:**

> You will not receive any further messages from this number. Reply HELP for
> help.

**Help message:**

> Ringlatch by AInovations - AI call answering. Reply STOP to unsubscribe.
> Contact jp@ainovations.net for support.

---

> **Consent record kept:** the exact checkbox wording, the mobile number, the
> submission timestamp and the originating IP address, retained for the life of
> the account and available on request.

## 3. Before you hit submit

- [ ] `ai-receptionist.html` is **deployed and publicly reachable** — reviewers
      open the URL, and a 404 fails the campaign. This is why the page had to
      ship before the filing.
- [ ] `https://ainovations.net/ringlatch#sms-terms` renders the messaging
      terms section.
- [ ] Privacy policy states that mobile numbers are not sold or shared with
      third parties for marketing. **Verify `/privacy` actually says this** —
      carriers check, and I have not audited that page.
- [ ] STOP / HELP auto-replies are enabled on the Twilio messaging service.
- [x] **The signup form with the consent checkbox is live and reachable** at
      https://ainovations.net/ringlatch-signup — an unchecked consent box with
      the full message terms beside it, linked from every Ringlatch page.

---

### Campaign B — caller text-back (file after A is approved)

Do not file this until campaign A is live. Same brand, second campaign.

**Use case:** Conversational / Customer Care

**Campaign description:**

> When a consumer calls a business using Ringlatch and hangs up before leaving
> their details, the service sends a single reply text to the number they called
> from, inviting them to reply with what they need. One message per inbound
> call, sent only in response to a call the consumer placed themselves, never
> marketing, always including STOP instructions.

**Sample message:**

> Sorry we missed you - this is Miller Plumbing. Reply here with what you need
> and we'll get right back to you. Reply STOP to opt out.

**Opt-in workflow:**

> The consumer initiates contact by calling the business directly. The single
> reply message is sent to the number that placed the call, in direct response
> to that call, and includes STOP opt-out instructions. No number is ever
> messaged without having first called the business.

## 4. Known risk on the caller text-back

The owner-alert flow is clean consent. The **caller text-back is the part that
draws scrutiny**: the recipient never signed anything. The defensible position,
and what the wording above argues, is that it is conversational messaging in
direct response to a call the consumer themselves placed, sent once, with STOP
included.

Keep it that way. Specifically:

- One message per inbound call. Never a follow-up, never a reminder.
- Never marketing content, never a promotion, never a second business.
- Honor STOP permanently and across all clients, not per-client.

If a carrier pushes back, the fallback is to run text-backs only to callers
whose number matches an existing customer record for that business, and drop
cold text-backs entirely. That weakens the product but keeps the campaign.

---

## 5. Parallel waiting periods — start these the same day

**NY sales tax.** New York taxes SaaS as prewritten software. Register for a
Certificate of Authority with NYS before invoicing client #1, then switch on
Stripe Tax. Doing this after the fact means going back to early clients for tax
you did not collect.

**Stripe.** Account, then three things: a $199 one-time setup product, three
subscription prices ($99 / $179 / $299), and the customer portal enabled so
owners can update a card without calling you.

Both need your identity and banking details, so both are yours to do — I can't
create accounts or enter financial information, and shouldn't.

---

## 6. The filing must match reality

The opt-in wording describes a consent checkbox on a live form. That form now
exists (`ringlatch-src/intake/index.html`) but **is not deployed**. Deploy it before
submitting, or a reviewer opens the page, finds no opt-in mechanism, and rejects
the campaign.
