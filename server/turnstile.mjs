/**
 * Cloudflare Turnstile (bot check) for register, login and forgot-password.
 * On only when both TURNSTILE_SITE_KEY and TURNSTILE_SECRET are set; otherwise every
 * check passes and nothing changes. Verification fails closed (missing token, bad token,
 * timeout or network error → rejected).
 */
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_REJECTED = "กรุณายืนยันว่าคุณไม่ใช่บอท แล้วลองอีกครั้ง";
const TIMEOUT_MS = 5000;

export function createTurnstile(
  env = {},
  {
    fetchImpl = (...args) => globalThis.fetch(...args),
    // TURNSTILE_VERIFY_URL: local smoke tests only (a mock siteverify). Never set in production.
    verifyUrl = (typeof env.TURNSTILE_VERIFY_URL === "string" && env.TURNSTILE_VERIFY_URL.trim()) || SITEVERIFY_URL,
    timeoutMs = TIMEOUT_MS,
  } = {},
) {
  const siteKey = typeof env.TURNSTILE_SITE_KEY === "string" ? env.TURNSTILE_SITE_KEY.trim() : "";
  const secret = typeof env.TURNSTILE_SECRET === "string" ? env.TURNSTILE_SECRET.trim() : "";
  if (!siteKey || !secret || typeof fetchImpl !== "function")
    return { enabled: false, siteKey: null, verify: async () => true };
  return {
    enabled: true,
    siteKey,
    /** true only when siteverify says success for this token. */
    async verify(token, remoteIp) {
      if (typeof token !== "string" || !token || token.length > 2048) return false;
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.set("remoteip", remoteIp);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(verifyUrl, { method: "POST", body, signal: controller.signal });
        if (!response.ok) return false;
        const data = await response.json();
        return data?.success === true;
      } catch (error) {
        console.error("Turnstile verify failed:", error?.message);
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Token sent by the client: our explicit field, or the hidden input the widget adds to forms. */
export function turnstileTokenFrom(input) {
  const value = input?.turnstileToken ?? input?.["cf-turnstile-response"];
  return typeof value === "string" ? value : "";
}
