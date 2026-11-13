// Back office for preorder modes (server/preorder.mjs): the "วิธีจอง" card in the product
// editor and the stage / mode labels used by ออเดอร์ › คิวพรีออเดอร์. Radio cards, fields and
// buttons reuse the existing admin classes (product-type-option, field, button); the layout
// follows shadcn/ui Radio Group + Card (MIT, https://ui.shadcn.com).
import { useEffect, useState, type FormEvent } from "react";
import { BadgePercent, CheckCircle2, CreditCard, LoaderCircle, Ticket } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api, dateTime, money } from "./api";
import type { PreorderMode } from "./types";
import "./preorder.css";

type Settings = {
  mode: PreorderMode;
  depositType: "percent" | "fixed";
  depositValue: number;
  payWindowHours: number;
  lapsePolicy: "refund_credit" | "keep";
  maxPerCustomer: number | null;
  queueLimit: number | null;
};
type SettingsResponse = {
  productId: string;
  preorder: boolean;
  settings: Settings;
  lowestPrice: number | null;
  open: number;
};

const MODES: [PreorderMode, string, string, typeof CreditCard][] = [
  ["full", "จ่ายเต็มตอนจอง", "ลูกค้าจ่ายครบได้เลขคิว ทีมงานกดส่งของตามคิว (แบบเดิม)", CreditCard],
  ["deposit", "มัดจำ", "จ่ายมัดจำได้เลขคิว ของพร้อมแล้วระบบเรียกคิวให้จ่ายส่วนที่เหลือแล้วส่งของอัตโนมัติ", BadgePercent],
  ["free", "จองฟรี", "ไม่ต้องจ่ายตอนจอง ของพร้อมแล้วเรียกคิวให้จ่ายเต็มราคาภายในเวลาที่กำหนด", Ticket],
];

/** Plain-Thai summary of what the customer will see. */
function summary(s: Settings, lowestPrice: number | null) {
  if (s.mode === "full") return "ลูกค้าจ่ายเต็มราคาตอนจอง ได้เลขคิว แล้วทีมงานส่งของจากเมนูคิวพรีออเดอร์";
  const late =
    s.mode === "free"
      ? "ถ้าไม่จ่ายในเวลา สิทธิ์ส่งต่อคิวถัดไป"
      : s.lapsePolicy === "keep"
        ? "ถ้าไม่จ่ายในเวลา ร้านเก็บมัดจำ แล้วเรียกคิวถัดไป"
        : "ถ้าไม่จ่ายในเวลา คืนมัดจำเป็นเครดิตร้าน แล้วเรียกคิวถัดไป";
  const deposit =
    s.mode === "deposit"
      ? s.depositType === "percent"
        ? "มัดจำ " + s.depositValue + "% ของราคา" +
          (lowestPrice ? " (เช่น ราคา " + money(lowestPrice) + " มัดจำ " + money(Math.round((lowestPrice * s.depositValue) / 100)) + ")" : "")
        : "มัดจำ " + money(s.depositValue) + " ต่อชิ้น"
      : "จองฟรี";
  return deposit + " · ของพร้อมแล้วจ่ายส่วนที่เหลือภายใน " + s.payWindowHours + " ชั่วโมง · " + late;
}

/** Product editor card "วิธีจอง" (ADMIN; preorder products only). Saves on its own. */
export function PreorderModeCard({ productId }: { productId: string }) {
  const { user, toast } = useStore();
  const admin = user?.role === "ADMIN";
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [baht, setBaht] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!admin) return;
    api<SettingsResponse>("/admin/products/" + encodeURIComponent(productId) + "/preorder")
      .then((r) => {
        setData(r);
        setDraft(r.settings);
        setBaht(r.settings.depositType === "fixed" ? String(r.settings.depositValue / 100) : "");
      })
      .catch((e) => setError((e as Error).message));
  }, [productId, admin]);
  if (!admin) return null;
  if (!draft || !data)
    return (
      <section className="reference-admin-card editor-panel preorder-mode-card" aria-busy={!error}>
        <h2>วิธีจอง</h2>
        <ErrorMessage message={error} />
      </section>
    );
  const set = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const value =
        draft.depositType === "fixed" ? Math.round(Number(baht || 0) * 100) : Math.round(Number(draft.depositValue));
      const saved = await api<SettingsResponse>(
        "/admin/products/" + encodeURIComponent(productId) + "/preorder",
        {
          mode: draft.mode,
          depositType: draft.depositType,
          depositValue: value,
          payWindowHours: Math.round(Number(draft.payWindowHours)),
          lapsePolicy: draft.lapsePolicy,
          maxPerCustomer: draft.maxPerCustomer,
          queueLimit: draft.queueLimit,
        },
        "PATCH",
      );
      setData(saved);
      setDraft(saved.settings);
      toast("บันทึกวิธีจองแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shown: Settings =
    draft.depositType === "fixed" ? { ...draft, depositValue: Math.round(Number(baht || 0) * 100) } : draft;
  return (
    <section className="reference-admin-card editor-panel preorder-mode-card">
      <h2>วิธีจอง</h2>
      <p>เลือกว่าลูกค้าจ่ายเท่าไรตอนจอง ใช้กับการจองใหม่เท่านั้น คิวเดิมใช้เงื่อนไขตอนที่ลูกค้าจอง{data.open ? " (ตอนนี้มี " + data.open + " คิวที่ยังเปิดอยู่)" : ""}</p>
      <form onSubmit={save}>
        <fieldset className="product-type-group" aria-label="วิธีจอง">
          {MODES.map(([mode, title, help, Icon]) => (
            <label className="product-type-option" key={mode}>
              <input
                type="radio"
                name="preorderMode"
                value={mode}
                checked={draft.mode === mode}
                onChange={() => set({ mode })}
              />
              <Icon size={20} aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <small>{help}</small>
              </div>
              <CheckCircle2 size={17} className="product-type-check" aria-hidden="true" />
            </label>
          ))}
        </fieldset>
        {draft.mode !== "full" && (
          <div className="preorder-mode-fields">
            {draft.mode === "deposit" && (
              <label className="field">
                ยอดมัดจำ
                <span className="preorder-inline">
                  <select
                    aria-label="แบบมัดจำ"
                    value={draft.depositType}
                    onChange={(e) => {
                      const depositType = e.target.value as Settings["depositType"];
                      set({ depositType, depositValue: depositType === "percent" ? 30 : draft.depositValue });
                    }}
                  >
                    <option value="percent">% ของราคา</option>
                    <option value="fixed">บาทต่อชิ้น</option>
                  </select>
                  {draft.depositType === "percent" ? (
                    <input
                      aria-label="มัดจำกี่เปอร์เซ็นต์"
                      type="number"
                      min={1}
                      max={90}
                      step={1}
                      inputMode="numeric"
                      required
                      value={draft.depositValue}
                      onChange={(e) => set({ depositValue: Number(e.target.value) })}
                    />
                  ) : (
                    <input
                      aria-label="มัดจำกี่บาท"
                      type="number"
                      min={1}
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={baht}
                      onChange={(e) => setBaht(e.target.value)}
                    />
                  )}
                </span>
                <small>
                  {draft.depositType === "percent"
                    ? "1–90% ของราคาที่ลูกค้าเห็นตอนจอง (ปัดเศษเป็นสตางค์)"
                    : "ต้องน้อยกว่าราคาตัวเลือกที่ถูกที่สุด" + (data.lowestPrice ? " (" + money(data.lowestPrice) + ")" : "")}
                </small>
              </label>
            )}
            <label className="field">
              เวลาชำระหลังเรียกคิว (ชั่วโมง)
              <input
                type="number"
                min={1}
                max={168}
                step={1}
                inputMode="numeric"
                required
                value={draft.payWindowHours}
                onChange={(e) => set({ payWindowHours: Number(e.target.value) })}
              />
              <small>ลูกค้าต้องจ่ายส่วนที่เหลือภายในเวลานี้ ระบบเตือนก่อนหมดเวลาประมาณ 2 ชั่วโมง (1–168)</small>
            </label>
            {draft.mode === "deposit" && (
              <fieldset className="field span-2">
                <legend>ถ้าลูกค้าไม่จ่ายภายในเวลา</legend>
                <span className="preorder-radio-row">
                  <label>
                    <input
                      type="radio"
                      name="lapsePolicy"
                      checked={draft.lapsePolicy === "refund_credit"}
                      onChange={() => set({ lapsePolicy: "refund_credit" })}
                    />
                    คืนมัดจำเป็นเครดิตร้าน
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="lapsePolicy"
                      checked={draft.lapsePolicy === "keep"}
                      onChange={() => set({ lapsePolicy: "keep" })}
                    />
                    ร้านเก็บมัดจำ
                  </label>
                </span>
                <small>ลูกค้าเห็นเงื่อนไขนี้ในหน้าสินค้าก่อนจอง แล้วระบบเรียกคิวถัดไปให้อัตโนมัติ</small>
              </fieldset>
            )}
          </div>
        )}
        <div className="preorder-mode-fields">
          <label className="field">
            จำนวนคิวต่อบัญชี
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              inputMode="numeric"
              placeholder={draft.mode === "free" ? "1 (ค่าเริ่มต้นจองฟรี)" : "ไม่จำกัด"}
              value={draft.maxPerCustomer ?? ""}
              onChange={(e) => set({ maxPerCustomer: numberOrNull(e.target.value) })}
            />
            <small>คิวที่ยังเปิดอยู่ของลูกค้าหนึ่งคนสำหรับสินค้านี้ เว้นว่าง = จองฟรี 1 คิว / แบบอื่นไม่จำกัด</small>
          </label>
          <label className="field">
            จำนวนคิวสูงสุดของสินค้านี้
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              inputMode="numeric"
              placeholder="ไม่จำกัด"
              value={draft.queueLimit ?? ""}
              onChange={(e) => set({ queueLimit: numberOrNull(e.target.value) })}
            />
            <small>ครบแล้วปิดรับจองให้อัตโนมัติ จนกว่าจะมีคิวจบ</small>
          </label>
        </div>
        <p className="preorder-mode-summary" aria-live="polite">
          {summary(shown, data.lowestPrice)}
        </p>
        <ErrorMessage message={error} />
        <div className="preorder-mode-actions">
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : null}
            บันทึกวิธีจอง
          </button>
        </div>
      </form>
    </section>
  );
}

export type QueueStageRow = {
  status: string;
  mode?: PreorderMode;
  stage?: string | null;
  pay_by?: string | null;
};

export const queueModeText: Record<PreorderMode, string> = {
  full: "จ่ายเต็ม",
  deposit: "มัดจำ",
  free: "จองฟรี",
};

/** รอของ / เรียกแล้ว·รอจ่ายถึง <time> / หมดเวลา / ส่งแล้ว / ยกเลิก. */
export function QueueStage({ row }: { row: QueueStageRow }) {
  if ((row.mode ?? "full") === "full") {
    if (row.status === "DELIVERED") return <span className="queue-stage is-delivered">ส่งแล้ว</span>;
    if (row.status === "CANCELLED") return <span className="queue-stage is-cancelled">ยกเลิก</span>;
    return <span className="queue-stage is-queued">รอส่ง</span>;
  }
  switch (row.stage) {
    case "queued":
      return <span className="queue-stage is-queued">รอของ</span>;
    case "called":
      return (
        <span className="queue-stage is-called" title={row.pay_by ? "ต้องจ่ายภายใน " + dateTime(row.pay_by) : undefined}>
          เรียกแล้ว · รอจ่ายถึง {row.pay_by ? dateTime(row.pay_by) : "-"}
        </span>
      );
    case "lapsed":
      return <span className="queue-stage is-lapsed">หมดเวลา</span>;
    case "delivered":
      return <span className="queue-stage is-delivered">ส่งแล้ว</span>;
    case "cancelled":
      return <span className="queue-stage is-cancelled">ลูกค้ายกเลิก</span>;
    case "shop_cancelled":
      return <span className="queue-stage is-cancelled">ร้านยกเลิก</span>;
    default:
      return <span className="queue-stage">{row.status}</span>;
  }
}
