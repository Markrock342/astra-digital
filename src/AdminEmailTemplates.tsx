// Admin › ตั้งค่า › ข้อความอีเมล: edit the subject / heading / body of each email the shop
// sends, with placeholders, a preview on sample data, "send a test to my email" and reset.
// Layout reference: shadcn/ui (MIT, github.com/shadcn-ui/ui) — Card, Badge, Input, Textarea
// and the "Mail" example's list + reading pane — on the admin's white-card / cool-grey pass.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlert, Eye, LoaderCircle, Mail, RotateCcw, Save, Send } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api, dateTime } from "./api";
import { confirmDialog } from "./dialogs";
import "./alerts.css";
import "./fraud-templates.css";

type Template = {
  key: string;
  label: string;
  when: string;
  placeholders: { name: string; hint: string }[];
  required: string[];
  subject: string;
  heading: string;
  body: string;
  defaults: { subject: string; heading: string; body: string };
  customized: boolean;
  updatedAt: string | null;
};
type TemplatesData = {
  email: { enabled: boolean; canTest: boolean };
  limits: { subject: number; heading: number; body: number; testPerHour: number; testsLeft: number };
  templates: Template[];
};
type Draft = { subject: string; heading: string; body: string };
type Field = keyof Draft;
type Preview = { subject: string; text: string; html: string };

const pick = (t: Template): Draft => ({ subject: t.subject, heading: t.heading, body: t.body });

export function AdminEmailTemplates() {
  const { toast } = useStore();
  const [data, setData] = useState<TemplatesData | null>(null);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Draft>({ subject: "", heading: "", body: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "preview" | "test" | "reset">("");
  const [confirmReset, setConfirmReset] = useState(false);
  const focused = useRef<{ field: Field; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const current = data?.templates.find((t) => t.key === selected) ?? null;
  const dirty = !!current && JSON.stringify(draft) !== JSON.stringify(pick(current));

  async function load(keep = selected) {
    try {
      const next = await api<TemplatesData>("/admin/email-templates");
      setData(next);
      const key = next.templates.some((t) => t.key === keep) ? keep : next.templates[0]?.key ?? "";
      setSelected(key);
      const t = next.templates.find((x) => x.key === key);
      if (t) setDraft(pick(t));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load("");
  }, []);
  async function choose(key: string) {
    if (key === selected) return;
    if (dirty && !(await confirmDialog({ title: "ข้อความที่แก้ยังไม่บันทึก ต้องการเปลี่ยนแม่แบบหรือไม่" }))) return;
    const t = data?.templates.find((x) => x.key === key);
    if (!t) return;
    setSelected(key);
    setDraft(pick(t));
    setPreview(null);
    setConfirmReset(false);
    setError("");
  }
  /** Put {name} where the cursor was in the last focused field (body by default). */
  function insert(name: string) {
    const token = "{" + name + "}";
    const target = focused.current;
    const field: Field = target?.field ?? "body";
    const value = draft[field];
    const el = target?.el;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setDraft((d) => ({ ...d, [field]: next }));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }
  async function act(kind: "save" | "preview" | "test" | "reset", fn: () => Promise<void>) {
    setBusy(kind);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void act("save", async () => {
      await api("/admin/email-templates/" + selected, draft, "PATCH");
      await load(selected);
      toast("บันทึกข้อความอีเมลแล้ว");
    });
  };
  const showPreview = () =>
    act("preview", async () => {
      const result = await api<{ preview: Preview }>("/admin/email-templates/" + selected + "/preview", draft);
      setPreview(result.preview);
    });
  const sendTest = () =>
    act("test", async () => {
      const result = await api<{ to: string }>("/admin/email-templates/" + selected + "/test", draft);
      toast("ส่งอีเมลทดสอบไปที่ " + result.to + " แล้ว");
      await load(selected).then(() => setDraft(draft));
    });
  const reset = () =>
    act("reset", async () => {
      await api("/admin/email-templates/" + selected, undefined, "DELETE");
      setConfirmReset(false);
      setPreview(null);
      await load(selected);
      toast("คืนค่าเริ่มต้นแล้ว");
    });
  const bind = (field: Field) => ({
    value: draft[field],
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [field]: e.target.value })),
    onFocus: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
      focused.current = { field, el: e.currentTarget };
    },
  });

  return (
    <div className="alerts-page email-templates-page">
      <div className="reference-admin-heading">
        <div>
          <h1>ข้อความอีเมล</h1>
          <p>แก้หัวข้อและข้อความของอีเมลที่ระบบส่งถึงลูกค้า ตารางรายละเอียด ปุ่ม และลิงก์ ระบบใส่ให้เอง</p>
        </div>
      </div>
      {data && !data.email.enabled && (
        <p className="email-template-notice" role="note">
          <CircleAlert size={16} aria-hidden="true" />
          ยังไม่ได้ตั้งค่าระบบส่งอีเมล แก้ข้อความและดูตัวอย่างได้ แต่ส่งทดสอบไม่ได้ · ดูวิธีตั้งค่าที่ ตั้งค่า › ร้าน
        </p>
      )}
      <ErrorMessage message={error} />
      {!data ? (
        <section className="reference-admin-card editor-panel">
          <p className="reference-empty-text">กำลังโหลด…</p>
        </section>
      ) : (
        <div className="email-template-layout">
          <nav className="reference-admin-card email-template-list" aria-label="แม่แบบอีเมล">
            {data.templates.map((t) => (
              <button
                key={t.key}
                type="button"
                className={t.key === selected ? "active" : ""}
                aria-current={t.key === selected ? "true" : undefined}
                onClick={() => void choose(t.key)}
              >
                <Mail size={15} aria-hidden="true" />
                <span>
                  <strong>{t.label}</strong>
                  <small>{t.when}</small>
                </span>
                {t.customized && <span className="alert-badge on">แก้แล้ว</span>}
              </button>
            ))}
          </nav>
          {current && (
            <form className="reference-admin-card editor-panel email-template-editor" onSubmit={save} data-template={current.key}>
              <div className="email-template-title">
                <h2>{current.label}</h2>
                <span className={"alert-badge " + (current.customized ? "on" : "off")}>
                  {current.customized ? "แก้แล้ว" + (current.updatedAt ? " · " + dateTime(current.updatedAt) : "") : "ค่าเริ่มต้น"}
                </span>
              </div>
              <label className="field">
                หัวข้ออีเมล
                <input {...bind("subject")} maxLength={data.limits.subject} required />
              </label>
              <label className="field">
                หัวเรื่องในอีเมล
                <input {...bind("heading")} maxLength={data.limits.heading} required />
              </label>
              <label className="field">
                ข้อความ
                <textarea {...bind("body")} rows={6} maxLength={data.limits.body} required />
              </label>
              <div className="email-placeholders">
                <span>แทรกข้อมูล (กดเพื่อใส่ตรงตำแหน่งที่พิมพ์อยู่)</span>
                <div>
                  {current.placeholders.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className={"email-chip" + (current.required.includes(p.name) ? " required" : "")}
                      title={p.hint}
                      onClick={() => insert(p.name)}
                    >
                      {"{" + p.name + "}"}
                    </button>
                  ))}
                </div>
                {current.required.length > 0 && (
                  <small>ข้อความต้องมี {current.required.map((n) => "{" + n + "}").join(" ")} เสมอ</small>
                )}
              </div>
              <div className="admin-action-row email-template-actions">
                <button className="button primary" disabled={!!busy || !dirty}>
                  {busy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                  บันทึก
                </button>
                <button type="button" className="button secondary" disabled={!!busy} onClick={() => void showPreview()}>
                  {busy === "preview" ? <LoaderCircle className="spin" size={15} /> : <Eye size={15} />}
                  ดูตัวอย่าง
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!busy || !data.email.canTest}
                  title={
                    data.email.enabled
                      ? data.email.canTest
                        ? undefined
                        : "บัญชีของคุณไม่มีอีเมลที่รับจดหมายได้"
                      : "ยังไม่ได้ตั้งค่าระบบส่งอีเมล"
                  }
                  onClick={() => void sendTest()}
                >
                  {busy === "test" ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
                  ส่งทดสอบไปที่อีเมลของฉัน
                </button>
                {current.customized &&
                  (confirmReset ? (
                    <span className="email-reset-confirm">
                      <button type="button" className="button danger" disabled={!!busy} onClick={() => void reset()}>
                        ยืนยันคืนค่าเริ่มต้น
                      </button>
                      <button type="button" className="button ghost" onClick={() => setConfirmReset(false)}>
                        ยกเลิก
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="button ghost" disabled={!!busy} onClick={() => setConfirmReset(true)}>
                      <RotateCcw size={15} />
                      คืนค่าเริ่มต้น
                    </button>
                  ))}
              </div>
              <small className="field-help">
                {dirty ? "มีการเปลี่ยนแปลงที่ยังไม่บันทึก · " : ""}
                ส่งทดสอบได้ {data.limits.testPerHour} ครั้งต่อชั่วโมง (เหลือ {data.limits.testsLeft}) · ทดสอบใช้ข้อมูลตัวอย่าง
              </small>
              {preview && (
                <section className="email-preview" aria-label="ตัวอย่างอีเมล">
                  <p className="email-preview-subject">
                    <span>หัวข้อ</span>
                    <strong>{preview.subject}</strong>
                  </p>
                  <iframe title="ตัวอย่างอีเมล" sandbox="" srcDoc={preview.html} />
                </section>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
