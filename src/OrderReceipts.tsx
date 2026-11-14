// ใบเสร็จคำสั่งซื้อ — account profiles + per-order request card (server/order-receipts.mjs).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileText, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api } from "./api";
import { EN_STRINGS } from "./i18n-en";
import { t } from "./i18n";
import { useLive } from "./live";
import {
  BuyerFields,
  buyerPayload,
  draftFrom,
  type Buyer,
  type BuyerDraft,
} from "./TaxInvoice";
import "./tax-invoice.css";
import "./order-receipts.css";

const EN_OR: Record<string, string> = {
  "ขอได้ภายใน 7 วันหลังชำระ": "Ask within 7 days of payment",
  "ขอใบเสร็จ": "Request receipt",
  "ขอใหม่": "Ask again",
  "ข้อมูลใบเสร็จคำสั่งซื้อ": "Order receipt details",
  "บันทึกข้อมูลสำหรับออกใบเสร็จได้หลายรายการ แล้วเลือกใช้ตอนส่งคำขอในแต่ละออเดอร์":
    "Save multiple receipt profiles, then pick one when you request a receipt on an order.",
  "เพิ่มข้อมูลใบเสร็จ": "Add receipt profile",
  "ชื่อโปรไฟล์": "Profile label",
  "เช่น บ้าน / ที่ทำงาน": "e.g. Home / Work",
  "บันทึกโปรไฟล์": "Save profile",
  "ยังไม่มีข้อมูลใบเสร็จ": "No receipt profiles yet",
  "ลบโปรไฟล์นี้": "Delete this profile",
  "ใบเสร็จคำสั่งซื้อ": "Order receipt",
  "ส่งคำขอใบเสร็จ": "Request receipt",
  "รอทีมงานอนุมัติ": "Waiting for approval",
  "อนุมัติแล้ว": "Approved",
  "ไม่อนุมัติ": "Declined",
  "ดู / พิมพ์ใบเสร็จ": "View / print receipt",
  "เลือกโปรไฟล์ใบเสร็จ": "Choose a receipt profile",
  "หรือกรอกข้อมูลใหม่": "Or enter new details",
  "ส่งคำขอ": "Submit request",
  "หมดเวลายื่นคำขอแล้ว": "Request window expired",
  "บันทึกโปรไฟล์แล้ว": "Profile saved",
  "ส่งคำขอใบเสร็จแล้ว": "Receipt request submitted",
  "ลบโปรไฟล์แล้ว": "Profile deleted",
  "ยกเลิก": "Cancel",
};
for (const [th, en] of Object.entries(EN_OR)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

type Profile = Buyer & { id: string; label: string; createdAt: string; updatedAt: string };
type ReceiptState = {
  orderId: string;
  request: null | {
    status: "PENDING" | "APPROVED" | "REJECTED";
    statusLabel: string;
    reason: string | null;
    buyer: Buyer;
  };
  window: { eligible: boolean; reason: string | null; expiresAt: string | null };
  canRequest: boolean;
  canDownload: boolean;
  downloadBlockedReason: string | null;
};

const emptyDraft = (): BuyerDraft & { label: string } => ({
  ...draftFrom(null),
  label: "",
});

/** Account › ข้อมูลใบเสร็จคำสั่งซื้อ — many saved buyer profiles. */
export function ReceiptProfilesPanel() {
  const { toast } = useStore();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = () =>
    api<{ profiles: Profile[] }>("/account/receipt-profiles")
      .then((r) => setProfiles(r.profiles))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/account/receipt-profiles", { label: draft.label.trim() || "ข้อมูลใบเสร็จ", ...buyerPayload(draft) });
      setDraft(emptyDraft());
      setOpen(false);
      toast(t("บันทึกโปรไฟล์แล้ว"));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setError("");
    try {
      await api("/account/receipt-profiles/" + encodeURIComponent(id), undefined, "DELETE");
      toast(t("ลบโปรไฟล์แล้ว"));
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <section className="panel order-receipt-profiles" aria-labelledby="receipt-profiles-title">
      <h2 id="receipt-profiles-title">{t("ข้อมูลใบเสร็จคำสั่งซื้อ")}</h2>
      <p className="muted">{t("บันทึกข้อมูลสำหรับออกใบเสร็จได้หลายรายการ แล้วเลือกใช้ตอนส่งคำขอในแต่ละออเดอร์")}</p>
      <ErrorMessage message={error} />
      {profiles.length === 0 ? <p className="muted">{t("ยังไม่มีข้อมูลใบเสร็จ")}</p> : null}
      <ul className="order-receipt-profile-list">
        {profiles.map((p) => (
          <li key={p.id} className="order-receipt-profile-item">
            <div>
              <strong>{p.label}</strong>
              <p>
                {p.name} · {p.taxId}
              </p>
              <p className="muted">{p.address}</p>
            </div>
            <button type="button" className="button secondary" onClick={() => void remove(p.id)} aria-label={t("ลบโปรไฟล์นี้")}>
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <form className="order-receipt-profile-form" onSubmit={save}>
          <label className="field">
            {t("ชื่อโปรไฟล์")}
            <input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder={t("เช่น บ้าน / ที่ทำงาน")}
              maxLength={80}
              required
            />
          </label>
          <BuyerFields value={draft} onChange={(next) => setDraft({ ...draft, ...next, label: draft.label })} />
          <div className="order-receipt-actions">
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
              {t("บันทึกโปรไฟล์")}
            </button>
            <button type="button" className="button secondary" onClick={() => setOpen(false)}>
              {t("ยกเลิก")}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="button secondary" onClick={() => setOpen(true)}>
          <Plus size={16} />
          {t("เพิ่มข้อมูลใบเสร็จ")}
        </button>
      )}
    </section>
  );
}

/** Order detail card: request / pending / approved / rejected. */
export function OrderReceiptCard({ orderId }: { orderId: string }) {
  const { toast } = useStore();
  const [state, setState] = useState<ReceiptState | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [useNew, setUseNew] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Closed until the customer asks: most orders never need a receipt. ใบเสร็จของฉัน links here
  // with ?receipt=open, which opens it and brings it into view.
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get("receipt") === "open");
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open && state) cardRef.current?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!state]);
  const load = () =>
    Promise.all([
      api<ReceiptState>("/orders/" + encodeURIComponent(orderId) + "/order-receipt"),
      api<{ profiles: Profile[] }>("/account/receipt-profiles"),
    ])
      .then(([st, pr]) => {
        setState(st);
        setProfiles(pr.profiles);
        if (!profileId && pr.profiles[0]) setProfileId(pr.profiles[0].id);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, [orderId]);
  useLive(["orders", "notify"], () => void load());
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = useNew || !profileId ? buyerPayload(draft) : { profileId };
      const next = await api<ReceiptState>("/orders/" + encodeURIComponent(orderId) + "/order-receipt", body);
      setState(next);
      setOpen(false);
      toast(t("ส่งคำขอใบเสร็จแล้ว"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!state) {
    return error ? <ErrorMessage message={error} /> : null;
  }
  const status = state.request?.status;
  // One line: what the receipt is doing now, and the one action that fits.
  const line =
    status === "PENDING"
      ? t("รอทีมงานอนุมัติ")
      : status === "APPROVED"
        ? t("อนุมัติแล้ว")
        : status === "REJECTED"
          ? t("ไม่อนุมัติ") + (state.request?.reason ? " — " + state.request.reason : "")
          : state.canRequest
            ? t("ขอได้ภายใน 7 วันหลังชำระ")
            : state.window.reason || state.downloadBlockedReason || t("หมดเวลายื่นคำขอแล้ว");
  return (
    <section ref={cardRef} className="panel order-receipt-card" aria-labelledby={"order-receipt-" + orderId}>
      <div className="order-receipt-row">
        <FileText size={18} aria-hidden="true" />
        <div>
          <h3 id={"order-receipt-" + orderId}>{t("ใบเสร็จคำสั่งซื้อ")}</h3>
          <p
            className={
              "order-receipt-line" +
              (status === "APPROVED" ? " is-ok" : status === "REJECTED" ? " is-fail" : status === "PENDING" ? " is-pending" : "")
            }
          >
            {line}
          </p>
        </div>
        {status === "APPROVED" ? (
          <Link to={"/orders/" + orderId + "/receipt"} className="button secondary small">
            {t("ดู / พิมพ์ใบเสร็จ")}
          </Link>
        ) : state.canRequest && !open ? (
          <button type="button" className="button secondary small" onClick={() => setOpen(true)}>
            {status === "REJECTED" ? t("ขอใหม่") : t("ขอใบเสร็จ")}
          </button>
        ) : null}
      </div>
      <ErrorMessage message={error} />
      {state.canRequest && open && (
        <form onSubmit={submit} className="order-receipt-request-form">
          {profiles.length > 0 && !useNew && (
            <label className="field">
              {t("เลือกโปรไฟล์ใบเสร็จ")}
              <select value={profileId} onChange={(e) => setProfileId(e.target.value)} required>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(useNew || profiles.length === 0) && (
            <BuyerFields value={draft} onChange={(next) => setDraft({ ...draft, ...next, label: draft.label })} />
          )}
          {profiles.length > 0 && (
            <button type="button" className="linkish" onClick={() => setUseNew(!useNew)}>
              {useNew ? t("เลือกโปรไฟล์ใบเสร็จ") : t("หรือกรอกข้อมูลใหม่")}
            </button>
          )}
          <div className="order-receipt-form-actions">
            <button type="button" className="button ghost" onClick={() => setOpen(false)}>
              {t("ยกเลิก")}
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : null}
              {t("ส่งคำขอ")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
