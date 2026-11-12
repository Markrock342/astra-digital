// Lazy loader for Cloudflare Turnstile + the public auth config from /api/health.
// The script is only requested by pages that render a Turnstile box (login, register,
// forgot-password), never on the rest of the shop.
import { api } from "./api";

export type AuthConfig = { email: boolean; turnstileSiteKey: string | null };
type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// The back office is served with a strict CSP (no third-party scripts). A page first
// loaded under /admin that later routes to /login must reload to get the storefront CSP.
const bootedInAdmin = location.pathname === "/admin" || location.pathname.startsWith("/admin/");

let configCache: Promise<AuthConfig> | null = null;
export function authConfig(): Promise<AuthConfig> {
  configCache ??= api<{ features?: { email?: boolean; turnstile?: boolean }; turnstileSiteKey?: string | null }>("/health")
    .then((h) => ({
      email: !!h.features?.email,
      turnstileSiteKey: h.features?.turnstile && h.turnstileSiteKey ? h.turnstileSiteKey : null,
    }))
    .catch(() => ({ email: false, turnstileSiteKey: null }));
  return configCache;
}

let scriptCache: Promise<TurnstileApi> | null = null;
export function loadTurnstile(): Promise<TurnstileApi> {
  if (bootedInAdmin) {
    location.reload();
    return new Promise(() => {});
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptCache ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      scriptCache = null;
      script.remove();
      reject(new Error("turnstile"));
    };
    document.head.append(script);
  });
  return scriptCache;
}
