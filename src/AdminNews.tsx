// /admin/settings/news — ตั้งค่า › ข่าวสารและกิจกรรม, and /admin/settings/about — ตั้งค่า ›
// เกี่ยวกับเรา (ADMIN only; the server audits every change).
// UI reference: shadcn/ui (MIT, https://ui.shadcn.com) — Card for each group, Tabs (TH / EN),
// Switch (role="switch") for publish / pinned / contact block, Badge for status, AlertDialog for
// delete and reset. Back-office look: white cards on the cool-grey admin background, the one
// admin brand colour, soft elevation. The live preview renders the real storefront pieces
// (News.tsx) with the unsaved draft; nothing reaches customers before "บันทึก".
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  Clock,
  ImagePlus,
  LoaderCircle,
  Newspaper,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";
import { useDialog } from "./dialog";
import { useLive } from "./live";
import { useUnsavedChangesGuard } from "./navigation";
import { checkSource, toWebp, uploadImage } from "./image-upload";
import { bannerLinkProblem } from "./AdminBanners";
import { TRUST_ICON_COMPONENTS } from "./Appearance";
import { shopName } from "./Theme";
import { AboutView, NewsArticle, NewsCard, eventStateNow, type NewsPost } from "./News";
import { ABOUT_LIMITS, NEWS_LIMITS, type AboutContent, type AboutHighlight } from "../server/content-rules.mjs";
import type { Lang } from "./i18n";
import "./admin-news.css";

type AdminPost = NewsPost & {
  body: string | null;
  bodyEn: string | null;
  published: boolean;
  publishAt: string | null;
  publishAtLocal: string | null;
  status: "draft" | "scheduled" | "live";
  createdAt: string;
};
const STATUS: Record<AdminPost["status"], string> = {
  live: "เผยแพร่อยู่",
  scheduled: "ตั้งเวลาไว้",
  draft: "ฉบับร่าง",
};
const thaiTime = (local: string | null) =>
  local
    ? new Date(local + ":00+07:00").toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** data: URL (the page CSP allows img-src 'self' data: only). */
const readAsDataUrl = (file: File) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(file);
  });

/** shadcn/ui Switch: role="switch" (alerts.css .alert-switch look). */
function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="alert-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

/** shadcn/ui Tabs for the language of the text fields. */
function LangTabs({ value, onChange, id }: { value: Lang; onChange: (lang: Lang) => void; id: string }) {
  return (
    <div className="news-lang-tabs" role="tablist" aria-label="ภาษา">
      {(["th", "en"] as Lang[]).map((lang) => (
        <button
          key={lang}
          type="button"
          role="tab"
          id={id + "-" + lang}
          aria-selected={value === lang}
          className={value === lang ? "active" : ""}
          onClick={() => onChange(lang)}
        >
          {lang === "th" ? "ไทย" : "English"}
        </button>
      ))}
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <small className={"news-counter" + (value.length > max ? " over" : "")}>
      {value.length}/{max}
    </small>
  );
}

function CoverField({
  src,
  onPick,
  onRemove,
  label,
  ratio,
}: {
  src: string | null;
  onPick: (file: File) => void;
  onRemove: () => void;
  label: string;
  ratio: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="news-cover-field">
      <span className="news-field-label">
        {label} <span className="muted">ไม่บังคับ</span>
      </span>
      <div className="news-cover-frame" style={{ aspectRatio: ratio }}>
        {src ? (
          <img src={src} alt={"ตัวอย่าง" + label} />
        ) : (
          <span className="news-cover-empty">
            <ImagePlus size={22} aria-hidden="true" />
            ยังไม่มีรูป
          </span>
        )}
      </div>
      <span className="news-cover-actions">
        <button type="button" className="button secondary" onClick={() => input.current?.click()}>
          <ImagePlus size={15} />
          {src ? "เปลี่ยนรูป" : "เลือกรูป"}
        </button>
        {src && (
          <button type="button" className="button ghost" onClick={onRemove}>
            เอารูปออก
          </button>
        )}
        <small className="field-help">JPG, PNG หรือ WebP</small>
      </span>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-label={label}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
    </div>
  );
}

function ConfirmDialog({
  title,
  text,
  action,
  danger,
  onClose,
  onConfirm,
}: {
  title: string;
  text: string;
  action: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy) onClose();
  };
  useDialog(true, ".news-confirm-dialog", close);
  async function run() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="reference-modal-backdrop" onClick={close}>
      <section
        className="reference-import-modal news-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="news-confirm-title"
        aria-describedby="news-confirm-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reference-card-heading">
          <h2 id="news-confirm-title">{title}</h2>
          <button type="button" className="icon-button" aria-label="ปิด" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <ErrorMessage message={error} />
        <p id="news-confirm-text">{text}</p>
        <div className="form-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            ยกเลิก
          </button>
          <button type="button" className={"button " + (danger ? "danger" : "primary")} disabled={busy} onClick={() => void run()}>
            {busy ? <LoaderCircle className="spin" size={15} /> : danger ? <Trash2 size={15} /> : <RotateCcw size={15} />}
            {action}
          </button>
        </div>
      </section>
    </div>
  );
}

/** Preview card (shadcn/ui Card) with a TH / EN switch. */
function PreviewCard({ children, lang, setLang, extra }: { children: ReactNode; lang: Lang; setLang: (l: Lang) => void; extra?: ReactNode }) {
  return (
    <aside className="news-preview-card" aria-label="ตัวอย่างหน้าร้าน">
      <div className="news-preview-head">
        <strong>ตัวอย่างหน้าร้าน</strong>
        <span className="news-preview-tools">
          {extra}
          <LangTabs value={lang} onChange={setLang} id="news-preview-lang" />
        </span>
      </div>
      <div className="news-preview storefront-preview-scope">{children}</div>
    </aside>
  );
}

// ================================================================== news

export function AdminNews() {
  const { toast } = useStore();
  const [rows, setRows] = useState<AdminPost[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<AdminPost | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminPost | null>(null);
  async function load() {
    try {
      const data = await api<{ posts: AdminPost[] }>("/admin/news");
      setRows(data.posts);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useLive(["content"], () => {
    if (!editing) void load();
  });

  async function togglePublished(post: AdminPost) {
    setBusy(post.id);
    setError("");
    try {
      await api("/admin/news/" + post.id, { published: !post.published }, "PATCH");
      toast(post.published ? "ซ่อนข่าวแล้ว" : "เผยแพร่ข่าวแล้ว");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (editing)
    return (
      <NewsEditor
        post={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          toast(message);
          await load();
        }}
      />
    );

  return (
    <section className="news-admin" aria-labelledby="news-admin-title">
      <div className="reference-admin-heading">
        <div>
          <h1 id="news-admin-title">ข่าวสาร</h1>
          <p>ประกาศข่าว โปรโมชัน และกิจกรรมที่หน้า /news ข่าวที่ปักหมุดอยู่บนสุด ที่เหลือเรียงจากใหม่ไปเก่า</p>
        </div>
        <button type="button" className="button primary" disabled={rows === null} onClick={() => setEditing("new")}>
          <Plus size={16} />
          เขียนข่าว
        </button>
      </div>
      <ErrorMessage message={error} />
      {rows === null && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
      {rows?.length === 0 && (
        <div className="news-admin-empty">
          <Newspaper size={28} aria-hidden="true" />
          <p>ยังไม่มีข่าว กด “เขียนข่าว” เพื่อเริ่ม</p>
        </div>
      )}
      {!!rows?.length && (
        <ul className="news-admin-list" aria-label="รายการข่าว">
          {rows.map((post) => (
            <li key={post.id} className="news-admin-row" data-news={post.id}>
              <span className="news-admin-thumb">
                {post.coverUrl ? <img src={post.coverUrl} alt="" loading="lazy" /> : <Newspaper size={20} aria-hidden="true" />}
              </span>
              <span className="news-admin-info">
                <strong>
                  {post.pinned && <Pin size={14} aria-label="ปักหมุด" className="news-admin-pin" />}
                  {post.title}
                </strong>
                <small>
                  {post.status === "scheduled"
                    ? "เผยแพร่ " + thaiTime(post.publishAtLocal) + " · เวลาไทย"
                    : "สร้าง " + new Date(post.createdAt.replace(" ", "T") + "Z").toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" })}
                  {post.eventState && (
                    <span className="news-admin-event">
                      <CalendarDays size={12} aria-hidden="true" />
                      กิจกรรม
                    </span>
                  )}
                </small>
              </span>
              <span className={"news-admin-status " + post.status}>{STATUS[post.status]}</span>
              <span className="news-admin-actions">
                <Switch
                  checked={post.published}
                  disabled={!!busy}
                  label={"เผยแพร่ข่าว " + post.title}
                  onChange={() => void togglePublished(post)}
                />
                <button type="button" className="button secondary" onClick={() => setEditing(post)}>
                  <Pencil size={14} />
                  แก้ไข
                </button>
                <button type="button" className="button secondary danger-text" onClick={() => setDeleting(post)}>
                  <Trash2 size={14} />
                  ลบ
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title="ลบข่าว"
          text={"ลบ “" + deleting.title + "” และรูปปกของข่าวนี้ ลบแล้วกู้คืนไม่ได้ ถ้าแค่อยากซ่อนให้ปิดสวิตช์เผยแพร่แทน"}
          action="ลบข่าว"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api("/admin/news/" + deleting.id, undefined, "DELETE");
            setDeleting(null);
            toast("ลบข่าวแล้ว");
            await load();
          }}
        />
      )}
    </section>
  );
}

type Draft = {
  title: string;
  titleEn: string;
  summary: string;
  summaryEn: string;
  body: string;
  bodyEn: string;
  eventStarts: string;
  eventEnds: string;
  link: string;
  linkLabel: string;
  linkLabelEn: string;
  pinned: boolean;
  published: boolean;
  publishAt: string;
};
const draftOf = (post: AdminPost | null): Draft => ({
  title: post?.title ?? "",
  titleEn: post?.titleEn ?? "",
  summary: post?.summary ?? "",
  summaryEn: post?.summaryEn ?? "",
  body: post?.body ?? "",
  bodyEn: post?.bodyEn ?? "",
  eventStarts: post?.eventStarts ?? "",
  eventEnds: post?.eventEnds ?? "",
  link: post?.link ?? "",
  linkLabel: post?.linkLabel ?? "",
  linkLabelEn: post?.linkLabelEn ?? "",
  pinned: post?.pinned ?? false,
  published: post?.published ?? true,
  publishAt: post?.publishAtLocal ?? "",
});

function NewsEditor({
  post,
  onClose,
  onSaved,
}: {
  post: AdminPost | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const initial = useRef(draftOf(post));
  const [draft, setDraft] = useState<Draft>(initial.current);
  const [cover, setCover] = useState<{ file: File; url: string } | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [lang, setLang] = useState<Lang>("th");
  const [previewLang, setPreviewLang] = useState<Lang>("th");
  const [view, setView] = useState<"card" | "page">("card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current) || !!cover || coverRemoved;
  useUnsavedChangesGuard(dirty && !busy);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const L = NEWS_LIMITS;
  const linkProblem = bannerLinkProblem(draft.link);
  const coverSrc = cover?.url ?? (coverRemoved ? null : (post?.coverUrl ?? null));
  const starts = draft.eventStarts || null;
  const ends = draft.eventEnds || null;
  const previewPost: NewsPost = {
    id: post?.id ?? "preview",
    title: draft.title.trim() || "หัวข้อข่าว",
    titleEn: draft.titleEn.trim() || null,
    summary: draft.summary.trim() || null,
    summaryEn: draft.summaryEn.trim() || null,
    body: draft.body,
    bodyEn: draft.bodyEn || null,
    coverUrl: coverSrc,
    eventStarts: starts,
    eventEnds: ends,
    eventState: eventStateNow(starts, ends),
    pinned: draft.pinned,
    date: post?.date ?? new Date().toISOString().slice(0, 19).replace("T", " "),
    link: draft.link.trim() && !linkProblem ? draft.link.trim() : null,
    linkLabel: draft.linkLabel.trim() || null,
    linkLabelEn: draft.linkLabelEn.trim() || null,
  };

  async function pick(file: File) {
    const problem = checkSource(file);
    if (problem) return setError(problem);
    setError("");
    try {
      setCover({ file, url: await readAsDataUrl(file) });
      setCoverRemoved(false);
    } catch {
      setError("เปิดรูปนี้ไม่ได้ ลองไฟล์อื่น");
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) {
      setLang("th");
      return setError("กรุณาใส่หัวข้อข่าว");
    }
    if (linkProblem) return setError(linkProblem);
    if (ends && !starts) return setError("กรุณาใส่วันเริ่มกิจกรรม");
    if (starts && ends && ends < starts) return setError("วันจบกิจกรรมต้องไม่ก่อนวันเริ่ม");
    setBusy(true);
    setError("");
    const values = { ...draft, publishAt: draft.publishAt || null, eventStarts: starts, eventEnds: ends };
    let id = post?.id ?? "";
    try {
      if (post) await api("/admin/news/" + post.id, values, "PATCH");
      else id = (await api<{ post: AdminPost }>("/admin/news", values)).post.id;
      if (cover) await uploadImage("/admin/news/" + id + "/cover", await toWebp(cover.file, 1600));
      else if (coverRemoved && post?.coverUrl) await api("/admin/news/" + id + "/cover", undefined, "DELETE");
      await onSaved(post ? "บันทึกข่าวแล้ว" : draft.published ? "เผยแพร่ข่าวแล้ว" : "บันทึกฉบับร่างแล้ว");
    } catch (e) {
      setError((e as Error).message + (!post && id ? " · บันทึกข่าวไว้แล้ว เปิดแก้ไขเพื่อใส่รูปอีกครั้ง" : ""));
      setBusy(false);
    }
  }
  const en = lang === "en";
  const scheduledFuture = draft.published && draft.publishAt && new Date(draft.publishAt + ":00+07:00").getTime() > Date.now();
  return (
    <section className="news-admin news-editor" aria-labelledby="news-editor-title">
      <div className="reference-admin-heading">
        <div>
          <button type="button" className="button ghost news-editor-back" disabled={busy} onClick={onClose}>
            <ArrowLeft size={16} />
            ข่าวทั้งหมด
          </button>
          <h1 id="news-editor-title">{post ? "แก้ไขข่าว" : "เขียนข่าว"}</h1>
        </div>
      </div>
      <div className="news-editor-grid">
        <form className="news-editor-form" onSubmit={submit} noValidate>
          <ErrorMessage message={error} />
          <div className="news-card-panel">
            <div className="news-panel-head">
              <h2>เนื้อหา</h2>
              <LangTabs value={lang} onChange={setLang} id="news-text-lang" />
            </div>
            {en && <p className="field-help news-en-help">ช่องภาษาอังกฤษไม่บังคับ ช่องที่ว่างจะแสดงภาษาไทยแทน</p>}
            <label className="field">
              <span className="news-label-row">
                {en ? "หัวข้อ (English)" : "หัวข้อข่าว"}
                <Counter value={en ? draft.titleEn : draft.title} max={L.title} />
              </span>
              <input
                value={en ? draft.titleEn : draft.title}
                maxLength={L.title}
                required={!en}
                onChange={(e) => set(en ? "titleEn" : "title", e.target.value)}
              />
            </label>
            <label className="field">
              <span className="news-label-row">
                {en ? "สรุปสั้น (English)" : "สรุปสั้น"} <span className="muted">ไม่บังคับ</span>
                <Counter value={en ? draft.summaryEn : draft.summary} max={L.summary} />
              </span>
              <textarea
                rows={2}
                maxLength={L.summary}
                value={en ? draft.summaryEn : draft.summary}
                onChange={(e) => set(en ? "summaryEn" : "summary", e.target.value)}
              />
            </label>
            <label className="field">
              <span className="news-label-row">
                {en ? "เนื้อหา (English)" : "เนื้อหา"}
                <Counter value={en ? draft.bodyEn : draft.body} max={L.body} />
              </span>
              <textarea
                rows={9}
                maxLength={L.body}
                value={en ? draft.bodyEn : draft.body}
                onChange={(e) => set(en ? "bodyEn" : "body", e.target.value)}
              />
              <small className="field-help">
                เว้นบรรทัดว่างเพื่อขึ้นย่อหน้า · ขึ้นต้นบรรทัดด้วย “- ” เป็นรายการ · ลิงก์: [ข้อความ](/products) หรือ https://…
              </small>
            </label>
          </div>

          <div className="news-card-panel">
            <h2>รูปปกและกิจกรรม</h2>
            <CoverField
              label="รูปปก"
              ratio="16 / 9"
              src={coverSrc}
              onPick={(file) => void pick(file)}
              onRemove={() => {
                setCover(null);
                setCoverRemoved(true);
              }}
            />
            <div className="news-two-col">
              <label className="field">
                วันเริ่มกิจกรรม <span className="muted">ไม่บังคับ</span>
                <input type="date" value={draft.eventStarts} onChange={(e) => set("eventStarts", e.target.value)} />
              </label>
              <label className="field">
                วันจบกิจกรรม <span className="muted">ไม่บังคับ</span>
                <input type="date" value={draft.eventEnds} min={draft.eventStarts || undefined} onChange={(e) => set("eventEnds", e.target.value)} />
              </label>
            </div>
            <small className="field-help">ใส่วันที่เมื่อเป็นกิจกรรม หน้าร้านจะแสดงป้าย “กิจกรรม” และสถานะ กำลังจะมา / กำลังจัดอยู่ / จบแล้ว</small>
          </div>

          <div className="news-card-panel">
            <h2>ปุ่มลิงก์</h2>
            <label className="field">
              ลิงก์ <span className="muted">ไม่บังคับ</span>
              <input
                value={draft.link}
                maxLength={L.link}
                placeholder="/products หรือ https://…"
                spellCheck={false}
                autoCapitalize="off"
                aria-invalid={!!linkProblem}
                onChange={(e) => set("link", e.target.value)}
              />
              {linkProblem && <small className="field-help news-link-problem">{linkProblem}</small>}
            </label>
            <label className="field">
              <span className="news-label-row">
                {en ? "ข้อความปุ่ม (English)" : "ข้อความปุ่ม"} <span className="muted">ว่าง = “ดูรายละเอียด”</span>
              </span>
              <input
                value={en ? draft.linkLabelEn : draft.linkLabel}
                maxLength={L.linkLabel}
                disabled={!draft.link.trim()}
                onChange={(e) => set(en ? "linkLabelEn" : "linkLabel", e.target.value)}
              />
            </label>
          </div>

          <div className="news-card-panel">
            <h2>การเผยแพร่</h2>
            <div className="news-switch-row">
              <span>
                <strong>เผยแพร่</strong>
                <small>ปิดไว้ = ฉบับร่าง ลูกค้าไม่เห็น</small>
              </span>
              <Switch checked={draft.published} label="เผยแพร่" onChange={(v) => set("published", v)} />
            </div>
            <div className="news-switch-row">
              <span>
                <strong>ปักหมุด</strong>
                <small>แสดงก่อนข่าวอื่น</small>
              </span>
              <Switch checked={draft.pinned} label="ปักหมุด" onChange={(v) => set("pinned", v)} />
            </div>
            <label className="field">
              <span>
                <Clock size={14} aria-hidden="true" /> ตั้งเวลาเผยแพร่ <span className="muted">เวลาไทย · ไม่บังคับ</span>
              </span>
              <input
                type="datetime-local"
                aria-label="ตั้งเวลาเผยแพร่"
                value={draft.publishAt}
                disabled={!draft.published}
                onChange={(e) => set("publishAt", e.target.value)}
              />
              {scheduledFuture && (
                <small className="field-help">ลูกค้าจะเห็นข่าวนี้ตั้งแต่ {thaiTime(draft.publishAt)}</small>
              )}
            </label>
          </div>

          <div className="form-actions news-editor-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={15} />}
              {post ? "บันทึก" : draft.published ? "เผยแพร่" : "บันทึกฉบับร่าง"}
            </button>
          </div>
        </form>
        <PreviewCard
          lang={previewLang}
          setLang={setPreviewLang}
          extra={
            <span className="news-lang-tabs" role="tablist" aria-label="มุมมอง">
              {(
                [
                  ["card", "การ์ด"],
                  ["page", "หน้าข่าว"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  className={view === key ? "active" : ""}
                  onClick={() => setView(key)}
                >
                  {label}
                </button>
              ))}
            </span>
          }
        >
          {view === "card" ? (
            <div className="news-preview-cardwrap">
              <NewsCard post={previewPost} lang={previewLang} preview />
            </div>
          ) : (
            <NewsArticle post={previewPost} lang={previewLang} />
          )}
        </PreviewCard>
      </div>
    </section>
  );
}

// ================================================================== about

type AboutData = {
  about: AboutContent;
  defaults: AboutContent;
  icons: string[];
  customized: boolean;
};
const contentOf = (a: AboutContent): AboutContent => ({
  heading: { ...a.heading },
  body: { ...a.body },
  highlights: a.highlights.map((h) => ({ icon: h.icon, title: { ...h.title }, text: { ...h.text } })),
  showContact: a.showContact,
});

export function AdminAbout() {
  const { toast, overview } = useStore();
  const [data, setData] = useState<AboutData | null>(null);
  const [draft, setDraft] = useState<AboutContent | null>(null);
  const [cover, setCover] = useState<{ file: File; url: string } | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [lang, setLang] = useState<Lang>("th");
  const [previewLang, setPreviewLang] = useState<Lang>("th");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  const saved = useRef("");
  function apply(next: AboutData) {
    setData(next);
    const content = contentOf(next.about);
    setDraft(content);
    saved.current = JSON.stringify(content);
    setCover(null);
    setCoverRemoved(false);
  }
  useEffect(() => {
    api<AboutData>("/admin/about").then(apply, (e: Error) => setError(e.message));
  }, []);
  const dirty = !!draft && (JSON.stringify(draft) !== saved.current || !!cover || coverRemoved);
  useUnsavedChangesGuard(dirty && !busy);
  if (!data || !draft)
    return (
      <section className="news-admin">
        <ErrorMessage message={error} />
        {!error && <p className="reference-empty-text">กำลังโหลด…</p>}
      </section>
    );
  const L = ABOUT_LIMITS;
  const en = lang === "en";
  const k = en ? "en" : "th";
  const update = (fn: (d: AboutContent) => void) =>
    setDraft((d) => {
      const next = contentOf(d!);
      fn(next);
      return next;
    });
  const setHighlight = (i: number, fn: (h: AboutHighlight) => void) => update((d) => fn(d.highlights[i]));
  const coverSrc = cover?.url ?? (coverRemoved ? null : (data.about.coverUrl ?? null));

  async function pick(file: File) {
    const problem = checkSource(file);
    if (problem) return setError(problem);
    setError("");
    try {
      setCover({ file, url: await readAsDataUrl(file) });
      setCoverRemoved(false);
    } catch {
      setError("เปิดรูปนี้ไม่ได้ ลองไฟล์อื่น");
    }
  }
  async function save() {
    if (!draft!.heading.th.trim()) {
      setLang("th");
      return setError("กรุณาใส่หัวข้อ");
    }
    if (!draft!.body.th.trim()) {
      setLang("th");
      return setError("กรุณาใส่เนื้อหา");
    }
    const missing = draft!.highlights.findIndex((h) => !h.title.th.trim());
    if (missing >= 0) {
      setLang("th");
      return setError("กรุณาใส่หัวข้อจุดเด่นข้อ " + (missing + 1));
    }
    setBusy(true);
    setError("");
    try {
      let next = await api<AboutData>("/admin/about", draft);
      if (cover) next = await uploadImage<AboutData>("/admin/about/cover", await toWebp(cover.file, 1920));
      else if (coverRemoved && data!.about.coverUrl) next = await api<AboutData>("/admin/about/cover", undefined, "DELETE");
      apply(next);
      toast("บันทึกหน้าเกี่ยวกับเราแล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const previewAbout: AboutContent = { ...draft, coverUrl: coverSrc };
  return (
    <section className="news-admin about-admin" aria-labelledby="about-admin-title">
      <div className="reference-admin-heading">
        <div>
          <h1 id="about-admin-title">เกี่ยวกับเรา</h1>
          <p>หน้า /about แนะนำร้าน {data.customized ? "" : "· ตอนนี้ใช้ข้อความเริ่มต้น"}</p>
        </div>
        <button type="button" className="button secondary" disabled={busy || !data.customized} onClick={() => setResetting(true)}>
          <RotateCcw size={15} />
          คืนค่าเริ่มต้น
        </button>
      </div>
      <div className="news-editor-grid">
        <div className="news-editor-form">
          <ErrorMessage message={error} />
          <div className="news-card-panel">
            <div className="news-panel-head">
              <h2>ข้อความ</h2>
              <LangTabs value={lang} onChange={setLang} id="about-text-lang" />
            </div>
            {en && <p className="field-help news-en-help">ช่องภาษาอังกฤษไม่บังคับ ช่องที่ว่างจะแสดงภาษาไทยแทน</p>}
            <label className="field">
              <span className="news-label-row">
                {en ? "หัวข้อ (English)" : "หัวข้อ"}
                <Counter value={draft.heading[k]} max={L.heading} />
              </span>
              <input value={draft.heading[k]} maxLength={L.heading} onChange={(e) => update((d) => void (d.heading[k] = e.target.value))} />
            </label>
            <label className="field">
              <span className="news-label-row">
                {en ? "เนื้อหา (English)" : "เนื้อหา"}
                <Counter value={draft.body[k]} max={L.body} />
              </span>
              <textarea rows={8} maxLength={L.body} value={draft.body[k]} onChange={(e) => update((d) => void (d.body[k] = e.target.value))} />
              <small className="field-help">
                เว้นบรรทัดว่างเพื่อขึ้นย่อหน้า · ขึ้นต้นบรรทัดด้วย “- ” เป็นรายการ · ลิงก์: [ข้อความ](/products) หรือ https://…
              </small>
            </label>
          </div>

          <div className="news-card-panel">
            <CoverField
              label="รูปปก"
              ratio="21 / 9"
              src={coverSrc}
              onPick={(file) => void pick(file)}
              onRemove={() => {
                setCover(null);
                setCoverRemoved(true);
              }}
            />
          </div>

          <div className="news-card-panel">
            <div className="news-panel-head">
              <h2>
                จุดเด่น <span className="muted">{draft.highlights.length}/{L.highlights}</span>
              </h2>
              <button
                type="button"
                className="button secondary"
                disabled={draft.highlights.length >= L.highlights}
                onClick={() =>
                  update((d) => void d.highlights.push({ icon: data.icons[0], title: { th: "", en: "" }, text: { th: "", en: "" } }))
                }
              >
                <Plus size={15} />
                เพิ่มจุดเด่น
              </button>
            </div>
            {draft.highlights.length === 0 && <p className="field-help">ไม่มีจุดเด่น หน้าร้านจะไม่แสดงส่วนนี้</p>}
            <ol className="about-highlight-list">
              {draft.highlights.map((item, i) => (
                <li key={i} className="about-highlight-row" data-highlight={i}>
                  <div className="about-highlight-tools">
                    <span className="about-highlight-index">{i + 1}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={"เลื่อนจุดเด่นข้อ " + (i + 1) + " ขึ้น"}
                      disabled={i === 0}
                      onClick={() => update((d) => void d.highlights.splice(i - 1, 2, d.highlights[i], d.highlights[i - 1]))}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={"เลื่อนจุดเด่นข้อ " + (i + 1) + " ลง"}
                      disabled={i === draft.highlights.length - 1}
                      onClick={() => update((d) => void d.highlights.splice(i, 2, d.highlights[i + 1], d.highlights[i]))}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger-text"
                      aria-label={"ลบจุดเด่นข้อ " + (i + 1)}
                      onClick={() => update((d) => void d.highlights.splice(i, 1))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="about-icon-picker" role="radiogroup" aria-label={"ไอคอนจุดเด่นข้อ " + (i + 1)}>
                    {data.icons.map((name) => {
                      const Icon = TRUST_ICON_COMPONENTS[name];
                      if (!Icon) return null;
                      return (
                        <button
                          key={name}
                          type="button"
                          role="radio"
                          aria-checked={item.icon === name}
                          aria-label={name}
                          className={item.icon === name ? "active" : ""}
                          onClick={() => setHighlight(i, (h) => void (h.icon = name))}
                        >
                          <Icon size={16} />
                        </button>
                      );
                    })}
                  </div>
                  <label className="field">
                    {en ? "หัวข้อ (English)" : "หัวข้อ"}
                    <input
                      value={item.title[k]}
                      maxLength={L.highlightTitle}
                      onChange={(e) => setHighlight(i, (h) => void (h.title[k] = e.target.value))}
                    />
                  </label>
                  <label className="field">
                    {en ? "รายละเอียด (English)" : "รายละเอียด"} <span className="muted">ไม่บังคับ</span>
                    <textarea
                      rows={2}
                      maxLength={L.highlightText}
                      value={item.text[k]}
                      onChange={(e) => setHighlight(i, (h) => void (h.text[k] = e.target.value))}
                    />
                  </label>
                </li>
              ))}
            </ol>
          </div>

          <div className="news-card-panel">
            <div className="news-switch-row">
              <span>
                <strong>แสดงช่องทางติดต่อ</strong>
                <small>ใช้ข้อมูลจาก ตั้งค่า › ร้าน › ช่องทางติดต่อ</small>
              </span>
              <Switch checked={draft.showContact} label="แสดงช่องทางติดต่อ" onChange={(v) => update((d) => void (d.showContact = v))} />
            </div>
          </div>

          <div className="form-actions news-editor-actions">
            <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save()}>
              {busy && <LoaderCircle className="spin" size={15} />}
              บันทึก
            </button>
          </div>
        </div>
        <PreviewCard lang={previewLang} setLang={setPreviewLang}>
          <AboutView about={previewAbout} lang={previewLang} shop={overview?.shop} name={shopName(overview?.shop?.shopName)} />
        </PreviewCard>
      </div>
      {resetting && (
        <ConfirmDialog
          title="คืนค่าเริ่มต้น"
          text="ข้อความ จุดเด่น และรูปปกของหน้าเกี่ยวกับเราจะกลับเป็นค่าเริ่มต้น"
          action="คืนค่าเริ่มต้น"
          onClose={() => setResetting(false)}
          onConfirm={async () => {
            apply(await api<AboutData>("/admin/about/reset", {}));
            setResetting(false);
            toast("คืนค่าเริ่มต้นแล้ว");
          }}
        />
      )}
    </section>
  );
}
