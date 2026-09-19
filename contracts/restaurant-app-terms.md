# Restaurant App — Agreement Terms Sheet
_Internal. Not served publicly (`/contracts/*` and `/*.md` both 404 in `_redirects`). Drop these into the client agreement verbatim; Aiden (site chatbot) answers from the same terms if asked. Last updated 2026-09-18._

## Plans and fees
| Plan | Monthly | Locations | Texts / mo | Campaigns | Setup (waived on 3-year) |
|---|---|---|---|---|---|
| Regulars | $399 | 1 | 1,000 | Monthly | $1,000 |
| Members | $699 | up to 2 | 2,000 | Every two weeks | $1,500 |
| Group | $1,199 | up to 5 | 5,000 | Weekly | $2,500 |

- Text overage: 2¢ per message over the plan cap. A message over 160 characters, or containing an emoji, counts as two. Caps do not roll over.
- AInovations takes no percentage and no per-order fee on anything sold through the app. Sales run through the Client's own Stripe account at Stripe's published rates.
- Apple Developer Program ($99/yr) and Google Play ($25 one-time) are the Client's accounts and the Client's cost.
- Two (2) hours per month of AInovations time for Client-requested changes on every plan. Hard cap; **unused hours do not roll over**; larger projects quoted separately.

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
- Toast POS on Restaurant Management Suite Essentials or higher, with Toast Online Ordering. Client grants read-only Toast API access; the app never writes to Toast. Ordering in the app is the Client's own Toast Online Ordering hosted inside the app — Toast processes payment and fulfills; AInovations never handles orders or payment.
- Client adds AInovations-written promo codes in Toast Web (single-use per guest, tracked by phone).
- Client prints insert cards from AInovations artwork.
- Client enrolls in Apple/Google developer programs in its legal-entity name (Apple requires a D-U-N-S number; no DBAs).
- Texts are sent only to opted-in recipients under the Client's registered business name (A2P 10DLC brand in the Client's name; one-time carrier registration).
