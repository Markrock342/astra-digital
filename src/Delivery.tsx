// Delivery type per product (server/delivery.mjs): the "วิธีส่งมอบ" card in the product editor,
// the shared-account seat editor, the fulfilment queue (ออเดอร์ › รอส่งมอบ), the checkout fields
// and the customer's delivered card. Layout follows shadcn/ui (MIT, https://ui.shadcn.com):
// RadioGroup cards, Card, Table, Badge, Switch/Toggle; colours come from the existing tokens.
import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  Mail,
  Minus,
  PackageCheck,
  Plus,
  Send,
  Trash2,
  Type,
  UserRound,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime } from "./api";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { useLive } from "./live";
import type { CheckoutField, Order } from "./types";
import "./delivery.css";

const EN_DELIVERY: Record<string, string> = {
  "โปรไฟล์": "Profile",
  "ที่นั่ง {n}": "Seat {n}",
  "ลิงก์เชิญ": "Invite link",
  "เปิดลิงก์": "Open link",
  "คัดลอกลิงก์แล้ว": "Link copied",
  "ข้อมูลสำหรับร้าน": "Details for the shop",
  "ร้านใช้ข้อมูลนี้ทำรายการให้คุณ": "The shop uses this to set up your order",
  "ไม่บังคับ": "Optional",
  "รอร้านส่งมอบ": "Waiting for the shop",
  "ชำระแล้ว ร้านจะส่งให้ที่หน้านี้และแจ้งเตือนคุณ": "Paid. The shop will deliver here and notify you",
  "ร้านส่งมอบแล้ว": "Delivered by the shop",
  "ข้อมูลที่คุณให้ไว้": "What you sent",
  "ข้อความจากร้าน": "Message from the shop",
  "คัดลอกข้อความแล้ว": "Message copied",
  "คัดลอก": "Copy",
  "ร้านทำรายการให้หลังชำระ แจ้งเตือนเมื่อเสร็จ": "The shop sets it up after payment and notifies you",
  "ชำระแล้ว รอร้านส่งมอบ": "Paid, waiting for the shop",
  "ร้านกำลังทำรายการให้คุณ": "The shop is setting up your order",
  "บัญชีแชร์ ได้ที่นั่งของคุณทันทีหลังชำระ": "Shared account, your seat arrives right after payment",
  "ได้ลิงก์เชิญทันทีหลังชำระ": "Invite link arrives right after payment",
};
for (const [th, en] of Object.entries(EN_DELIVERY)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

export type DeliveryType = "account" | "shared" | "code" | "invite" | "manual";

// ---------------------------------------------------------------- storefront

/** One-line delivery note on the product page (null = keep the default line). */
export function deliveryNote(type?: string | null): string | null {
  if (type === "manual") return t("ร้านทำรายการให้หลังชำระ แจ้งเตือนเมื่อเสร็จ");
  if (type === "shared") return t("บัญชีแชร์ ได้ที่นั่งของคุณทันทีหลังชำระ");
  if (type === "invite") return t("ได้ลิงก์เชิญทันทีหลังชำระ");
  return null;
}

/** Checkout: the fields a shop-fulfilled product asks for. */
export function CheckoutFields({
  fields,
  values,
  onChange,
}: {
  fields: CheckoutField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  if (!fields.length) return null;
  return (
    <fieldset className="checkout-fields">
      <legend>
        <Wrench size={16} />
        {t("ข้อมูลสำหรับร้าน")}
      </legend>
      {fields.map((f) => (
        <label className="field" key={f.id}>
          <span>
            {f.label}
            {!f.required && <small> · {t("ไม่บังคับ")}</small>}
          </span>
          <input
            name={"delivery-" + f.id}
            type={f.type === "email" ? "email" : "text"}
            inputMode={f.type === "email" ? "email" : undefined}
            autoComplete={f.type === "email" ? "email" : "off"}
            required={f.required}
            maxLength={200}
            value={values[f.id] ?? ""}
            onChange={(e) => onChange({ ...values, [f.id]: e.target.value })}
          />
        </label>
      ))}
      <p className="checkout-fields-note">{t("ร้านใช้ข้อมูลนี้ทำรายการให้คุณ")}</p>
    </fieldset>
  );
}
/** All required fields filled (and emails look like emails). */
export function checkoutFieldsReady(fields: CheckoutField[], values: Record<string, string>) {
  return fields.every((f) => {
    const v = (values[f.id] ?? "").trim();
    if (!v) return !f.required;
    return f.type !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  });
}

function useCopy() {
  const { toast } = useStore();
  return async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(done);
    } catch {
      toast(t("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกโค้ดแล้วคัดลอก"));
    }
  };
}

/** Order page: invite links (button + copy). */
export function DeliveredLinks({ links }: { links: string[] }) {
  const copy = useCopy();
  if (!links.length) return null;
  return (
    <>
      {links.map((link, i) => (
        <div className="delivered-link" key={"link-" + i}>
          <small>
            <Link2 size={14} />
            {t("ลิงก์เชิญ")}
          </small>
          <code>{link}</code>
          <span className="delivered-link-actions">
            <a className="button primary" href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} />
              {t("เปิดลิงก์")}
            </a>
            <button
              type="button"
              className="icon-button"
              aria-label={t("คัดลอก") + " " + t("ลิงก์เชิญ")}
              onClick={() => void copy(link, t("คัดลอกลิงก์แล้ว"))}
            >
              <Copy size={18} />
            </button>
          </span>
        </div>
      ))}
    </>
  );
}

/** Order page: a shop-fulfilled order (waiting → done with the shop's message). */
export function FulfilmentCard({ order }: { order: Order }) {
  const copy = useCopy();
  const f = order.fulfilment;
  if (!f || order.status !== "DELIVERED") return null;
  const done = f.state === "done";
  return (
    <div className={"fulfilment-card" + (done ? " is-done" : "")}>
      <div className="fulfilment-head">
        {done ? <PackageCheck size={20} /> : <LoaderCircle size={20} className="fulfilment-wait" />}
        <div>
          <strong>{done ? t("ร้านส่งมอบแล้ว") : t("รอร้านส่งมอบ")}</strong>
          <p>{done ? (f.deliveredAt ? dateTime(f.deliveredAt) : "") : t("ชำระแล้ว ร้านจะส่งให้ที่หน้านี้และแจ้งเตือนคุณ")}</p>
        </div>
      </div>
      {done && f.message && (
        <div className="fulfilment-message">
          <small>{t("ข้อความจากร้าน")}</small>
          <p>{f.message}</p>
          <button type="button" className="button secondary" onClick={() => void copy(f.message, t("คัดลอกข้อความแล้ว"))}>
            <Copy size={16} />
            {t("คัดลอก")}
          </button>
        </div>
      )}
      {f.inputs.length > 0 && (
        <dl className="fulfilment-inputs" aria-label={t("ข้อมูลที่คุณให้ไว้")}>
          {f.inputs.map((i) => (
            <div key={i.id}>
              <dt>{i.label}</dt>
              <dd>{i.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- admin: delivery type card

const TYPES: [DeliveryType, string, string, typeof KeyRound][] = [
  ["account", "บัญชีส่วนตัว", "ID + รหัสผ่าน", UserRound],
  ["shared", "บัญชีแชร์", "1 บัญชี หลายที่นั่ง", Users],
  ["code", "โค้ด / คีย์", "โค้ดเดี่ยว", KeyRound],
  ["invite", "ลิงก์เชิญ", "จำกัดครั้งต่อลิงก์", Link2],
  ["manual", "ร้านทำให้", "ลูกค้ากรอกข้อมูล ร้านส่งทีหลัง", Wrench],
];
export const deliveryTypeLabel = (type?: string | null) => TYPES.find(([k]) => k === type)?.[1] ?? "บัญชีส่วนตัว";

type FieldDraft = { id?: string; label: string; type: "text" | "email"; required: boolean };
type DeliveryInfo = {
  productId: string;
  type: DeliveryType;
  stored: DeliveryType | null;
  fields: FieldDraft[];
  preorder: boolean;
  freeStock: number;
  waiting: number;
};

/** Product editor: "วิธีส่งมอบ" (ADMIN). Saves on its own, like the preorder card. */
export function DeliveryTypeCard({ productId, onChanged }: { productId: string; onChanged?: (type: DeliveryType) => void }) {
  const { user, toast } = useStore();
  const admin = user?.role === "ADMIN";
  const [info, setInfo] = useState<DeliveryInfo | null>(null);
  const [type, setType] = useState<DeliveryType>("account");
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!admin) return;
    api<DeliveryInfo>("/admin/products/" + encodeURIComponent(productId) + "/delivery")
      .then((r) => {
        setInfo(r);
        setType(r.type);
        setFields(r.fields.length ? r.fields : [{ label: "", type: "email", required: true }]);
      })
      .catch((e) => setError((e as Error).message));
  }, [productId, admin]);
  if (!admin) return null;
  const savedFields = JSON.stringify(info?.fields ?? []);
  const cleanFields = fields.filter((f) => f.label.trim());
  const dirty =
    !!info && (type !== info.type || (type === "manual" && JSON.stringify(cleanFields) !== savedFields) || (!info.stored && type !== info.type));
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<DeliveryInfo>(
        "/admin/products/" + encodeURIComponent(productId) + "/delivery",
        { type, fields: type === "manual" ? cleanFields.map((f) => ({ ...f, label: f.label.trim() })) : [] },
        "PATCH",
      );
      setInfo(r);
      setFields(r.fields.length ? r.fields : [{ label: "", type: "email", required: true }]);
      toast("บันทึกวิธีส่งมอบแล้ว");
      onChanged?.(r.type);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const setField = (i: number, patch: Partial<FieldDraft>) =>
    setFields((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <section className="reference-admin-card editor-panel delivery-type-card" aria-busy={!info && !error}>
      <div className="delivery-type-head">
        <h2>วิธีส่งมอบ</h2>
        {!!info?.waiting && (
          <Link to="/admin/fulfilment" className="admin-chip">
            รอส่งมอบ {info.waiting}
          </Link>
        )}
      </div>
      <form onSubmit={save}>
        <div className="delivery-type-grid" role="radiogroup" aria-label="วิธีส่งมอบ">
          {TYPES.map(([key, label, sub, Icon]) => {
            const blocked = key === "manual" && (info?.preorder || (info?.freeStock ?? 0) > 0) && info?.type !== "manual";
            return (
              <label key={key} className={"delivery-type-option" + (blocked ? " is-blocked" : "")}>
                <input
                  type="radio"
                  name="delivery-type"
                  value={key}
                  checked={type === key}
                  disabled={busy || !info || blocked}
                  onChange={() => setType(key)}
                />
                <Icon size={20} />
                <span>
                  <strong>{label}</strong>
                  <small>{blocked ? (info?.preorder ? "ใช้กับพรีออเดอร์ไม่ได้" : "มีสต็อกค้างอยู่") : sub}</small>
                </span>
                <CheckCircle2 size={16} className="delivery-type-check" />
              </label>
            );
          })}
        </div>
        {type === "manual" && (
          <div className="delivery-fields">
            <h3>ช่องให้ลูกค้ากรอกตอนสั่ง</h3>
            {fields.map((f, i) => (
              <div className="delivery-field-row" key={i}>
                <input
                  aria-label={"ชื่อช่องที่ " + (i + 1)}
                  placeholder="เช่น อีเมล Gmail ที่จะให้เชิญ"
                  maxLength={60}
                  value={f.label}
                  onChange={(e) => setField(i, { label: e.target.value })}
                />
                <div className="segmented-control delivery-field-type" role="group" aria-label="ชนิดข้อมูล">
                  <button
                    type="button"
                    className={f.type === "email" ? "active" : ""}
                    aria-pressed={f.type === "email"}
                    onClick={() => setField(i, { type: "email" })}
                  >
                    <Mail size={14} />
                    อีเมล
                  </button>
                  <button
                    type="button"
                    className={f.type === "text" ? "active" : ""}
                    aria-pressed={f.type === "text"}
                    onClick={() => setField(i, { type: "text" })}
                  >
                    <Type size={14} />
                    ข้อความ
                  </button>
                </div>
                <label className="delivery-field-required">
                  <input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} />
                  บังคับ
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={"ลบช่องที่ " + (i + 1)}
                  onClick={() => setFields((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {fields.length < 5 && (
              <button
                type="button"
                className="button ghost"
                onClick={() => setFields((list) => [...list, { label: "", type: "text", required: true }])}
              >
                <Plus size={15} />
                เพิ่มช่อง
              </button>
            )}
          </div>
        )}
        <ErrorMessage message={error} />
        <div className="delivery-type-actions">
          <button className="button primary" disabled={busy || !info || !dirty}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            บันทึกวิธีส่งมอบ
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- admin: seats of one shared account

type SeatGroup = {
  groupId: string;
  kind: "seat" | "invite";
  variantId: string;
  loginIdMasked: string;
  seats: {
    id: string;
    seatNo: number;
    label: string | null;
    hasPin: boolean;
    status: "available" | "sold" | "defective";
    order_id: string | null;
    reservation_id: string | null;
  }[];
};

/** Stock page: seats of one shared account (or uses of one invite link). */
export function SeatGroupPanel({ groupId, onChanged, onClose }: { groupId: string; onChanged: () => void; onClose: () => void }) {
  const { user, toast } = useStore();
  const admin = user?.role === "ADMIN";
  const [group, setGroup] = useState<SeatGroup | null>(null);
  const [count, setCount] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    api<SeatGroup>("/admin/seat-groups/" + encodeURIComponent(groupId))
      .then((g) => {
        setGroup(g);
        setCount(g.seats.filter((s) => s.status !== "defective").length);
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      toast(done);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!group)
    return (
      <div className="seat-panel" aria-busy={!error}>
        <ErrorMessage message={error} />
      </div>
    );
  const live = group.seats.filter((s) => s.status !== "defective").length;
  const sold = group.seats.filter((s) => s.status === "sold").length;
  const invite = group.kind === "invite";
  const unit = invite ? "ครั้ง" : "ที่นั่ง";
  return (
    <div className="seat-panel">
      <div className="seat-panel-head">
        <span>
          {invite ? <Link2 size={16} /> : <Users size={16} />}
          <code>{group.loginIdMasked}</code>
          <small>
            ขายแล้ว {sold}/{live} {unit}
          </small>
        </span>
        <button type="button" className="icon-button" aria-label="ปิด" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {admin && (
        <div className="seat-count" role="group" aria-label={"จำนวน" + unit}>
          <button type="button" className="icon-button" aria-label={"ลด" + unit} disabled={busy || count <= Math.max(1, sold)} onClick={() => setCount(count - 1)}>
            <Minus size={16} />
          </button>
          <input
            aria-label={"จำนวน" + unit}
            type="number"
            inputMode="numeric"
            min={Math.max(1, sold)}
            max={invite ? 1000 : 50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.round(Number(e.target.value) || 1)))}
          />
          <button type="button" className="icon-button" aria-label={"เพิ่ม" + unit} disabled={busy} onClick={() => setCount(count + 1)}>
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy || count === live}
            onClick={() =>
              void run(() => api("/admin/seat-groups/" + encodeURIComponent(groupId), { seats: count }, "PATCH"), "บันทึกจำนวน" + unit + "แล้ว")
            }
          >
            บันทึก
          </button>
          {!invite && (
            <button type="button" className="button ghost" aria-expanded={loginOpen} onClick={() => setLoginOpen(!loginOpen)}>
              <KeyRound size={15} />
              เปลี่ยนรหัสบัญชี
            </button>
          )}
        </div>
      )}
      {loginOpen && (
        <form
          className="seat-login-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            void run(
              () => api("/admin/seat-groups/" + encodeURIComponent(groupId) + "/login", data, "PATCH"),
              "อัปเดตบัญชีแล้ว ผู้ซื้อได้แจ้งเตือน",
            ).then(() => setLoginOpen(false));
          }}
        >
          <input name="loginId" aria-label="ID ใหม่" placeholder="ID ใหม่ (เว้นว่าง = เดิม)" maxLength={160} autoComplete="off" />
          <input name="password" aria-label="รหัสผ่านใหม่" placeholder="รหัสผ่านใหม่" maxLength={500} autoComplete="new-password" />
          <button className="button primary" disabled={busy}>
            บันทึก
          </button>
        </form>
      )}
      {!invite && (
        <table className="seat-table">
          <thead>
            <tr>
              <th>#</th>
              <th>โปรไฟล์</th>
              <th>PIN</th>
              <th>สถานะ</th>
              {admin && <th aria-label="แก้ไข" />}
            </tr>
          </thead>
          <tbody>
            {group.seats.map((s) =>
              editing === s.id ? (
                <tr key={s.id}>
                  <td colSpan={admin ? 5 : 4}>
                    <form
                      className="seat-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
                        const body: Record<string, string> = { label: data.label };
                        if (data.pin !== "") body.pin = data.pin;
                        void run(() => api("/admin/seats/" + s.id, body, "PATCH"), "บันทึกที่นั่งแล้ว").then(() => setEditing(null));
                      }}
                    >
                      <span className="seat-no">{s.seatNo}</span>
                      <input name="label" aria-label="ชื่อโปรไฟล์" defaultValue={s.label ?? ""} maxLength={40} placeholder="เช่น จอ 1" />
                      <input name="pin" aria-label="PIN" maxLength={20} inputMode="numeric" placeholder={s.hasPin ? "PIN ใหม่ (เว้นว่าง = เดิม)" : "PIN"} autoComplete="off" />
                      <button className="button primary" disabled={busy}>
                        บันทึก
                      </button>
                      <button type="button" className="button ghost" onClick={() => setEditing(null)}>
                        ยกเลิก
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={s.id} className={"seat-" + s.status}>
                  <td className="seat-no">{s.seatNo}</td>
                  <td>{s.label ?? <span className="muted">–</span>}</td>
                  <td>{s.hasPin ? "••••" : <span className="muted">–</span>}</td>
                  <td>
                    <span className={"seat-badge seat-badge-" + s.status}>
                      {s.status === "sold" ? "ขายแล้ว" : s.status === "defective" ? "เสีย" : "ว่าง"}
                    </span>
                    {(s.order_id || s.reservation_id) && (
                      <Link to={"/admin/orders/" + (s.order_id ?? s.reservation_id)} className="seat-order-link">
                        ออเดอร์
                      </Link>
                    )}
                  </td>
                  {admin && (
                    <td>
                      {s.status !== "defective" && (
                        <button type="button" className="button ghost" onClick={() => setEditing(s.id)}>
                          แก้
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      <ErrorMessage message={error} />
    </div>
  );
}

// ---------------------------------------------------------------- admin: fulfilment queue

type QueueRow = {
  id: string;
  state: "waiting" | "done";
  created_at: string;
  delivered_at: string | null;
  quantity: number;
  ordered_at: string;
  customer_id: string;
  customer: string;
  product_id: string;
  product: string;
  label: string;
  inputs: { id: string; label: string; value: string }[];
};

/** Deliver form: one message (account details, instructions…) for the customer. */
export function FulfilForm({ orderId, onDone, update = false }: { orderId: string; onDone: () => void; update?: boolean }) {
  const { toast } = useStore();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/orders/" + encodeURIComponent(orderId) + "/fulfil", { message });
      toast(update ? "อัปเดตแล้ว ลูกค้าได้แจ้งเตือน" : "ส่งมอบแล้ว ลูกค้าได้แจ้งเตือน");
      setMessage("");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="fulfil-form" onSubmit={send}>
      <textarea
        aria-label="ข้อความถึงลูกค้า"
        placeholder="ข้อความ / ข้อมูลบัญชีที่ลูกค้าจะเห็น"
        rows={3}
        maxLength={2000}
        required
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <ErrorMessage message={error} />
      <button className="button primary" disabled={busy || !message.trim()}>
        {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
        {update ? "ส่งข้อความใหม่" : "ส่งแล้ว"}
      </button>
    </form>
  );
}

function CopyInput({ value }: { value: string }) {
  const { toast } = useStore();
  return (
    <button
      type="button"
      className="fulfil-input-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => toast("คัดลอกแล้ว"), () => {});
      }}
    >
      <span>{value}</span>
      <Copy size={13} />
    </button>
  );
}

/** ออเดอร์ › รอส่งมอบ: paid orders of shop-fulfilled products. */
export function FulfilmentQueue() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [view, setView] = useState<"waiting" | "done">("waiting");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api<{ rows: QueueRow[] }>("/admin/fulfilment")
      .then((r) => setRows(r.rows))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  useLive(["orders"], () => void load());
  const waiting = (rows ?? []).filter((r) => r.state === "waiting");
  const done = (rows ?? []).filter((r) => r.state === "done");
  const shown = view === "waiting" ? waiting : done;
  return (
    <section className="reference-admin-card fulfilment-queue">
      <div className="reference-admin-heading">
        <div>
          <h1>รอส่งมอบ</h1>
        </div>
        <div className="reference-status-tabs" role="group" aria-label="สถานะ">
          <button type="button" className={view === "waiting" ? "active" : ""} onClick={() => setView("waiting")}>
            รอ {waiting.length}
          </button>
          <button type="button" className={view === "done" ? "active" : ""} onClick={() => setView("done")}>
            ส่งแล้ว {done.length}
          </button>
        </div>
      </div>
      <ErrorMessage message={error} />
      {rows && !shown.length && <p className="muted">{view === "waiting" ? "ไม่มีออเดอร์รอส่งมอบ" : "ยังไม่มีรายการใน 30 วัน"}</p>}
      <ul className="fulfil-list">
        {shown.map((r) => (
          <li key={r.id} className="fulfil-item">
            <div className="fulfil-item-head">
              <span>
                <Link to={"/admin/orders/" + r.id}>
                  <strong>{r.product}</strong>
                </Link>
                <small>
                  {r.label} · {r.quantity} ชิ้น · {r.customer} · {dateTime(r.ordered_at)}
                </small>
              </span>
              {r.state === "waiting" ? (
                <button type="button" className="button primary" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <Send size={15} />
                  ส่งมอบ
                </button>
              ) : (
                <span className="seat-badge seat-badge-sold">ส่งแล้ว {r.delivered_at ? dateTime(r.delivered_at) : ""}</span>
              )}
            </div>
            {r.inputs.length > 0 && (
              <dl className="fulfil-inputs">
                {r.inputs.map((i) => (
                  <div key={i.id}>
                    <dt>{i.label}</dt>
                    <dd>
                      <CopyInput value={i.value} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {open === r.id && (
              <FulfilForm
                orderId={r.id}
                onDone={() => {
                  setOpen(null);
                  void load();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Admin order detail: what the customer typed + deliver / re-send. */
export function AdminFulfilment({
  orderId,
  fulfilment,
  revealedMessage,
  onChanged,
}: {
  orderId: string;
  fulfilment: { state: string; inputs: { id: string; label: string; value: string }[]; hasMessage: boolean; deliveredAt: string | null };
  revealedMessage?: string;
  onChanged: () => void;
}) {
  const [resend, setResend] = useState(false);
  const waiting = fulfilment.state === "waiting";
  return (
    <div className="admin-fulfilment">
      <span className={"seat-badge " + (waiting ? "seat-badge-available" : fulfilment.state === "done" ? "seat-badge-sold" : "")}>
        {waiting ? "รอส่งมอบ" : fulfilment.state === "done" ? "ส่งมอบแล้ว" : "ยังไม่ชำระ"}
        {fulfilment.deliveredAt ? " · " + dateTime(fulfilment.deliveredAt) : ""}
      </span>
      {fulfilment.inputs.length > 0 && (
        <dl className="fulfil-inputs">
          {fulfilment.inputs.map((i) => (
            <div key={i.id}>
              <dt>{i.label}</dt>
              <dd>
                <CopyInput value={i.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {revealedMessage && <pre className="fulfil-message-shown">{revealedMessage}</pre>}
      {waiting && <FulfilForm orderId={orderId} onDone={onChanged} />}
      {fulfilment.state === "done" &&
        (resend ? (
          <FulfilForm
            orderId={orderId}
            update
            onDone={() => {
              setResend(false);
              onChanged();
            }}
          />
        ) : (
          <button type="button" className="button ghost" onClick={() => setResend(true)}>
            <Send size={15} />
            แก้ข้อความที่ส่ง
          </button>
        ))}
    </div>
  );
}
