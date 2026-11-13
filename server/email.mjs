/**
 * Outgoing email (transactional only). Providers, in order of preference:
 *   1. Cloudflare Email Sending: a `send_email` binding named EMAIL (env.EMAIL.send()).
 *   2. Resend HTTP API: RESEND_API_KEY (+ EMAIL_API_BASE, tests only).
 *   3. Off: nothing is sent and features.email is false.
 * Both providers need EMAIL_FROM (an address on a domain verified with that provider).
 *
 * Sending never blocks or fails the user action: callers queue a message, the send runs
 * in the background with a ~5s timeout and the outcome lands in email_log.
 * Emails never carry passwords or delivered credentials.
 */
import { renderTemplate } from "./email-templates.mjs";

export const EMAIL_TIMEOUT_MS = 5000;
const RESEND_BASE = "https://api.resend.com";

/** Accounts made without an email get <username>@no-email.asiax.local; demo and owner
 *  accounts use other *.local domains. None of those can receive mail. Plain format
 *  check only (the shop has no email verification step). */
export function isRealEmail(value) {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  // *.local (placeholders, demo, owner) and reserved test TLDs never get mail.
  return !/\.(local|localhost|invalid|test|example)$/.test(email);
}

/** "somchai@gmail.com" → "so***@gmail.com" (enough for the admin log, never the full address). */
export function maskEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return head + "***" + (domain ? "@" + domain : "");
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " timed out after " + ms + "ms")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Build the sender from Worker env / process.env. `fetchImpl` is injectable for tests.
 * Returns { enabled, provider, from, send(message) → Promise<{ id }> (throws on failure) }.
 */
export function createEmailSender(env = {}, { fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = EMAIL_TIMEOUT_MS } = {}) {
  const from = text(env.EMAIL_FROM);
  const fromName = text(env.EMAIL_FROM_NAME);
  const binding = env.EMAIL && typeof env.EMAIL.send === "function" ? env.EMAIL : null;
  const resendKey = text(env.RESEND_API_KEY);
  const base = (text(env.EMAIL_API_BASE) || RESEND_BASE).replace(/\/+$/, "");
  const off = { enabled: false, provider: null, from: from || null, send: async () => fail("email is not configured") };
  if (!from || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) return off;
  if (binding)
    return {
      enabled: true,
      provider: "cloudflare",
      from,
      async send({ to, subject, text: body, html }) {
        const result = await withTimeout(
          binding.send({
            to,
            from: fromName ? { email: from, name: fromName } : from,
            subject,
            text: body,
            html,
          }),
          timeoutMs,
          "Cloudflare Email",
        );
        return { id: result?.messageId ?? null };
      },
    };
  if (resendKey && typeof fetchImpl === "function")
    return {
      enabled: true,
      provider: "resend",
      from,
      async send({ to, subject, text: body, html }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(base + "/emails", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + resendKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromName ? `${fromName} <${from}>` : from,
              to: [to],
              subject,
              text: body,
              html,
            }),
            signal: controller.signal,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok)
            fail("Resend " + response.status + ": " + String(data?.message ?? data?.name ?? "error").slice(0, 160));
          return { id: data?.id ?? null };
        } catch (error) {
          if (error?.name === "AbortError") fail("Resend timed out after " + timeoutMs + "ms");
          throw error;
        } finally {
          clearTimeout(timer);
        }
      },
    };
  return off;
}
function fail(message) {
  throw new Error(message);
}


// ---------------------------------------------------------------- templates (Thai)
// Text, layout and placeholders live in email-templates.mjs (admins can edit them in
// ตั้งค่า › ข้อความอีเมล). These wrappers render the built-in defaults; senders that have
// the database use createEmailTemplateApis().render() so the admin's version wins.

export const templates = {
  passwordReset: (args) => renderTemplate("password_reset", args),
  orderConfirmed: (args) => renderTemplate(args?.preorder ? "preorder_confirmed" : "order_confirmed", args),
  /** Admin announcement (ลูกค้า › ประกาศถึงลูกค้า). Plain text; line breaks kept. */
  broadcast: (args) => renderTemplate("broadcast", args),
  preorderReady: (args) => renderTemplate("preorder_ready", args),
  /** "แจ้งเตือนเมื่อสินค้าเข้า": sent once per request; never says how many are in stock. */
  backInStock: (args) => renderTemplate("back_in_stock", args),
};
