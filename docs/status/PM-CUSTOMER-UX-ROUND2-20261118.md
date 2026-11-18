# PM acceptance — Customer UX Round 2

Date: 18 November 2026 (Asia/Bangkok)
Baseline: `c3238c6` (main). The reported `feat/ux-r2-customer-storefront` branch was absent on origin when fetched, so this delivery implements the customer's supplied requirements on the available baseline.

## Customer requirements

| Area | Delivered behavior |
| --- | --- |
| Product card title | Smaller text, one line with ellipsis; full name remains accessible; arrow removed |
| Price | Minimum–maximum current variant price; one price when equal |
| Card divider | No border between artwork and product information; artwork frame retained |
| Card buttons | Filled accent background; ซื้อเลย / พรีออเดอร์; sold-out label retained |
| Card counters | Ready stock: sellable remainder and purchased units; preorder: purchased units only |
| Category artwork | Square image tile instead of a circular crop |
| Recent activity | Mobile shows vertically stacked transaction rows |
| Product back link | Larger text and 48px target |
| Product gallery | Native horizontal touch swipe, thumbnails, tap-to-enlarge, modal with touch close and keyboard Escape |
| Variant labels | ตัวเลือกสินค้า; larger, bold names |
| Variant stock | Remaining units and green frame; sold-out text and red frame; purchase action unavailable for sold-out selections |
| Variant sales | Purchased count on each ready-stock / preorder option, including grouped option listings |
| Quantity and purchase controls | 52px high; larger buttons and text |
| Product chat CTA | Removed from PDP; store chat FAB and product attachments remain available |

`stockRemaining` includes only sellable inventory. Shop-fulfilled products with no finite inventory return `null` and do not display a misleading zero. Preorder sales count paid reservations and delivered reservations once; unpaid orders / unpaid free queues do not increase the count. No credentials, ciphertext or raw admin `stock` key are exposed.

## Additional verified fix

Approved account deletion now clears questionnaire answers for preorder reservations as well as ordinary orders. Regression coverage reproduces the original retention bug and verifies empty answers after deletion.

## Evidence

- `tests/public-stock-sold.test.mjs`: sellable stock, unpaid / paid sales and preorder delivery without double counting.
- `tests/customer-ux-round2.spec.mjs`: 320 / 390 / 430 / 1440px, real browser touch swipe and touch modal close, card/variant requirements and actual preorder checkout through HTTP.
- `tests/privacy-pdpa.test.mjs`: questionnaire deletion regression.
- Existing chat attachment tests now attach a product through the retained chat FAB.
- Local screenshots: `/private/tmp/astra-r2-shots/round2-<width>-pdp.png`.

## Validation

- TypeScript and production build: passed.
- Unit/API/storage tests: 491 passed.
- Round 2 browser acceptance: 5 passed (four viewport sizes plus preorder checkout).
- Complete browser regression: 203 cases exercised. The initial full run passed 191, failed 5 and blocked 7 dependent cases. Follow-up suites passed after corrections: journey 8/8; live-shop + order-list 5/5; pricing + Round 2 acceptance 10/10; small-ux-a 5/5. This covers the failed and blocked cases with no outstanding failure.
- Corrections included updating old stock-label expectations, waiting for async clipboard completion, preserving sale/discount information alongside price ranges, and rerunning an editor timeout against the settled final build.
- Deployment uses the existing `astra` Worker and `astra-demo` Pages project. Release verification checks the published Git SHA, API health, storage and public/merchant routes.
