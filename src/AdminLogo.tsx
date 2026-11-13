// ตั้งค่า › ร้าน › โลโก้: upload / replace / remove the shop logo (POST|DELETE /api/admin/settings/logo).
// Used by the back-office header and as the team's picture in the live chat. Card + button row
// follow shadcn/ui Card + Button (MIT, https://ui.shadcn.com/docs/components/card).
import { useRef, useState } from "react";
import { ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";
import { checkSource, toWebp, uploadImage } from "./image-upload";
import "./logo.css";

/** The shop's built-in mark (blue square, yellow X), used until the admin uploads a logo. */
export const DEFAULT_LOGO = "/brand/icon-512.png";
/** Uploaded logo, else the built-in mark. */
export const shopLogo = (url?: string | null) => url || DEFAULT_LOGO;

export function AdminLogoSetting() {
  const { overview, refresh, toast } = useStore();
  const logo = overview?.shop?.logoUrl ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function upload(file: File) {
    setError("");
    const problem = checkSource(file);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await uploadImage("/admin/settings/logo", await toWebp(file, 512));
      await refresh();
      toast("เปลี่ยนโลโก้แล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm("ลบโลโก้ที่อัปโหลด? หลังบ้านและแชทจะกลับไปใช้โลโก้เดิมของร้าน (รูป X)")) return;
    setBusy(true);
    setError("");
    try {
      await api("/admin/settings/logo", {}, "DELETE");
      await refresh();
      toast("ลบโลโก้แล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="reference-admin-card editor-panel logo-setting">
      <h2>โลโก้</h2>
      <p>
        ใช้ที่หัวหลังบ้าน และเป็นรูปของทีมงานเวลาตอบแชทลูกค้า · แนะนำรูปสี่เหลี่ยมจัตุรัสอย่างน้อย 256×256 px ·
        JPG, PNG หรือ WebP
      </p>
      <div className="logo-setting-row">
        <img
          src={shopLogo(logo)}
          className="settings-logo"
          alt={logo ? "โลโก้ร้านปัจจุบัน" : "โลโก้เดิมของร้าน"}
        />
        <div className="logo-setting-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ImageUp size={16} />}
            เปลี่ยนโลโก้
          </button>
          {logo ? (
            <button type="button" className="button ghost logo-remove" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={16} />
              กลับไปใช้โลโก้เดิม
            </button>
          ) : (
            <span className="logo-default-note">ตอนนี้ใช้โลโก้เดิมของร้าน</span>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-label="เลือกไฟล์โลโก้"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <ErrorMessage message={error} />
    </section>
  );
}

/** Square shop mark: the uploaded logo, else the built-in X mark. */
export function ShopMark({ className = "", label }: { className?: string; label?: string }) {
  const { overview } = useStore();
  return <img src={shopLogo(overview?.shop?.logoUrl)} className={className + " shop-mark-img"} alt={label ?? ""} />;
}
