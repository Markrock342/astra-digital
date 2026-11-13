// /admin/settings/banners — ตั้งค่า › แบนเนอร์หน้าแรก (ADMIN only).
// List + dialog follow the shadcn/ui patterns already used in the back office (MIT):
// a list of rows with up/down ordering and row actions, Dialog with a form, AlertDialog for
// delete. The image fields show the exact crop the storefront uses (object-fit: cover in an
// recommended 8:3, 3:2 on phones; the storefront never crops). Admin pass: white cards on cool grey, one brand colour.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";
import { useDialog } from "./dialog";
import { useLive } from "./live";
import { checkSource, toWebp, uploadImage } from "./image-upload";
import type { AdminBanner } from "./types";
import "./banners.css";

/** Recommended sizes (the storefront frame ratios). */
export const BANNER_SIZE = { main: [1600, 600], mobile: [1200, 800] } as const;
const STATUS: Record<AdminBanner["status"], string> = {
  live: "แสดงอยู่",
  scheduled: "ตั้งเวลาไว้",
  ended: "หมดเวลาแล้ว",
  off: "ปิดอยู่",
  draft: "ยังไม่มีรูป",
};

/** Same rule as the server (banners.mjs): in-shop path or https URL. "" = OK / no link. */
export function bannerLinkProblem(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/\s|\\/.test(text)) return "ลิงก์มีช่องว่างหรืออักขระที่ใช้ไม่ได้";
  if (text.startsWith("/")) return text.startsWith("//") ? "ลิงก์ในร้านต้องเป็น /หน้าในร้าน เช่น /products" : "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "ใช้ได้เฉพาะหน้าในร้าน (ขึ้นต้นด้วย /) หรือเว็บ https://";
  } catch {
    return "ใช้ได้เฉพาะหน้าในร้าน (ขึ้นต้นด้วย /) หรือเว็บ https://";
  }
  return "";
}

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

function scheduleText(b: AdminBanner) {
  if (b.startsAtLocal && b.endsAtLocal) return thaiTime(b.startsAtLocal) + " – " + thaiTime(b.endsAtLocal);
  if (b.startsAtLocal) return "เริ่ม " + thaiTime(b.startsAtLocal);
  if (b.endsAtLocal) return "ถึง " + thaiTime(b.endsAtLocal);
  return "แสดงตลอด";
}

export function AdminBanners() {
  const { toast } = useStore();
  const [rows, setRows] = useState<AdminBanner[] | null>(null);
  const [max, setMax] = useState(8);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<AdminBanner | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminBanner | null>(null);
  async function load() {
    try {
      const data = await api<{ banners: AdminBanner[]; max: number }>("/admin/banners");
      setRows(data.banners);
      setMax(data.max);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useLive(["catalog"], () => void load());

  async function move(index: number, by: -1 | 1) {
    if (!rows) return;
    const next = [...rows];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy("order");
    setError("");
    setRows(next);
    try {
      const data = await api<{ banners: AdminBanner[] }>("/admin/banners/reorder", { ids: next.map((b) => b.id) });
      setRows(data.banners);
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy("");
    }
  }
  async function toggleActive(b: AdminBanner) {
    setBusy("active:" + b.id);
    setError("");
    try {
      await api("/admin/banners/" + b.id, { active: !b.active }, "PATCH");
      toast(b.active ? "ปิดแบนเนอร์แล้ว" : "เปิดแบนเนอร์แล้ว");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const total = rows?.length ?? 0;
  const full = total >= max;
  return (
    <section className="banner-admin" aria-labelledby="banner-admin-title">
      <div className="reference-admin-heading">
        <div>
          <h1 id="banner-admin-title">แบนเนอร์หน้าแรก</h1>
          <p>
            รูปโปรโมชันเลื่อนอัตโนมัติด้านบนหน้าแรก ได้สูงสุด {max} รูป แสดงเฉพาะที่เปิดอยู่และอยู่ในช่วงเวลาที่ตั้ง
            ถ้าไม่มีแบนเนอร์ หน้าแรกจะแสดงเหมือนเดิม
          </p>
        </div>
        <button type="button" className="button primary" disabled={full || rows === null} onClick={() => setEditing("new")}>
          <Plus size={16} />
          เพิ่มแบนเนอร์
        </button>
      </div>
      <ErrorMessage message={error} />
      {full && <p className="banner-admin-note">ครบ {max} รูปแล้ว ลบหรือแก้แบนเนอร์เดิมเพื่อเปลี่ยนรูป</p>}
      <ol className="banner-admin-list" aria-label="ลำดับแบนเนอร์">
        {rows?.map((b, i) => (
          <li key={b.id} className={"banner-admin-row" + (b.status === "live" ? "" : " is-muted")} data-banner={b.id}>
            <span className="banner-admin-order">
              <span className="banner-admin-index" aria-hidden="true">
                {i + 1}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={"เลื่อนแบนเนอร์ " + b.alt + " ขึ้น"}
                disabled={!!busy || i === 0}
                onClick={() => void move(i, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={"เลื่อนแบนเนอร์ " + b.alt + " ลง"}
                disabled={!!busy || i === total - 1}
                onClick={() => void move(i, 1)}
              >
                <ArrowDown size={15} />
              </button>
            </span>
            <span className="banner-admin-thumb">
              {b.imageUrl ? <img src={b.imageUrl} alt="" loading="lazy" /> : <ImagePlus size={20} aria-hidden="true" />}
            </span>
            <span className="banner-admin-info">
              <strong>{b.alt}</strong>
              <small>
                {b.link ? (
                  <span className="banner-admin-link">
                    {b.link.startsWith("/") ? null : <ExternalLink size={12} aria-hidden="true" />}
                    {b.link}
                  </span>
                ) : (
                  "ไม่มีลิงก์"
                )}
              </small>
              <small>
                {scheduleText(b)} · เวลาไทย
                {b.mobileImageUrl ? (
                  <span className="banner-admin-mobile">
                    <Smartphone size={12} aria-hidden="true" />
                    มีรูปมือถือ
                  </span>
                ) : null}
              </small>
            </span>
            <span className={"banner-admin-status " + b.status}>{STATUS[b.status]}</span>
            <span className="banner-admin-actions">
              {/* Same switch as แจ้งเตือนนอกเว็บ (alerts.css .alert-switch). */}
              <button
                type="button"
                role="switch"
                className="alert-switch"
                aria-checked={b.active}
                aria-label={"เปิดแสดงแบนเนอร์ " + b.alt}
                disabled={!!busy}
                onClick={() => void toggleActive(b)}
              >
                <span />
              </button>
              <button type="button" className="button secondary" onClick={() => setEditing(b)}>
                <Pencil size={14} />
                แก้ไข
              </button>
              <button type="button" className="button secondary danger-text" onClick={() => setDeleting(b)}>
                <Trash2 size={14} />
                ลบ
              </button>
            </span>
          </li>
        ))}
      </ol>
      {rows === null && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
      {rows?.length === 0 && (
        <div className="banner-admin-empty">
          <ImagePlus size={28} aria-hidden="true" />
          <p>ยังไม่มีแบนเนอร์ กด “เพิ่มแบนเนอร์” เพื่อเริ่ม แนะนำรูป 1600×600 px</p>
        </div>
      )}
      {editing && (
        <BannerEditor
          banner={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            toast(message);
            await load();
          }}
        />
      )}
      {deleting && (
        <BannerDelete
          banner={deleting}
          onClose={() => setDeleting(null)}
          onDone={async () => {
            setDeleting(null);
            toast("ลบแบนเนอร์แล้ว");
            await load();
          }}
        />
      )}
    </section>
  );
}

type Picked = { file: File; url: string; width: number; height: number } | null;

function ImageField({
  label,
  kind,
  current,
  picked,
  onPick,
  onRemove,
  required,
}: {
  label: string;
  kind: "main" | "mobile";
  current: string | null;
  picked: Picked;
  onPick: (file: File) => void;
  onRemove?: () => void;
  required?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [w, h] = BANNER_SIZE[kind];
  const src = picked?.url ?? current;
  const ratio = w / h;
  const off = picked && Math.abs(picked.width / picked.height - ratio) / ratio > 0.04;
  return (
    <div className={"banner-image-field " + kind}>
      <div className="banner-image-head">
        <span className="banner-field-label">
          {label} {!required && <span className="muted">ไม่บังคับ</span>}
        </span>
        <small className="field-help">
          แนะนำ {w}×{h} px ({kind === "main" ? "8:3" : "3:2"}) · JPG, PNG หรือ WebP
        </small>
      </div>
      <div className="banner-crop" style={{ aspectRatio: `${w} / ${h}` }}>
        {src ? (
          <img src={src} alt={"ตัวอย่าง" + label} />
        ) : (
          <span className="banner-crop-empty">
            <ImagePlus size={22} aria-hidden="true" />
            {kind === "main" ? "ยังไม่ได้เลือกรูป" : "ใช้รูปหลักบนมือถือ"}
          </span>
        )}
        <span className="banner-crop-tag">{kind === "main" ? "จอคอม 8:3" : "มือถือ 3:2"}</span>
      </div>
      {off && (
        <small className="field-help banner-crop-warning" role="note">
          รูปนี้ {picked!.width}×{picked!.height} px สัดส่วนไม่ตรงกับที่แนะนำ หน้าร้านจะแสดงครบทั้งรูป (กรอบปรับตามรูป อาจมีขอบว่างด้านข้าง)
        </small>
      )}
      <span className="banner-image-actions">
        <button type="button" className="button secondary" onClick={() => input.current?.click()}>
          <ImagePlus size={15} />
          {src ? "เปลี่ยนรูป" : "เลือกรูป"}
        </button>
        {src && onRemove && (
          <button type="button" className="button ghost" onClick={onRemove}>
            เอารูปมือถือออก
          </button>
        )}
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

function BannerEditor({
  banner,
  onClose,
  onSaved,
}: {
  banner: AdminBanner | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [alt, setAlt] = useState(banner?.alt ?? "");
  const [link, setLink] = useState(banner?.link ?? "");
  const [startsAt, setStartsAt] = useState(banner?.startsAtLocal ?? "");
  const [endsAt, setEndsAt] = useState(banner?.endsAtLocal ?? "");
  const [active, setActive] = useState(banner?.active ?? true);
  const [main, setMain] = useState<Picked>(null);
  const [mobile, setMobile] = useState<Picked>(null);
  const [mobileRemoved, setMobileRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy) onClose();
  };
  useDialog(true, ".banner-dialog", close);
  async function pick(file: File, set: (p: Picked) => void) {
    const problem = checkSource(file);
    if (problem) return setError(problem);
    setError("");
    try {
      // data: URL, not blob: — the page CSP allows img-src 'self' data: only.
      const url = await new Promise<string>((done, fail) => {
        const reader = new FileReader();
        reader.onload = () => done(String(reader.result));
        reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(file);
      });
      const bitmap = await createImageBitmap(file);
      set({ file, url, width: bitmap.width, height: bitmap.height });
      bitmap.close();
    } catch {
      setError("เปิดรูปนี้ไม่ได้ ลองไฟล์อื่น");
    }
  }
  const linkProblem = bannerLinkProblem(link);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!alt.trim()) return setError("กรุณาใส่ข้อความอธิบายรูป (alt)");
    if (linkProblem) return setError(linkProblem);
    if (!banner && !main) return setError("กรุณาเลือกรูปแบนเนอร์");
    if (startsAt && endsAt && endsAt <= startsAt) return setError("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
    setBusy(true);
    setError("");
    const values = { alt, link, startsAt: startsAt || null, endsAt: endsAt || null, active };
    let id = banner?.id ?? "";
    try {
      if (banner) await api("/admin/banners/" + banner.id, values, "PATCH");
      else id = (await api<{ banner: AdminBanner }>("/admin/banners", values)).banner.id;
      if (main) await uploadImage("/admin/banners/" + id + "/image", await toWebp(main.file, 1920));
      if (mobile) await uploadImage("/admin/banners/" + id + "/mobile-image", await toWebp(mobile.file, 1200));
      else if (mobileRemoved && banner?.mobileImageUrl)
        await api("/admin/banners/" + id + "/mobile-image", undefined, "DELETE");
      await onSaved(banner ? "บันทึกแบนเนอร์แล้ว" : "เพิ่มแบนเนอร์แล้ว");
    } catch (e) {
      // A new banner whose image failed stays as a draft (never shown); reopen it to retry.
      setError((e as Error).message + (!banner && id ? " · บันทึกเป็นฉบับร่างไว้แล้ว เปิดแก้ไขเพื่อใส่รูปอีกครั้ง" : ""));
      setBusy(false);
    }
  }
  return (
    <div className="reference-modal-backdrop" onClick={close}>
      <section
        className="reference-import-modal banner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="banner-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reference-card-heading">
          <h2 id="banner-dialog-title">{banner ? "แก้ไขแบนเนอร์" : "เพิ่มแบนเนอร์"}</h2>
          <button type="button" className="icon-button" aria-label="ปิด" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} noValidate>
          <ErrorMessage message={error} />
          <div className="banner-image-grid">
            <ImageField
              label="รูปแบนเนอร์"
              kind="main"
              required
              current={banner?.imageUrl ?? null}
              picked={main}
              onPick={(file) => void pick(file, setMain)}
            />
            <ImageField
              label="รูปสำหรับมือถือ"
              kind="mobile"
              current={mobileRemoved ? null : (banner?.mobileImageUrl ?? null)}
              picked={mobile}
              onPick={(file) => {
                setMobileRemoved(false);
                void pick(file, setMobile);
              }}
              onRemove={() => {
                setMobile(null);
                setMobileRemoved(true);
              }}
            />
          </div>
          <label className="field">
            ข้อความอธิบายรูป (alt)
            <input
              name="alt"
              required
              maxLength={160}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="เช่น ลด 20% Netflix Premium ถึงสิ้นเดือน"
            />
            <small className="field-help">ผู้ใช้โปรแกรมอ่านหน้าจอจะได้ยินข้อความนี้ ใส่ใจความสำคัญบนรูป</small>
          </label>
          <label className="field">
            ลิงก์เมื่อกดแบนเนอร์ <span className="muted">ไม่บังคับ</span>
            <input
              name="link"
              maxLength={500}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/products?category=streaming"
              spellCheck={false}
              autoCapitalize="off"
              aria-invalid={!!linkProblem}
            />
            <small className={"field-help" + (linkProblem ? " banner-link-problem" : "")}>
              {linkProblem || "หน้าในร้าน เช่น /products/<รหัสสินค้า> หรือ /products?category=<หมวด> หรือเว็บที่ขึ้นต้นด้วย https://"}
            </small>
          </label>
          <div className="banner-time-grid">
            <label className="field">
              เริ่มแสดง <span className="muted">เวลาไทย · ไม่บังคับ</span>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </label>
            <label className="field">
              หยุดแสดง <span className="muted">เวลาไทย · ไม่บังคับ</span>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </label>
          </div>
          <label className="checkbox-label banner-active-field">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            เปิดแสดงบนหน้าแรก
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={close}>
              ยกเลิก
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={15} />}
              {banner ? "บันทึก" : "เพิ่มแบนเนอร์"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BannerDelete({
  banner,
  onClose,
  onDone,
}: {
  banner: AdminBanner;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy) onClose();
  };
  useDialog(true, ".banner-delete-dialog", close);
  async function run() {
    setBusy(true);
    setError("");
    try {
      await api("/admin/banners/" + banner.id, undefined, "DELETE");
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="reference-modal-backdrop" onClick={close}>
      <section
        className="reference-import-modal banner-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="banner-delete-title"
        aria-describedby="banner-delete-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reference-card-heading">
          <h2 id="banner-delete-title">ลบแบนเนอร์</h2>
          <button type="button" className="icon-button" aria-label="ปิด" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="banner-delete-body">
          <ErrorMessage message={error} />
          {banner.imageUrl && <img className="banner-delete-thumb" src={banner.imageUrl} alt="" />}
          <p id="banner-delete-text">
            ลบ “{banner.alt}” และไฟล์รูปของแบนเนอร์นี้ ลบแล้วกู้คืนไม่ได้ ถ้าแค่อยากซ่อนชั่วคราวให้ปิดสวิตช์แทน
          </p>
          <div className="form-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={close}>
              ยกเลิก
            </button>
            <button type="button" className="button danger" disabled={busy} onClick={() => void run()}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
              ลบแบนเนอร์
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
