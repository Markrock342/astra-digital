// หน้ารับสินค้า (client, 21 Nov) + the short "สั่งซื้อสำเร็จ" screen before it.
//
// - OrderSuccessPage (/order-success?to=…&kind=ready|preorder): a check with a short pop +
//   ring, then it replaces itself with the order page (Back does not return to it).
// - OrderReceivedView: a delivered order, redesigned. Three groups — the product, what was
//   received (each account's ID + password in ONE box, codes, links, or the shop's message),
//   and one row of actions: แจ้งปัญหา · วิธีใช้งาน (text + pictures) · ใบเสร็จ. No success icon,
//   no ask-in-chat / hide-code / keep-safe note / buy again / shop more / review.
// Layout follows shadcn/ui Card + Sheet + Button groups (MIT, https://ui.shadcn.com).
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  MessageSquareWarning,
  ReceiptText,
  RotateCcw,
  TicketPercent,
  Users,
} from "lucide-react";
import { ManualOrderNote } from "./ManualOrderNote";
import { Art, Link, Status, shownStatus, useStore } from "./App";
import { dateTime, money } from "./api";
import { FulfilmentCard, useCopy } from "./Delivery";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { REPORT_EVENT, type ReportContext, UsageText } from "./OrderExtras";
import { OrderReceiptCard } from "./OrderReceipts";
import { BottomSheet } from "./Sheet";
import { TaxInvoiceCard } from "./TaxInvoice";
import type { Order, Product } from "./types";
import { WarrantyStatus } from "./Warranty";
import "./order-received.css";

const EN: Record<string, string> = {
  "สั่งซื้อสำเร็จ": "Order complete",
  "จองสำเร็จ": "Reservation complete",
  "กำลังพาไปหน้ารับสินค้า": "Taking you to your order",
  "กำลังพาไปหน้าคำสั่งซื้อ": "Taking you to your order",
  "สินค้าที่ได้รับ": "What you received",
  "อีเมล / ไอดี": "Email / ID",
  "คัดลอกทั้งหมด": "Copy all",
  "คัดลอกแล้ว": "Copied",
  "วิธีใช้งาน": "How to use",
  "ใบเสร็จ": "Receipt",
  "แจ้งปัญหา": "Report a problem",
  "ยังไม่มีวิธีใช้งานสำหรับสินค้านี้": "No instructions for this product yet",
  "ข้อมูลที่คุณให้ไว้": "What you told the shop",
  "ทั้งคำสั่งซื้อ": "Whole order",
};
for (const [th, en] of Object.entries(EN)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

const SUCCESS_MS = 1800;

/** /order-success — shown once after paying, then replaced by the order page. */
export function OrderSuccessPage() {
  const { go } = useStore();
  const params = new URLSearchParams(location.search);
  const raw = params.get("to") ?? "/orders";
  // Only shop paths (no //host): the screen can never send anyone off-site.
  const to = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/orders";
  const preorder = params.get("kind") === "preorder";
  useEffect(() => {
    const timer = setTimeout(() => go(to, { replace: true }), SUCCESS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);
  return (
    <main className="container page-main order-success" role="status" aria-live="polite">
      <div className="order-success-mark" aria-hidden="true">
        <span className="order-success-ring" />
        <span className="order-success-disc">
          <Check size={44} strokeWidth={3} />
        </span>
      </div>
      <h1>{preorder ? t("จองสำเร็จ") : t("สั่งซื้อสำเร็จ")}</h1>
      <p>{preorder ? t("กำลังพาไปหน้าคำสั่งซื้อ") : t("กำลังพาไปหน้ารับสินค้า")}</p>
    </main>
  );
}

/** Where to send the buyer after paying: through the success screen. */
export const successPath = (to: string, preorder: boolean) =>
  "/order-success?to=" + encodeURIComponent(to) + (preorder ? "&kind=preorder" : "");

const coverOf = (products: Product[], variantId?: string) => {
  const p = variantId ? products.find((x) => x.variants?.some((v) => v.id === variantId)) : undefined;
  return p?.images?.[0]?.url ?? p?.imageUrl ?? null;
};

export function OrderReceivedView({ order }: { order: Order }) {
  const { products } = useStore();
  const copy = useCopy();
  // /receipts links here with ?receipt=open: open the receipt sheet straight away.
  const [sheet, setSheet] = useState<null | "usage" | "receipt">(() =>
    new URLSearchParams(location.search).get("receipt") === "open" ? "receipt" : null,
  );
  const extra = order as Order & {
    usageInstructions?: string | null;
    usageImages?: { id: string; url: string }[];
    deliveredAt?: string | null;
  };
  const number = order.id.slice(0, 8).toUpperCase();
  // A shop-fulfilled product (waiting / done) shows the shop's card; a preorder questionnaire
  // ("input": answers only) still shows the account like any other order.
  const shopFulfilled = !!order.fulfilment && order.fulfilment.state !== "input";
  const answers = !shopFulfilled ? (order.fulfilment?.inputs ?? []) : [];
  const hasUsage = !!extra.usageInstructions || !!extra.usageImages?.length;
  const report = () => {
    const detail: ReportContext = {
      orderId: order.id,
      number,
      product: order.name,
      option: order.label,
      deliveredAt: extra.deliveredAt ?? null,
      warrantyUntil: order.warranty_until ?? null,
    };
    dispatchEvent(new CustomEvent(REPORT_EVENT, { detail }));
  };
  const credentialText = (c: NonNullable<Order["credentials"]>[number]) =>
    [c.loginId, c.password, c.profile ? t("โปรไฟล์") + " " + c.profile : "", c.pin ? "PIN " + c.pin : ""]
      .filter(Boolean)
      .join(" | ");
  return (
    <main className="container page-main order-received">
      <Link to="/orders" className="back-link">
        <ArrowLeft size={16} />
        {t("ประวัติการซื้อ")}
      </Link>

      <section className="or-card or-product" aria-labelledby="or-product-name">
        <span className="or-art">
          <Art type={order.art} name={order.name} image={coverOf(products, order.variant_id)} small />
        </span>
        <div className="or-product-main">
          <h1 id="or-product-name">{order.name}</h1>
          <p className="or-option">
            {order.label} · × {order.quantity}
          </p>
          <p className="or-meta">
            #{number} · {dateTime(order.created_at)}
          </p>
          {order.checkout_id && (order.checkoutSize ?? 1) > 1 && (
            <Link to={"/checkouts/" + order.checkout_id} className="or-meta-link">
              {t("ทั้งคำสั่งซื้อ")} #{order.checkout_id.slice(0, 8).toUpperCase()}
            </Link>
          )}
        </div>
        <div className="or-product-side">
          <Status status={shownStatus(order)} />
          <strong>{money(order.total)}</strong>
        </div>
        {order.createdByAdmin && (
          <div className="or-warranty">
            <ManualOrderNote method={order.paymentMethodLabel} />
          </div>
        )}
        {!!order.discount && (
          <dl className="or-price" aria-label={t("สรุปยอด")}>
            <div>
              <dt>{t("ราคาสินค้า")}</dt>
              <dd>{money(order.subtotal ?? order.total + order.discount)}</dd>
            </div>
            <div className="is-discount">
              <dt>
                <TicketPercent size={15} />
                {t("ส่วนลด")}
                {order.coupon_code ? " (" + order.coupon_code + ")" : ""}
              </dt>
              <dd>−{money(order.discount)}</dd>
            </div>
          </dl>
        )}
        {!!order.refundedTotal && (
          <p className="or-refund">
            <RotateCcw size={16} />
            {order.refundStatus === "REFUNDED" ? t("ร้านคืนเงินคำสั่งซื้อนี้แล้ว") : t("ร้านคืนเงินบางส่วนแล้ว")}{" "}
            {money(order.refundedTotal)}
          </p>
        )}
        <div className="or-warranty">
          <WarrantyStatus until={order.warranty_until} />
        </div>
      </section>

      <section className="or-card or-items" aria-labelledby="or-items-title">
        <h2 id="or-items-title">{t("สินค้าที่ได้รับ")}</h2>
        {shopFulfilled ? (
          <FulfilmentCard order={order} />
        ) : (
          <>
            {order.credentials?.map((c, i) => (
              <div className="or-item" key={"c" + i}>
                {c.seat != null && (
                  <span className="or-seat">
                    <Users size={14} />
                    {t("ที่นั่ง {n}", { n: c.seat })}
                  </span>
                )}
                <dl>
                  <div>
                    <dt>{t("อีเมล / ไอดี")}</dt>
                    <dd>{c.loginId}</dd>
                  </div>
                  <div>
                    <dt>{t("รหัสผ่าน")}</dt>
                    <dd>{c.password}</dd>
                  </div>
                  {c.profile && (
                    <div>
                      <dt>{t("โปรไฟล์")}</dt>
                      <dd>{c.profile}</dd>
                    </div>
                  )}
                  {c.pin && (
                    <div>
                      <dt>PIN</dt>
                      <dd>{c.pin}</dd>
                    </div>
                  )}
                </dl>
                <button
                  type="button"
                  className="button secondary or-copy"
                  aria-label={t("คัดลอกทั้งหมด") + " " + (i + 1)}
                  onClick={() => void copy(credentialText(c), t("คัดลอกแล้ว"))}
                >
                  <Copy size={16} />
                  {t("คัดลอก")}
                </button>
              </div>
            ))}
            {order.codes.map((code, i) => (
              <div className="or-item or-item-line" key={"k" + i}>
                <code>{code}</code>
                <button
                  type="button"
                  className="button secondary or-copy"
                  aria-label={t("คัดลอกโค้ด ") + (i + 1)}
                  onClick={() => void copy(code, t("คัดลอกแล้ว"))}
                >
                  <Copy size={16} />
                  {t("คัดลอก")}
                </button>
              </div>
            ))}
            {(order.links ?? []).map((link, i) => (
              <div className="or-item or-item-line" key={"l" + i}>
                <a href={link} target="_blank" rel="noopener noreferrer" className="or-link">
                  <ExternalLink size={16} />
                  <span>{link}</span>
                </a>
                <button
                  type="button"
                  className="button secondary or-copy"
                  aria-label={t("คัดลอก") + " " + (i + 1)}
                  onClick={() => void copy(link, t("คัดลอกแล้ว"))}
                >
                  <Copy size={16} />
                  {t("คัดลอก")}
                </button>
              </div>
            ))}
            {answers.length > 0 && (
              <dl className="or-answers" aria-label={t("ข้อมูลที่คุณให้ไว้")}>
                {answers.map((a) => (
                  <div key={a.id}>
                    <dt>{a.label}</dt>
                    <dd>{a.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </section>

      <div className="or-actions" role="group" aria-label={t("สินค้าที่ได้รับ")}>
        <button type="button" className="or-action" onClick={report}>
          <MessageSquareWarning size={20} />
          <span>{t("แจ้งปัญหา")}</span>
        </button>
        <button type="button" className="or-action" onClick={() => setSheet("usage")} disabled={!hasUsage}>
          <BookOpen size={20} />
          <span>{t("วิธีใช้งาน")}</span>
        </button>
        <button type="button" className="or-action" onClick={() => setSheet("receipt")}>
          <ReceiptText size={20} />
          <span>{t("ใบเสร็จ")}</span>
        </button>
      </div>

      <BottomSheet id="order-usage-sheet" open={sheet === "usage"} onClose={() => setSheet(null)} title={t("วิธีใช้งาน")}>
        <section className="or-usage" aria-label={t("วิธีใช้งานหลังซื้อ")}>
          {extra.usageInstructions ? <UsageText text={extra.usageInstructions} /> : null}
          {extra.usageImages?.map((img, i) => (
            <img key={img.id} src={img.url} alt={t("วิธีใช้งาน") + " " + (i + 1)} loading="lazy" />
          ))}
          {!hasUsage && <p>{t("ยังไม่มีวิธีใช้งานสำหรับสินค้านี้")}</p>}
        </section>
      </BottomSheet>
      <BottomSheet id="order-receipt-sheet" open={sheet === "receipt"} onClose={() => setSheet(null)} title={t("ใบเสร็จ")}>
        <div className="or-receipt">
          <OrderReceiptCard orderId={order.id} />
          <TaxInvoiceCard orderId={order.id} />
        </div>
      </BottomSheet>
    </main>
  );
}
