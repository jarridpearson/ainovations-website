# Restaurant App — Agreement Terms Sheet
_Internal. Not served publicly (`/contracts/*` and `/*.md` both 404 in `_redirects`). Drop these into the client agreement verbatim; Aiden (site chatbot) answers from the same terms if asked. Last updated 2026-09-18._

## Plans and fees
| Plan | Monthly | Locations | Texts / mo | Campaigns | Setup (waived on 3-year) |
|---|---|---|---|---|---|
| Regulars | $399 | 1 | 1,000 | Monthly | $1,000 |
| Members | $699 | up to 2 | 2,000 | Every two weeks | $1,500 |
| Group | $1,199 | up to 5 | 5,000 | Weekly | $2,500 |

- Text overage: 2¢ per message over the plan cap. A message over 160 characters counts as two segments; a single emoji switches the encoding and drops that limit to 70 characters. Caps do not roll over.
- AInovations takes no percentage and no per-order fee on anything sold through the app. Sales run through the Client's own Stripe account at Stripe's published rates.
- Apple Developer Program ($99/yr) and Google Play ($25 one-time) are the Client's accounts and the Client's cost.
- Two (2) hours per month of AInovations time for Client-requested changes on every plan. Hard cap; **unused hours do not roll over**; larger projects quoted separately.

## Delivery timeline
- Estimated time from Effective Date to live in both app stores: **eight (8) to twelve (12) weeks**. This is an estimate, not a guarantee, and is not a condition of the Agreement.
- The governing constraint is Apple's verification of the Client's business for an Apple Developer Program Organization account. Apple publishes no processing time for it, and neither party can escalate or expedite it. AInovations has no account relationship with Apple for the Client's legal entity; only the Client may contact Apple about its own enrollment.
- The Client's own turnaround also moves the date: enrolling with Apple and Google in the business's legal name, completing two-factor authentication on the Client's device, accepting the developer agreements, paying the Apple and Google fees on a business card, inviting AInovations to the team with Certificates access, granting read-only Toast API access, and approving content.
- A D-U-N-S number is required and is free. AInovations initiates it on day one. A Client that already holds one is at the short end of the range.
- All other work — the build, the Toast connection, the loyalty program, carrier registration for texting, and Stripe setup — proceeds in parallel and is complete and waiting during Apple's verification.

## Memberships and paid items (material term)
- Memberships and any other paid item sold through the app entitle the guest ONLY to physical goods or in-person service handed over at the Client's restaurant (for example a coffee club, a wine club, a monthly pie, a held table). 
- **No paid item may confer status, tier, or access to any content or feature inside the app.** VIP status, the secret menu, and every other in-app unlock are earned through the loyalty program only and are never sold. Apple's App Store Review Guideline 3.1.1 requires in-app purchase (and Apple's 15-30% commission) for anything purchased that unlocks content within an app; the no-commission structure of this Agreement depends on paid items remaining outside that rule.
- AInovations configures the membership catalog with the Client and will decline to publish a paid item that confers in-app status or access.

## Term, renewal, notice
- Term: one (1) year or three (3) years from the Effective Date.
- Renewal: at the end of the Term, the Agreement renews automatically for a further term **of the same length** (a three-year renews into another three-year) unless either party gives **sixty (60) days' written notice** before the end of the current Term.

## Early termination (NOT published on the website — Client may ask)
- If the Client terminates before the end of the Term for any reason other than a price change under the Price Notice clause, the Client pays an early-termination fee equal to **fifty percent (50%) of the remaining value of the Agreement** — the number of months remaining in the Term multiplied by the then-current monthly fee, multiplied by 0.5.
- Any waived setup fee is not clawed back separately; it is covered by the early-termination fee.

## Price notice (no price lock)
- The monthly fee is **not** locked for the Term. AInovations may change the monthly fee, text overage rate, or setup fee for any reason.
- AInovations must give the Client **at least sixty (60) days' written notice** before any price change takes effect.
- On receiving a price-change notice, the Client may terminate the Agreement effective on or before the change date **with no early-termination fee**.

## Ownership on exit
- Client keeps: Apple and Google developer accounts and the store listing; its Stripe account; its customer list including member point balances (exportable at any time, including on the way out); its Toast data-access credentials (Client grants and may revoke); menu, photos, brand assets, perks.
- AInovations keeps: the loyalty engine, notification and campaign systems, reporting, and hosting. These stop at termination. The app remains installed on guests' phones and its Order button continues to open the Client's own Toast Online Ordering; loyalty, texts, alerts, and reports cease.

## Dependencies stated to the Client
- Steps only the Client can perform, because Apple ties them to the enrolled legal entity and its Account Holder: completing Organization enrollment and Apple's business verification, two-factor authentication on the Account Holder's own device, accepting Apple's and Google's developer agreements, paying the Apple and Google fees on a business card, and inviting AInovations to the team with Admin access. Everything after that — build, signing, certificates, TestFlight, store listing, and submission to App Review — is performed by AInovations inside the Client's account.
- Two separate Toast subscriptions: Toast's Restaurant Management Suite at the Essentials tier or higher, AND Toast Online Ordering (both appear on the Client's Toast Subscriptions page). Client grants read-only Toast API access; the app never writes to Toast. Ordering in the app is the Client's own Toast Online Ordering hosted inside the app — Toast processes payment and fulfills; AInovations never handles orders or payment.
- Client adds AInovations-written promo codes in Toast Web (single-use per guest, tracked by phone).
- Client prints insert cards from AInovations artwork.
- Client must be an LLC or corporation with a D-U-N-S number (eligibility requirement, decided 2026-09-19). Client enrolls in the Apple Developer Program as an Organization and Google Play as an Organization account in its legal-entity name; no DBAs; sole proprietors are not eligible until they form an entity. Client's Account Holder invites AInovations to the Client's team with the **Admin** role and access to Certificates, Identifiers & Profiles, and issues a team App Store Connect API key. Admin is required: Apple's published role matrix allows App Manager to submit only when there is no binary in the submission, and only Admin and Account Holder can create the distribution and Pass Type ID certificates. AInovations builds, signs, and submits the app from within the Client's own account as a member of the Client's team — the same arrangement Toast documents for its own branded app, which instructs restaurants to enroll as an organization with a D-U-N-S number and invite brandedmobileapp@toasttab.com with Admin permissions. AInovations never submits a Client app from an AInovations developer account; that is what App Store Review Guideline 4.2.6 prohibits.
- Texts are sent only to opted-in recipients under the Client's registered business name (A2P 10DLC brand in the Client's name; one-time carrier registration).
