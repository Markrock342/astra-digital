// Storefront side of ตั้งค่า › หน้าตาร้าน: the admin's texts / links / colours from
// /api/overview (`appearance`), with the built-in defaults until the overview arrives.
// Admin-entered text is shown as typed (Thai, or English when the visitor picked English and
// the admin filled it in); it never goes through t(), and it is always rendered as text nodes.
import { useEffect, type ReactNode } from "react";
import {
  Award,
  ArrowRight,
  BadgeCheck,
  Clock,
  CreditCard,
  Gift,
  Headphones,
  History,
  KeyRound,
  Lock,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Link, useStore } from "./App";
import { getLang, t } from "./i18n";
import { applyShopTheme } from "./Theme";
import {
  DEFAULT_APPEARANCE,
  pick,
  type Appearance,
  type TextPair,
} from "../server/appearance-rules.mjs";
import "./appearance.css";

/** The fixed icon set an admin can choose for a trust card (TRUST_ICONS on the server). */
export const TRUST_ICON_COMPONENTS: Record<string, LucideIcon> = {
  ShieldCheck,
  KeyRound,
  History,
  Wallet,
  Zap,
  Clock,
  Lock,
  BadgeCheck,
  Headphones,
  MessageCircle,
  CreditCard,
  Gift,
  Star,
  ThumbsUp,
  Sparkles,
  Award,
};

export function useAppearance(): Appearance {
  const { overview } = useStore();
  return (overview?.appearance ?? DEFAULT_APPEARANCE) as Appearance;
}

/** Text in the visitor's language. */
export const text = (value: TextPair | null | undefined) => pick(value, getLang());

/** In-shop path → SPA link; https URL → new tab. */
export function ShopLink({ to, className = "", children }: { to: string; className?: string; children: ReactNode }) {
  if (to.startsWith("/"))
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  return (
    <a href={to} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Shop colours + default accent, applied on the storefront (and drafts in the admin preview). */
export function useShopTheme(preview: boolean) {
  const colors = useAppearance().colors;
  const { overview } = useStore();
  const ready = !!overview?.appearance;
  useEffect(() => {
    if (ready) applyShopTheme(colors, { preview });
  }, [ready, preview, colors.primary, colors.secondary, colors.defaultAccent]);
}

/** Favicon / app icon: the uploaded one, else the built-in files from index.html. */
export function useShopIcon() {
  const icon = useAppearance().seo.faviconUrl ?? null;
  useEffect(() => {
    for (const [rel, fallback] of [
      ["icon", "/brand/favicon-64.png"],
      ["apple-touch-icon", "/brand/apple-touch-icon.png"],
    ]) {
      const el = document.head.querySelector(`link[rel="${rel}"]`);
      const href = icon || fallback;
      if (el && el.getAttribute("href") !== href) {
        el.setAttribute("href", href);
        if (rel === "icon") {
          if (icon) el.removeAttribute("type");
          else el.setAttribute("type", "image/png");
        }
      }
    }
  }, [icon]);
}

/** Shop colours, default accent and favicon (rendered once inside the app shell). */
export function AppearanceEffects({ preview }: { preview: boolean }) {
  useShopTheme(preview);
  useShopIcon();
  return null;
}

/** "ซื้อสินค้าอย่างมั่นใจ" block on the เครดิตร้าน page — only when the admin switches it on. */
export function TrustBlock() {
  const trust = useAppearance().trust;
  if (!trust.show) return null;
  const body = text(trust.text);
  return (
    <section className="trust-block" aria-labelledby="trust-block-title" data-testid="trust-block">
      <div className="trust-block-head">
        <h2 id="trust-block-title">
          <ShieldCheck size={22} aria-hidden="true" />
          {text(trust.heading)}
        </h2>
        {body && <p>{body}</p>}
      </div>
      <div className="trust-block-cards">
        {trust.cards.map((card, i) => {
          const Icon = TRUST_ICON_COMPONENTS[card.icon] ?? ShieldCheck;
          const detail = text(card.text);
          return (
            <article className="trust-block-card" key={i}>
              <span className="trust-block-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h3>{text(card.title)}</h3>
              {detail && <p>{detail}</p>}
            </article>
          );
        })}
      </div>
      <Link to="/products" className="button primary trust-block-cta">
        {t("เลือกดูสินค้า")}
        <ArrowRight size={17} />
      </Link>
    </section>
  );
}
