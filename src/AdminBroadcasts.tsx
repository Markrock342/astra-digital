// /admin/broadcasts — ลูกค้า › ประกาศถึงลูกค้า (ADMIN only). Compose → live preview and
// recipient count → confirm dialog with the admin's password → history table.
// Layout follows shadcn/ui patterns (MIT, github.com/shadcn-ui/ui): Card + Form fields,
// RadioGroup for the audience, Dialog for the confirmation and the data-table for history.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bell, LoaderCircle, Mail, Megaphone, Send, Users, X } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime } from "./api";
import { useDialog } from "./dialog";
import "./broadcast.css";

type Audience = "all" | "buyers" | "unpaid";
type HistoryRow = {
  id: string;
  createdAt: string;
  sender: string | null;
  title: string;
  body: string;
  link: string | null;
  audienceLabel: string;
  recipients: number;
  email: boolean;
  emailsQueued: number;
};
type Status = {
  history: HistoryRow[];
  limit: { max: number; used: number; remaining: number; windowHours: number; nextAt: string | null };
  email: { enabled: boolean; cap: number };
  products: { id: string; name: string; active: number }[];
  limits: { title: number; body: number; link: number; maxDays: number };
};
type Preview = {
  label: string;
  count: number;
  emailEnabled: boolean;
  emailRecipients: number;
  emailCap: number;
};
type Form = {
  title: string;
  body: string;
  link: string;
  audience: Audience;
  productId: string;
  days: string;
  email: boolean;
};
const EMPTY: Form = { title: "", body: "", link: "", audience: "all", productId: "", days: "30", email: false };
const AUDIENCES: [Audience, string, string][] = [
  ["all", "ลูกค้าทั้งหมด", "ทุกบัญชีลูกค้าที่ยังใช้งานอยู่"],
  ["buyers", "ลูกค้าที่ซื้อสินค้า", "ชำระเงินสินค้าที่เลือกภายในจำนวนวันที่กำหนด"],
  ["unpaid", "ลูกค้าที่มีออเดอร์ค้างชำระ", "มีคำสั่งซื้อที่ยังไม่ชำระเงินและยังไม่หมดเวลา"],
];
const linkProblem = (link: string) => {
  const value = link.trim();
  if (!value) return "";
  if (/\s/.test(value)) return "ลิงก์ต้องไม่มีช่องว่าง";
  if (/^\/(?!\/)/.test(value)) return "";
  if (/^https:\/\/[^/\s]+/i.test(value)) return "";
  return "ลิงก์ต้องขึ้นต้นด้วย / (หน้าในร้าน) หรือ https://";
};

export function AdminBroadcasts() {
  const { toast, user } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [counting, setCounting] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const load = () =>
    api<Status>("/admin/broadcasts")
      .then((s) => {
        setStatus(s);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  // Recipient count follows the audience (debounced while the number of days is typed).
  const audienceKey = form.audience === "buyers" ? `buyers|${form.productId}|${form.days}` : form.audience;
  useEffect(() => {
    if (form.audience === "buyers" && !form.productId) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    let live = true;
    // A count for another audience must never be shown (or confirmed) as this one's.
    setPreview(null);
    setCounting(true);
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ audience: form.audience });
      if (form.audience === "buyers") {
        q.set("productId", form.productId);
        q.set("days", form.days);
      }
      api<Preview>("/admin/broadcasts/preview?" + q)
        .then((p) => {
          if (!live) return;
          setPreview(p);
          setPreviewError("");
        })
        .catch((e) => {
          if (!live) return;
          setPreview(null);
          setPreviewError((e as Error).message);
        })
        .finally(() => live && setCounting(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [audienceKey]);
  useDialog(confirming, ".broadcast-confirm", () => !busy && setConfirming(false));

  const limits = status?.limits ?? { title: 120, body: 2000, link: 500, maxDays: 365 };
  const emailOn = !!status?.email.enabled;
  const problem = linkProblem(form.link);
  const ready =
    !!form.title.trim() &&
    !!form.body.trim() &&
    !problem &&
    !!preview &&
    preview.count > 0 &&
    !counting &&
    (status?.limit.remaining ?? 0) > 0;
  const emailCount = preview ? Math.min(preview.emailRecipients, preview.emailCap) : 0;
  const productName = useMemo(
    () => status?.products.find((p) => p.id === form.productId)?.name ?? "",
    [status, form.productId],
  );

  function review(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) return setError("กรุณากรอกหัวข้อประกาศ");
    if (!form.body.trim()) return setError("กรุณากรอกข้อความประกาศ");
    if (problem) return setError(problem);
    if (form.audience === "buyers" && !form.productId) return setError("กรุณาเลือกสินค้า");
    if (!preview || !preview.count) return setError("ไม่มีลูกค้าในกลุ่มนี้");
    setConfirming(true);
  }
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const currentPassword = String(new FormData(e.currentTarget).get("currentPassword") ?? "");
    setBusy(true);
    setError("");
    try {
      const result = await api<{ count: number; emailsQueued: number; emailsSkipped: number }>(
        "/admin/broadcasts",
        {
          title: form.title,
          body: form.body,
          link: form.link.trim() || null,
          audience: form.audience,
          ...(form.audience === "buyers" ? { productId: form.productId, days: Number(form.days) } : {}),
          email: emailOn && form.email,
          currentPassword,
        },
      );
      setConfirming(false);
      setForm(EMPTY);
      toast(
        `ส่งประกาศถึงลูกค้า ${result.count.toLocaleString("th-TH")} คนแล้ว` +
          (result.emailsQueued ? ` · ส่งอีเมล ${result.emailsQueued} ฉบับ` : ""),
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (user?.role !== "ADMIN")
    return (
      <section className="reference-admin-card editor-panel">
        <h1>ประกาศถึงลูกค้า</h1>
        <p>เฉพาะแอดมินเท่านั้น</p>
      </section>
    );

  return (
    <div className="broadcast-admin">
      <div className="reference-admin-heading">
        <div>
          <h1>ประกาศถึงลูกค้า</h1>
          <p>ส่งข่าวสารถึงกลุ่มลูกค้าที่เลือก ลูกค้าจะเห็นที่กระดิ่งแจ้งเตือนบนหน้าร้าน และทางอีเมลถ้าเปิดใช้งาน</p>
        </div>
        {status && (
          <span className={"broadcast-quota" + (status.limit.remaining ? "" : " is-empty")}>
            ส่งแล้ว {status.limit.used}/{status.limit.max} ครั้งใน 24 ชม.
          </span>
        )}
      </div>
      <p className="broadcast-hint">
        แถบประกาศด้านบนหน้าร้านแก้ได้ที่ <Link to="/admin/settings">ตั้งค่า › ร้าน</Link> ส่วนหน้านี้ส่งถึงลูกค้าแต่ละคน
      </p>
      <div className="broadcast-grid">
        <form className="broadcast-form" onSubmit={review} noValidate>
          <section className="reference-admin-card editor-panel">
            <h2>ข้อความ</h2>
            <div className="field">
              <label htmlFor="broadcast-title">หัวข้อ</label>
              <input
                id="broadcast-title"
                name="title"
                value={form.title}
                maxLength={limits.title}
                placeholder="เช่น ต่ออายุบัญชีได้แล้ววันนี้"
                aria-describedby="broadcast-title-help"
                onChange={(e) => set({ title: e.target.value })}
              />
              <small id="broadcast-title-help" className="broadcast-counter">
                {form.title.trim().length}/{limits.title}
              </small>
            </div>
            <div className="field">
              <label htmlFor="broadcast-body">ข้อความ</label>
              <textarea
                id="broadcast-body"
                name="body"
                value={form.body}
                maxLength={limits.body}
                rows={6}
                placeholder="ข้อความแสดงตามที่พิมพ์ ขึ้นบรรทัดใหม่ได้"
                aria-describedby="broadcast-body-help"
                onChange={(e) => set({ body: e.target.value })}
              />
              <small id="broadcast-body-help" className="broadcast-counter">
                {form.body.length}/{limits.body} · แสดงเป็นข้อความธรรมดา ไม่รองรับ HTML
              </small>
            </div>
            <div className="field">
              <label htmlFor="broadcast-link">ลิงก์ (ไม่บังคับ)</label>
              <input
                id="broadcast-link"
                name="link"
                value={form.link}
                maxLength={limits.link}
                inputMode="url"
                placeholder="/products หรือ https://…"
                aria-invalid={!!problem || undefined}
                aria-describedby="broadcast-link-help"
                onChange={(e) => set({ link: e.target.value })}
              />
              <small id="broadcast-link-help" className={problem ? "broadcast-field-error" : ""}>
                {problem || "หน้าในร้านขึ้นต้นด้วย / เช่น /products/netflix หรือเว็บภายนอกที่ขึ้นต้นด้วย https://"}
              </small>
            </div>
          </section>

          <section className="reference-admin-card editor-panel">
            <h2>ผู้รับ</h2>
            <div className="broadcast-audiences" role="radiogroup" aria-label="กลุ่มผู้รับ">
              {AUDIENCES.map(([value, label, help]) => (
                <label key={value} className={"broadcast-audience" + (form.audience === value ? " is-selected" : "")}>
                  <input
                    type="radio"
                    name="audience"
                    value={value}
                    checked={form.audience === value}
                    onChange={() => set({ audience: value })}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{help}</small>
                  </span>
                </label>
              ))}
            </div>
            {form.audience === "buyers" && (
              <div className="admin-form-grid broadcast-buyers">
                <div className="field">
                  <label htmlFor="broadcast-product">สินค้า</label>
                  <select id="broadcast-product" value={form.productId} onChange={(e) => set({ productId: e.target.value })}>
                    <option value="">เลือกสินค้า…</option>
                    {status?.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.active ? "" : " (ปิดขาย)"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="broadcast-days">ซื้อภายใน (วัน)</label>
                  <input
                    id="broadcast-days"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={limits.maxDays}
                    step={1}
                    value={form.days}
                    onChange={(e) => set({ days: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div className="broadcast-count" aria-live="polite">
              <Users size={18} aria-hidden="true" />
              {counting ? (
                <span>
                  <LoaderCircle className="spin" size={14} /> กำลังนับผู้รับ…
                </span>
              ) : preview ? (
                <span>
                  ผู้รับ <strong data-testid="broadcast-count">{preview.count.toLocaleString("th-TH")}</strong> คน
                  <small>{preview.label}</small>
                </span>
              ) : (
                <span className="muted">{previewError || "เลือกสินค้าเพื่อดูจำนวนผู้รับ"}</span>
              )}
            </div>
          </section>

          <section className="reference-admin-card editor-panel">
            <h2>ช่องทาง</h2>
            <label className="checkbox-label">
              <input type="checkbox" checked disabled />
              <Bell size={15} aria-hidden="true" /> แจ้งเตือนในเว็บ (กระดิ่ง) — ส่งทุกครั้ง
            </label>
            <label className={"checkbox-label" + (emailOn ? "" : " is-disabled")}>
              <input
                type="checkbox"
                checked={emailOn && form.email}
                disabled={!emailOn}
                onChange={(e) => set({ email: e.target.checked })}
              />
              <Mail size={15} aria-hidden="true" /> ส่งอีเมลด้วย
            </label>
            <p className="field-help">
              {emailOn
                ? `ส่งเฉพาะอีเมลจริงของลูกค้า สูงสุด ${status?.email.cap ?? 100} ฉบับต่อประกาศ` +
                  (preview && form.email ? ` · ครั้งนี้ ${emailCount} ฉบับ` : "")
                : "ระบบอีเมลของร้านยังไม่ได้ตั้งค่า จึงส่งได้เฉพาะแจ้งเตือนในเว็บ"}
            </p>
          </section>
          <ErrorMessage message={confirming ? "" : error} />
          <div className="editor-save-bar broadcast-actions">
            <span>
              {status && !status.limit.remaining
                ? "ส่งครบ 5 ครั้งใน 24 ชั่วโมงแล้ว" +
                  (status.limit.nextAt ? " · ส่งได้อีกครั้ง " + dateTime(status.limit.nextAt) : "")
                : "ตรวจตัวอย่างด้านขวาก่อนส่ง"}
            </span>
            <button className="button primary" disabled={!ready}>
              <Send size={16} aria-hidden="true" />
              ตรวจสอบและส่ง
            </button>
          </div>
        </form>

        <aside className="broadcast-preview-col" aria-label="ตัวอย่างประกาศ">
          <section className="reference-admin-card broadcast-preview-card">
            <small>ตัวอย่างในกระดิ่งแจ้งเตือนของลูกค้า</small>
            <div className="broadcast-bell-preview">
              <span className="broadcast-bell-icon">
                <Megaphone size={16} aria-hidden="true" />
              </span>
              <div>
                <strong>{form.title.trim() || "หัวข้อประกาศ"}</strong>
                <p>{form.body.trim() || "ข้อความประกาศจะแสดงตรงนี้"}</p>
                {form.link.trim() && !problem && <span className="broadcast-preview-link">{form.link.trim()}</span>}
                <time>เมื่อสักครู่</time>
              </div>
            </div>
            <dl className="broadcast-summary">
              <div>
                <dt>ผู้รับ</dt>
                <dd>{preview ? `${preview.count.toLocaleString("th-TH")} คน` : "–"}</dd>
              </div>
              <div>
                <dt>กลุ่ม</dt>
                <dd>
                  {preview?.label ??
                    (form.audience === "buyers"
                      ? productName
                        ? `ลูกค้าที่ซื้อ ${productName}`
                        : "ยังไม่ได้เลือกสินค้า"
                      : AUDIENCES.find((a) => a[0] === form.audience)?.[1])}
                </dd>
              </div>
              <div>
                <dt>ช่องทาง</dt>
                <dd>{emailOn && form.email ? `กระดิ่ง + อีเมล ${emailCount} ฉบับ` : "กระดิ่งแจ้งเตือน"}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <section className="reference-admin-card broadcast-history">
        <div className="reference-card-heading">
          <h2>ประวัติการส่ง</h2>
          <small>ล่าสุด 50 รายการ</small>
        </div>
        {!status ? (
          <div className="loading-row">
            <LoaderCircle className="spin" size={16} /> กำลังโหลด
          </div>
        ) : status.history.length ? (
          <div className="table-scroll reference-table admin-list-table">
            <table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>หัวข้อ</th>
                  <th>ผู้รับ</th>
                  <th className="num">จำนวน</th>
                  <th>ช่องทาง</th>
                  <th>ผู้ส่ง</th>
                </tr>
              </thead>
              <tbody>
                {status.history.map((h) => (
                  <tr key={h.id}>
                    <td className="nowrap">{dateTime(h.createdAt)}</td>
                    <td>
                      <strong className="broadcast-history-title">{h.title}</strong>
                    </td>
                    <td>{h.audienceLabel}</td>
                    <td className="num">{h.recipients.toLocaleString("th-TH")}</td>
                    <td>{h.email ? `กระดิ่ง + อีเมล ${h.emailsQueued}` : "กระดิ่ง"}</td>
                    <td>{h.sender ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="reference-empty-text">ยังไม่เคยส่งประกาศ</p>
        )}
      </section>

      {confirming && (
        <div className="reference-modal-backdrop" onClick={() => !busy && setConfirming(false)}>
          <section
            className="reference-import-modal broadcast-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="broadcast-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reference-card-heading">
              <h2 id="broadcast-confirm-title">ยืนยันการส่งประกาศ</h2>
              <button className="icon-button" aria-label="ปิด" disabled={busy} onClick={() => setConfirming(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={send}>
              <p className="broadcast-confirm-lead">
                ส่ง “{form.title.trim()}” ถึง <strong>{preview?.count.toLocaleString("th-TH")} คน</strong> ({preview?.label})
                {emailOn && form.email ? ` พร้อมอีเมล ${emailCount} ฉบับ` : ""} ส่งแล้วยกเลิกไม่ได้
              </p>
              <label className="field">
                รหัสผ่านของคุณ (ยืนยันก่อนส่ง)
                <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
              </label>
              <ErrorMessage message={error} />
              <div className="form-actions">
                <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  ยกเลิก
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} aria-hidden="true" />}
                  ส่งประกาศ
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
