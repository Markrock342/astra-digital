// Back office for receipts + full tax invoices (server/tax-invoices.mjs). Thai only.
// - AdminReceiptSettings: ตั้งค่า › ใบเสร็จและใบกำกับภาษี (company, tax ID, branch, address,
//   contact on documents, logo, footer, VAT-registered, number prefix).
// - AdminTaxInvoices: ออเดอร์ › ใบกำกับภาษี — pending requests, issued invoices, rejected.
// - AdminTaxInvoiceCard: on the order detail — buyer details, issue / reject / void, print.
// Layout reference: shadcn/ui (MIT, https://ui.shadcn.com) Form, Input, Card, RadioGroup,
// Switch and Badge, on the admin's existing white-card / cool-grey brand pass (alerts.css).
import { useEffect, useState, type FormEvent } from "react";
import { Ban, CheckCircle2, FileCheck2, FileText, LoaderCircle, Printer, Save, XCircle } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { confirmDialog } from "./dialogs";
import { useLive } from "./live";
import {
  BuyerFields,
  BuyerSummary,
  buyerPayload,
  draftFrom,
  taxInvoiceHref,
  validTaxId,
  type Buyer,
  type BuyerDraft,
  type TaxInvoiceState,
} from "./TaxInvoice";
import "./alerts.css";
import "./tax-invoice.css";

type Mode = TaxInvoiceState["mode"];
const MODE_TEXT: Record<Mode, [string, string]> = {
  TAX_INVOICE: ["on", "ลูกค้าขอใบกำกับภาษีเต็มรูปได้"],
  RECEIPT: ["off", "ออกเฉพาะใบเสร็จรับเงิน (ไม่ได้จดทะเบียน VAT)"],
  OFF: ["fail", "ยังเปิดใบกำกับภาษีไม่ได้ ข้อมูลบริษัทไม่ครบ"],
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="alert-switch" onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

// ------------------------------------------------------------ settings

type ReceiptSettings = {
  legalName: string;
  taxId: string;
  branch: string;
  address: string;
  phone: string;
  email: string;
  showLogo: boolean;
  footerNote: string;
  vatRegistered: boolean;
  invoicePrefix: string;
  updatedAt: string | null;
};
type SettingsView = {
  settings: ReceiptSettings;
  saved: boolean;
  mode: Mode;
  missing: string[];
  logoUrl: string | null;
  shopName: string;
  nextNumber: string;
  testMode: boolean;
};
type SettingsDraft = Omit<ReceiptSettings, "branch" | "updatedAt"> & { branchKind: "HEAD" | "BRANCH"; branchNo: string };
const toDraft = (s: ReceiptSettings): SettingsDraft => ({
  legalName: s.legalName,
  taxId: s.taxId,
  branchKind: s.branch && s.branch !== "00000" ? "BRANCH" : "HEAD",
  branchNo: s.branch && s.branch !== "00000" ? s.branch : "",
  address: s.address,
  phone: s.phone,
  email: s.email,
  showLogo: s.showLogo,
  footerNote: s.footerNote,
  vatRegistered: s.vatRegistered,
  invoicePrefix: s.invoicePrefix,
});

/** /admin/settings/receipts */
export function AdminReceiptSettings() {
  const { toast } = useStore();
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<SettingsView>("/admin/receipt-settings")
      .then((v) => {
        setView(v);
        setDraft(toDraft(v.settings));
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const set = (patch: Partial<SettingsDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const dirty = !!view && !!draft && JSON.stringify(draft) !== JSON.stringify(toDraft(view.settings));
  const taxIdDigits = draft?.taxId.replace(/[\s-]/g, "") ?? "";
  const taxIdError = taxIdDigits.length > 0 && !validTaxId(taxIdDigits);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<SettingsView>("/admin/receipt-settings", {
        legalName: draft.legalName,
        taxId: taxIdDigits,
        branch: draft.branchKind === "HEAD" ? "HEAD" : draft.branchNo,
        address: draft.address,
        phone: draft.phone,
        email: draft.email,
        showLogo: draft.showLogo,
        footerNote: draft.footerNote,
        vatRegistered: draft.vatRegistered,
        invoicePrefix: draft.invoicePrefix,
      });
      setView(next);
      setDraft(toDraft(next.settings));
      toast("บันทึกการตั้งค่าใบเสร็จแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [badge, modeText] = view ? MODE_TEXT[view.mode] : ["off", ""];
  return (
    <div className="alerts-page tax-settings-page">
      <div className="reference-admin-heading">
        <div>
          <h1>ใบเสร็จและใบกำกับภาษี</h1>
          <p>ออกใบเสร็จในนามบริษัทของร้าน และเปิดให้ลูกค้าขอใบกำกับภาษีเต็มรูป (ราคาในร้านรวม VAT แล้ว)</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      {!view || !draft ? (
        <section className="reference-admin-card editor-panel">
          <p className="reference-empty-text">กำลังโหลด…</p>
        </section>
      ) : (
        <form className="alerts-form" onSubmit={save}>
          <section className="reference-admin-card editor-panel tax-status-card" aria-live="polite">
            <span className={"alert-badge " + badge}>{modeText}</span>
            {view.missing.length > 0 && <p className="field-help">ยังขาด: {view.missing.join(", ")}</p>}
            {view.mode === "TAX_INVOICE" && (
              <p className="field-help">
                เลขที่ใบถัดไป <strong className="num">{view.nextNumber}</strong>
                {view.testMode && " · โหมดทดสอบ: เลขที่ขึ้นต้นด้วย TEST- และแยกจากเลขจริงหลังเปิดร้าน"}
              </p>
            )}
          </section>

          <section className="reference-admin-card editor-panel tax-settings-card">
            <h2>ผู้ออกเอกสาร</h2>
            <p className="field-help">ชื่อและที่อยู่ตามหนังสือรับรอง / ภ.พ.20 ที่จะพิมพ์บนใบเสร็จและใบกำกับภาษี</p>
            <div className="tax-grid">
              <label className="field tax-span-2">
                ชื่อนิติบุคคล / ชื่อผู้ประกอบการ
                <input value={draft.legalName} onChange={(e) => set({ legalName: e.target.value })} maxLength={200} placeholder="บริษัท ตัวอย่าง จำกัด" />
              </label>
              <label className="field">
                เลขประจำตัวผู้เสียภาษี (13 หลัก)
                <input
                  value={draft.taxId}
                  onChange={(e) => set({ taxId: e.target.value.replace(/[^\d\s-]/g, "").slice(0, 17) })}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={taxIdError || undefined}
                />
                {taxIdError && <small className="field-error">เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง</small>}
              </label>
              <fieldset className="tax-radio-group">
                <legend>สำนักงาน</legend>
                <div className="tax-radio-row" role="radiogroup" aria-label="สำนักงาน">
                  <label className={draft.branchKind === "HEAD" ? "tax-radio selected" : "tax-radio"}>
                    <input type="radio" name="shop-branch" checked={draft.branchKind === "HEAD"} onChange={() => set({ branchKind: "HEAD" })} />
                    <span>สำนักงานใหญ่</span>
                  </label>
                  <label className={draft.branchKind === "BRANCH" ? "tax-radio selected" : "tax-radio"}>
                    <input type="radio" name="shop-branch" checked={draft.branchKind === "BRANCH"} onChange={() => set({ branchKind: "BRANCH" })} />
                    <span>สาขาที่</span>
                  </label>
                  {draft.branchKind === "BRANCH" && (
                    <input
                      className="tax-branch-input"
                      aria-label="เลขสาขา 5 หลัก"
                      placeholder="00001"
                      value={draft.branchNo}
                      onChange={(e) => set({ branchNo: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                      inputMode="numeric"
                      required
                    />
                  )}
                </div>
              </fieldset>
              <label className="field tax-span-2">
                ที่อยู่ตามที่จดทะเบียน
                <textarea value={draft.address} onChange={(e) => set({ address: e.target.value })} rows={3} maxLength={400} />
              </label>
              <label className="field">
                เบอร์โทรบนเอกสาร
                <input value={draft.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} inputMode="tel" placeholder="ใช้เบอร์ร้านถ้าเว้นว่าง" />
              </label>
              <label className="field">
                อีเมลบนเอกสาร
                <input value={draft.email} onChange={(e) => set({ email: e.target.value })} maxLength={120} inputMode="email" placeholder="ใช้อีเมลร้านถ้าเว้นว่าง" />
              </label>
            </div>
          </section>

          <section className="reference-admin-card editor-panel tax-settings-card">
            <div className="tax-switch-row">
              <div>
                <h2>จดทะเบียนภาษีมูลค่าเพิ่ม (VAT 7%)</h2>
                <p className="field-help">
                  เปิดเมื่อร้านจด VAT แล้ว ลูกค้าจะขอใบกำกับภาษีเต็มรูปได้จากหน้าคำสั่งซื้อที่ได้รับสินค้าแล้ว
                  ภาษีคิดจากยอดที่ลูกค้าจ่ายจริง (ราคารวม VAT: ภาษี = ยอด × 7/107) · ต้องกรอกชื่อ เลขภาษี และที่อยู่ให้ครบ
                </p>
              </div>
              <Switch checked={draft.vatRegistered} onChange={(v) => set({ vatRegistered: v })} label="จดทะเบียนภาษีมูลค่าเพิ่ม" />
            </div>
            <label className="field tax-prefix-field">
              อักษรนำหน้าเลขที่ใบกำกับภาษี
              <input
                value={draft.invoicePrefix}
                onChange={(e) => set({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 10) })}
                maxLength={10}
                autoComplete="off"
              />
              <small className="field-hint">เลขที่ = อักษรนำหน้า + ปี + ลำดับ 6 หลัก เช่น {draft.invoicePrefix || "INV"}2026-000001 · เลขเรียงต่อกันและไม่ซ้ำ</small>
            </label>
          </section>

          <section className="reference-admin-card editor-panel tax-settings-card">
            <div className="tax-switch-row">
              <div>
                <h2>โลโก้บนเอกสาร</h2>
                <p className="field-help">
                  {view.logoUrl ? "ใช้โลโก้ร้านจาก ตั้งค่า › ร้าน" : "ยังไม่มีโลโก้ร้าน ตั้งได้ที่ ตั้งค่า › ร้าน"}
                </p>
              </div>
              {view.logoUrl && <img className="tax-logo-preview" src={view.logoUrl} alt="" />}
              <Switch checked={draft.showLogo} onChange={(v) => set({ showLogo: v })} label="แสดงโลโก้บนเอกสาร" />
            </div>
            <label className="field">
              ข้อความท้ายเอกสาร (ไม่บังคับ)
              <textarea
                value={draft.footerNote}
                onChange={(e) => set({ footerNote: e.target.value })}
                rows={2}
                maxLength={300}
                placeholder="เช่น ขอบคุณที่ใช้บริการ · สอบถามได้ที่ LINE ของร้าน"
              />
            </label>
          </section>

          <div className="admin-action-row tax-save-row">
            {view.settings.updatedAt && <span className="muted">บันทึกล่าสุด {dateTime(view.settings.updatedAt)}</span>}
            <button className="button primary" disabled={busy || !dirty}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
              บันทึก
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------ list page

type RequestRow = {
  orderId: string;
  status: string;
  buyer: Buyer | null;
  reason: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  total: number;
  customer: { name: string; email: string };
};
type IssuedRow = {
  id: string;
  number: string;
  orderId: string;
  issuedAt: string;
  buyerName: string;
  buyerTaxId: string;
  total: number;
  vat: number;
  net: number;
  voided: { reason: string; at: string } | null;
};
type ListData = {
  status: string;
  counts: { pending: number };
  mode: Mode;
  requests?: RequestRow[];
  invoices?: IssuedRow[];
};
const LIST_TABS: [string, string][] = [
  ["PENDING", "รอออก"],
  ["ISSUED", "ออกแล้ว"],
  ["REJECTED", "ไม่อนุมัติ"],
];
const shortId = (id: string) => id.slice(0, 8).toUpperCase();

/** /admin/tax-invoices */
export function AdminTaxInvoices() {
  const [status, setStatus] = useState("PENDING");
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api<ListData>("/admin/tax-invoices?status=" + status)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    setData(null);
    void load();
  }, [status]);
  useLive(["orders"], () => void load());
  return (
    <div className="alerts-page tax-list-page">
      <div className="reference-admin-heading">
        <div>
          <h1>ใบกำกับภาษี</h1>
          <p>คำขอใบกำกับภาษีเต็มรูปจากลูกค้า · เปิดออเดอร์เพื่อตรวจข้อมูลผู้ซื้อแล้วกดออกใบ</p>
        </div>
        <Link to="/admin/settings/receipts" className="button secondary">
          ตั้งค่าใบเสร็จ
        </Link>
      </div>
      <ErrorMessage message={error} />
      {data && data.mode !== "TAX_INVOICE" && (
        <section className="reference-admin-card editor-panel tax-status-card">
          <span className={"alert-badge " + MODE_TEXT[data.mode][0]}>{MODE_TEXT[data.mode][1]}</span>
          <p className="field-help">
            เปิดได้ที่ <Link to="/admin/settings/receipts">ตั้งค่า › ใบเสร็จและใบกำกับภาษี</Link>
          </p>
        </section>
      )}
      <div className="reference-status-tabs order-status-tabs" role="tablist" aria-label="สถานะ">
        {LIST_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            className={status === key ? "active" : ""}
            onClick={() => setStatus(key)}
          >
            {label}
            {key === "PENDING" && data && <span className="tab-count">{data.counts.pending.toLocaleString("th-TH")}</span>}
          </button>
        ))}
      </div>
      {!data ? (
        <section className="reference-admin-card editor-panel">
          <p className="reference-empty-text">กำลังโหลด…</p>
        </section>
      ) : data.invoices ? (
        data.invoices.length ? (
          <div className="table-scroll reference-table admin-list-table">
            <table>
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>วันที่ออก</th>
                  <th>ผู้ซื้อ</th>
                  <th className="num">ก่อน VAT</th>
                  <th className="num">VAT</th>
                  <th className="num">รวม</th>
                  <th>ออเดอร์</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} className={i.voided ? "tax-row-void" : ""}>
                    <td>
                      <Link to={taxInvoiceHref(i.orderId, true, i.id)} className="num">
                        {i.number}
                      </Link>
                      {i.voided && <span className="alert-badge fail tax-inline-badge">ยกเลิกแล้ว</span>}
                    </td>
                    <td>{dateTime(i.issuedAt)}</td>
                    <td>
                      {i.buyerName}
                      <small className="tax-sub num">{i.buyerTaxId}</small>
                    </td>
                    <td className="num">{money(i.net)}</td>
                    <td className="num">{money(i.vat)}</td>
                    <td className="num">{money(i.total)}</td>
                    <td>
                      <Link to={"/admin/orders/" + i.orderId}>{shortId(i.orderId)}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <section className="reference-admin-card editor-panel fraud-empty">
            <p>ยังไม่มีใบกำกับภาษีที่ออก</p>
          </section>
        )
      ) : data.requests?.length ? (
        <div className="table-scroll reference-table admin-list-table">
          <table>
            <thead>
              <tr>
                <th>ออเดอร์</th>
                <th>ขอเมื่อ</th>
                <th>ผู้ซื้อ</th>
                <th>ลูกค้า</th>
                <th className="num">ยอด</th>
                {status === "REJECTED" && <th>เหตุผล</th>}
              </tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.orderId}>
                  <td>
                    <Link to={"/admin/orders/" + r.orderId}>{shortId(r.orderId)}</Link>
                  </td>
                  <td>{dateTime(r.requestedAt)}</td>
                  <td>
                    {r.buyer?.name ?? "—"}
                    {r.buyer && <small className="tax-sub num">{r.buyer.taxId}</small>}
                  </td>
                  <td>
                    {r.customer.name || "ลูกค้า"}
                    {r.customer.email && <small className="tax-sub">{r.customer.email}</small>}
                  </td>
                  <td className="num">{money(r.total)}</td>
                  {status === "REJECTED" && <td>{r.reason}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className="reference-admin-card editor-panel fraud-empty">
          <CheckCircle2 size={20} aria-hidden="true" />
          <p>{status === "PENDING" ? "ไม่มีคำขอที่รอออก" : "ยังไม่มีรายการ"}</p>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------- order detail card

type AdminState = TaxInvoiceState & {
  canIssue: boolean;
  missing: string[];
  order: { id: string; total: number; status: string; preorder: boolean };
  customer: { name: string; email: string };
};
const STATUS_BADGE: Record<string, [string, string]> = {
  PENDING: ["fail", "ลูกค้าขอใบกำกับภาษี · รอออก"],
  ISSUED: ["on", "ออกใบกำกับภาษีแล้ว"],
  REJECTED: ["off", "ไม่อนุมัติ"],
  VOIDED: ["off", "ยกเลิกใบแล้ว"],
  SAVED: ["off", "บันทึกข้อมูลผู้ซื้อแล้ว"],
};

/** Order detail: tax invoice / buyer on the receipt. Staff see it; ADMIN acts. */
export function AdminTaxInvoiceCard({ orderId }: { orderId: string }) {
  const { user, toast } = useStore();
  const admin = user?.role === "ADMIN";
  const [state, setState] = useState<AdminState | null>(null);
  const [draft, setDraft] = useState<BuyerDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"" | "edit" | "reject" | "void">("");
  const [reason, setReason] = useState("");
  const path = "/admin/orders/" + encodeURIComponent(orderId) + "/tax-invoice";
  const load = () =>
    api<AdminState>(path)
      .then((s) => {
        setState(s);
        setDraft((d) => d ?? draftFrom(s.request?.buyer));
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, [orderId]);
  useLive(["orders"], () => void load());
  if (!state || !draft) return error ? <ErrorMessage message={error} /> : null;
  // Nothing to show for an order that can never get one (unpaid, refunded …) without history.
  if (!state.request && !state.invoices.length && !state.eligible) return null;
  // Not VAT-registered: only worth a card once the customer put a buyer on the receipt.
  if (state.mode === "RECEIPT" && !state.request?.buyer && !state.invoices.length) return null;
  const active = state.activeInvoice;
  const status = active ? "ISSUED" : state.request?.status;
  const receiptMode = state.mode === "RECEIPT";
  async function run(action: () => Promise<AdminState | { state: AdminState }>, message: string) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      const next = "state" in result ? result.state : result;
      setState(next);
      setDraft(draftFrom(next.request?.buyer));
      setMode("");
      setReason("");
      toast(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const saveBuyer = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api<AdminState>(path + "/buyer", buyerPayload(draft)), "บันทึกข้อมูลผู้ซื้อแล้ว");
  };
  const issue = () => {
    void confirmDialog({ title: "ออกใบกำกับภาษีให้ออเดอร์นี้? ระบบจะใช้เลขที่ถัดไป และแก้ไขใบที่ออกแล้วไม่ได้ (ยกเลิกแล้วออกใบใหม่ได้)" }).then((ok) => {
      if (!ok) return;
      void run(
        () => api<{ state: AdminState }>(path + "/issue", mode === "edit" || !state.request?.buyer ? { buyer: buyerPayload(draft) } : {}),
        "ออกใบกำกับภาษีแล้ว ลูกค้าได้แจ้งเตือน",
      );
    });
  };
  const reject = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api<AdminState>(path + "/reject", { reason }), "แจ้งลูกค้าว่าไม่อนุมัติแล้ว");
  };
  const voidInvoice = (e: FormEvent) => {
    e.preventDefault();
    if (!active) return;
    void run(() => api<AdminState>("/admin/tax-invoices/" + active.id + "/void", { reason }), "ยกเลิกใบกำกับภาษีแล้ว");
  };
  const badge = status ? STATUS_BADGE[status] : null;
  const showForm = admin && !active && state.mode === "TAX_INVOICE" && (mode === "edit" || !state.request?.buyer);
  return (
    <section className="reference-admin-card admin-detail-card tax-admin-card" aria-label="ใบกำกับภาษี">
      <header className="tax-admin-head">
        <h2>
          {active ? <FileCheck2 size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
          {receiptMode ? "ผู้ซื้อในใบเสร็จ" : "ใบกำกับภาษี"}
        </h2>
        {badge && <span className={"alert-badge " + badge[0]}>{badge[1]}</span>}
      </header>
      <ErrorMessage message={error} />
      {state.mode === "OFF" && (
        <p className="field-help">
          ข้อมูลบริษัทไม่ครบ ({state.missing.join(", ")}) · <Link to="/admin/settings/receipts">ตั้งค่าใบเสร็จ</Link>
        </p>
      )}
      {receiptMode && <p className="field-help">ร้านไม่ได้จด VAT · ลูกค้าใส่ชื่อผู้ซื้อในใบเสร็จรับเงินได้เอง ไม่ต้องอนุมัติ</p>}
      {state.blockedReason && !active && state.mode !== "OFF" && <p className="field-help">{state.blockedReason}</p>}
      {active && (
        <div className="tax-issued-row">
          <div>
            <strong className="num">{active.number}</strong>
            <small>
              ออกเมื่อ {dateTime(active.issuedAt)} · VAT {money(active.vat)} · รวม {money(active.total)}
            </small>
          </div>
          <Link to={taxInvoiceHref(orderId, true)} className="button secondary">
            <Printer size={15} />
            ดู / พิมพ์
          </Link>
        </div>
      )}
      {state.request?.reason && (status === "REJECTED" || status === "VOIDED") && (
        <p className="tax-alert">
          <strong>{status === "VOIDED" ? "เหตุผลที่ยกเลิก" : "เหตุผลที่ไม่อนุมัติ"}</strong>
          <span>{state.request.reason}</span>
        </p>
      )}
      {showForm ? (
        <form className="tax-form" onSubmit={saveBuyer}>
          <BuyerFields value={draft} onChange={setDraft} idPrefix="admin-buyer" />
          <div className="admin-action-row">
            {state.request?.buyer && (
              <button type="button" className="button ghost" onClick={() => setMode("")} disabled={busy}>
                ยกเลิกการแก้ไข
              </button>
            )}
            <button className="button secondary" disabled={busy}>
              <Save size={15} />
              บันทึกข้อมูลผู้ซื้อ
            </button>
            {state.canIssue && (
              <button type="button" className="button primary" disabled={busy} onClick={issue}>
                <FileCheck2 size={15} />
                บันทึกและออกใบกำกับภาษี
              </button>
            )}
          </div>
        </form>
      ) : (
        state.request?.buyer &&
        !active && (
          <>
            <BuyerSummary buyer={state.request.buyer} />
            {state.request.requestedAt && state.request.status === "PENDING" && (
              <p className="field-help">ลูกค้าขอเมื่อ {dateTime(state.request.requestedAt)}</p>
            )}
          </>
        )
      )}
      {admin && !showForm && !active && state.mode === "TAX_INVOICE" && mode === "" && (
        <div className="admin-action-row">
          {state.request?.buyer && (
            <button type="button" className="button ghost" disabled={busy} onClick={() => setMode("edit")}>
              แก้ข้อมูลผู้ซื้อ
            </button>
          )}
          {state.request?.status === "PENDING" && (
            <button type="button" className="button secondary" disabled={busy} onClick={() => setMode("reject")}>
              <XCircle size={15} />
              ไม่อนุมัติ
            </button>
          )}
          {state.canIssue && (
            <button type="button" className="button primary" disabled={busy} onClick={issue}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <FileCheck2 size={15} />}
              ออกใบกำกับภาษี
            </button>
          )}
        </div>
      )}
      {admin && active && mode === "" && (
        <div className="admin-action-row">
          <button type="button" className="button ghost" disabled={busy} onClick={() => setMode("void")}>
            <Ban size={15} />
            ยกเลิกใบกำกับภาษี
          </button>
        </div>
      )}
      {(mode === "reject" || mode === "void") && (
        <form className="admin-reason-form" onSubmit={mode === "reject" ? reject : voidInvoice}>
          <label className="field">
            {mode === "reject" ? "เหตุผลที่ไม่อนุมัติ (ลูกค้าเห็น)" : "เหตุผลที่ยกเลิกใบ (ลูกค้าเห็น · เลขที่เดิมจะไม่ถูกใช้ซ้ำ)"}
            <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} autoFocus />
          </label>
          <div className="admin-action-row">
            <button type="button" className="button secondary" onClick={() => setMode("")} disabled={busy}>
              กลับ
            </button>
            <button className="button danger" disabled={busy}>
              {mode === "reject" ? "ยืนยันไม่อนุมัติ" : "ยืนยันยกเลิกใบกำกับภาษี"}
            </button>
          </div>
        </form>
      )}
      {state.invoices.some((i) => i.voided) && (
        <ul className="tax-history" aria-label="ใบที่ยกเลิกแล้ว">
          {state.invoices
            .filter((i) => i.voided)
            .map((i) => (
              <li key={i.id}>
                <Link to={taxInvoiceHref(orderId, true, i.id)} className="num">
                  {i.number}
                </Link>
                <span className="alert-badge off">ยกเลิกแล้ว</span>
                <small>{i.voided!.reason}</small>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
