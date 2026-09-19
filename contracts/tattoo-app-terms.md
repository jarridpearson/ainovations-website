# Rent-an-App for Tattoo Studios — Agreement Terms Sheet
_Internal. Not served publicly (`/contracts/*` and `/*.md` both 404 in `_redirects`). Drop these into the client agreement verbatim; Aiden (site chatbot) answers from the same terms if asked. Last updated 2026-09-19._

The app has no product name of its own. It is the Client's app, named by the Client, published in the stores under the Client's legal entity. Nothing in the agreement or the app refers to an AInovations product name.

## Plans and fees
| Plan | Monthly | Artists | Texts / mo | Setup (waived on 3-year) |
|---|---|---|---|---|
| Solo | $79 | 1 | 1,000 | $1,000 |
| Studio | $199 | up to 5 | 2,500 | $1,500 |
| Collective | $399 | up to 15, or multiple locations | 6,000 | $2,500 |

- **Platform fee: one percent (1%) of every payment processed through the app** — services, deposits, balances, flash, merch, and **tips** — with no exemptions and no category excluded. Collected at the time of payment as a Stripe Connect application fee on the Client's connected account; shown on the customer's receipt and as its own line on the Client's reports. Tips are included by design (one rule for everything; prevents a $1 service + $300 tip workaround).
- **Refunds:** when a payment is refunded in full or in part through the app, the 1% on the refunded amount is returned to the Client with it (implemented with `refund_application_fee=true`). Stripe's own processing fees on a refund are governed by Stripe's terms.
- Card processing: Stripe's published rates on the Client's own Stripe account, paid to Stripe. The Client is the merchant of record. AInovations never holds Client funds and has no login to the Client's Stripe account beyond the platform connection needed to collect the 1%.
- Artists are not Stripe accounts. The app produces per-artist statements (gross, tips, split or booth rent, net owed); the Client pays its artists outside the app, exactly as it does today.
- **AI assistant add-on:** $50/mo on any plan. 500 conversations per calendar month included; **10¢ per conversation** over the cap; the Client is notified before overage billing begins. The assistant quotes only price ranges the artist published (never a price), answers aftercare only from the studio's own sheet, and routes anything medical or off-script to the artist.
- Text overage: 2¢ per message over the plan cap. A message over 160 characters, or containing an emoji, counts as two. Reminders count. Caps do not roll over.
- Apple Developer Program ($99/yr) and Google Play ($25 one-time) are the Client's accounts and the Client's cost.
- Two (2) hours per month of AInovations time for Client-requested changes on every plan. Hard cap; **unused hours do not roll over**; larger projects quoted separately. Collective is scheduled ahead of other plans.

## Term, renewal, notice
- Term: one (1) year or three (3) years from the Effective Date.
- Renewal: at the end of the Term, the Agreement renews automatically for a further term **of the same length** (a three-year renews into another three-year) unless either party gives **sixty (60) days' written notice** before the end of the current Term.

## Early termination (NOT published on the website — Client may ask)
- If the Client terminates before the end of the Term for any reason other than a price change under the Price Notice clause, the Client pays an early-termination fee equal to **fifty percent (50%) of the remaining value of the Agreement** — the number of months remaining in the Term multiplied by the then-current monthly fee, multiplied by 0.5. The 1% platform fee is not projected or included in that calculation.
- Any waived setup fee is not clawed back separately; it is covered by the early-termination fee.

## Price notice (no price lock)
- The monthly fee, the 1% platform fee rate, the AI add-on price and limits, the text overage rate, and the setup fee are **not** locked for the Term. AInovations may change any of them for any reason.
- AInovations must give the Client **at least sixty (60) days' written notice** before any price change takes effect.
- On receiving a price-change notice, the Client may terminate the Agreement effective on or before the change date **with no early-termination fee**.

## Ownership on exit
- Client keeps: Apple and Google developer accounts and the store listing; its Stripe account and every dollar in it; its client list including every consent form, every point balance, and every no-show flag (exportable at any time, including on the way out); all portfolio media, artist bios, brand assets, and the studio's own release text.
- AInovations keeps: the booking engine, custom-request flow, reminders, loyalty engine, back office, campaign and notification systems, the AI assistant, reporting, and hosting. These stop at termination. The app remains installed on clients' phones and the listing remains the Client's; booking, payments through the app, requests, reminders, loyalty, the back office, and the assistant cease.
- Consent-form archive: on termination AInovations delivers the full archive (forms, signatures, ID photos, timestamps) to the Client in a standard export and retains nothing beyond what law requires. The Client is responsible for continuing to retain it for the legally required period.

## Content rules (material terms)
- **No nudity anywhere in the app** — portfolio, flash, bios, messages. Apple and Google will not publish it and AInovations will not build or host it. The Client is responsible for what its artists upload; AInovations may remove violating content on sight and notify the Client; repeated violations are a material breach.
- Portfolio photos are posted only with the tattooed client's consent (the app records the approval). Artists post under their own logins; the Client (owner) can see and remove any artist's content.

## Consent records and New York law
- The app provides: digital consent signed on the client's phone (valid under NY State Technology Law §304); the sealed single-use needle attestation signed by **both** the client and the artist before every tattoo (NY Public Health Law §467), retained **no less than seven (7) years**; a hard block on anyone under 18 at date of birth (NY Penal Law §260.21 — no parental-consent path); ID photo captured with the form; health questions and the studio's own release; automatic aftercare and healing check-ins.
- Retention period and form contents are set per studio, with New York's requirements as the floor; the Client is responsible for confirming any other state's rules.
- The Client remains the licensed operator (NY PHL §461 Department of Health permit) and is responsible for its own regulatory compliance. AInovations supplies the tooling and does not give legal advice.

## Dependencies stated to the Client
- Client must be an LLC or corporation with a D-U-N-S number (eligibility requirement, same as every AInovations app). Client enrolls in the Apple Developer Program as an Organization and Google Play as an Organization account in its legal-entity name; no DBAs; sole proprietors are not eligible until they form an entity. Client's Account Holder invites AInovations as an App Manager (with Certificates access) and issues a team App Store Connect API key; AInovations is an authorized developer on the Client's team under this agreement, never a submitting service provider.
- Client holds a Stripe account in its legal-entity name, connected to AInovations' platform as a Standard connected account; the Client completes Stripe's onboarding and remains subject to Stripe's terms. One Stripe account per studio; all in-app payments settle to it.
- Deposit amounts, cancellation windows, no-show fees, and splits are the Client's policies; the app displays them before payment and records the customer's acceptance at booking. Deposits are charged at booking, not authorized-and-held. No-show fees are charged to the saved card under the accepted policy.
- Walk-in payments are taken by a pay link sent from the app. (Tap to Pay on the studio's phone is not included.)
- Texts are sent only to opted-in recipients under the Client's registered business name (A2P 10DLC brand in the Client's name; one-time carrier registration, typically one to three weeks).
- Instagram: version one is "Share to Instagram" from the app through the phone's share sheet. Importing the studio's existing Instagram posts into the app is not included until Meta approves AInovations' one-time app review; no date is promised.
