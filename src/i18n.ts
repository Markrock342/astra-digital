// Storefront language. Thai strings are the keys; English comes from i18n-en.
// The back office (merchant scope) always stays in Thai.
import { EN_STRINGS } from "./i18n-en";

export type Lang = "th" | "en";
const EN: Record<string, string> = EN_STRINGS;
const STORAGE = "asiax-lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved === "th" || saved === "en") return saved;
  } catch {
    /* storage blocked: fall back to Thai */
  }
  return "th";
}

let chosen: Lang = initial();
let merchant = false;

export const getLang = (): Lang => (merchant ? "th" : chosen);
export const locale = () => (getLang() === "en" ? "en-US" : "th-TH");

export function setLang(lang: Lang) {
  chosen = lang;
  try {
    localStorage.setItem(STORAGE, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
}

/** Called by App on every render so admin pages keep Thai. */
export function setMerchantScope(value: boolean) {
  merchant = value;
  document.documentElement.lang = getLang();
}

/** Translate a Thai UI string; `{name}` placeholders are filled from vars. */
export function t(th: string, vars?: Record<string, string | number>) {
  let text = getLang() === "en" ? (EN[th] ?? th) : th;
  if (vars)
    text = text.replace(/\{(\w+)\}/g, (_, key: string) =>
      String(vars[key] ?? ""),
    );
  return text;
}
