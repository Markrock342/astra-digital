// ASIA EXTRA brand pieces: logo, theme preferences, language toggle,
// scroll progress and the marquee strip. Preferences are per-browser only.
import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Palette, Sun, X } from "lucide-react";
import { getLang, t, type Lang } from "./i18n";

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

type Mode = "system" | "light" | "dark";
type Accent = "blue" | "yellow" | "mono" | "duo";
type Shape = "soft" | "round" | "sharp";
type Motion = "full" | "calm";
type Prefs = { mode: Mode; accent: Accent; shape: Shape; motion: Motion };
const KEY = "asiax-theme";
const DEFAULTS: Prefs = {
  mode: "light",
  accent: "blue",
  shape: "soft",
  motion: "full",
};

function readPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULTS, ...saved };
  } catch {
    /* storage blocked or corrupt: defaults */
  }
  return DEFAULTS;
}

function apply(prefs: Prefs) {
  const root = document.documentElement;
  const dark =
    prefs.mode === "dark" ||
    (prefs.mode === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.accent = prefs.accent;
  root.dataset.shape = prefs.shape;
  root.dataset.motion = prefs.motion;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0a0a0a" : "#ffffff");
}

const listeners = new Set<(p: Prefs) => void>();
let prefs = readPrefs();
if (typeof document !== "undefined") apply(prefs);

function update(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  // Animate the colour change instead of flashing.
  const root = document.documentElement;
  root.classList.add("theme-fade");
  apply(prefs);
  setTimeout(() => root.classList.remove("theme-fade"), 450);
  listeners.forEach((fn) => fn(prefs));
}

function usePrefs() {
  const [value, setValue] = useState(prefs);
  useEffect(() => {
    listeners.add(setValue);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => prefs.mode === "system" && apply(prefs);
    media.addEventListener("change", onChange);
    return () => {
      listeners.delete(setValue);
      media.removeEventListener("change", onChange);
    };
  }, []);
  return value;
}

const MODES: [Mode, typeof Sun, string][] = [
  ["system", Monitor, "ตามระบบ"],
  ["light", Sun, "สว่าง"],
  ["dark", Moon, "มืด"],
];

/** Compact light/dark/system switch (footer). */
export function ThemeSwitch() {
  const { mode } = usePrefs();
  return (
    <div className="theme-switch" aria-label={t("รูปแบบสี")}>
      {MODES.map(([value, Icon, label]) => (
        <button
          key={value}
          className={mode === value ? "selected" : ""}
          aria-label={t("ธีม" + label)}
          aria-pressed={mode === value}
          onClick={() => update({ mode: value })}
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
const SHAPES: [Shape, string][] = [
  ["soft", "มน"],
  ["round", "โค้งมาก"],
  ["sharp", "เหลี่ยม"],
];

/** Header button + slide-in panel to tune mode, accent, corners and motion. */
export function ThemePanel() {
  const current = usePrefs();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panel.current &&
        !panel.current.contains(target) &&
        !(target as Element).closest?.(".theme-trigger")
      )
        setOpen(false);
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
        className="icon-button theme-trigger"
        aria-label={t("ปรับธีม")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Palette size={20} />
      </button>
      <div
        ref={panel}
        className={open ? "theme-panel open" : "theme-panel"}
        role="dialog"
        aria-label={t("ปรับธีม")}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="theme-panel-head">
          <strong>{t("ปรับธีม")}</strong>
          <button
            className="icon-button"
            aria-label={t("ปิด")}
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <fieldset>
          <legend>{t("โหมดสี")}</legend>
          <div className="theme-options three">
            {MODES.map(([value, Icon, label]) => (
              <button
                key={value}
                className={current.mode === value ? "selected" : ""}
                aria-pressed={current.mode === value}
                onClick={() => update({ mode: value })}
              >
                <Icon size={16} />
                {t(label)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("สีเน้น")}</legend>
          <div className="theme-options swatches">
            {ACCENTS.map(([value, label]) => (
              <button
                key={value}
                className={current.accent === value ? "selected" : ""}
                aria-pressed={current.accent === value}
                onClick={() => update({ accent: value })}
              >
                <i className={"swatch swatch-" + value} />
                {t(label)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("มุมขอบ")}</legend>
          <div className="theme-options three">
            {SHAPES.map(([value, label]) => (
              <button
                key={value}
                className={current.shape === value ? "selected" : ""}
                aria-pressed={current.shape === value}
                onClick={() => update({ shape: value })}
              >
                <i className={"shape-chip shape-" + value} />
                {t(label)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="theme-toggle-row">
          <span>{t("ภาพเคลื่อนไหว")}</span>
          <input
            type="checkbox"
            role="switch"
            checked={current.motion === "full"}
            onChange={(e) =>
              update({ motion: e.target.checked ? "full" : "calm" })
            }
          />
        </label>
        <button
          className="theme-reset"
          onClick={() => update({ ...DEFAULTS })}
        >
          {t("คืนค่าเริ่มต้น")}
        </button>
      </div>
    </>
  );
}

export function LanguageToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (lang: Lang) => void;
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
          onClick={() => onChange(value)}
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

export function Marquee() {
  const items = [
    t("ส่งสินค้าทันทีหลังชำระเงิน"),
    t("ปลอดภัย เข้ารหัสทุกโค้ด"),
    t("ติดต่อร้านผ่าน LINE ได้"),
    t("รีวิวจากผู้ซื้อจริง"),
    t("สั่งจองล่วงหน้าได้"),
  ];
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
