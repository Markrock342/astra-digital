// Admin queue for ใบเสร็จคำสั่งซื้อ approvals (server/order-receipts.mjs).
import { useEffect, useState } from "react";
import { Check, Eye, LoaderCircle, X } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime } from "./api";
import { useLive } from "./live";
import "./alerts.css";
import "./tax-invoice.css";
import "./order-receipts.css";

type Row = {
  orderId: string;
  status: string;
  statusLabel: string;
  reason: string | null;
  requestedAt: string;
  customerName: string;
  customerEmail: string;
  buyer: { name: string; taxId: string; address: string; type: string };
};

const TABS = [
  ["PENDING", "รออนุมัติ"],
  ["APPROVED", "อนุมัติแล้ว"],
  ["REJECTED", "ไม่อนุมัติ"],
] as const;
type Tab = (typeof TABS)[number][0];
const EMPTY: Record<Tab, string> = {
  PENDING: "ไม่มีคำขอที่รออนุมัติ",
  APPROVED: "ยังไม่มีใบเสร็จที่อนุมัติ",
  REJECTED: "ยังไม่มีคำขอที่ไม่อนุมัติ",
};
const shortId = (id: string) => id.slice(0, 8).toUpperCase();

/** /admin/order-receipts — same list pattern as ใบกำกับภาษี (tabs with counts + table). */
export function AdminOrderReceipts() {
  const { toast } = useStore();
  const [status, setStatus] = useState<Tab>("PENDING");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<Tab, number>>>({});
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [rejecting, setRejecting] = useState("");
  const [reason, setReason] = useState("");
  const load = () =>
    api<{ requests: Row[]; counts?: Partial<Record<Tab, number>> }>("/admin/order-receipts?status=" + status)
      .then((r) => {
        setRows(r.requests);
        if (r.counts) setCounts(r.counts);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    setRows(null);
    setRejecting("");
    void load();
  }, [status]);
  useLive(["orders", "notify"], () => void load());

  async function approve(id: string) {
    setBusyId(id);
    setError("");
    try {
      await api("/admin/orders/" + encodeURIComponent(id) + "/order-receipt/approve", {});
      toast("อนุมัติใบเสร็จแล้ว ลูกค้าดาวน์โหลดได้");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId("");
    }
  }
  async function reject(id: string) {
    const text = reason.trim();
    if (text.length < 3) {
      setError("กรุณาใส่เหตุผลอย่างน้อย 3 ตัวอักษร");
      return;
    }
    setBusyId(id);
    setError("");
    try {
      await api("/admin/orders/" + encodeURIComponent(id) + "/order-receipt/reject", { reason: text });
      toast("ไม่อนุมัติแล้ว ลูกค้าได้แจ้งเตือน");
      setRejecting("");
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="alerts-page tax-list-page order-receipt-admin">
      <div className="reference-admin-heading">
        <div>
          <h1>ใบเสร็จคำสั่งซื้อ</h1>
          <p>ลูกค้าส่งคำขอ · อนุมัติแล้วลูกค้าจึงดาวน์โหลดหรือพิมพ์ได้</p>
        </div>
        <Link to="/admin/settings/receipts" className="button secondary">
          ตั้งค่าใบเสร็จ
        </Link>
      </div>
      <ErrorMessage message={error} />
      <div className="reference-status-tabs order-status-tabs" role="tablist" aria-label="สถานะ">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            className={status === key ? "active" : ""}
            onClick={() => setStatus(key)}
          >
            {label}
            {counts[key] != null && <span className="tab-count">{counts[key]!.toLocaleString("th-TH")}</span>}
          </button>
        ))}
      </div>
      {!rows ? (
        <section className="reference-admin-card editor-panel">
          <p className="reference-empty-text">กำลังโหลด…</p>
        </section>
      ) : !rows.length ? (
        <section className="reference-admin-card editor-panel fraud-empty">
          <p>{EMPTY[status]}</p>
        </section>
      ) : (
        <div className="table-scroll reference-table admin-list-table">
          <table>
            <thead>
              <tr>
                <th>ออเดอร์</th>
                <th>{status === "PENDING" ? "ขอเมื่อ" : "ส่งคำขอ"}</th>
                <th>ผู้ซื้อบนใบเสร็จ</th>
                <th>ลูกค้า</th>
                {status === "REJECTED" && <th>เหตุผล</th>}
                <th className="order-receipt-col-actions">
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const busy = busyId === row.orderId;
                return (
                  <tr key={row.orderId}>
                    <td>
                      <Link to={"/admin/orders/" + row.orderId} className="num">
                        #{shortId(row.orderId)}
                      </Link>
                    </td>
                    <td>{dateTime(row.requestedAt)}</td>
                    <td>
                      <span className="order-receipt-stack">
                        <span>{row.buyer.name}</span>
                        {row.buyer.taxId && <small>{row.buyer.taxId}</small>}
                        {row.buyer.address && <small>{row.buyer.address}</small>}
                      </span>
                    </td>
                    <td>
                      <span className="order-receipt-stack">
                        <span>{row.customerName}</span>
                        {row.customerEmail && <small>{row.customerEmail}</small>}
                      </span>
                    </td>
                    {status === "REJECTED" && <td>{row.reason}</td>}
                    <td>
                      <div className="order-receipt-row-actions">
                        <Link to={"/admin/orders/" + row.orderId + "/receipt"} className="button ghost small">
                          <Eye size={15} />
                          ดูใบเสร็จ
                        </Link>
                        {status === "PENDING" && rejecting !== row.orderId && (
                          <>
                            <button
                              type="button"
                              className="button secondary small"
                              disabled={busy}
                              onClick={() => {
                                setRejecting(row.orderId);
                                setReason("");
                              }}
                            >
                              <X size={15} />
                              ไม่อนุมัติ
                            </button>
                            <button type="button" className="button primary small" disabled={busy} onClick={() => void approve(row.orderId)}>
                              {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                              อนุมัติ
                            </button>
                          </>
                        )}
                      </div>
                      {rejecting === row.orderId && (
                        <form
                          className="order-receipt-reject"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void reject(row.orderId);
                          }}
                        >
                          <label className="field">
                            <span>เหตุผลที่ไม่อนุมัติ (ลูกค้าเห็น)</span>
                            <input
                              autoFocus
                              value={reason}
                              maxLength={200}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="เช่น เลขผู้เสียภาษีไม่ถูกต้อง"
                            />
                          </label>
                          <div>
                            <button type="button" className="button ghost small" onClick={() => setRejecting("")}>
                              ยกเลิก
                            </button>
                            <button className="button primary small" disabled={busy || reason.trim().length < 3}>
                              {busy ? <LoaderCircle className="spin" size={15} /> : null}
                              ยืนยันไม่อนุมัติ
                            </button>
                          </div>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
