# Architecture

## Components

- `src/`: React 19 + TypeScript SPA, Lucide icons, CSS tokens and self-hosted Noto Sans Thai. Page routing uses the History API, preserves modifier-click links, supports direct production deep links and route titles. Admin is loaded separately.
- `server/http.mjs`: Node HTTP API, request-size/content-type limits, same-origin mutation checks, custom request header, auth throttling, HTTP-only cookies, owner/admin guards and static production assets.
- `server/domain.mjs`: shared domain rules, SQL queries, sessions, password hashing, encrypted inventory, payment allocation and ledger.
- `server/commerce.mjs`: local Node SQLite adapter and migration runner.
- `server/api-handler.mjs`: shared Fetch Request/Response API for both runtimes.
- `cloud/worker.mjs`: Cloudflare Worker, durable SQLite adapter, signed workspace routing, persistent authentication limits and secret-derived inventory keys. Browser-supplied prices, roles or payment statuses are ignored.
- `server/migrations/`: ordered SQL migrations recorded in `schema_migrations`. New schema changes should be append-only.
- `server/catalog.mjs`: fictional seed catalog. Seed never resets existing data.
- `.data/`: ignored local SQLite database and 32-byte AES key. Private directory; key is created with file mode 0600.
- `tests/`: Node business/API regression tests and Chromium browser workflows.

## Payment/delivery transaction

```text
Server creates pending order with DB price and opaque confirmation token
 -> authenticated owner submits sandbox confirmation
 -> BEGIN IMMEDIATE (SQLite write lock)
 -> return existing delivery if already delivered
 -> validate order state, token, sandbox outcome, stock, credit
 -> insert unique ledger debit
 -> assign exactly N previously unallocated inventory rows
 -> mark order DELIVERED and write audit event
 -> COMMIT
```

A competing buyer cannot allocate the same stock because allocation is inside the database write transaction. `inventory.fingerprint` prevents importing a key twice. `ledger.reference` is unique; repeated confirmation of a delivered order returns the existing result. Missing stock marks OUT_OF_STOCK without debiting; insufficient balance leaves the order pending without side effects. Failed payment marks FAILED without allocating keys.

Orders are not reserved before payment. Stock shown in a browser is advisory; the authoritative check happens inside confirmation. The implementation sends immediately, so it only persists PENDING_PAYMENT, DELIVERED, FAILED, OUT_OF_STOCK and CANCELLED. PAID/PROCESSING are not fabricated states; an asynchronous gateway would need an expanded state machine.

## Identity and secrets

Passwords use scrypt with random per-user salts and constant-time comparison. Session cookies hold random tokens; only SHA-256 hashes are stored in the database. Delivery queries always include the authenticated user's ID. Password changes revoke existing sessions. Admin setup is available only through a server environment variable.

Unused codes are AES-256-GCM encrypted. Public catalogs and even admin inventory listings return quantities, not encrypted or plaintext unused codes. Paid owners receive only the keys assigned to their own orders. All inventory is obviously invalid TEST data.

The server cannot establish a real bank's payment truth: it implements an explicit sandbox method, verifies its server-issued token and performs the credit/stock transaction. Users can request preset TEST top-ups as an intentional demo feature. This mechanism must be replaced before any real-money use.

## Cloudflare runtime and demo isolation

A browser receives a signed, HTTP-only `astra_space` cookie on its first login/demo registration. The Worker verifies its HMAC before selecting a private Durable Object. Browsers without a workspace read a shared presentation dataset; mutations never execute against that presentation object. Customer sessions remain independently authenticated inside each private workspace.

`/api/demo-merchant` creates an ADMIN account only inside that browser's isolated workspace. It cannot promote users in other workspaces. This explicit test entry lets customers exercise the back office without a shared admin password. Normal registration/profile input cannot select roles. The merchant store card links the same workspace's storefront and administration.

The durable SQLite adapter uses `ctx.storage.transactionSync` instead of SQL BEGIN/COMMIT. Payment/ledger/allocation rules stay in the shared synchronous domain layer. Migrations apply once per workspace. Cloudflare encrypted secrets hold the space signing key and inventory root key; the local `.data/inventory.key` is never uploaded.

Identity is scoped to the browser workspace for this sandbox. A demo registration is not a permanent cross-device account. Do not rotate SPACE_SIGNING_KEY or INVENTORY_KEY without a migration/recovery plan: routing and encrypted inventory depend on them.

## Limits

The local runtime is a single Node process with one SQLite database. Cloudflare runs one SQLite-backed Durable Object per demo workspace. Password hashing is synchronous. Local rate limits are in memory; Cloudflare authentication limits are stored in SQLite, including an IP-hashed global start limit. No production mail, payment, recovery, settlement or scheduled task is configured. Cloud infrastructure serves an explicitly public TEST-credit demonstration. React state is used for this bounded demo; no query-cache library or external ORM is required for the local SQLite adapter.

## Short frontend hostname

Cloudflare Pages project `astra-demo` (assigned hostname `astra-demo-133.pages.dev`) serves the same Vite artifact. Its advanced-mode Worker delegates API calls through a service binding to the existing `astra` Worker. Request URLs and cookies stay same-origin for the public Pages hostname. Worker `astra` remains the sole database and API owner. The Cloudflare Pages creation was explicitly approved by the user after automatic review required specific authorization.
