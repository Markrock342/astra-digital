// ASIA EXTRA brand pieces: logo, theme preferences, language toggle,
// scroll progress and the marquee strip. Preferences are per-browser only.
import { useEffect, useRef, useState } from "react";
import { Languages, Monitor, Moon, Sun, X } from "lucide-react";
import { getLang, t, type Lang } from "./i18n";
import { colorTokens } from "../server/appearance-rules.mjs";

export const BRAND = "ASIA EXTRA";
/** The server's untouched default name means the owner has not named the shop yet. */
export const shopName = (name?: string) =>
  name && name !== "ร้านค้า" ? name : BRAND;

export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={"brand-logo " + className}>
      <img src="/brand/asiax-logo.png" alt={BRAND} draggable={false} />
    </span>
  );
}

type Accent = "blue" | "yellow" | "mono" | "duo" | "custom";
type Mode = "system" | "light" | "dark";
const ACCENT_KEY = "asiax-accent";
const MODE_KEY = "asiax-mode";
// Last known shop settings (ตั้งค่า › หน้าตาร้าน), so a returning visitor's first paint already
// uses them: the default accent and the generated brand-colour CSS.
const SHOP_ACCENT_KEY = "asiax-shop-accent";
const SHOP_COLORS_KEY = "asiax-shop-colors";
const ACCENT_VALUES: Accent[] = ["blue", "yellow", "duo", "mono", "custom"];
// "เลือกสีเอง": the visitor's own hue (0–359) on the colour slider.
const HUE_KEY = "asiax-accent-hue";
const MODE_VALUES: Mode[] = ["system", "light", "dark"];

// Light/dark follows the device unless the visitor picks one; corners stay soft.
function read<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (allowed.includes(saved as T)) return saved as T;
  } catch {
    /* storage blocked: default */
  }
  return fallback;
}

const darkQuery =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-color-scheme: dark)")
    : null;

/** The visitor's own pick (theme panel) always wins over the shop's default accent. */
let picked = read<Accent | "">(ACCENT_KEY, ACCENT_VALUES, "");
let accent: Accent = picked || read(SHOP_ACCENT_KEY, ACCENT_VALUES, "blue");
/** True while the shop's own brand colours are applied (theme panel names change). */
let custom = false;
let mode = read(MODE_KEY, MODE_VALUES, "system");
let hue = readHue();

function readHue() {
  try {
    const n = Number(localStorage.getItem(HUE_KEY));
    if (Number.isInteger(n) && n >= 0 && n < 360) return n;
  } catch {
    /* storage blocked */
  }
  return 220;
}
/** hsl → #rrggbb (fixed saturation / lightness: every hue stays a usable brand colour). */
export function hueHex(h: number) {
  const s = 0.82;
  const l = 0.5;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}
/** Tokens for data-accent="custom", from the same contrast maths as the shop colours. */
function writeHueStyle() {
  let el = document.getElementById("visitor-accent") as HTMLStyleElement | null;
  if (accent !== "custom") return el?.remove();
  const c = colorTokens(hueHex(hue));
  const css =
    `:root:root[data-accent="custom"] .storefront-shell{--accent:${c.light.fill};--accent-2:${c.light.fill2};--accent-ink:${c.light.ink};--accent-text:${c.light.text}}` +
    `:root:root[data-theme="dark"][data-accent="custom"] .storefront-shell{--accent:${c.dark.fill};--accent-ink:${c.dark.ink};--accent-text:${c.dark.text}}`;
  if (!el) {
    el = document.createElement("style");
    el.id = "visitor-accent";
    document.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

function apply() {
  const root = document.documentElement;
  const dark = mode === "dark" || (mode === "system" && !!darkQuery?.matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.accent = accent;
  writeHueStyle();
  root.dataset.shape = "soft";
  root.dataset.motion = "full";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0a0a0a" : "#ffffff");
}
function fade() {
  // Animate the colour change instead of flashing.
  const root = document.documentElement;
  root.classList.add("theme-fade");
  apply();
  setTimeout(() => root.classList.remove("theme-fade"), 450);
}

const listeners = new Set<() => void>();
if (typeof document !== "undefined") {
  try {
    writeColorStyle(localStorage.getItem(SHOP_COLORS_KEY) ?? "");
  } catch {
    /* storage blocked: colours arrive with the overview */
  }
  apply();
  darkQuery?.addEventListener("change", () => mode === "system" && fade());
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function setAccent(value: Accent) {
  accent = value;
  picked = value;
  save(ACCENT_KEY, value);
  fade();
  listeners.forEach((fn) => fn());
}
function setHue(value: number) {
  hue = Math.max(0, Math.min(359, Math.round(value)));
  save(HUE_KEY, String(hue));
  accent = "custom";
  picked = "custom";
  save(ACCENT_KEY, "custom");
  apply();
  listeners.forEach((fn) => fn());
}
function setMode(value: Mode) {
  mode = value;
  save(MODE_KEY, value);
  fade();
  listeners.forEach((fn) => fn());
}

type ShopColors = { primary: string | null; secondary: string | null };

/**
 * CSS for the shop's own brand colours. Only the storefront's accent tokens change (fills,
 * accent text, the ink on fills, the brand swatches); text, muted, border and background tokens
 * never do, so footer text such as the theme credit keeps its contrast. `:root:root` outranks
 * the matching brand.css rule; each brand.css accent rule has a counterpart here.
 */
export function shopColorCss({ primary, secondary }: ShopColors) {
  const rules: string[] = [];
  const root = [primary && "--brand-blue:" + primary, secondary && "--brand-yellow:" + secondary].filter(Boolean);
  if (root.length) rules.push(":root:root{" + root.join(";") + "}");
  const shell = (selectors: string[]) => selectors.map((x) => ":root:root" + x + " .storefront-shell").join(",");
  if (primary) {
    const p = colorTokens(primary);
    rules.push(
      shell(['[data-accent="blue"]', '[data-accent="duo"]']) +
        `{--accent:${p.light.fill};--accent-ink:${p.light.ink};--accent-text:${p.light.text}}`,
      shell(['[data-accent="blue"]']) + `{--accent-2:${p.light.fill2}}`,
      shell(['[data-theme="dark"][data-accent="blue"]', '[data-theme="dark"][data-accent="duo"]']) +
        `{--accent:${p.dark.fill};--accent-ink:${p.dark.ink};--accent-text:${p.dark.text}}`,
    );
  }
  if (secondary) {
    const y = colorTokens(secondary);
    rules.push(
      shell(['[data-accent="yellow"]']) +
        `{--accent:${y.light.fill};--accent-2:${y.light.fill2};--accent-ink:${y.light.ink};--accent-text:${y.light.text}}`,
      shell(['[data-theme="dark"][data-accent="yellow"]']) +
        `{--accent:${y.dark.fill};--accent-ink:${y.dark.ink};--accent-text:${y.dark.text}}`,
    );
  }
  return rules.join("\n");
}
function writeColorStyle(css: string) {
  let el = document.getElementById("shop-colors") as HTMLStyleElement | null;
  custom = !!css;
  if (!css) return el?.remove();
  if (!el) {
    el = document.createElement("style");
    el.id = "shop-colors";
    document.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/**
 * Shop brand colours + the accent visitors see first (from /api/overview). `preview` = the
 * admin's live preview frame: show the draft as a first-time visitor would, never remember it.
 */
export function applyShopTheme(
  colors: ShopColors & { defaultAccent: Accent },
  { preview = false }: { preview?: boolean } = {},
) {
  writeColorStyle(shopColorCss(colors));
  if (!preview) {
    save(SHOP_ACCENT_KEY, colors.defaultAccent);
    save(SHOP_COLORS_KEY, shopColorCss(colors));
  }
  const next: Accent = preview ? colors.defaultAccent : picked || colors.defaultAccent;
  if (next !== accent) {
    accent = next;
    apply();
  }
  listeners.forEach((fn) => fn());
}

function useTheme() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { accent, mode };
}

const MODES: [Mode, typeof Sun, string][] = [
  ["system", Monitor, "ตามระบบ"],
  ["light", Sun, "สว่าง"],
  ["dark", Moon, "มืด"],
];

/** Compact light/dark/system switch (footer). */
export function ThemeSwitch() {
  const current = useTheme();
  return (
    <div className="theme-switch" aria-label={t("รูปแบบสี")}>
      {MODES.map(([value, Icon, label]) => (
        <button
          key={value}
          className={current.mode === value ? "selected" : ""}
          aria-label={t("ธีม" + label)}
          aria-pressed={current.mode === value}
          onClick={() => setMode(value)}
        >
          <Icon size={17} />
        </button>
      ))}
    </div>
  );
}

const ACCENTS: [Accent, string][] = [
  ["blue", "น้ำเงิน ASIA"],
  ["yellow", "เหลือง EXTRA"],
  ["duo", "น้ำเงิน-เหลือง"],
  ["mono", "ขาวดำ"],
];
/** Names when the shop set its own colours (blue / yellow would be wrong). */
const CUSTOM_ACCENTS: [Accent, string][] = [
  ["blue", "สีหลักของร้าน"],
  ["yellow", "สีรองของร้าน"],
  ["duo", "สีหลัก-สีรอง"],
  ["mono", "ขาวดำ"],
];

/**
 * Header "ภาษา + ธีม" button + small popover: TH/EN, light/dark/system and the accent colour.
 * Popover pattern from shadcn/ui Popover (MIT, https://ui.shadcn.com): anchored panel, Esc and
 * outside click close it, focus moves in on open and back to the trigger on Esc.
 */
export function PrefsPanel({
  lang,
  onLangChange,
}: {
  lang: Lang;
  onLangChange: (lang: Lang, origin?: { x: number; y: number }) => void;
}) {
  const current = useTheme();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button[aria-pressed='true']")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current && !panel.current.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    addEventListener("keydown", onKey);
    addEventListener("mousedown", onClick);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("mousedown", onClick);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="prefs-trigger"
        aria-label={t("ภาษาและธีม")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Languages size={17} aria-hidden="true" />
        <span aria-hidden="true">{lang === "th" ? "TH" : "EN"}</span>
      </button>
      <div
        ref={panel}
        className={open ? "theme-panel prefs-panel open" : "theme-panel prefs-panel"}
        role="dialog"
        aria-label={t("ภาษาและธีม")}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="theme-panel-head">
          <strong>{t("ภาษาและธีม")}</strong>
          <button className="icon-button" aria-label={t("ปิด")} onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <fieldset>
          <legend>{t("ภาษา")}</legend>
          <LanguageToggle lang={lang} onChange={onLangChange} />
        </fieldset>
        <fieldset>
          <legend>{t("โหมดสี")}</legend>
          <div className="theme-options three">
            {MODES.map(([value, Icon, label]) => (
              <button
                key={value}
                className={current.mode === value ? "selected" : ""}
                aria-pressed={current.mode === value}
                onClick={() => setMode(value)}
              >
                <Icon size={16} />
                {t(label)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("สีธีม")}</legend>
          <div className="theme-options swatches">
            {(custom ? CUSTOM_ACCENTS : ACCENTS).map(([value, label]) => (
              <button
                key={value}
                className={current.accent === value ? "selected" : ""}
                aria-pressed={current.accent === value}
                onClick={() => setAccent(value)}
              >
                <i className={"swatch swatch-" + value} />
                {t(label)}
              </button>
            ))}
          </div>
          <label className={"hue-picker" + (current.accent === "custom" ? " selected" : "")}>
            <span>
              <i className="swatch" style={{ background: hueHex(hue) }} />
              {t("เลือกสีเอง")}
            </span>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={hue}
              aria-label={t("เลือกสีเอง")}
              aria-valuetext={hueHex(hue)}
              onChange={(e) => setHue(Number(e.target.value))}
            />
          </label>
        </fieldset>
      </div>
    </>
  );
}

export function LanguageToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (lang: Lang, origin?: { x: number; y: number }) => void;
}) {
  return (
    <div
      className="lang-toggle"
      role="group"
      aria-label={t("ภาษา")}
      data-lang={lang}
    >
      <span className="lang-thumb" aria-hidden="true" />
      {(["th", "en"] as Lang[]).map((value) => (
        <button
          key={value}
          aria-pressed={lang === value}
          lang={value}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            onChange(value, {
              x: box.left + box.width / 2,
              y: box.top + box.height / 2,
            });
          }}
        >
          {value === "th" ? "TH" : "EN"}
        </button>
      ))}
    </div>
  );
}

export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        bar.current?.style.setProperty(
          "--progress",
          String(max > 0 ? scrollY / max : 0),
        );
      });
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  return <div ref={bar} className="scroll-progress" aria-hidden="true" />;
}

/** Scrolling strip; items = the shop's texts in the visitor's language (ตั้งค่า › หน้าตาร้าน). */
export function Marquee({ items }: { items: string[] }) {
  const row = [...items, ...items];
  return (
    <div className="marquee" aria-hidden="true" lang={getLang()}>
      <div className="marquee-track">
        {row.map((item, i) => (
          <span key={i}>
            {item}
            <i className="marquee-x">✕</i>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Subtle pointer-following tilt for product cards (skipped on touch / calm). */
export function useCardTilt() {
  useEffect(() => {
    if (matchMedia("(hover: none)").matches) return;
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element).closest?.(
        ".storefront-shell .product-card",
      ) as HTMLElement | null;
      if (!card || document.documentElement.dataset.motion === "calm") return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", String((e.clientX - r.left) / r.width));
      card.style.setProperty("--my", String((e.clientY - r.top) / r.height));
    };
    addEventListener("pointermove", onMove, { passive: true });
    return () => removeEventListener("pointermove", onMove);
  }, []);
}
