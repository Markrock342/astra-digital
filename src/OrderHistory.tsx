// Order history pieces for the back office, kept apart from AdminLists.tsx so
// other order-detail work merges cleanly.
// - OrderStatusTabs: status tabs with server counts (shadcn/ui Tabs pattern, MIT;
//   status views like the Polaris resource index, idea only).
// - OrderActivity: one timeline of system events, audit events and notes
//   (Medusa order "Activity", MIT).
// - OrderNotes: append-only internal notes.
// - ReplacementHistory: masked old → new account per replacement.
import { useState, type FormEvent } from "react";
import { MessageSquarePlus, RefreshCcw } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api, dateTime } from "./api";

// ---------------------------------------------------------------- Status tabs

export type OrderTab = "todo" | "all" | "pending" | "preorder" | "delivered" | "failed";
export type OrderCounts = Partial<Record<OrderTab, number>>;

const TAB_TEXT: [OrderTab, string][] = [
  ["all", "ทั้งหมด"],
  ["pending", "รอชำระ"],
  ["preorder", "พรีออเดอร์รอส่ง"],
  ["delivered", "ส่งแล้ว"],
  ["failed", "ยกเลิก/ล้มเหลว"],
];
export const ORDER_TABS = TAB_TEXT.map(([key]) => key).concat("todo");

/** STAFF gets "ต้องทำ" first: paid preorders waiting to be sent. */
export function OrderStatusTabs({
  value,
  counts,
  staff,
  onChange,
}: {
  value: OrderTab;
  counts: OrderCounts | null;
  staff: boolean;
  onChange: (tab: OrderTab) => void;
}) {
  const tabs: [OrderTab, string][] = staff ? [["todo", "ต้องทำ"], ...TAB_TEXT] : TAB_TEXT;
  return (
    <div className="reference-status-tabs order-status-tabs" role="tablist" aria-label="สถานะออเดอร์">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          className={value === key ? "active" : ""}
          onClick={() => onChange(key)}
        >
          {label}
          <span className="tab-count" aria-label={(counts?.[key] ?? 0) + " รายการ"}>
            {counts ? (counts[key] ?? 0).toLocaleString("th-TH") : "–"}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Activity timeline

export type ActivityEvent = {
  at: string;
  event: string;
  actor?: string | null;
  actorRole?: string | null;
  reason?: string;
  body?: string;
  legacy?: boolean;
};

const EVENT_TEXT: Record<string, string> = {
  created: "สร้างออเดอร์",
  paid: "ชำระเงินสำเร็จ",
  payment_failed: "ชำระเงินไม่สำเร็จ",
  delivered: "ส่งของแล้ว",
  failed: "ล้มเหลว",
  out_of_stock: "สินค้าหมด",
  cancelled: "ยกเลิกออเดอร์",
  revealed: "เปิดดูรหัส",
  replaced: "เปลี่ยนบัญชีให้ลูกค้า",
  reviewed: "ลูกค้ารีวิว",
  note: "เพิ่มหมายเหตุ",
};
const ROLE_TEXT: Record<string, string> = { ADMIN: "แอดมิน", STAFF: "ทีมงาน", CUSTOMER: "ลูกค้า" };
const SYSTEM_TEXT: Record<string, string> = {
  delivered: "ระบบส่งอัตโนมัติ",
  paid: "ระบบชำระเงิน",
  payment_failed: "ระบบชำระเงิน",
};

function Actor({ name, role, event }: { name?: string | null; role?: string | null; event: string }) {
  if (!name) return <span className="admin-timeline-actor">{SYSTEM_TEXT[event] ?? "ระบบ"}</span>;
  return (
    <span className="admin-timeline-actor">
      โดย {name}
      {role && ROLE_TEXT[role] && <span className="admin-chip">{ROLE_TEXT[role]}</span>}
    </span>
  );
}

export function OrderActivity({ events }: { events: ActivityEvent[] }) {
  if (!events.length) return <p className="muted">ยังไม่มีความเคลื่อนไหว</p>;
  return (
    <ol className="admin-timeline admin-activity">
      {events.map((e, i) => (
        <li key={i} className={"event-" + e.event}>
          <strong>{EVENT_TEXT[e.event] ?? e.event}</strong>
          <Actor name={e.actor} role={e.actorRole} event={e.event} />
          {e.reason && <p className="admin-timeline-reason">เหตุผล: {e.reason}</p>}
          {e.body && <p className="admin-timeline-note">{e.body}</p>}
          <time dateTime={e.at.replace(" ", "T") + "Z"}>{dateTime(e.at)}</time>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- Notes

export type OrderNoteItem = {
  id: string;
  at: string;
  author: string | null;
  authorRole: string | null;
  body: string;
  legacy: boolean;
};

const NOTE_MAX = 1000;

export function OrderNotes({
  id,
  notes,
  onAdded,
}: {
  id: string;
  notes: OrderNoteItem[];
  onAdded: (notes: OrderNoteItem[]) => void;
}) {
  const { toast } = useStore();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function add(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api<{ notes: OrderNoteItem[] }>("/admin/orders/" + id + "/notes", { body: text });
      onAdded(result.notes);
      setText("");
      toast("เพิ่มหมายเหตุแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="reference-admin-card admin-detail-card order-notes-card">
      <h2>หมายเหตุภายใน</h2>
      <p className="field-help">ทีมงานเห็นเท่านั้น ลูกค้าไม่เห็น บันทึกแล้วแก้หรือลบไม่ได้</p>
      {notes.length > 0 && (
        <ul className="order-note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <div className="order-note-head">
                <strong>{n.author ?? "ไม่ทราบผู้เขียน"}</strong>
                {n.authorRole && ROLE_TEXT[n.authorRole] && <span className="admin-chip">{ROLE_TEXT[n.authorRole]}</span>}
                {n.legacy && <span className="admin-chip">หมายเหตุเดิม</span>}
                <time>{dateTime(n.at)}</time>
              </div>
              <p>{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="admin-note-form">
        <label className="field">
          <span className="sr-only">เพิ่มหมายเหตุ</span>
          <textarea
            aria-label="เพิ่มหมายเหตุ"
            maxLength={NOTE_MAX}
            rows={3}
            placeholder="เช่น ลูกค้าแจ้งทางแชทว่า…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="order-note-actions">
          <small className="muted">
            {text.length}/{NOTE_MAX}
          </small>
          <button className="button primary" disabled={saving || !text.trim()}>
            <MessageSquarePlus size={15} />
            เพิ่มหมายเหตุ
          </button>
        </div>
        <ErrorMessage message={error} />
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- Replacement history

export type ReplacementItem = {
  id: string;
  at: string;
  actor: string | null;
  actorRole: string | null;
  reason: string;
  oldLogin: string;
  newLogin: string;
};

export function ReplacementHistory({ items }: { items: ReplacementItem[] }) {
  if (!items.length) return null;
  return (
    <div className="order-replacements">
      <h2>
        ประวัติการเปลี่ยนบัญชี <span className="admin-chip">{items.length} ครั้ง</span>
      </h2>
      <ul>
        {items.map((r) => (
          <li key={r.id}>
            <div className="order-replacement-swap">
              <RefreshCcw size={14} aria-hidden="true" />
              <code>{r.oldLogin}</code>
              <span aria-label="เปลี่ยนเป็น">→</span>
              <code>{r.newLogin}</code>
            </div>
            <p>เหตุผล: {r.reason}</p>
            <small>
              {dateTime(r.at)} · โดย {r.actor ?? "ไม่ทราบ"}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
