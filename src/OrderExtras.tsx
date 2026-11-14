// Customer order extras (server: server/order-extras.mjs). Kept out of App.tsx / Ops.tsx /
// Admin.tsx so parallel work merges cleanly; those files only mount these pieces.
// - UsageText / DeliveredExtras: "วิธีใช้งานหลังซื้อ" (plain text → paragraphs + bullets,
//   always rendered as React text, never HTML) and the "แจ้งปัญหาบัญชีนี้" button.
// - useReportDraft: the report draft inside the shop chat (reason picker + prefilled text).
// - ReceiptPage: printable order confirmation / short receipt (A4, no credentials).
// - Admin editor fields: first option label + warranty, usage instructions + preview.
// Design references (layout/components only, no branding copied):
// - Receipt: sparksuite/simple-html-invoice-template (MIT)
//   https://github.com/sparksuite/simple-html-invoice-template
// - Reason picker, textarea with counter, buttons: shadcn/ui ToggleGroup + Textarea (MIT)
//   https://ui.shadcn.com/docs/components/toggle-group
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BookOpen,
  LoaderCircle,
  MessageSquareWarning,
  Printer,
  ReceiptText,
  X,
} from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { EN_STRINGS } from "./i18n-en";
import { getLang, t } from "./i18n";
import { shopName } from "./Theme";
import type { Order } from "./types";
import { branchText, TaxInvoiceCard, TaxInvoicePage, taxInvoiceHref, type Buyer } from "./TaxInvoice";
import { OrderReceiptCard } from "./OrderReceipts";
import "./order-extras.css";

// English storefront strings for this file, added to the shared table on load
// (existing entries win, so other screens never change).
const EN_EXTRAS: Record<string, string> = {
  "วิธีใช้งานหลังซื้อ": "How to use",
  "แจ้งปัญหาบัญชีนี้": "Report a problem with this account",
  "แจ้งปัญหาออเดอร์ #{n}": "Report order #{n}",
  "อาการที่พบ": "What happened",
  "ยกเลิกการแจ้งปัญหา": "Cancel report",
  "ตรวจข้อความ เพิ่มรายละเอียดได้ แล้วกดส่ง · อย่าส่งรหัสผ่านในแชท":
    "Check the message, add details, then send · Never send passwords in chat",
  "เข้าไม่ได้": "Can't sign in",
  "รหัสผิด": "Wrong password",
  "โดนเปลี่ยนรหัส": "Password was changed",
  "อื่นๆ": "Other",
  "ใบเสร็จ": "Receipt",
  "ช่องทางชำระ": "Payment method",
  "ใบยืนยันการสั่งซื้อ / ใบเสร็จรับเงิน (อย่างย่อ)": "Order confirmation / Receipt (short form)",
  "ใบเสร็จคำสั่งซื้อ": "Order receipt",
  "ดาวน์โหลด PDF / พิมพ์": "Download PDF / Print",
  "กลับไปที่ออเดอร์": "Back to order",
  "กำลังโหลดใบเสร็จ": "Loading receipt",
  "เลขที่": "No.",
  "วันที่ออกเอกสาร": "Issued",
  "ลูกค้า": "Customer",
  "รายละเอียดคำสั่งซื้อ": "Order details",
  "วันที่สั่งซื้อ": "Ordered",
  "วันที่ชำระเงิน": "Paid",
  "วันที่ส่งสินค้า": "Delivered",
  "สถานะการชำระเงิน": "Payment status",
  "สถานะการคืนเงิน": "Refund status",
  "รายการ": "Item",
  "จำนวน": "Qty",
  "ราคาต่อหน่วย": "Unit price",
  "จำนวนเงิน": "Amount",
  "ราคารวม": "Subtotal",
  "ส่วนลด": "Discount",
  "ยอดชำระสุทธิ": "Total",
  "คืนเงินแล้ว": "Refunded",
  "ชำระเงินแล้ว": "Paid",
  "รอชำระเงิน": "Awaiting payment",
  "ยกเลิกแล้ว": "Cancelled",
  "ไม่ได้ชำระเงิน": "Not paid",
  "คืนเงินเต็มจำนวนแล้ว": "Fully refunded",
  "คืนเงินบางส่วนแล้ว": "Partially refunded",
  "เลขประจำตัวผู้เสียภาษี": "Tax ID",
  "เอกสารนี้ไม่ใช่ใบกำกับภาษีเต็มรูปแบบ": "This document is not a full tax invoice.",
  "ต้องการใบกำกับภาษีเต็มรูปแบบ กรุณาติดต่อร้าน": "For a full tax invoice, please contact the shop.",
  "ขอบคุณที่ใช้บริการ": "Thank you for your purchase",
  "เข้าสู่ระบบเพื่อดูใบเสร็จ": "Sign in to view the receipt",
};
for (const [th, en] of Object.entries(EN_EXTRAS)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

// ------------------------------------------------------------ usage text

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

/** Paragraphs (blank line) and "- " / "• " / "1. " bullets. Everything else is text. */
export function parseUsage(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    let current: Block | null = null;
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^[-•*·]\s+(.+)$/.exec(line);
      const numbered = /^\d{1,2}[.)]\s+(.+)$/.exec(line);
      const kind = bullet ? "ul" : numbered ? "ol" : "p";
      const content = bullet?.[1] ?? numbered?.[1] ?? line;
      if (!current || current.kind !== kind) {
        current = kind === "p" ? { kind, lines: [] } : { kind, items: [] };
        blocks.push(current);
      }
      if (current.kind === "p") current.lines.push(content);
      else current.items.push(content);
    }
  }
  return blocks;
}

export function UsageText({ text }: { text: string }) {
  return (
    <div className="usage-text">
      {parseUsage(text).map((block, i) =>
        block.kind === "p" ? (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ) : block.kind === "ul" ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------- report issue

export const REPORT_EVENT = "report-order-issue";
export const REPORT_REASONS = [
  ["cannot_login", "เข้าไม่ได้"],
  ["wrong_password", "รหัสผิด"],
  ["password_changed", "โดนเปลี่ยนรหัส"],
  ["other", "อื่นๆ"],
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number][0];
const reasonText = (r: ReportReason) => REPORT_REASONS.find(([k]) => k === r)![1];

export type ReportContext = {
  orderId: string;
  number: string;
  product: string;
  option: string;
  deliveredAt: string | null;
  warrantyUntil: string | null;
};

const parseDb = (value: string) => new Date(value.replace(" ", "T") + "Z");
/** The message goes to the shop team, so dates are always Thai. */
const thaiDate = (value: string) =>
  parseDb(value).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });

export function buildReportMessage(ctx: ReportContext, reason: ReportReason, now = Date.now()) {
  const warranty = !ctx.warrantyUntil
    ? "ไม่มีประกัน"
    : parseDb(ctx.warrantyUntil).getTime() < now
      ? "หมดประกันแล้ว"
      : "อยู่ในประกันถึง " + thaiDate(ctx.warrantyUntil);
  return [
    "แจ้งปัญหาบัญชี",
    "ออเดอร์: #" + ctx.number,
    "สินค้า: " + ctx.product + " · " + ctx.option,
    "ส่งของเมื่อ: " + (ctx.deliveredAt ? thaiDate(ctx.deliveredAt) : "-"),
    "ประกัน: " + warranty,
    "อาการ: " + reasonText(reason),
    "รายละเอียดเพิ่มเติม: ",
  ].join("\n");
}

type OrderExtrasFields = { usageInstructions?: string | null; deliveredAt?: string | null };

/** Delivered order: usage instructions next to the credentials + report button. */
export function DeliveredExtras({ order }: { order: Order }) {
  const extra = order as Order & OrderExtrasFields;
  const report = () => {
    const detail: ReportContext = {
      orderId: order.id,
      number: order.id.slice(0, 8).toUpperCase(),
      product: order.name,
      option: order.label,
      deliveredAt: extra.deliveredAt ?? null,
      warrantyUntil: order.warranty_until ?? null,
    };
    dispatchEvent(new CustomEvent(REPORT_EVENT, { detail }));
  };
  return (
    <>
      {extra.usageInstructions && (
        <section className="usage-guide" aria-label={t("วิธีใช้งานหลังซื้อ")}>
          <h3>
            <BookOpen size={17} aria-hidden="true" />
            {t("วิธีใช้งานหลังซื้อ")}
          </h3>
          <UsageText text={extra.usageInstructions} />
        </section>
      )}
      <div className="order-help-row">
        <button type="button" className="button secondary report-issue-button" onClick={report}>
          <MessageSquareWarning size={17} aria-hidden="true" />
          {t("แจ้งปัญหาบัญชีนี้")}
        </button>
      </div>
      <OrderReceiptCard orderId={order.id} />
      {/* Tax invoice request / buyer on the receipt (TaxInvoice.tsx); owner only, else nothing. */}
      <TaxInvoiceCard orderId={order.id} />
    </>
  );
}

/**
 * Report draft for the shop chat. The order page fires REPORT_EVENT; the chat opens
 * with the message prefilled and a reason picker above the composer. The message is
 * sent through the normal chat API with { orderId, reportReason }.
 */
export function useReportDraft({
  setText,
  open,
}: {
  setText: (update: string | ((text: string) => string)) => void;
  open: () => void;
}) {
  const [report, setReport] = useState<ReportContext | null>(null);
  const [reason, setReason] = useState<ReportReason>("cannot_login");
  const latest = useRef({ setText, open });
  latest.current = { setText, open };
  useEffect(() => {
    const onReport = (e: Event) => {
      const ctx = (e as CustomEvent<ReportContext>).detail;
      if (!ctx?.orderId) return;
      setReport(ctx);
      setReason("cannot_login");
      latest.current.setText(buildReportMessage(ctx, "cannot_login"));
      latest.current.open();
    };
    addEventListener(REPORT_EVENT, onReport);
    return () => removeEventListener(REPORT_EVENT, onReport);
  }, []);
  const pick = (next: ReportReason) => {
    const from = "อาการ: " + reasonText(reason);
    setReason(next);
    // Keep whatever the customer typed; only swap the reason line.
    setText((text) => (text.includes(from) ? text.replace(from, "อาการ: " + reasonText(next)) : text));
  };
  const clear = () => setReport(null);
  const bar = report ? (
    <div className="report-draft" role="group" aria-label={t("แจ้งปัญหาบัญชีนี้")}>
      <div className="report-draft-head">
        <MessageSquareWarning size={16} aria-hidden="true" />
        <strong>{t("แจ้งปัญหาออเดอร์ #{n}", { n: report.number })}</strong>
        <button
          type="button"
          className="icon-button"
          aria-label={t("ยกเลิกการแจ้งปัญหา")}
          onClick={() => {
            setReport(null);
            setText("");
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="report-reasons" role="radiogroup" aria-label={t("อาการที่พบ")}>
        {REPORT_REASONS.map(([key, label]) => (
          <label key={key} className={reason === key ? "report-reason selected" : "report-reason"}>
            <input
              type="radio"
              name="report-reason"
              value={key}
              checked={reason === key}
              onChange={() => pick(key)}
            />
            {t(label)}
          </label>
        ))}
      </div>
      <small>{t("ตรวจข้อความ เพิ่มรายละเอียดได้ แล้วกดส่ง · อย่าส่งรหัสผ่านในแชท")}</small>
    </div>
  ) : null;
  return {
    report,
    bar,
    clear,
    payload: report ? { orderId: report.orderId, reportReason: reason } : {},
  };
}

const REASON_LABEL: Record<string, string> = Object.fromEntries(REPORT_REASONS);

/** Order link on a chat message that reported a problem. */
export function ChatOrderTag({
  orderId,
  reason,
  admin,
}: {
  orderId: string;
  reason?: string | null;
  admin?: boolean;
}) {
  const label =
    (admin ? "ออเดอร์ #" : t("คำสั่งซื้อ #")) +
    orderId.slice(0, 8).toUpperCase() +
    (reason && REASON_LABEL[reason] ? " · " + (admin ? REASON_LABEL[reason] : t(REASON_LABEL[reason])) : "");
  return (
    <Link to={(admin ? "/admin/orders/" : "/orders/") + orderId} className="chat-order-tag">
      <MessageSquareWarning size={13} aria-hidden="true" />
      {label}
    </Link>
  );
}

// --------------------------------------------------------------- receipt

export type DocumentKind = "receipt" | "tax-invoice";
/** /orders/<id>/receipt, /orders/<id>/tax-invoice and their /admin twins. */
export function receiptRoute(path: string): { id: string; admin: boolean; kind: DocumentKind } | null {
  const m = /^\/(admin\/)?orders\/([^/]+)\/(receipt|tax-invoice)\/?$/.exec(path);
  if (!m) return null;
  try {
    return { id: decodeURIComponent(m[2]), admin: !!m[1], kind: m[3] as DocumentKind };
  } catch {
    return null;
  }
}

export function ReceiptLink({
  id,
  admin = false,
  className = "subtle-link receipt-link",
  children,
}: {
  id: string;
  admin?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link to={(admin ? "/admin" : "") + "/orders/" + id + "/receipt"} className={className}>
      <ReceiptText size={16} aria-hidden="true" />
      {children ?? (admin ? "ใบเสร็จ" : t("ใบเสร็จ"))}
    </Link>
  );
}

/** Receipt links are offered once money was taken (or refunded). */
/** Printable receipt link — only after staff approved the ใบเสร็จคำสั่งซื้อ request. */
export const hasReceipt = (
  order: Pick<Order, "status" | "refundStatus"> & { receiptApproved?: boolean },
) =>
  !!order.receiptApproved &&
  (order.status === "DELIVERED" || order.status === "PREORDER" || !!order.refundStatus);

type Receipt = {
  id: string;
  number: string;
  preorder: boolean;
  status: string;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  issuedAt: string;
  shop: {
    name: string;
    legalName: string;
    taxId: string;
    address: string;
    email: string;
    phone: string;
    line: string;
    vatRegistered: boolean;
    // ตั้งค่า › ใบเสร็จและใบกำกับภาษี (server/tax-invoices.mjs sellerBlock).
    branch?: string;
    branchLabel?: string;
    logoUrl?: string | null;
    footerNote?: string;
  };
  /** Buyer on a ใบเสร็จรับเงิน (shop not VAT-registered, customer filled it in). */
  buyer?: Buyer | null;
  taxInvoiceMode?: "TAX_INVOICE" | "RECEIPT" | "OFF";
  taxInvoice?: { id: string; number: string } | null;
  customer: { name: string; email: string };
  item: {
    product: string;
    option: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    discount: number;
    couponCode: string | null;
  };
  /** One row per product when several were bought together (server/order-extras.mjs). */
  items?: { orderId: string; product: string; option: string; quantity: number; unitPrice: number; subtotal: number }[];
  total: number;
  paymentStatus: "PAID" | "PENDING" | "CANCELLED" | "UNPAID";
  refundStatus: "REFUNDED" | "PARTIALLY_REFUNDED" | null;
  refundedTotal: number;
  /** Set when the shop created the order for a customer who paid outside the site. */
  createdByAdmin?: boolean;
  paymentMethodLabel?: string;
};

const PAYMENT_TEXT: Record<Receipt["paymentStatus"], string> = {
  PAID: "ชำระเงินแล้ว",
  PENDING: "รอชำระเงิน",
  CANCELLED: "ยกเลิกแล้ว",
  UNPAID: "ไม่ได้ชำระเงิน",
};
const REFUND_TEXT = {
  REFUNDED: "คืนเงินเต็มจำนวนแล้ว",
  PARTIALLY_REFUNDED: "คืนเงินบางส่วนแล้ว",
} as const;

/** /orders/<id>/receipt (customer) and /admin/orders/<id>/receipt (staff); tax invoices too. */
export function ReceiptPage({ id, admin, kind = "receipt" }: { id: string; admin: boolean; kind?: DocumentKind }) {
  return kind === "tax-invoice" ? <TaxInvoicePage id={id} admin={admin} /> : <ShortReceipt id={id} admin={admin} />;
}

function ShortReceipt({ id, admin }: { id: string; admin: boolean }) {
  const { user, loading } = useStore();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const tr = (text: string) => (admin ? text : t(text));
  const title = tr("ใบเสร็จคำสั่งซื้อ");
  useEffect(() => {
    if (!user) return;
    api<{ receipt: Receipt }>((admin ? "/admin" : "") + "/orders/" + encodeURIComponent(id) + "/receipt")
      .then((r) => setReceipt(r.receipt))
      .catch((e: Error) => setError(e.message));
  }, [id, admin, user?.id]);
  useEffect(() => {
    // Also the suggested file name when saving as PDF.
    if (receipt) document.title = tr("ใบเสร็จ") + " " + receipt.number + " — " + shopName(receipt.shop.name);
  }, [receipt]);
  const back = (admin ? "/admin" : "") + "/orders/" + id;
  const shop = receipt?.shop;
  const contact = shop
    ? [shop.phone && "โทร " + shop.phone, shop.email, shop.line && "LINE " + shop.line].filter(Boolean).join(" · ")
    : "";
  return (
    <main className={admin ? "receipt-shell is-admin" : "receipt-shell"} id="receipt">
      <div className="receipt-toolbar">
        <Link to={back} className="receipt-back">
          <ArrowLeft size={16} aria-hidden="true" />
          {tr("กลับไปที่ออเดอร์")}
        </Link>
        <button type="button" className="receipt-print" disabled={!receipt} onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" />
          {tr("ดาวน์โหลด PDF / พิมพ์")}
        </button>
      </div>
      {!user && !loading ? (
        <div className="receipt-paper receipt-message">
          <p>{tr("เข้าสู่ระบบเพื่อดูใบเสร็จ")}</p>
          <Link to={"/login?next=" + encodeURIComponent(location.pathname)} className="receipt-print">
            {tr("เข้าสู่ระบบ")}
          </Link>
        </div>
      ) : error ? (
        <div className="receipt-paper receipt-message">
          <ErrorMessage message={error} />
        </div>
      ) : !receipt || !shop ? (
        <div className="receipt-paper receipt-message" aria-busy="true">
          <LoaderCircle className="spin" size={20} />
          {tr("กำลังโหลดใบเสร็จ")}
        </div>
      ) : (
        <article className="receipt-paper" aria-label={title}>
          <header className="receipt-head">
            <div className="receipt-shop">
              {shop.logoUrl && <img className="tax-logo" src={shop.logoUrl} alt="" />}
              <strong className="receipt-shop-name">{shopName(shop.name)}</strong>
              {shop.legalName && <span>{shop.legalName}</span>}
              {shop.address && <span className="receipt-address">{shop.address}</span>}
              {shop.taxId && (
                <span>
                  {tr("เลขประจำตัวผู้เสียภาษี")} {shop.taxId}
                  {shop.branchLabel ? " · " + branchText(shop.branchLabel, shop.branch) : ""}
                </span>
              )}
              {contact && <span>{contact}</span>}
            </div>
            <div className="receipt-title">
              <h1>{title}</h1>
              <dl>
                <div>
                  <dt>{tr("เลขที่")}</dt>
                  <dd>#{receipt.number}</dd>
                </div>
                <div>
                  <dt>{tr("วันที่ออกเอกสาร")}</dt>
                  <dd>{dateTime(receipt.issuedAt)}</dd>
                </div>
              </dl>
            </div>
          </header>
          <section className="receipt-parties">
            {receipt.buyer ? (
              <div>
                <h2>{tr("ผู้ซื้อในใบเสร็จ")}</h2>
                <p>
                  <strong>{receipt.buyer.name}</strong>
                </p>
                <p className="receipt-muted tax-address">{receipt.buyer.address}</p>
                <p className="receipt-muted">
                  {tr("เลขประจำตัวผู้เสียภาษี")} {receipt.buyer.taxId}
                  {receipt.buyer.type === "COMPANY" && " · " + branchText(receipt.buyer.branchLabel ?? "-", receipt.buyer.branch)}
                </p>
              </div>
            ) : (
              <div>
                <h2>{tr("ลูกค้า")}</h2>
                <p>{receipt.customer.name}</p>
                {receipt.customer.email && <p className="receipt-muted">{receipt.customer.email}</p>}
              </div>
            )}
            <div>
              <h2>{tr("รายละเอียดคำสั่งซื้อ")}</h2>
              <dl className="receipt-facts">
                <div>
                  <dt>{tr("วันที่สั่งซื้อ")}</dt>
                  <dd>{dateTime(receipt.createdAt)}</dd>
                </div>
                {receipt.paidAt && (
                  <div>
                    <dt>{tr("วันที่ชำระเงิน")}</dt>
                    <dd>{dateTime(receipt.paidAt)}</dd>
                  </div>
                )}
                {receipt.deliveredAt && (
                  <div>
                    <dt>{tr("วันที่ส่งสินค้า")}</dt>
                    <dd>{dateTime(receipt.deliveredAt)}</dd>
                  </div>
                )}
                <div>
                  <dt>{tr("สถานะการชำระเงิน")}</dt>
                  <dd>
                    <span className={"receipt-pill is-" + receipt.paymentStatus.toLowerCase()}>
                      {tr(PAYMENT_TEXT[receipt.paymentStatus])}
                    </span>
                  </dd>
                </div>
                {receipt.paymentMethodLabel && (
                  <div>
                    <dt>{tr("ช่องทางชำระ")}</dt>
                    <dd className="receipt-method">
                      {admin || getLang() !== "en" ? receipt.paymentMethodLabel : "Bank transfer (outside the website)"}
                      {admin && receipt.createdByAdmin && " · สร้างโดยแอดมิน"}
                    </dd>
                  </div>
                )}
                {receipt.refundStatus && (
                  <div>
                    <dt>{tr("สถานะการคืนเงิน")}</dt>
                    <dd>
                      <span className="receipt-pill is-refund">{tr(REFUND_TEXT[receipt.refundStatus])}</span>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </section>
          <table className="receipt-table">
            <thead>
              <tr>
                <th scope="col">{tr("รายการ")}</th>
                <th scope="col" className="num">
                  {tr("จำนวน")}
                </th>
                <th scope="col" className="num">
                  {tr("ราคาต่อหน่วย")}
                </th>
                <th scope="col" className="num">
                  {tr("จำนวนเงิน")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(receipt.items?.length ? receipt.items : [receipt.item]).map((item, i) => (
                <tr key={i}>
                  <td>
                    <strong>{item.product}</strong>
                    <small>{item.option}</small>
                  </td>
                  <td className="num" data-label={tr("จำนวน")}>
                    {item.quantity}
                  </td>
                  <td className="num" data-label={tr("ราคาต่อหน่วย")}>
                    {money(item.unitPrice)}
                  </td>
                  <td className="num" data-label={tr("จำนวนเงิน")}>
                    {money(item.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="receipt-totals">
            <div>
              <dt>{tr("ราคารวม")}</dt>
              <dd>{money(receipt.item.subtotal)}</dd>
            </div>
            {receipt.item.discount > 0 && (
              <div>
                <dt>
                  {tr("ส่วนลด")}
                  {receipt.item.couponCode ? " (" + receipt.item.couponCode + ")" : ""}
                </dt>
                <dd>−{money(receipt.item.discount)}</dd>
              </div>
            )}
            <div className="receipt-grand">
              <dt>{tr("ยอดชำระสุทธิ")}</dt>
              <dd>{money(receipt.total)}</dd>
            </div>
            {receipt.refundedTotal > 0 && (
              <div>
                <dt>{tr("คืนเงินแล้ว")}</dt>
                <dd>−{money(receipt.refundedTotal)}</dd>
              </div>
            )}
          </dl>
          <footer className="receipt-foot">
            <p>
              {receipt.taxInvoice ? (
                <>
                  {tr("ออกใบกำกับภาษีเลขที่ {n} แล้ว").replace("{n}", receipt.taxInvoice.number)}{" "}
                  <Link to={taxInvoiceHref(receipt.id, admin)} className="tax-receipt-link">
                    {tr("ดู / พิมพ์ใบกำกับภาษี")}
                  </Link>
                </>
              ) : receipt.taxInvoiceMode === "TAX_INVOICE" ? (
                tr("ขอใบกำกับภาษีเต็มรูปได้ที่หน้าคำสั่งซื้อ")
              ) : shop.vatRegistered ? (
                tr("ต้องการใบกำกับภาษีเต็มรูปแบบ กรุณาติดต่อร้าน")
              ) : (
                tr("เอกสารนี้ไม่ใช่ใบกำกับภาษีเต็มรูปแบบ")
              )}
            </p>
            {shop.footerNote ? <p className="tax-address">{shop.footerNote}</p> : <p>{tr("ขอบคุณที่ใช้บริการ")}</p>}
          </footer>
        </article>
      )}
    </main>
  );
}

// ------------------------------------------------------ admin editor bits

/** New product: first option name (required) + price (children) + warranty days. */
export function FirstOptionFields({ children }: { children: ReactNode }) {
  return (
    <div className="first-option-fields">
      <label className="field">
        ชื่อตัวเลือกแรก
        <input name="firstLabel" required minLength={1} maxLength={80} placeholder="1 เดือน" />
        <small>เช่น 1 เดือน, 3 เดือน, 1 ปี</small>
      </label>
      {children}
      <label className="field">
        วันรับประกัน
        <input
          name="firstWarrantyDays"
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          step={1}
          placeholder="0"
        />
        <small>ไม่บังคับ · 0 หรือเว้นว่าง = ไม่มีประกัน</small>
      </label>
    </div>
  );
}

/** Form value → API value for the warranty field (empty = not sent). */
export const firstWarrantyValue = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? Number(value) : undefined;

export const USAGE_MAX = 2000;

export function UsageInstructionsField({ defaultValue }: { defaultValue?: string | null }) {
  const [length, setLength] = useState((defaultValue ?? "").length);
  return (
    <section className="reference-admin-card editor-panel">
      <h2>วิธีใช้งานหลังซื้อ</h2>
      <p>ลูกค้าเห็นข้อความนี้หลังได้รับสินค้าแล้วเท่านั้น (หน้าออเดอร์ ข้างบัญชีที่ได้รับ) ไม่แสดงบนหน้าสินค้า</p>
      <label className="field">
        วิธีใช้งานหลังซื้อ
        <textarea
          name="usageInstructions"
          aria-label="วิธีใช้งานหลังซื้อ"
          maxLength={USAGE_MAX}
          rows={6}
          defaultValue={defaultValue ?? ""}
          placeholder={"เปิดแอปแล้วกด “เข้าสู่ระบบ”\n- ใช้ ID และรหัสผ่านจากหน้าออเดอร์\n- ห้ามเปลี่ยนรหัสผ่านหรืออีเมล"}
          onInput={(e) => setLength(e.currentTarget.value.length)}
        />
        <small className="usage-field-help">
          <span>ข้อความล้วน เว้นบรรทัดว่างเพื่อขึ้นย่อหน้าใหม่ ขึ้นต้นบรรทัดด้วย - เพื่อทำรายการ</span>
          <span className="num">
            {length}/{USAGE_MAX}
          </span>
        </small>
      </label>
    </section>
  );
}

/** Editor preview: what the buyer sees on a delivered order. */
export function UsageInstructionsPreview({ text }: { text: string }) {
  return (
    <div className="usage-preview" aria-label="ตัวอย่างวิธีใช้งานหลังซื้อ">
      <div className="usage-preview-head">
        <BookOpen size={15} aria-hidden="true" />
        <strong>วิธีใช้งานหลังซื้อ</strong>
        <span>ลูกค้าเห็นหลังได้รับสินค้า</span>
      </div>
      {text.trim() ? (
        <UsageText text={text} />
      ) : (
        <p className="usage-preview-empty">ยังไม่ได้ใส่วิธีใช้งาน</p>
      )}
    </div>
  );
}
