// Storefront price display for pricing rules (server/pricing.mjs): the price this customer
// pays now, the struck-through "was" price with a -X% badge, sale end / tag-price notes and
// the per-account purchase limit. The server decides every number; this only shows it.
import { money, shopInstant } from "./api";
import { locale, t } from "./i18n";
import { MAX_PER_ORDER, type Variant } from "./types";
import "./pricing.css";

/** "-25%" badge, or nothing. */
export function DiscountBadge({ variant }: { variant: Variant }) {
  if (!variant.compareAt || !variant.discountPercent) return null;
  return (
    <span className="price-badge" aria-label={t("ลด {n}%", { n: variant.discountPercent })}>
      -{variant.discountPercent}%
    </span>
  );
}

/** Struck-through price (screen readers hear "ราคาปกติ ฿X"). */
export function WasPrice({ variant }: { variant: Variant }) {
  if (!variant.compareAt) return null;
  return (
    <s className="price-was">
      <span className="sr-only">{t("ราคาปกติ")} </span>
      {money(variant.compareAt)}
    </s>
  );
}

const shortDate = (value: string) =>
  shopInstant(value).toLocaleString(locale(), {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Price block: current price, was price, badge and a one-line note. */
export function PriceDisplay({ variant, className = "" }: { variant: Variant; className?: string }) {
  return (
    <div className={"price-display " + className}>
      <span className="price-now">{money(variant.price)}</span>
      <WasPrice variant={variant} />
      <DiscountBadge variant={variant} />
      <PriceNote variant={variant} />
    </div>
  );
}

/** "ราคาสำหรับ ตัวแทน" or "ลดราคาถึง 1 ธ.ค. 23:59". */
export function PriceNote({ variant }: { variant: Variant }) {
  if (variant.priceKind === "tag" && variant.priceTag)
    return <span className="price-note price-note-tag">{t("ราคาสำหรับ {tag}", { tag: variant.priceTag })}</span>;
  if (variant.priceKind === "sale" && variant.saleEndsAt)
    return <span className="price-note">{t("ลดราคาถึง {date}", { date: shortDate(variant.saleEndsAt) })}</span>;
  return null;
}

/** Most this customer can put in one order for this option. */
export function quantityCap(variant: Variant) {
  if (!variant.available) return 0;
  return variant.remainingForYou == null
    ? MAX_PER_ORDER
    : Math.max(0, Math.min(MAX_PER_ORDER, variant.remainingForYou));
}

/** "จำกัด 1 ชิ้นต่อบัญชี" (+ how many are left for a signed-in customer). */
export function PurchaseLimitNote({ variant }: { variant: Variant }) {
  if (!variant.maxPerCustomer) return null;
  const left = variant.remainingForYou;
  return (
    <p className={"purchase-limit" + (left === 0 ? " purchase-limit-reached" : "")}>
      {t("จำกัด {n} ชิ้นต่อบัญชี", { n: variant.maxPerCustomer })}
      {left == null
        ? ""
        : left === 0
          ? " · " + t("คุณซื้อครบจำนวนแล้ว")
          : left < variant.maxPerCustomer
            ? " · " + t("สั่งได้อีก {n} ชิ้น", { n: left })
            : ""}
    </p>
  );
}
