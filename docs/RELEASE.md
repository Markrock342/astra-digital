# Online release — 8 November 2026

- Storefront: https://astra-demo-133.pages.dev/
- Merchant entry: https://astra-demo-133.pages.dev/stores
- Administration: https://astra-demo-133.pages.dev/admin

Cloudflare assigned `astra-demo-133.pages.dev` to the user-approved Pages project `astra-demo`. The unsuffixed hostname is not claimed. The rejected unrelated custom hostname was removed and was not reused.

Pages deployment: `8609c1c7` (final date-display polish); Worker API version: `3bf5c090-6465-4f04-8b9b-b7947040f055`, Worker `astra`. The `COMMERCE_API` service binding connects Pages to the existing durable SQLite backend and managed runtime secrets. No secrets were rotated.

## Validation

- TypeScript/Vite production build passes.
- 18 business/API tests pass: atomic allocation/debits, idempotency, ownership, encrypted persistence, concurrency, usernames, drafts, settings, closure, preorders and review expiry.
- Six browser workflows pass: responsive catalog/theme/search, purchase/delivery/history/top-up/review, failure, registration/profile, admin draft/publish/import/duplicate/export, routes/errors/fonts.
- 37 Cloud QA checks pass against the actual primary Pages hostname. This includes adding a product in the merchant UI, importing two known TEST keys, customer checkout receiving the imported key, retrieving the same key after reload, last-unit contention, repeat-payment idempotency, private workspaces, persisted settings, closure, private preorders, motion transforms/reduced motion, ten mobile routes and zero JavaScript errors. See `cloud-qa-result.json`.
- Final date-label formatting was deployed after the full Cloud QA run; final HTTP/browser smoke checks verify the current Pages bundle and formatted dates. Business logic was unchanged by that last display-only patch.
- `/`, `/stores`, `/admin`, `/api/health` return HTTP 200 through the primary hostname, with nosniff/security headers.
- Source credentials are absent from app/server/public/docs text. Source browser tabs remain open per the user's request.

## Visual review and scope

Reference and demo screenshots are in `comparison/reference/` and `comparison/demo/`. Storefront, catalog/product, reviews and main merchant screens were visually reviewed at desktop and mobile sizes. Motion recording: `previews/astra-motion.gif` / `.webm`.

The sandbox uses ASTRA identity, TEST credit and DEMO keys. Trial data is isolated by browser workspace. Real payment collection and advanced rental/OTP/LINE/shipping/team/billing services are not connected. See `feature-matrix.md` and `production-gap.md`; this is not a claim of pixel-perfect reproduction or complete production service parity.
