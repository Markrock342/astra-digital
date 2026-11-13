// Orders list › เลือกหลายออเดอร์ (bulk actions). API: server/admin-order-bulk.mjs.
// Selection + action bar follow the shadcn/ui data-table "row selection" example (MIT);
// cancel / resend ask first in a dialog that shows how many orders will change.
import { useEffect, useState, type FormEvent } from "react";
import { Ban, Download, LoaderCircle, Send, X } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api } from "./api";
import "./order-bulk.css";

/** Same as the server's BULK_ORDER_CAP. */
export const BULK_CAP = 100;

export type BulkTarget = { ids: string[] } | { filter: Record<string, string> };

type BulkResult = {
  id: string;
  shortId: string;
  status?: string;
  result: "ok" | "skipped" | "failed";
  message: string | null;
};
type BulkSummary = {
  action: "cancel" | "resend" | "export";
  dryRun: boolean;
  cap: number;
  capped: boolean;
  total: number;
  ok: number;
  skipped: number;
  failed: number;
  results: BulkResult[];
};
export type BulkExportRow = {
  id: string;
  status: string;
  total: number;
  quantity: number;
  created_at: string;
  customer: string;
  customer_email: string;
  product: string;
  variant_label: string;
  preorder: boolean;
  queue_number: number | null;
};

const ACTION_TEXT = {
  cancel: { title: "ยกเลิกออเดอร์ที่ยังไม่ชำระ", ok: "ยกเลิกได้", done: "ยกเลิกแล้ว", verb: "ยกเลิก" },
  resend: { title: "ส่งรหัสให้ลูกค้าอีกครั้ง", ok: "ส่งได้", done: "ส่งแล้ว", verb: "ส่งรหัสซ้ำ" },
} as const;

/** Checkbox selection for a cursor list: picked ids, or "everything matching the filter". */
export function useOrderSelection(resetKey: string) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  useEffect(() => {
    setPicked(new Set());
    setAllMatching(false);
  }, [resetKey]);
  const toggle = (id: string) => {
    setAllMatching(false);
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_CAP) next.add(id);
      return next;
    });
  };
  const setPage = (ids: string[], on: boolean) => {
    setAllMatching(false);
    setPicked(on ? new Set(ids.slice(0, BULK_CAP)) : new Set());
  };
  const clear = () => {
    setPicked(new Set());
    setAllMatching(false);
  };
  return { picked, allMatching, setAllMatching, toggle, setPage, clear };
}

function ResultList({ results }: { results: BulkResult[] }) {
  if (!results.length) return null;
  return (
    <ul className="order-bulk-results" aria-label="ผลแต่ละออเดอร์">
      {results.map((r) => (
        <li key={r.id} className={"is-" + r.result}>
          <Link to={"/admin/orders/" + r.id} className="order-number">
            {r.shortId}
          </Link>
          <span>{r.result === "ok" ? "สำเร็จ" : r.result === "skipped" ? "ข้าม" : "ไม่สำเร็จ"}</span>
          {r.message && <small>{r.message}</small>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Sticky bar over the orders table. `target` is what the server should act on;
 * `count` is how many orders that is (for the labels).
 */
export function OrderBulkBar({
  count,
  target,
  admin,
  onClear,
  onExport,
}: {
  count: number;
  target: BulkTarget;
  admin: boolean;
  onClear: () => void;
  onExport: (rows: BulkExportRow[]) => void;
}) {
  const { toast } = useStore();
  const [dialog, setDialog] = useState<null | { action: "cancel" | "resend"; plan: BulkSummary; done?: BulkSummary }>(null);
  const [checking, setChecking] = useState<"" | "cancel" | "resend" | "export">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("ลูกค้าไม่ได้ชำระเงินภายในเวลาที่กำหนด");
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  function close() {
    const finished = !!dialog?.done;
    setDialog(null);
    setError("");
    if (finished) onClear();
  }
  async function plan(action: "cancel" | "resend") {
    setChecking(action);
    setError("");
    try {
      const summary = await api<BulkSummary>("/admin/orders/bulk", { action, dryRun: true, ...target });
      setDialog({ action, plan: summary });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking("");
    }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!dialog) return;
    setBusy(true);
    setError("");
    try {
      const done = await api<BulkSummary>("/admin/orders/bulk", {
        action: dialog.action,
        ...(dialog.action === "cancel" ? { reason } : {}),
        ...target,
      });
      setDialog({ ...dialog, done });
      toast(`${ACTION_TEXT[dialog.action].done} ${done.ok} ออเดอร์` + (done.skipped + done.failed ? ` · ข้าม/ไม่สำเร็จ ${done.skipped + done.failed}` : ""));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportCsv() {
    setChecking("export");
    setError("");
    try {
      const result = await api<BulkSummary & { rows: BulkExportRow[] }>("/admin/orders/bulk", { action: "export", ...target });
      onExport(result.rows);
      toast(`ดาวน์โหลด ${result.rows.length} ออเดอร์แล้ว`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking("");
    }
  }
  const text = dialog ? ACTION_TEXT[dialog.action] : null;
  const shown = dialog?.done ?? dialog?.plan;
  return (
    <>
      <div className="bulk-action-bar order-bulk-bar" role="region" aria-label="จัดการออเดอร์ที่เลือก">
        <strong>เลือก {count.toLocaleString("th-TH")} ออเดอร์</strong>
        <span className="bulk-action-buttons">
          {admin && (
            <button type="button" className="button secondary" disabled={!!checking} onClick={() => void plan("cancel")}>
              {checking === "cancel" ? <LoaderCircle className="spin" size={14} /> : <Ban size={14} />}
              ยกเลิกที่ยังไม่ชำระ
            </button>
          )}
          <button type="button" className="button secondary" disabled={!!checking} onClick={() => void plan("resend")}>
            {checking === "resend" ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
            ส่งรหัสซ้ำ
          </button>
          <button type="button" className="button secondary" disabled={!!checking} onClick={() => void exportCsv()}>
            {checking === "export" ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
            ดาวน์โหลด CSV
          </button>
          <button type="button" className="button ghost" disabled={!!checking} onClick={onClear}>
            ล้างที่เลือก
          </button>
        </span>
      </div>
      {!dialog && <ErrorMessage message={error} />}
      {dialog && text && shown && (
        <div className="reference-modal-backdrop" onClick={() => !busy && close()}>
          <section
            className="reference-import-modal order-bulk-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-bulk-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reference-card-heading">
              <h2 id="order-bulk-title">{dialog.done ? "ผลการ" + text.verb : "ยืนยัน" + text.verb}</h2>
              <button type="button" className="icon-button" aria-label="ปิด" disabled={busy} onClick={close}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={confirm}>
              <dl className="order-bulk-counts" aria-label="สรุปจำนวน">
                <div>
                  <dt>เลือก</dt>
                  <dd>{shown.total}</dd>
                </div>
                <div className="is-ok">
                  <dt>{dialog.done ? text.done : text.ok}</dt>
                  <dd>{shown.ok}</dd>
                </div>
                <div>
                  <dt>ข้าม</dt>
                  <dd>{shown.skipped}</dd>
                </div>
                {shown.failed > 0 && (
                  <div className="is-failed">
                    <dt>ไม่สำเร็จ</dt>
                    <dd>{shown.failed}</dd>
                  </div>
                )}
              </dl>
              {shown.capped && (
                <p className="order-bulk-note">
                  ตัวกรองนี้มีออเดอร์มากกว่า {shown.cap} รายการ ระบบใช้ {shown.cap} รายการล่าสุดเท่านั้น
                </p>
              )}
              {!dialog.done && (
                <p className="order-bulk-lead">
                  {dialog.action === "cancel"
                    ? `ยกเลิก ${shown.ok} ออเดอร์ที่ยังไม่ชำระ คูปองที่ใช้จะคืนสิทธิ์ให้ลูกค้า ออเดอร์ที่ชำระแล้วจะถูกข้าม ยกเลิกแล้วย้อนกลับไม่ได้`
                    : `ส่งแจ้งเตือนและข้อความแชทให้ลูกค้า ${shown.ok} ออเดอร์ที่ส่งของแล้ว ให้เปิดดูรหัสในหน้าคำสั่งซื้อ (ไม่ส่งรหัสผ่านในแชท)`}
                </p>
              )}
              {!dialog.done && dialog.action === "cancel" && shown.ok > 0 && (
                <label className="field">
                  เหตุผล (บันทึกในประวัติทุกออเดอร์)
                  <input value={reason} required minLength={3} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                </label>
              )}
              <ResultList
                results={dialog.done ? shown.results : shown.results.filter((r) => r.result !== "ok")}
              />
              <ErrorMessage message={error} />
              <div className="form-actions">
                {dialog.done ? (
                  <button type="button" className="button primary" onClick={close}>
                    เสร็จแล้ว
                  </button>
                ) : (
                  <>
                    <button type="button" className="button secondary" disabled={busy} onClick={close}>
                      ยกเลิก
                    </button>
                    <button
                      className={"button " + (dialog.action === "cancel" ? "danger" : "primary")}
                      disabled={busy || shown.ok === 0 || (dialog.action === "cancel" && reason.trim().length < 3)}
                    >
                      {busy && <LoaderCircle className="spin" size={15} />}
                      {shown.ok === 0 ? "ไม่มีออเดอร์ที่ทำรายการได้" : `ยืนยัน${text.verb} ${shown.ok} ออเดอร์`}
                    </button>
                  </>
                )}
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
