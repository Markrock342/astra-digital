// Admin queue for ใบเสร็จคำสั่งซื้อ approvals (server/order-receipts.mjs).
import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime } from "./api";
import { useLive } from "./live";
import "./alerts.css";
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

export function AdminOrderReceipts() {
  const { toast } = useStore();
  const [status, setStatus] = useState<(typeof TABS)[number][0]>("PENDING");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const load = () =>
    api<{ requests: Row[] }>("/admin/order-receipts?status=" + status)
      .then((r) => setRows(r.requests))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, [status]);
  useLive(["orders", "notify"], () => void load());

  async function approve(id: string) {
    setBusyId(id);
    setError("");
    try {
      await api("/admin/orders/" + encodeURIComponent(id) + "/order-receipt/approve", {});
      toast("อนุมัติใบเสร็จแล้ว");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId("");
    }
  }
  async function reject(id: string) {
    const reason = (rejectReason[id] || "").trim();
    if (reason.length < 3) {
      setError("กรุณาใส่เหตุผลอย่างน้อย 3 ตัวอักษร");
      return;
    }
    setBusyId(id);
    setError("");
    try {
      await api("/admin/orders/" + encodeURIComponent(id) + "/order-receipt/reject", { reason });
      toast("ไม่อนุมัติใบเสร็จแล้ว");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="admin-order-receipts">
      <div className="page-heading">
        <span className="eyebrow">ออเดอร์</span>
        <h1>ใบเสร็จคำสั่งซื้อ</h1>
        <p>คิวอนุมัติก่อนลูกค้าดาวน์โหลดหรือพิมพ์ใบเสร็จ</p>
      </div>
      <div className="admin-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            className={status === key ? "is-active" : ""}
            aria-selected={status === key}
            onClick={() => setStatus(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorMessage message={error} />
      {rows.length === 0 ? <p className="muted">ไม่พบรายการในสถานะนี้</p> : null}
      <ul className="order-receipt-profile-list">
        {rows.map((row) => (
          <li key={row.orderId} className="panel order-receipt-profile-item">
            <div>
              <Link to={"/admin/orders/" + row.orderId}>#{row.orderId.slice(0, 8).toUpperCase()}</Link>
              <p>
                {row.customerName}
                {row.customerEmail ? " · " + row.customerEmail : ""}
              </p>
              <p>
                {row.buyer.name} · {row.buyer.taxId}
              </p>
              <p className="muted">{row.buyer.address}</p>
              <p className="muted">ส่งคำขอ {dateTime(row.requestedAt)}</p>
              {row.reason ? <p className="order-receipt-status is-fail">{row.reason}</p> : null}
            </div>
            {status === "PENDING" ? (
              <div className="order-receipt-actions">
                <button type="button" className="button primary" disabled={busyId === row.orderId} onClick={() => void approve(row.orderId)}>
                  {busyId === row.orderId ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
                  อนุมัติ
                </button>
                <label className="field">
                  เหตุผลไม่อนุมัติ
                  <input
                    value={rejectReason[row.orderId] || ""}
                    onChange={(e) => setRejectReason({ ...rejectReason, [row.orderId]: e.target.value })}
                    placeholder="เช่น ข้อมูลไม่ครบ"
                  />
                </label>
                <button type="button" className="button secondary" disabled={busyId === row.orderId} onClick={() => void reject(row.orderId)}>
                  <XCircle size={16} />
                  ไม่อนุมัติ
                </button>
                <Link to={"/admin/orders/" + row.orderId + "/receipt"} className="button secondary">
                  ดูใบเสร็จ
                </Link>
              </div>
            ) : (
              <Link to={"/admin/orders/" + row.orderId + "/receipt"} className="button secondary">
                ดูใบเสร็จ
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
