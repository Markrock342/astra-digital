// Admin order detail helpers for delivered accounts, kept apart from
// AdminLists.tsx so other order-detail work merges cleanly.
// - CopyValue: a revealed ID / password / code with a copy button
//   (shadcn/ui "copy button" pattern, MIT; idea only).
// - ResendCredentials: "ส่งรหัสให้ลูกค้าอีกครั้ง" with a confirm step. The server
//   sends a notification + a shop chat message pointing at the order page; the
//   password itself is never sent.
import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle, Send } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";

export function CopyValue({ value, label, copyable }: { value: string; label: string; copyable: boolean }) {
  const { toast } = useStore();
  const [copied, setCopied] = useState(false);
  // Thai runs words together; Latin labels like "ID" get spaces around them.
  const name = /^[A-Za-z]/.test(label) ? " " + label + " " : label;
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast(("คัดลอก" + name + "แล้ว").replace(/\s+/g, " "));
    } catch {
      toast("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง");
    }
  }
  return (
    <div className="credential-value">
      <code>{value}</code>
      {copyable && (
        <button
          type="button"
          className="button ghost credential-copy"
          aria-label={("คัดลอก" + name).trim()}
          onClick={() => void copy()}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "คัดลอกแล้ว" : "คัดลอก"}
        </button>
      )}
    </div>
  );
}

export function ResendCredentials({ orderId, onSent }: { orderId: string; onSent: () => void }) {
  const { toast } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ remaining: number }>("/admin/orders/" + orderId + "/resend-credentials", {});
      toast(
        "ส่งรหัสให้ลูกค้าอีกครั้งแล้ว ลูกค้าได้รับแจ้งเตือนและข้อความในแชท" +
          (result.remaining > 0 ? ` (ส่งได้อีก ${result.remaining} ครั้งในชั่วโมงนี้)` : ""),
      );
      setConfirming(false);
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!confirming)
    return (
      <button type="button" className="button secondary resend-credentials-btn" onClick={() => setConfirming(true)}>
        <Send size={15} />
        ส่งรหัสให้ลูกค้าอีกครั้ง
      </button>
    );
  return (
    <div className="resend-confirm" role="group" aria-label="ยืนยันส่งรหัสให้ลูกค้าอีกครั้ง">
      <p>
        <strong>ส่งรหัสให้ลูกค้าอีกครั้ง?</strong>
      </p>
      <small>
        ลูกค้าจะได้รับแจ้งเตือนและข้อความจากร้านในแชท พร้อมลิงก์ไปหน้าคำสั่งซื้อที่มี ID และรหัสผ่าน
        ระบบไม่ส่งรหัสผ่านในแชทหรือแจ้งเตือน · ส่งได้ไม่เกิน 3 ครั้งต่อชั่วโมงต่อออเดอร์
      </small>
      <ErrorMessage message={error} />
      <div className="admin-action-row">
        <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>
          ยกเลิก
        </button>
        <button type="button" className="button primary" disabled={busy} onClick={() => void send()}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
          ยืนยันส่งให้ลูกค้า
        </button>
      </div>
    </div>
  );
}
