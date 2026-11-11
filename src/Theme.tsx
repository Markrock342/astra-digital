// ASIA EXTRA brand pieces: logo, theme preferences, language toggle,
// scroll progress and the marquee strip. Preferences are per-browser only.
import { useEffect, useRef, useState } from "react";
import { Palette, X } from "lucide-react";
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

type Accent = "blue" | "yellow" | "mono" | "duo";
const ACCENT_KEY = "asiax-accent";
const ACCENT_VALUES: Accent[] = ["blue", "yellow", "duo", "mono"];

// Light/dark always follows the device; corners are fixed to the soft style.
// The only visitor choice is the accent colour.
function readAccent(): Accent {
  try {
    const saved = localStorage.getItem(ACCENT_KEY);
    if (ACCENT_VALUES.includes(saved as Accent)) return saved as Accent;
  } catch {
    /* storage blocked: default */
  }
  return "blue";
}

const darkQuery =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-color-scheme: dark)")
    : null;

function apply(value: Accent) {
  const root = document.documentElement;
  const dark = !!darkQuery?.matches;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.accent = value;
  root.dataset.shape = "soft";
  root.dataset.motion = "full";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0a0a0a" : "#ffffff");
}

const listeners = new Set<(a: Accent) => void>();
let accent = readAccent();
if (typeof document !== "undefined") {
  apply(accent);
  darkQuery?.addEventListener("change", () => {
    const root = document.documentElement;
    root.classList.add("theme-fade");
    apply(accent);
    setTimeout(() => root.classList.remove("theme-fade"), 450);
  });
}

function setAccent(value: Accent) {
  accent = value;
  try {
    localStorage.setItem(ACCENT_KEY, value);
  } catch {
    /* ignore */
  }
  // Animate the colour change instead of flashing.
  const root = document.documentElement;
  root.classList.add("theme-fade");
  apply(accent);
  setTimeout(() => root.classList.remove("theme-fade"), 450);
  listeners.forEach((fn) => fn(accent));
}

function useAccent() {
  const [value, setValue] = useState(accent);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

const ACCENTS: [Accent, string][] = [
  ["blue", "น้ำเงิน ASIA"],
  ["yellow", "เหลือง EXTRA"],
  ["duo", "น้ำเงิน-เหลือง"],
  ["mono", "ขาวดำ"],
];

/** Header button + small panel to pick the accent colour. */
export function ThemePanel() {
  const current = useAccent();
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
          <strong>{t("สีธีม")}</strong>
          <button
            className="icon-button"
            aria-label={t("ปิด")}
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="theme-options swatches">
          {ACCENTS.map(([value, label]) => (
            <button
              key={value}
              className={current === value ? "selected" : ""}
              aria-pressed={current === value}
              onClick={() => setAccent(value)}
            >
              <i className={"swatch swatch-" + value} />
              {t(label)}
            </button>
          ))}
        </div>
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
