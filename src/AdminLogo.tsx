// ตั้งค่า › ร้าน › โลโก้: upload / replace / remove the shop logo (POST|DELETE /api/admin/settings/logo).
// Used by the back-office header and as the team's picture in the live chat. Card + button row
// follow shadcn/ui Card + Button (MIT, https://ui.shadcn.com/docs/components/card).
import { useRef, useState } from "react";
import { ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";
import { checkSource, toWebp, uploadImage } from "./image-upload";
import "./logo.css";

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
    if (!confirm("ลบโลโก้ร้าน? หลังบ้านและแชทจะกลับไปใช้ตัวอักษร AX")) return;
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
        {logo ? (
          <img src={logo} className="settings-logo" alt="โลโก้ร้านปัจจุบัน" />
        ) : (
          <span className="settings-logo logo-placeholder" aria-label="ยังไม่มีโลโก้">
            AX
          </span>
        )}
        <div className="logo-setting-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ImageUp size={16} />}
            {logo ? "เปลี่ยนโลโก้" : "อัปโหลดโลโก้"}
          </button>
          {logo && (
            <button type="button" className="button ghost logo-remove" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={16} />
              ลบโลโก้
            </button>
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

/** Square shop mark: the uploaded logo, else the AX letters. */
export function ShopMark({ className = "", label }: { className?: string; label?: string }) {
  const { overview } = useStore();
  const logo = overview?.shop?.logoUrl;
  return logo ? (
    <img src={logo} className={className + " shop-mark-img"} alt={label ?? ""} />
  ) : (
    <span className={className} aria-hidden={label ? undefined : true}>
      AX
    </span>
  );
}
