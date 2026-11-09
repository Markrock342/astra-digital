# Demo scope

| Area | Implemented and tested | Boundary |
| --- | --- | --- |
| Storefront | Reference composition, typography, product images, catalog, gallery, variants, cart, reviews, theme, responsive views and observed motion | ASTRA identity and TEST disclosures |
| Authentication | Username, optional email, confirmation, password hashes, sessions, profile and password change | No email recovery/verification service |
| Purchase and delivery | Server-owned prices, atomic credit debit and unique-key allocation, encrypted stock, owner-only retrieval, reload persistence, idempotency and last-unit contention | TEST credit and DEMO keys only |
| Preorder | Booking/delivery dates, zero-price shared option, paid option, idempotent payment and private PREORDER history | No key is fabricated before fulfillment; no scheduler/provider integration |
| Reviews | Delivered-order owner, one review per order, seven-day window, ratings and filters | No media uploads |
| Merchant | Horizontal navigation, overview, setup, product table, draft/edit/publish, inventory import, orders, customers, ledger and CSV | One isolated shop per browser workspace |
| Settings | Shop/contact/announcement/policy persistence, open/close control and stock delivery order | Production consent tracking/media upload/integration settings not implemented |
| Catalog migration | Two reference products, 25 available units at initialization, legacy stock/orders preserved | Existing private workspaces keep subsequent edits and purchases |
| Cloudflare | Pages frontend, bound Worker API, durable SQLite, managed runtime secrets and HTTPS | Demo tenancy is browser-scoped; not permanent organization tenancy |
| Advanced platform services | Navigation structure retained | Coupons, stamps, rental/OTP, shipping, LINE bots, teams, domain/billing integrations remain outside the working sandbox |
