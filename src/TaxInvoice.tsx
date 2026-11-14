// Receipts in the buyer's name + full tax invoices (ใบกำกับภาษีเต็มรูป), storefront side.
// Server: server/tax-invoices.mjs. Admin side: src/AdminTaxInvoices.tsx.
// - BuyerFields: buyer form shared with the back office (individual / company, 13-digit tax
//   ID with the Thai check digit, head office or branch no., address).
// - TaxInvoiceCard: on a delivered order — request a tax invoice (shop VAT-registered) or put
//   the buyer on the ใบเสร็จรับเงิน (not VAT-registered); status, reason and print link.
// - TaxInvoicePage: printable A4 ใบเสร็จรับเงิน/ใบกำกับภาษี (/orders/<id>/tax-invoice and
//   /admin/orders/<id>/tax-invoice), same paper styles as the receipt.
// Design references (layout/components only, no branding copied):
// - Form, Input, Card, RadioGroup: shadcn/ui (MIT) https://ui.shadcn.com/docs/components/radio-group
// - Document: sparksuite/simple-html-invoice-template (MIT)
//   https://github.com/sparksuite/simple-html-invoice-template
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, FileCheck2, FileText, LoaderCircle, Pencil, Printer } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { EN_STRINGS } from "./i18n-en";
import { getLang, t } from "./i18n";
import { useLive } from "./live";
import { shopName } from "./Theme";
import "./order-extras.css";
import "./tax-invoice.css";

// English storefront strings for this file (existing entries win).
const EN_TAX: Record<string, string> = {
  "ใบกำกับภาษีเต็มรูป": "Full tax invoice",
  "ชื่อผู้ซื้อในใบเสร็จ": "Buyer on the receipt",
  "ขอใบกำกับภาษี": "Request a tax invoice",
  "ส่งคำขอใบกำกับภาษี": "Send tax invoice request",
  "บันทึกข้อมูลผู้ซื้อ": "Save buyer details",
  "ใส่ชื่อผู้ซื้อในใบเสร็จ": "Add buyer details to the receipt",
  "ต้องการใบกำกับภาษีในนามบุคคลหรือบริษัท กรอกข้อมูลผู้ซื้อแล้วส่งคำขอ ร้านจะออกให้และแจ้งเตือนเมื่อพร้อม":
    "Need a tax invoice for yourself or your company? Enter the buyer details and send a request. The shop issues it and notifies you.",
  "ต้องการใบเสร็จรับเงินในนามบุคคลหรือบริษัท ใส่ชื่อ เลขประจำตัวผู้เสียภาษี และที่อยู่ แล้วพิมพ์ใบเสร็จได้ทันที":
    "Need the receipt in your or your company's name? Add the name, tax ID and address, then print the receipt right away.",
  "ส่งคำขอแล้ว รอร้านออกใบกำกับภาษี": "Request sent. Waiting for the shop to issue the tax invoice.",
  "ร้านไม่อนุมัติคำขอ": "The shop declined the request",
  "แก้ไขและส่งอีกครั้ง": "Edit and send again",
  "แก้ไขข้อมูล": "Edit details",
  "ยกเลิก": "Cancel",
  "ออกใบกำกับภาษีแล้ว": "Tax invoice issued",
  "เลขที่ {n}": "No. {n}",
  "ดู / พิมพ์ใบกำกับภาษี": "View / print tax invoice",
  "ดูใบเสร็จรับเงิน": "View receipt",
  "ใบกำกับภาษีเลขที่ {n} ถูกยกเลิก": "Tax invoice {n} was cancelled",
  "ขอใบใหม่": "Request a new one",
  "ใบที่ยกเลิกแล้ว": "Cancelled invoices",
  "ยกเลิกแล้ว": "Cancelled",
  "รอออก": "Pending",
  "ไม่ผ่าน": "Declined",
  "บันทึกแล้ว": "Saved",
  "ส่งคำขอใบกำกับภาษีแล้ว": "Tax invoice request sent",
  "บันทึกข้อมูลผู้ซื้อแล้ว": "Buyer details saved",
  "ประเภทผู้ซื้อ": "Buyer type",
  "บุคคลธรรมดา": "Individual",
  "นิติบุคคล / บริษัท": "Company",
  "ชื่อ-นามสกุล": "Full name",
  "ชื่อบริษัท / นิติบุคคล": "Company name",
  "เลขประจำตัวผู้เสียภาษี (13 หลัก)": "Tax ID (13 digits)",
  "บุคคลธรรมดาใช้เลขบัตรประชาชน": "Individuals use their national ID number",
  "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง": "This tax ID is not valid",
  "สำนักงานใหญ่": "Head office",
  "สาขา": "Branch",
  "สาขาที่": "Branch no.",
  "เลขสาขา 5 หลัก": "5-digit branch number",
  "ที่อยู่": "Address",
  "ที่อยู่ตามที่ใช้ออกเอกสาร (บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์)":
    "Address for the document (number, street, sub-district, district, province, postcode)",
  "ผู้ซื้อ": "Buyer",
  "ผู้ขาย": "Seller",
  "เลขประจำตัวผู้เสียภาษี": "Tax ID",
  "วันที่": "Date",
  "อ้างอิงคำสั่งซื้อ": "Order ref.",
  "ลำดับ": "No.",
  "รวมเป็นเงิน": "Subtotal",
  "มูลค่าก่อนภาษีมูลค่าเพิ่ม": "Amount before VAT",
  "ภาษีมูลค่าเพิ่ม {r}%": "VAT {r}%",
  "จำนวนเงินรวมทั้งสิ้น": "Grand total",
  "ราคารวมภาษีมูลค่าเพิ่มแล้ว": "Prices include VAT",
  "เอกสารทดสอบ (โหมดทดสอบ) ใช้ทางภาษีไม่ได้": "Test document (test mode). Not valid for tax purposes.",
  "เอกสารนี้ถูกยกเลิกแล้ว": "This document has been cancelled",
  "กำลังโหลดใบกำกับภาษี": "Loading tax invoice",
  "เข้าสู่ระบบเพื่อดูใบกำกับภาษี": "Sign in to view the tax invoice",
  "เอกสารออกโดยระบบคอมพิวเตอร์": "Computer-generated document",
  "ต้นฉบับ": "Original",
  "ขอได้เฉพาะคำสั่งซื้อที่ชำระเงินและได้รับสินค้าแล้ว": "Only for paid and delivered orders",
  "คำสั่งซื้อที่คืนเงินแล้วขอใบกำกับภาษีไม่ได้": "Refunded orders cannot get a tax invoice",
  "ร้านยังไม่เปิดให้ขอใบกำกับภาษี": "The shop does not offer tax invoices yet",
  "ผู้ซื้อในใบเสร็จ": "Bill to",
  "ใบเสร็จรับเงิน": "Receipt",
  "ขอใบกำกับภาษีเต็มรูปได้ที่หน้าคำสั่งซื้อ": "You can request a full tax invoice on the order page.",
  "ออกใบกำกับภาษีเลขที่ {n} แล้ว": "Tax invoice {n} has been issued.",
  "ใบเสร็จรับเงิน/ใบกำกับภาษี": "Receipt / Tax invoice",
  "กลับไปที่ออเดอร์": "Back to order",
  "ดาวน์โหลด PDF / พิมพ์": "Download PDF / print",
  "เลขที่": "No.",
  "วันที่สั่งซื้อ": "Order date",
  "วันที่ชำระเงิน": "Paid on",
  "รายละเอียดคำสั่งซื้อ": "Order details",
  "ราคาต่อหน่วย": "Unit price",
  "จำนวนเงิน": "Amount",
  "โทร": "Phone",
  "ชำระเงินแล้ว": "Paid",
};
for (const [th, en] of Object.entries(EN_TAX)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

// --------------------------------------------------------------- types

export type BuyerType = "PERSON" | "COMPANY";
export type Buyer = {
  type: BuyerType;
  name: string;
  taxId: string;
  branch: string | null;
  branchLabel?: string;
  address: string;
};
export type InvoiceSummary = {
  id: string;
  number: string;
  issuedAt: string;
  total: number;
  vat: number;
  testMode: boolean;
  voided: { reason: string; at: string } | null;
};
export type TaxInvoiceState = {
  mode: "TAX_INVOICE" | "RECEIPT" | "OFF";
  eligible: boolean;
  blockedReason: string | null;
  request: {
    status: "SAVED" | "PENDING" | "ISSUED" | "REJECTED" | "VOIDED";
    buyer: Buyer | null;
    reason: string | null;
    requestedAt: string | null;
    updatedAt: string;
    resolvedAt: string | null;
  } | null;
  invoices: InvoiceSummary[];
  activeInvoice: InvoiceSummary | null;
};

// -------------------------------------------------------- buyer form

/** Thai 13-digit tax ID / national ID with the mod-11 check digit (same as the server). */
export function validTaxId(value: string) {
  const id = value.replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

export type BuyerDraft = {
  type: BuyerType;
  name: string;
  taxId: string;
  branchKind: "HEAD" | "BRANCH";
  branchNo: string;
  address: string;
};
export const emptyBuyer = (): BuyerDraft => ({
  type: "COMPANY",
  name: "",
  taxId: "",
  branchKind: "HEAD",
  branchNo: "",
  address: "",
});
export const draftFrom = (buyer: Buyer | null | undefined): BuyerDraft =>
  buyer
    ? {
        type: buyer.type,
        name: buyer.name,
        taxId: buyer.taxId,
        branchKind: buyer.branch && buyer.branch !== "00000" ? "BRANCH" : "HEAD",
        branchNo: buyer.branch && buyer.branch !== "00000" ? buyer.branch : "",
        address: buyer.address,
      }
    : emptyBuyer();
export const buyerPayload = (d: BuyerDraft) => ({
  type: d.type,
  name: d.name.trim(),
  taxId: d.taxId.replace(/[\s-]/g, ""),
  branch: d.type === "COMPANY" ? (d.branchKind === "HEAD" ? "HEAD" : d.branchNo.trim()) : null,
  address: d.address.trim(),
});

/**
 * Buyer details (controlled). Radio cards follow the shadcn/ui RadioGroup pattern: a native
 * radio inside each label, so keyboard and screen readers work without extra script.
 */
export function BuyerFields({
  value,
  onChange,
  idPrefix = "buyer",
}: {
  value: BuyerDraft;
  onChange: (next: BuyerDraft) => void;
  idPrefix?: string;
}) {
  const set = (patch: Partial<BuyerDraft>) => onChange({ ...value, ...patch });
  const digits = value.taxId.replace(/[\s-]/g, "");
  const taxIdError = digits.length === 13 && !validTaxId(digits);
  const company = value.type === "COMPANY";
  return (
    <div className="buyer-fields">
      <fieldset className="tax-radio-group">
        <legend>{t("ประเภทผู้ซื้อ")}</legend>
        <div className="tax-radio-row" role="radiogroup" aria-label={t("ประเภทผู้ซื้อ")}>
          {(
            [
              ["COMPANY", "นิติบุคคล / บริษัท"],
              ["PERSON", "บุคคลธรรมดา"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={value.type === key ? "tax-radio selected" : "tax-radio"}>
              <input
                type="radio"
                name={idPrefix + "-type"}
                value={key}
                checked={value.type === key}
                onChange={() => set({ type: key })}
              />
              <span>{t(label)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        {company ? t("ชื่อบริษัท / นิติบุคคล") : t("ชื่อ-นามสกุล")}
        <input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          required
          minLength={2}
          maxLength={200}
          autoComplete={company ? "organization" : "name"}
        />
      </label>
      <label className="field">
        {t("เลขประจำตัวผู้เสียภาษี (13 หลัก)")}
        <input
          value={value.taxId}
          onChange={(e) => set({ taxId: e.target.value.replace(/[^\d\s-]/g, "").slice(0, 17) })}
          inputMode="numeric"
          autoComplete="off"
          required
          pattern="[\d\s-]{13,17}"
          aria-invalid={taxIdError || undefined}
          aria-describedby={idPrefix + "-taxid-help"}
        />
        <small id={idPrefix + "-taxid-help"} className={taxIdError ? "field-error" : "field-hint"}>
          {taxIdError ? t("เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง") : company ? "0-1055-XXXXX-XX-X" : t("บุคคลธรรมดาใช้เลขบัตรประชาชน")}
        </small>
      </label>
      {company && (
        <fieldset className="tax-radio-group">
          <legend>{t("สาขา")}</legend>
          <div className="tax-radio-row" role="radiogroup" aria-label={t("สาขา")}>
            <label className={value.branchKind === "HEAD" ? "tax-radio selected" : "tax-radio"}>
              <input
                type="radio"
                name={idPrefix + "-branch"}
                checked={value.branchKind === "HEAD"}
                onChange={() => set({ branchKind: "HEAD" })}
              />
              <span>{t("สำนักงานใหญ่")}</span>
            </label>
            <label className={value.branchKind === "BRANCH" ? "tax-radio selected" : "tax-radio"}>
              <input
                type="radio"
                name={idPrefix + "-branch"}
                checked={value.branchKind === "BRANCH"}
                onChange={() => set({ branchKind: "BRANCH" })}
              />
              <span>{t("สาขาที่")}</span>
            </label>
            {value.branchKind === "BRANCH" && (
              <input
                className="tax-branch-input"
                aria-label={t("เลขสาขา 5 หลัก")}
                placeholder="00001"
                value={value.branchNo}
                onChange={(e) => set({ branchNo: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                inputMode="numeric"
                required
                pattern="\d{1,5}"
              />
            )}
          </div>
        </fieldset>
      )}
      <label className="field">
        {t("ที่อยู่")}
        <textarea
          value={value.address}
          onChange={(e) => set({ address: e.target.value })}
          required
          minLength={10}
          maxLength={400}
          rows={3}
          autoComplete="street-address"
          placeholder={t("ที่อยู่ตามที่ใช้ออกเอกสาร (บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์)")}
        />
      </label>
    </div>
  );
}

/** "สำนักงานใหญ่" or "สาขาที่ 00012" (English: Head office / Branch no.). */
export const branchText = (label: string, code?: string | null) =>
  !label ? "" : code && code !== "00000" ? t("สาขาที่") + " " + code : t("สำนักงานใหญ่");

/** Read-only buyer block (order page / admin). */
export function BuyerSummary({ buyer }: { buyer: Buyer }) {
  return (
    <dl className="tax-buyer-summary">
      <div>
        <dt>{buyer.type === "COMPANY" ? t("ชื่อบริษัท / นิติบุคคล") : t("ชื่อ-นามสกุล")}</dt>
        <dd>
          {buyer.name}
          {buyer.type === "COMPANY" ? " · " + branchText(buyer.branchLabel || "-", buyer.branch) : ""}
        </dd>
      </div>
      <div>
        <dt>{t("เลขประจำตัวผู้เสียภาษี")}</dt>
        <dd className="num">{buyer.taxId}</dd>
      </div>
      <div>
        <dt>{t("ที่อยู่")}</dt>
        <dd className="tax-address">{buyer.address}</dd>
      </div>
    </dl>
  );
}

// ------------------------------------------------------ order page card

export const taxInvoiceHref = (orderId: string, admin = false, invoiceId?: string) =>
  (admin ? "/admin" : "") +
  "/orders/" +
  encodeURIComponent(orderId) +
  "/tax-invoice" +
  (invoiceId ? "?invoice=" + encodeURIComponent(invoiceId) : "");

/** Delivered order (owner): tax-invoice request or buyer on the receipt. Renders nothing otherwise. */
export function TaxInvoiceCard({ orderId }: { orderId: string }) {
  const { toast } = useStore();
  const [state, setState] = useState<TaxInvoiceState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BuyerDraft>(emptyBuyer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    api<TaxInvoiceState>("/orders/" + encodeURIComponent(orderId) + "/tax-invoice")
      .then(setState)
      .catch(() => setState(null));
  useEffect(() => {
    void load();
  }, [orderId]);
  useLive(["orders"], () => void load());
  if (!state) return null;
  const { mode, request, activeInvoice } = state;
  const voidedList = state.invoices.filter((i) => i.voided);
  if (mode === "OFF" && !state.invoices.length) return null;
  if (!state.eligible && !request && !state.invoices.length) return null;
  const receiptMode = mode === "RECEIPT";
  // "ชื่อผู้ซื้อในใบเสร็จ" duplicates the ใบเสร็จคำสั่งซื้อ request (OrderReceipts.tsx); only a
  // full tax invoice keeps its own box here (a past request still shows).
  if (receiptMode && !request && !state.invoices.length) return null;
  const open = () => {
    setDraft(draftFrom(request?.buyer));
    setError("");
    setEditing(true);
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<TaxInvoiceState>(
        "/orders/" + encodeURIComponent(orderId) + "/tax-invoice",
        buyerPayload(draft),
      );
      setState(next);
      setEditing(false);
      toast(receiptMode ? t("บันทึกข้อมูลผู้ซื้อแล้ว") : t("ส่งคำขอใบกำกับภาษีแล้ว"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const status = activeInvoice ? "ISSUED" : request?.status;
  const pill =
    receiptMode || !status || status === "SAVED"
      ? null
      : status === "ISSUED"
        ? ["is-issued", "ออกใบกำกับภาษีแล้ว"]
        : status === "PENDING"
          ? ["is-pending", "รอออก"]
          : status === "REJECTED"
            ? ["is-rejected", "ไม่ผ่าน"]
            : ["is-rejected", "ยกเลิกแล้ว"];
  return (
    <section className="tax-card" aria-label={receiptMode ? t("ชื่อผู้ซื้อในใบเสร็จ") : t("ใบกำกับภาษีเต็มรูป")}>
      <header className="tax-card-head">
        <h3>
          {activeInvoice ? <FileCheck2 size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
          {receiptMode ? t("ชื่อผู้ซื้อในใบเสร็จ") : t("ใบกำกับภาษีเต็มรูป")}
        </h3>
        {pill && <span className={"tax-pill " + pill[0]}>{t(pill[1])}</span>}
      </header>
      {editing ? (
        <form className="tax-form" onSubmit={submit}>
          <BuyerFields value={draft} onChange={setDraft} idPrefix={"buyer-" + orderId.slice(0, 8)} />
          <ErrorMessage message={error} />
          <div className="tax-actions">
            <button type="button" className="button secondary" onClick={() => setEditing(false)} disabled={busy}>
              {t("ยกเลิก")}
            </button>
            <button className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
              {receiptMode ? t("บันทึกข้อมูลผู้ซื้อ") : t("ส่งคำขอใบกำกับภาษี")}
            </button>
          </div>
        </form>
      ) : activeInvoice ? (
        <>
          <p className="tax-lead">
            {t("ออกใบกำกับภาษีแล้ว")} · <strong className="num">{t("เลขที่ {n}", { n: activeInvoice.number })}</strong>
          </p>
          <div className="tax-actions">
            <Link to={taxInvoiceHref(orderId)} className="button primary">
              <Printer size={16} aria-hidden="true" />
              {t("ดู / พิมพ์ใบกำกับภาษี")}
            </Link>
          </div>
        </>
      ) : request?.buyer && request.status !== "REJECTED" && request.status !== "VOIDED" ? (
        <>
          {!receiptMode && request.status === "PENDING" && <p className="tax-lead">{t("ส่งคำขอแล้ว รอร้านออกใบกำกับภาษี")}</p>}
          <BuyerSummary buyer={request.buyer} />
          {state.eligible && (
            <div className="tax-actions">
              <button type="button" className="button secondary" onClick={open}>
                <Pencil size={15} aria-hidden="true" />
                {t("แก้ไขข้อมูล")}
              </button>
              {receiptMode && (
                <Link to={"/orders/" + encodeURIComponent(orderId) + "/receipt"} className="button primary">
                  <Printer size={16} aria-hidden="true" />
                  {t("ดูใบเสร็จรับเงิน")}
                </Link>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {request?.status === "REJECTED" && (
            <div className="tax-alert" role="status">
              <strong>{t("ร้านไม่อนุมัติคำขอ")}</strong>
              {request.reason && <span>{request.reason}</span>}
            </div>
          )}
          {request?.status === "VOIDED" && voidedList[0] && (
            <div className="tax-alert" role="status">
              <strong>{t("ใบกำกับภาษีเลขที่ {n} ถูกยกเลิก", { n: voidedList[0].number })}</strong>
              {request.reason && <span>{request.reason}</span>}
            </div>
          )}
          {state.eligible ? (
            <>
              {!request && (
                <p className="tax-help">
                  {receiptMode
                    ? t("ต้องการใบเสร็จรับเงินในนามบุคคลหรือบริษัท ใส่ชื่อ เลขประจำตัวผู้เสียภาษี และที่อยู่ แล้วพิมพ์ใบเสร็จได้ทันที")
                    : t("ต้องการใบกำกับภาษีในนามบุคคลหรือบริษัท กรอกข้อมูลผู้ซื้อแล้วส่งคำขอ ร้านจะออกให้และแจ้งเตือนเมื่อพร้อม")}
                </p>
              )}
              <div className="tax-actions">
                <button type="button" className="button primary" onClick={open}>
                  <FileText size={16} aria-hidden="true" />
                  {receiptMode
                    ? t("ใส่ชื่อผู้ซื้อในใบเสร็จ")
                    : request?.status === "REJECTED"
                      ? t("แก้ไขและส่งอีกครั้ง")
                      : request?.status === "VOIDED"
                        ? t("ขอใบใหม่")
                        : t("ขอใบกำกับภาษี")}
                </button>
              </div>
            </>
          ) : (
            state.blockedReason && <p className="tax-help">{t(state.blockedReason)}</p>
          )}
        </>
      )}
      {voidedList.length > 0 && !editing && (
        <details className="tax-voided">
          <summary>{t("ใบที่ยกเลิกแล้ว")}</summary>
          <ul>
            {voidedList.map((i) => (
              <li key={i.id}>
                <Link to={taxInvoiceHref(orderId, false, i.id)}>{i.number}</Link>
                <small>
                  {t("ยกเลิกแล้ว")} · {dateTime(i.voided!.at)}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ------------------------------------------------------- printable page

type InvoiceDoc = {
  id: string;
  number: string;
  title: string;
  testMode: boolean;
  orderId: string;
  orderNumber: string;
  orderedAt: string | null;
  paidAt: string | null;
  issuedAt: string;
  seller: {
    shopName?: string;
    legalName: string;
    taxId: string;
    branch: string;
    branchLabel: string;
    address: string;
    phone?: string;
    email?: string;
    logoUrl?: string | null;
    footerNote?: string;
  };
  buyer: Buyer;
  items: { description: string; option: string; quantity: number; unitPrice: number; amount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  vatRate: number;
  vat: number;
  net: number;
  voided: { reason: string; at: string } | null;
};


/** /orders/<id>/tax-invoice (owner) and /admin/orders/<id>/tax-invoice (staff); ?invoice=<id> picks one. */
export function TaxInvoicePage({ id, admin }: { id: string; admin: boolean }) {
  const { user, loading } = useStore();
  const [doc, setDoc] = useState<InvoiceDoc | null>(null);
  const [error, setError] = useState("");
  const invoiceId = new URLSearchParams(location.search).get("invoice");
  useEffect(() => {
    if (!user) return;
    api<{ invoice: InvoiceDoc }>(
      (admin ? "/admin" : "") +
        "/orders/" +
        encodeURIComponent(id) +
        "/tax-invoice/document" +
        (invoiceId ? "?invoice=" + encodeURIComponent(invoiceId) : ""),
    )
      .then((r) => setDoc(r.invoice))
      .catch((e: Error) => setError(e.message));
  }, [id, admin, user?.id, invoiceId]);
  useEffect(() => {
    if (doc) document.title = "ใบกำกับภาษี " + doc.number + " — " + shopName(doc.seller.shopName ?? "");
  }, [doc]);
  const back = (admin ? "/admin" : "") + "/orders/" + id;
  const english = !admin && getLang() === "en";
  const seller = doc?.seller;
  const contact = seller
    ? [seller.phone && t("โทร") + " " + seller.phone, seller.email].filter(Boolean).join(" · ")
    : "";
  return (
    <main className={admin ? "receipt-shell is-admin" : "receipt-shell"} id="receipt">
      <div className="receipt-toolbar">
        <Link to={back} className="receipt-back">
          <ArrowLeft size={16} aria-hidden="true" />
          {t("กลับไปที่ออเดอร์")}
        </Link>
        <button type="button" className="receipt-print" disabled={!doc} onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" />
          {t("ดาวน์โหลด PDF / พิมพ์")}
        </button>
      </div>
      {!user && !loading ? (
        <div className="receipt-paper receipt-message">
          <p>{t("เข้าสู่ระบบเพื่อดูใบกำกับภาษี")}</p>
          <Link to={"/login?next=" + encodeURIComponent(location.pathname + location.search)} className="receipt-print">
            {t("เข้าสู่ระบบ")}
          </Link>
        </div>
      ) : error ? (
        <div className="receipt-paper receipt-message">
          <ErrorMessage message={error} />
        </div>
      ) : !doc || !seller ? (
        <div className="receipt-paper receipt-message" aria-busy="true">
          <LoaderCircle className="spin" size={20} />
          {t("กำลังโหลดใบกำกับภาษี")}
        </div>
      ) : (
        <article className="receipt-paper tax-paper" aria-label={doc.title}>
          {(doc.voided || doc.testMode) && (
            <div className={doc.voided ? "tax-banner is-void" : "tax-banner"} role="note">
              {doc.voided
                ? t("เอกสารนี้ถูกยกเลิกแล้ว") + " · " + doc.voided.reason + " · " + dateTime(doc.voided.at)
                : t("เอกสารทดสอบ (โหมดทดสอบ) ใช้ทางภาษีไม่ได้")}
            </div>
          )}
          <header className="receipt-head">
            <div className="receipt-shop">
              {seller.logoUrl && <img className="tax-logo" src={seller.logoUrl} alt="" />}
              <strong className="receipt-shop-name">{seller.legalName}</strong>
              <span className="receipt-address">{seller.address}</span>
              <span>
                {t("เลขประจำตัวผู้เสียภาษี")} <span className="num">{seller.taxId}</span> · {branchText(seller.branchLabel, seller.branch)}
              </span>
              {contact && <span>{contact}</span>}
            </div>
            <div className="receipt-title">
              <h1>
                {/* Thai title always printed: the Revenue Code requires the words ใบกำกับภาษี on the document. */}
                {doc.title}
                {english && <small className="tax-title-en">{t(doc.title)}</small>}
              </h1>
              <span className="tax-original">{t("ต้นฉบับ")}</span>
              <dl>
                <div>
                  <dt>{t("เลขที่")}</dt>
                  <dd>{doc.number}</dd>
                </div>
                <div>
                  <dt>{t("วันที่")}</dt>
                  <dd>{dateTime(doc.issuedAt)}</dd>
                </div>
                <div>
                  <dt>{t("อ้างอิงคำสั่งซื้อ")}</dt>
                  <dd>#{doc.orderNumber}</dd>
                </div>
              </dl>
            </div>
          </header>
          <section className="receipt-parties">
            <div>
              <h2>{t("ผู้ซื้อ")}</h2>
              <p>
                <strong>{doc.buyer.name}</strong>
              </p>
              <p className="receipt-muted tax-address">{doc.buyer.address}</p>
              <p className="receipt-muted">
                {t("เลขประจำตัวผู้เสียภาษี")} <span className="num">{doc.buyer.taxId}</span>
                {doc.buyer.type === "COMPANY" && " · " + branchText(doc.buyer.branchLabel ?? "", doc.buyer.branch)}
              </p>
            </div>
            <div>
              <h2>{t("รายละเอียดคำสั่งซื้อ")}</h2>
              <dl className="receipt-facts">
                {doc.orderedAt && (
                  <div>
                    <dt>{t("วันที่สั่งซื้อ")}</dt>
                    <dd>{dateTime(doc.orderedAt)}</dd>
                  </div>
                )}
                {doc.paidAt && (
                  <div>
                    <dt>{t("วันที่ชำระเงิน")}</dt>
                    <dd>{dateTime(doc.paidAt)}</dd>
                  </div>
                )}
                <div>
                  <dt>{t("สถานะการชำระเงิน")}</dt>
                  <dd>
                    <span className="receipt-pill is-paid">{t("ชำระเงินแล้ว")}</span>
                  </dd>
                </div>
              </dl>
            </div>
          </section>
          <table className="receipt-table">
            <thead>
              <tr>
                <th scope="col" className="tax-col-no">
                  {t("ลำดับ")}
                </th>
                <th scope="col">{t("รายการ")}</th>
                <th scope="col" className="num">
                  {t("จำนวน")}
                </th>
                <th scope="col" className="num">
                  {t("ราคาต่อหน่วย")}
                </th>
                <th scope="col" className="num">
                  {t("จำนวนเงิน")}
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((item, i) => (
                <tr key={i}>
                  <td className="tax-col-no">{i + 1}</td>
                  <td>
                    <strong>{item.description}</strong>
                    <small>{item.option}</small>
                  </td>
                  <td className="num">{item.quantity}</td>
                  <td className="num">{money(item.unitPrice)}</td>
                  <td className="num">{money(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="receipt-totals tax-totals">
            <div>
              <dt>{t("รวมเป็นเงิน")}</dt>
              <dd>{money(doc.subtotal)}</dd>
            </div>
            {doc.discount > 0 && (
              <div>
                <dt>{t("ส่วนลด")}</dt>
                <dd>−{money(doc.discount)}</dd>
              </div>
            )}
            <div>
              <dt>{t("มูลค่าก่อนภาษีมูลค่าเพิ่ม")}</dt>
              <dd>{money(doc.net)}</dd>
            </div>
            <div className="tax-vat-row">
              <dt>{t("ภาษีมูลค่าเพิ่ม {r}%", { r: doc.vatRate })}</dt>
              <dd>{money(doc.vat)}</dd>
            </div>
            <div className="receipt-grand">
              <dt>{t("จำนวนเงินรวมทั้งสิ้น")}</dt>
              <dd>{money(doc.total)}</dd>
            </div>
          </dl>
          <footer className="receipt-foot">
            <p>{t("ราคารวมภาษีมูลค่าเพิ่มแล้ว")} · {t("เอกสารออกโดยระบบคอมพิวเตอร์")}</p>
            {seller.footerNote && <p className="tax-address">{seller.footerNote}</p>}
          </footer>
        </article>
      )}
    </main>
  );
}
