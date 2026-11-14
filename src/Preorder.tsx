// Preorder modes on the storefront (server/preorder.mjs): the reserve button + rules on the
// product page and checkout, the queue progress on the order page, and the bell texts.
// Layout follows shadcn/ui (MIT, https://ui.shadcn.com): Alert for notes, Badge, and a simple
// vertical step list for the progress; colours come from the storefront tokens (brand.css).
import { useEffect, useState } from "react";
import { Check, Clock, CreditCard, LoaderCircle, PackageCheck, RotateCcw, Ticket, XCircle } from "lucide-react";
import { ErrorMessage, Link } from "./App";
import { t, locale } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { money, shopInstant } from "./api";
import type { Order, PreorderTerms, Product, Variant } from "./types";
import "./preorder.css";

const EN_PREORDER: Record<string, string> = {
  "จองคิว · มัดจำ {amount}": "Reserve · {amount} deposit",
  "จองคิวฟรี": "Reserve for free",
  "มัดจำ {amount} ตอนจอง ได้เลขคิวทันที": "Pay a {amount} deposit now and get a queue number",
  "ของพร้อมแล้วชำระส่วนที่เหลือ {amount} ภายใน {hours} ชั่วโมง": "When stock is ready, pay the remaining {amount} within {hours} hours",
  "ไม่ชำระตามเวลา: คืนมัดจำเป็นเครดิตร้าน และสิทธิ์ส่งต่อให้คิวถัดไป":
    "If you don't pay in time, the deposit goes back as store credit and your turn passes to the next in line",
  "ไม่ชำระตามเวลา: ร้านเก็บมัดจำ และสิทธิ์ส่งต่อให้คิวถัดไป":
    "If you don't pay in time, the store keeps the deposit and your turn passes to the next in line",
  "จองฟรี ไม่ต้องจ่ายตอนนี้ ได้เลขคิวทันที": "Reserve for free, nothing to pay now, get a queue number",
  "ของพร้อมแล้วชำระเต็มราคา {amount} ภายใน {hours} ชั่วโมง": "When stock is ready, pay the full {amount} within {hours} hours",
  "ไม่ชำระตามเวลา สิทธิ์ส่งต่อให้คิวถัดไป": "If you don't pay in time, your turn passes to the next in line",
  "จองได้ {n} คิวต่อบัญชี": "{n} reservation(s) per account",
  "ร้านจะแจ้งเตือนในเว็บและทางอีเมลเมื่อถึงคิวของคุณ": "We'll notify you on the site and by email when it's your turn",
  "ชำระตอนจอง (มัดจำ)": "Pay now (deposit)",
  "ชำระตอนจอง": "Pay now",
  "ชำระเมื่อถึงคิว": "Pay when it's your turn",
  "จองแล้ว · คิว #{n}": "Reserved · queue #{n}",
  "ของพร้อม · ชำระส่วนที่เหลือ": "Stock ready · pay the rest",
  "ของพร้อม · ชำระเพื่อรับสินค้า": "Stock ready · pay to receive",
  "ส่งแล้ว": "Delivered",
  "รอของเข้า": "Waiting for stock",
  "ก่อนหน้าคุณ {n} คิว": "{n} ahead of you",
  "คุณอยู่คิวแรก": "You're next in line",
  "จ่ายมัดจำแล้ว {amount}": "Deposit paid {amount}",
  "ไม่ได้จ่ายเงินตอนจอง": "Nothing paid when reserving",
  "ชำระ {amount} ภายใน {time}": "Pay {amount} by {time}",
  "เหลือเวลา {h} ชม. {m} นาที": "{h} h {m} min left",
  "เหลือเวลา {m} นาที": "{m} min left",
  "หมดเวลาแล้ว": "Time is up",
  "ชำระส่วนที่เหลือ {amount}": "Pay the rest {amount}",
  "ชำระ {amount} เพื่อรับสินค้า": "Pay {amount} to receive",
  "ร้านกันสินค้าไว้ให้คุณแล้ว ชำระภายในเวลาเพื่อรับ ID และรหัสผ่านทันที":
    "Your item is held for you. Pay in time to get the ID and password right away",
  "ยกเลิกการจอง": "Cancel reservation",
  "ยืนยันยกเลิกการจอง": "Confirm cancellation",
  "ไม่ยกเลิก": "Keep my reservation",
  "ยกเลิกแล้วจะคืนมัดจำเป็นเครดิตร้าน": "Cancelling returns the deposit as store credit",
  "ยกเลิกแล้วร้านจะเก็บมัดจำตามเงื่อนไขที่แจ้งตอนจอง": "If you cancel, the store keeps the deposit as stated when you reserved",
  "ยกเลิกการจองแล้ว": "Reservation cancelled",
  "ร้านยกเลิกการจองของคุณ": "The store cancelled your reservation",
  "หมดเวลาชำระส่วนที่เหลือ": "Payment time ran out",
  "สิทธิ์ส่งต่อให้คิวถัดไปแล้ว": "Your turn has passed to the next in line",
  "คืนมัดจำ {amount} เข้าเครดิตร้านแล้ว": "{amount} deposit returned to your store credit",
  "ร้านเก็บมัดจำ {amount} ตามเงื่อนไขที่แจ้งตอนจอง": "The store kept the {amount} deposit as stated when you reserved",
  "ของพร้อมแล้ว ชำระส่วนที่เหลือ": "Stock is ready — pay the rest",
  "ของพร้อมแล้ว ชำระเพื่อรับสินค้า": "Stock is ready — pay to receive it",
  "ใกล้หมดเวลาชำระพรีออเดอร์": "Pre-order payment time is almost up",
  "หมดเวลาชำระพรีออเดอร์": "Pre-order payment time ran out",
  "ถึงคิวแล้ว · รอชำระ": "Your turn · awaiting payment",
  "หมดเวลาชำระ": "Payment time ran out",
  "ร้านเปิดอีกครั้งแล้วเวลาชำระจะขยายตามเวลาที่ร้านปิด": "Your payment time is extended by however long the store is closed",
  "คิว #{n}": "Queue #{n}",
  "คิว #{n} · ชำระ {amount} ภายใน {time}": "Queue #{n} · pay {amount} within {time}",
  "คิว #{n} · คืนมัดจำ {amount} เข้าเครดิตแล้ว": "Queue #{n} · {amount} deposit returned to your credit",
  "คิว #{n} · ร้านเก็บมัดจำ {amount} ตามเงื่อนไข": "Queue #{n} · the store kept the {amount} deposit as agreed",
  "{n} ชั่วโมง": "{n} hours",
  "{n} นาที": "{n} minutes",
  "ยกเลิกการจองแล้ว คืนมัดจำเป็นเครดิตแล้ว": "Reservation cancelled, deposit returned as credit",
  "ชำระเงินสำเร็จ ได้รับสินค้าแล้ว": "Payment complete, your item is ready",
};
for (const [th, en] of Object.entries(EN_PREORDER)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

/** Deposit for a price × quantity, same rule as the server's depositFor (preorder.mjs). */
export function depositPreview(terms: PreorderTerms | null | undefined, total: number, quantity = 1) {
  if (!terms || terms.mode !== "deposit" || total <= 0) return 0;
  const cap = Math.floor((total * (terms.depositCapPercent ?? 90)) / 100);
  const raw =
    terms.depositType === "fixed"
      ? (terms.depositValue ?? 0) * quantity
      : Math.round((total * (terms.depositValue ?? 0)) / 100);
  return Math.max(0, Math.min(raw, cap));
}

const modeOf = (product?: Product | null) => product?.preorderTerms?.mode ?? "full";

/** Main button on the product page: "จองคิว · มัดจำ ฿X" / "จองคิวฟรี" / "จองเลย" / "ซื้อเลย". */
export function buyLabel(product: Product, variant: Variant, quantity: number) {
  if (!product.preorder) return t("ซื้อเลย");
  const mode = modeOf(product);
  if (mode === "deposit")
    return t("จองคิว · มัดจำ {amount}", {
      amount: money(depositPreview(product.preorderTerms, variant.price * quantity, quantity)),
    });
  if (mode === "free") return t("จองคิวฟรี");
  return t("จองเลย");
}

/** Short rules under the buy row (deposit / free only): what is paid when, what if late. */
export function PreorderRules({ product, total, quantity }: { product: Product; total: number; quantity: number }) {
  const terms = product.preorderTerms;
  if (!product.preorder || !terms || terms.mode === "full") return null;
  const hours = terms.payWindowHours ?? 24;
  const deposit = depositPreview(terms, total, quantity);
  const lines =
    terms.mode === "deposit"
      ? [
          t("มัดจำ {amount} ตอนจอง ได้เลขคิวทันที", { amount: money(deposit) }),
          t("ของพร้อมแล้วชำระส่วนที่เหลือ {amount} ภายใน {hours} ชั่วโมง", { amount: money(total - deposit), hours }),
          terms.lapsePolicy === "keep"
            ? t("ไม่ชำระตามเวลา: ร้านเก็บมัดจำ และสิทธิ์ส่งต่อให้คิวถัดไป")
            : t("ไม่ชำระตามเวลา: คืนมัดจำเป็นเครดิตร้าน และสิทธิ์ส่งต่อให้คิวถัดไป"),
        ]
      : [
          t("จองฟรี ไม่ต้องจ่ายตอนนี้ ได้เลขคิวทันที"),
          t("ของพร้อมแล้วชำระเต็มราคา {amount} ภายใน {hours} ชั่วโมง", { amount: money(total), hours }),
          t("ไม่ชำระตามเวลา สิทธิ์ส่งต่อให้คิวถัดไป"),
        ];
  return (
    <div className="preorder-rules" role="note">
      <Ticket size={18} aria-hidden="true" />
      <div>
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {terms.maxPerCustomer ? <li>{t("จองได้ {n} คิวต่อบัญชี", { n: terms.maxPerCustomer })}</li> : null}
        </ul>
        <small>{t("ร้านจะแจ้งเตือนในเว็บและทางอีเมลเมื่อถึงคิวของคุณ")}</small>
      </div>
    </div>
  );
}

/** What one basket line charges at checkout: full price, the deposit, or nothing (free queue). */
export function payNowFor(product: Product, total: number, quantity: number) {
  if (!product.preorder) return total;
  const mode = modeOf(product);
  return mode === "full" ? total : mode === "deposit" ? depositPreview(product.preorderTerms, total, quantity) : 0;
}
/** Checkout summary row: what is charged when the reservation is saved. */
export function CheckoutPreorderRow({ product, total, quantity }: { product: Product; total: number; quantity: number }) {
  const mode = modeOf(product);
  if (!product.preorder || mode === "full") return null;
  const now = mode === "deposit" ? depositPreview(product.preorderTerms, total, quantity) : 0;
  return (
    <>
      <div className="preorder-summary-row">
        <span>{mode === "deposit" ? t("ชำระตอนจอง (มัดจำ)") : t("ชำระตอนจอง")}</span>
        <strong>{money(now)}</strong>
      </div>
      <div className="preorder-summary-row muted">
        <span>{t("ชำระเมื่อถึงคิว")}</span>
        <span>{money(total - now)}</span>
      </div>
    </>
  );
}

export const isQueueMode = (order: Order) =>
  !!order.preorder && (order.preorderMode === "deposit" || order.preorderMode === "free");

/** Order page heading for deposit / free reservations (null → the normal heading). */
export function preorderHeading(order: Order): [string, string] | null {
  if (!isQueueMode(order)) return null;
  if (order.status === "PREORDER" && order.stage === "called")
    return [
      order.preorderMode === "free" ? t("ของพร้อมแล้ว ชำระเพื่อรับสินค้า") : t("ของพร้อมแล้ว ชำระส่วนที่เหลือ"),
      t("ร้านกันสินค้าไว้ให้คุณแล้ว ชำระภายในเวลาเพื่อรับ ID และรหัสผ่านทันที"),
    ];
  if (order.stage === "lapsed") return [t("หมดเวลาชำระส่วนที่เหลือ"), t("สิทธิ์ส่งต่อให้คิวถัดไปแล้ว")];
  if (order.stage === "cancelled") return [t("ยกเลิกการจองแล้ว"), t("รายการนี้ไม่มีการส่งสินค้า")];
  if (order.stage === "shop_cancelled") return [t("ร้านยกเลิกการจองของคุณ"), t("รายการนี้ไม่มีการส่งสินค้า")];
  return null;
}

function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

function Countdown({ payBy }: { payBy: string }) {
  const now = useNow(true);
  const left = shopInstant(payBy).getTime() - now;
  if (!(left > 0)) return <span className="preorder-countdown is-late">{t("หมดเวลาแล้ว")}</span>;
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  return (
    <span className={"preorder-countdown" + (left < 2 * 3600000 ? " is-soon" : "")} role="timer">
      <Clock size={14} aria-hidden="true" />
      {h > 0 ? t("เหลือเวลา {h} ชม. {m} นาที", { h, m }) : t("เหลือเวลา {m} นาที", { m })}
    </span>
  );
}

const deadline = (sql: string) =>
  shopInstant(sql).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });

/**
 * Queue progress for a deposit / free reservation: จองแล้ว คิว #n → ของพร้อม (pay before
 * <time>, countdown) → ส่งแล้ว, plus the pay / cancel buttons and the lapse / refund note.
 */
export function PreorderProgress({
  order,
  busy,
  canPay,
  testPayments,
  balance,
  shopOpen,
  error,
  onPay,
  onCancel,
}: {
  order: Order;
  busy: boolean;
  canPay: boolean;
  testPayments: boolean;
  balance: number;
  shopOpen: boolean;
  error: string;
  onPay: () => void;
  onCancel: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!isQueueMode(order) || !order.stage) return null;
  const stage = order.stage;
  const delivered = order.status === "DELIVERED";
  const called = order.status === "PREORDER" && stage === "called";
  const queued = order.status === "PREORDER" && stage === "queued";
  const ended = ["lapsed", "cancelled", "shop_cancelled"].includes(stage);
  const due = order.amountDue ?? 0;
  const free = order.preorderMode === "free";
  const steps = [
    {
      key: "reserved",
      label: t("จองแล้ว · คิว #{n}", { n: order.queueNumber ?? "-" }),
      done: true,
      detail: free ? t("ไม่ได้จ่ายเงินตอนจอง") : t("จ่ายมัดจำแล้ว {amount}", { amount: money(order.depositPaid ?? 0) }),
    },
    {
      key: "ready",
      label: free ? t("ของพร้อม · ชำระเพื่อรับสินค้า") : t("ของพร้อม · ชำระส่วนที่เหลือ"),
      done: delivered,
      current: called,
      detail: queued
        ? t("รอของเข้า") +
          " · " +
          (order.queueAhead ? t("ก่อนหน้าคุณ {n} คิว", { n: order.queueAhead }) : t("คุณอยู่คิวแรก"))
        : null,
    },
    { key: "delivered", label: t("ส่งแล้ว"), done: delivered },
  ];
  return (
    <section className={"preorder-progress" + (ended ? " is-ended" : "")} aria-label={t("คิวที่ {n}", { n: order.queueNumber ?? "-" })}>
      <ol className="preorder-steps">
        {steps.map((step, i) => (
          <li
            key={step.key}
            className={step.done ? "is-done" : step.current ? "is-current" : ""}
            aria-current={step.current ? "step" : undefined}
          >
            <span className="preorder-step-dot" aria-hidden="true">
              {step.done ? <Check size={14} /> : i + 1}
            </span>
            <div>
              <strong>{step.label}</strong>
              {step.detail && <small>{step.detail}</small>}
              {step.key === "ready" && called && order.payBy && (
                <div className="preorder-pay-box">
                  <p>
                    {t("ชำระ {amount} ภายใน {time}", { amount: money(due), time: deadline(order.payBy) })}
                  </p>
                  {shopOpen && <Countdown payBy={order.payBy} />}
                  {!shopOpen && <p className="preorder-paused">{t("ร้านเปิดอีกครั้งแล้วเวลาชำระจะขยายตามเวลาที่ร้านปิด")}</p>}
                  {testPayments ? (
                    <div className="pay-actions">
                      <button className="button primary" disabled={busy || !canPay || !shopOpen} onClick={onPay}>
                        {busy ? <LoaderCircle className="spin" size={17} /> : <CreditCard size={17} />}
                        {free
                          ? t("ชำระ {amount} เพื่อรับสินค้า", { amount: money(due) })
                          : t("ชำระส่วนที่เหลือ {amount}", { amount: money(due) })}
                      </button>
                      {balance < due && (
                        <Link to="/wallet" className="button secondary">
                          {t("เติมเครดิตทดลอง")}
                        </Link>
                      )}
                    </div>
                  ) : (
                    <p>{t("รอเชื่อมช่องทางชำระเงิน ระบบจะส่ง ID และรหัสผ่านหลังยืนยันยอดแล้วเท่านั้น")}</p>
                  )}
                  <ErrorMessage message={error} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {ended && (
        <div className="preorder-ended" role="status">
          {stage === "lapsed" ? <Clock size={18} aria-hidden="true" /> : <XCircle size={18} aria-hidden="true" />}
          <div>
            <strong>
              {stage === "lapsed"
                ? t("หมดเวลาชำระส่วนที่เหลือ")
                : stage === "cancelled"
                  ? t("ยกเลิกการจองแล้ว")
                  : t("ร้านยกเลิกการจองของคุณ")}
            </strong>
            <p>
              {order.refundedTotal
                ? t("คืนมัดจำ {amount} เข้าเครดิตร้านแล้ว", { amount: money(order.refundedTotal) })
                : order.depositPaid
                  ? t("ร้านเก็บมัดจำ {amount} ตามเงื่อนไขที่แจ้งตอนจอง", { amount: money(order.depositPaid) })
                  : t("สิทธิ์ส่งต่อให้คิวถัดไปแล้ว")}
            </p>
            <Link to="/products" className="button secondary">
              {t("กลับไปเลือกสินค้า")}
            </Link>
          </div>
        </div>
      )}
      {queued && (
        <div className="preorder-cancel">
          {confirming ? (
            <>
              <p>
                <RotateCcw size={15} aria-hidden="true" />
                {free
                  ? t("ไม่ชำระตามเวลา สิทธิ์ส่งต่อให้คิวถัดไป")
                  : order.lapsePolicy === "keep"
                    ? t("ยกเลิกแล้วร้านจะเก็บมัดจำตามเงื่อนไขที่แจ้งตอนจอง")
                    : t("ยกเลิกแล้วจะคืนมัดจำเป็นเครดิตร้าน")}
              </p>
              <div className="pay-actions">
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => void onCancel().finally(() => setConfirming(false))}
                >
                  {t("ยืนยันยกเลิกการจอง")}
                </button>
                <button className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  {t("ไม่ยกเลิก")}
                </button>
              </div>
            </>
          ) : (
            <button className="text-button" onClick={() => setConfirming(true)}>
              {t("ยกเลิกการจอง")}
            </button>
          )}
        </div>
      )}
      {delivered && (
        <p className="preorder-delivered-note">
          <PackageCheck size={16} aria-hidden="true" />
          {t("ชำระเงินสำเร็จ ได้รับสินค้าแล้ว")}
        </p>
      )}
    </section>
  );
}

/** Bell text for preorder notices (customer side, translated); null = not a preorder notice. */
export function preorderNoticeBody(body: string): string | null {
  const pay = body.match(/^คิว #(\d+) · ชำระ (฿[\d,.]+) ภายใน (\d+) (ชั่วโมง|นาที)$/);
  if (pay)
    return t("คิว #{n} · ชำระ {amount} ภายใน {time}", {
      n: pay[1],
      amount: pay[2],
      time: t(pay[4] === "ชั่วโมง" ? "{n} ชั่วโมง" : "{n} นาที", { n: pay[3] }),
    });
  const refund = body.match(/^คิว #(\d+) · คืนมัดจำ (฿[\d,.]+) เข้าเครดิตแล้ว$/);
  if (refund) return t("คิว #{n} · คืนมัดจำ {amount} เข้าเครดิตแล้ว", { n: refund[1], amount: refund[2] });
  const kept = body.match(/^คิว #(\d+) · ร้านเก็บมัดจำ (฿[\d,.]+) ตามเงื่อนไข$/);
  if (kept) return t("คิว #{n} · ร้านเก็บมัดจำ {amount} ตามเงื่อนไข", { n: kept[1], amount: kept[2] });
  const queue = body.match(/^คิว #(\d+)$/);
  if (queue) return t("คิว #{n}", { n: queue[1] });
  return null;
}
