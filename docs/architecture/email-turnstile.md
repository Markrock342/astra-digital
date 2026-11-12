# Email, password reset, order emails, Turnstile

Everything here is **off** until its config exists. With nothing set, the shop behaves exactly as before:
- `features.email` and `features.turnstile` are false in `/api/health`.
- "ลืมรหัสผ่าน?" keeps the "ติดต่อร้าน" text.
- No Turnstile script is loaded and the CSP is unchanged.

## Config (Mark)

| What | Where | Value |
|---|---|---|
| Sender address | `wrangler.jsonc` → `vars.EMAIL_FROM` | `no-reply@<verified domain>` (required for either provider) |
| Sender name (optional) | `vars.EMAIL_FROM_NAME` | e.g. `ASIA EXTRA` |
| Provider A: Cloudflare Email Sending (preferred) | `wrangler.jsonc` → `"send_email": [{ "name": "EMAIL" }]` | Onboard the domain first: `npx wrangler email sending enable <domain>` |
| Provider B: Resend | secret `RESEND_API_KEY` (`npx wrangler secret put RESEND_API_KEY`) | Used only when there is no `EMAIL` binding |
| Links in emails (recommended) | `vars.PUBLIC_BASE_URL` | `https://<shop domain>`. Without it, the link uses the request's own origin. |
| Turnstile site key | `vars.TURNSTILE_SITE_KEY` | From Cloudflare dashboard › Turnstile (the hostname must be listed on the widget) |
| Turnstile secret | secret `TURNSTILE_SECRET` | Same widget |
| Pages build only | build env `TURNSTILE_SITE_KEY` when running `scripts/build-pages.mjs` | Writes the Turnstile CSP into `_headers` (storefront only; `/admin` stays strict) |

Never set `EMAIL_API_BASE` or `TURNSTILE_VERIFY_URL` in production. They only point the code at local mocks in `scripts/wrangler-local-email-smoke.mjs`.

Local Node server (`npm start`/`npm run dev`): the same names are read from `process.env`.

## Endpoints

- `POST /api/password/forgot {email, turnstileToken?}`
  - Always `200 {ok, message}`, whether or not the account exists.
  - `404` while email is off.
  - `429` after 5 requests per IP per 15 minutes.
  - Silently capped at 3 links per account per hour.
  - Each request writes the audit row `PASSWORD_RESET_REQUEST`.
- `POST /api/password/reset {token, newPassword, confirmPassword?}`
  - Password must be 10–128 characters.
  - The token is single-use and expires after 30 minutes. Only an HMAC of it is stored, in `password_resets`.
  - Revokes every session and pending 2FA challenge, and clears the lockout.
  - Writes the audit row `PASSWORD_RESET_DONE`.
  - Staff and admins with 2FA still need the code at their next login.
- `GET /api/admin/integrations` (admin only)
  - Shows email and Turnstile status, the sender, `PUBLIC_BASE_URL` and the last 20 `email_log` rows (recipient masked).
  - Never shows a secret.
- `GET /api/health` adds `features.email`, `features.passwordReset`, `features.turnstile` and `turnstileSiteKey` (public).

## Order emails

They are sent only when email is on and the customer has a real address. `*.local` placeholders (for example `<username>@no-email.asiax.local`) and reserved test TLDs are skipped.

| Email | Sent when | Dedupe key (`email_log.ref`) |
|---|---|---|
| ยืนยันคำสั่งซื้อ | `pay` succeeds: the order is `DELIVERED`, or the preorder is paid (`PREORDER`) | `order-confirmed:<id>` |
| สินค้าพรีออเดอร์พร้อมแล้ว | `deliverReservation` | `preorder-ready:<id>` |

- They are added as wrappers around `pay` and `deliverReservation`, after the original call has committed. Money and order logic is unchanged.
- Each email contains the order number, product, amount and a link to `/orders/<id>`. Credentials are shown there only after login, and never in the email.
- A future live-payment webhook can call `service.sendOrderConfirmation(orderId, {origin})`.

Sending runs in the background with a 5-second timeout and never fails the user action. Each outcome is written to `email_log`: time, kind, masked recipient, ok, provider id or error.

## Turnstile

- **Where it is required:** register, password login (`/api/login`) and forgot-password.
- **Not required on:** the 2FA step and the demo buttons.
- **Verification:** the server calls `siteverify` with the secret, the token and `remoteip`. A missing or invalid token, a timeout or a network error is rejected with a Thai `403`.
- **Login uses it on every attempt, not only after the first failure.**
  - Credential stuffing tries each account once from many IPs, so a rule that waits for a failure would never trigger. A per-browser flag can also be cleared by the attacker.
  - "Always" is enforced only on the server and needs no extra state.
  - Turnstile's managed mode is usually invisible to real users.
  - If Turnstile breaks, removing the two Turnstile config values switches it off.
- **Script loading:** the script loads lazily, only on login, register and forgot-password.
- **CSP:** `https://challenges.cloudflare.com` is added to `script-src` and `frame-src` for storefront pages only, and only while Turnstile is configured.

## Verify

- `npm test`: `tests/email-turnstile.test.mjs`, using a fake sender and a fake siteverify.
- `npm run test:e2e`: `tests/email-turnstile.spec.mjs`. The email is captured by a test hook and the Turnstile script is mocked.
- `npm run build && npm run qa:wrangler-email`: real `wrangler dev --local` (Durable Object SQLite). It checks:
  - the off state;
  - the on state, against a local mock of Resend and of siteverify.
