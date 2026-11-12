// Server-filtered admin tables (FR-O2–O4, O9, C1–C6, P1). Layout follows the
// shadcn/ui "Tasks" data-table example (MIT): filter bar → table → load more.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Download,
  Eye,
  LogOut,
  Package,
  Plus,
  RotateCcw,
  Search,
  ShieldBan,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useLive, type LiveTopic } from "./live";
import { AdminChat as AdminChatLazy, BuyerRankingCard as BuyerRankingInline } from "./Ops";
import { Art, ErrorMessage, Link, Status, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { checkSource, toWebp, uploadImage } from "./image-upload";

type Filters = Record<string, string>;

const query = (filters: Filters, cursor?: string | null) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (cursor) params.set("cursor", cursor);
  const text = params.toString();
  return text ? "?" + text : "";
};

/** Cursor list that refetches when filters change (search is debounced). */
function useCursorList<T>(path: string, key: string, filters: Filters, topics: LiveTopic[] = []) {
  const [tick, setTick] = useState(0);
  useLive(topics, () => setTick((n) => n + 1));
  const [rows, setRows] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const serial = JSON.stringify(filters);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    const timer = setTimeout(async () => {
      try {
        const data = await api<Record<string, unknown>>(path + query(filters));
        if (id !== request.current) return;
        setRows(data[key] as T[]);
        setNext((data.nextCursor as string) ?? null);
        setError("");
      } catch (e) {
        if (id === request.current) setError((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, serial, tick]);
  async function more() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const data = await api<Record<string, unknown>>(path + query(filters, next));
      setRows((current) => [...(current ?? []), ...(data[key] as T[])]);
      setNext((data.nextCursor as string) ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  return { rows, next, error, more, loadingMore };
}

function FilterBar({
  search,
  placeholder,
  onSearch,
  children,
  onReset,
  active,
}: {
  search: string;
  placeholder: string;
  onSearch: (value: string) => void;
  children?: ReactNode;
  onReset: () => void;
  active: boolean;
}) {
  return (
    <div className="admin-filters" role="search">
      <label className="search-field">
        <Search size={16} />
        <input
          aria-label={placeholder}
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      {children}
      {active && (
        <button type="button" className="button ghost admin-filter-reset" onClick={onReset}>
          <RotateCcw size={14} />
          ล้างตัวกรอง
        </button>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className={"admin-filter-select" + (value ? " is-set" : "")}>
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <span className={"admin-filter-dates" + (from || to ? " is-set" : "")}>
      <input
        type="date"
        aria-label="ตั้งแต่วันที่"
        value={from}
        max={to || undefined}
        onChange={(e) => onChange(e.target.value, to || e.target.value)}
      />
      <span aria-hidden="true">–</span>
      <input
        type="date"
        aria-label="ถึงวันที่"
        value={to}
        min={from || undefined}
        onChange={(e) => onChange(from || e.target.value, e.target.value)}
      />
    </span>
  );
}

function MoreRow({ next, more, loading, count }: { next: string | null; more: () => void; loading: boolean; count: number }) {
  return (
    <div className="admin-list-footer">
      <span>แสดง {count} รายการ</span>
      {next && (
        <button type="button" className="button secondary" onClick={more} disabled={loading}>
          {loading ? "กำลังโหลด…" : "โหลดเพิ่ม"}
        </button>
      )}
    </div>
  );
}

const shortId = (id: string) => "#" + id.slice(0, 8).toUpperCase();

/** CSV with a BOM for Excel; cells starting with = + - @ are quoted as text. */
function downloadCsv(name: string, rows: unknown[][]) {
  const cell = (v: unknown) => {
    let text = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const csv = rows.map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- Orders

type OrderRow = {
  id: string;
  status: string;
  total: number;
  quantity: number;
  created_at: string;
  customer_id: string;
  customer: string;
  customer_email: string;
  product: string;
  variant_label: string;
  preorder: boolean;
  queue_number: number | null;
};

const orderStatuses: [string, string][] = [
  ["", "ทุกสถานะ"],
  ["PENDING_PAYMENT", "รอชำระ"],
  ["PREORDER", "รอส่ง (พรีออเดอร์)"],
  ["DELIVERED", "ส่งแล้ว"],
  ["FAILED", "ชำระไม่สำเร็จ"],
  ["OUT_OF_STOCK", "สินค้าหมด"],
  ["CANCELLED", "ยกเลิก"],
];
const emptyOrderFilters = { q: "", status: "", type: "", from: "", to: "" };

export function AdminOrders() {
  const { go } = useStore();
  const [filters, setFilters] = useState<Filters>(emptyOrderFilters);
  const [exporting, setExporting] = useState(false);
  const list = useCursorList<OrderRow>("/admin/orders", "orders", { ...filters, limit: "50" }, ["orders"]);
  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch }));
  const active = Object.values(filters).some(Boolean);
  async function exportCsv() {
    setExporting(true);
    try {
      const all: OrderRow[] = [];
      let cursor: string | null = null;
      do {
        const page: { orders: OrderRow[]; nextCursor: string | null } = await api(
          "/admin/orders" + query({ ...filters, limit: "100" }, cursor),
        );
        all.push(...page.orders);
        cursor = page.nextCursor;
      } while (cursor && all.length < 10000);
      downloadCsv("orders.csv", [
        ["เลขออเดอร์", "วันที่", "ลูกค้า", "อีเมล", "สินค้า", "ตัวเลือก", "ประเภท", "คิว", "จำนวน", "ยอด (บาท)", "สถานะ"],
        ...all.map((o) => [
          o.id,
          o.created_at,
          o.customer,
          o.customer_email,
          o.product,
          o.variant_label,
          o.preorder ? "พรีออเดอร์" : "พร้อมส่ง",
          o.queue_number ?? "",
          o.quantity,
          (o.total / 100).toFixed(2),
          o.status,
        ]),
      ]);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>ออเดอร์</h1>
          <p>ออเดอร์พร้อมส่งและคิวพรีออเดอร์ทั้งหมด กรองจากเซิร์ฟเวอร์ เวลาเป็นเวลาไทย</p>
        </div>
        <button className="button secondary" onClick={exportCsv} disabled={exporting}>
          <Download size={15} />
          {exporting ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลด CSV"}
        </button>
      </div>
      <FilterBar
        search={filters.q}
        placeholder="ค้นเลขออเดอร์ ลูกค้า หรือสินค้า"
        onSearch={(q) => set({ q })}
        onReset={() => setFilters(emptyOrderFilters)}
        active={active}
      >
        <Select label="สถานะ" value={filters.status} onChange={(status) => set({ status })} options={orderStatuses} />
        <Select
          label="ประเภท"
          value={filters.type}
          onChange={(type) => set({ type })}
          options={[
            ["", "ทุกประเภท"],
            ["ready", "พร้อมส่ง"],
            ["preorder", "พรีออเดอร์"],
          ]}
        />
        <DateRange from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} />
      </FilterBar>
      <ErrorMessage message={list.error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>ออเดอร์</th>
              <th>ลูกค้า</th>
              <th>สถานะ</th>
              <th className="num">ยอดรวม</th>
              <th>วันที่</th>
            </tr>
          </thead>
          <tbody>
            {list.rows?.map((o) => (
              <tr key={o.id} className="admin-row-link" onClick={() => go("/admin/orders/" + o.id)}>
                <td>
                  <Link to={"/admin/orders/" + o.id} className="order-number">
                    {shortId(o.id)}
                  </Link>
                  <small>
                    {o.product} · {o.variant_label} · {o.quantity} ชิ้น
                    {o.preorder && <span className="admin-chip">คิว {o.queue_number ?? "–"}</span>}
                  </small>
                </td>
                <td>
                  {o.customer}
                  <small>{o.customer_email}</small>
                </td>
                <td>
                  <Status status={o.status} />
                </td>
                <td className="num">{money(o.total)}</td>
                <td className="nowrap">{dateTime(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.rows === null && !list.error && <p className="reference-empty-text">กำลังโหลด…</p>}
        {list.rows?.length === 0 && (
          <p className="reference-empty-text">{active ? "ไม่พบออเดอร์ตามตัวกรอง" : "ยังไม่มีออเดอร์"}</p>
        )}
      </div>
      {list.rows && <MoreRow next={list.next} more={list.more} loading={list.loadingMore} count={list.rows.length} />}
    </>
  );
}

type OrderDetail = {
  id: string;
  status: string;
  total: number;
  quantity: number;
  created_at: string;
  preorder: boolean;
  queue_number: number | null;
  product: { id: string; name: string; art: string; variant_label: string };
  customer: { id: string; name: string; email: string };
  payments: { id: string; amount: number; status: string; provider: string; provider_ref: string | null; created_at: string; finalized_at: string | null }[];
  timeline: { at: string; event: string }[];
  codes: string[];
  credentials: { loginId: string; password: string }[];
  units?: { id: string; kind: "pair" | "code" }[];
  note?: string | null;
};

function OrderNote({ id, note }: { id: string; note: string | null }) {
  const { toast } = useStore();
  const [text, setText] = useState(note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setText(note ?? ""), [note]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/admin/orders/" + id + "/note", { note: text });
      toast("บันทึกหมายเหตุแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="reference-admin-card admin-detail-card">
      <h2>หมายเหตุภายใน</h2>
      <form onSubmit={save} className="admin-note-form">
        <label className="field">
          <span className="sr-only">หมายเหตุภายใน</span>
          <textarea
            aria-label="หมายเหตุภายใน"
            maxLength={2000}
            rows={3}
            placeholder="เช่น ลูกค้าแจ้งทางแชทว่า… · ลูกค้าไม่เห็นข้อความนี้"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <ErrorMessage message={error} />
        <button className="button secondary" disabled={saving || text === (note ?? "")}>
          บันทึกหมายเหตุ
        </button>
      </form>
    </section>
  );
}

const eventText: Record<string, string> = {
  created: "สร้างออเดอร์",
  paid: "ชำระเงินสำเร็จ",
  payment_failed: "ชำระเงินไม่สำเร็จ",
  delivered: "ส่งของแล้ว",
  failed: "ล้มเหลว",
  out_of_stock: "สินค้าหมด",
};

export function AdminOrderDetail({ id }: { id: string }) {
  const { toast, user } = useStore();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  async function cancel(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api("/admin/orders/" + id + "/cancel", { reason });
      toast("ยกเลิกออเดอร์แล้ว");
      setCancelling(false);
      setOrder(await api<OrderDetail>("/admin/orders/" + id));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [revealed, setRevealed] = useState<Pick<OrderDetail, "codes" | "credentials"> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setOrder(null);
    setRevealed(null);
    api<OrderDetail>("/admin/orders/" + id)
      .then(setOrder)
      .catch((e) => setError((e as Error).message));
  }, [id]);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replaceReason, setReplaceReason] = useState("");
  const pairUnits = (order?.units ?? []).filter((u) => u.kind === "pair");
  const codeUnits = (order?.units ?? []).filter((u) => u.kind === "code");
  async function replace(e: FormEvent) {
    e.preventDefault();
    if (!replacing) return;
    try {
      await api("/admin/orders/" + id + "/replace", { inventoryId: replacing, reason: replaceReason });
      toast("ส่งบัญชีใหม่ให้ลูกค้าแล้ว ลูกค้าได้แจ้งเตือน");
      setReplacing(null);
      setReplaceReason("");
      setRevealed(null);
      setOrder(await api<OrderDetail>("/admin/orders/" + id));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const replaceButton = (unitId?: string) =>
    user?.role === "ADMIN" && unitId ? (
      <button type="button" className="button ghost admin-replace-btn" onClick={() => setReplacing(unitId)}>
        บัญชีเสีย · เปลี่ยนให้ลูกค้า
      </button>
    ) : null;
  async function reveal() {
    try {
      setRevealed(await api("/admin/orders/" + id + "/reveal", {}));
      toast("บันทึกการเปิดดูรหัสแล้ว");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const shown = revealed ?? order;
  return (
    <>
      <Link to="/admin/orders" className="back-link">
        <ArrowLeft size={15} />
        ออเดอร์
      </Link>
      <ErrorMessage message={error} />
      {order && (
        <>
          <div className="reference-admin-heading">
            <div>
              <h1>ออเดอร์ {shortId(order.id)}</h1>
              <p>
                {dateTime(order.created_at)} · {order.preorder ? "พรีออเดอร์" : "พร้อมส่ง"}
                {order.queue_number != null && " · คิวที่ " + order.queue_number}
              </p>
            </div>
            <Status status={order.status} />
          </div>
          {order.status === "PENDING_PAYMENT" && user?.role === "ADMIN" && (
            <section className="reference-admin-card admin-detail-card">
              {cancelling ? (
                <form className="admin-reason-form" onSubmit={cancel}>
                  <label className="field">
                    เหตุผลที่ยกเลิก (บันทึกภายใน)
                    <input required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                  </label>
                  <div className="admin-action-row">
                    <button type="button" className="button secondary" onClick={() => setCancelling(false)}>
                      ไม่ยกเลิก
                    </button>
                    <button className="button danger">ยืนยันยกเลิกออเดอร์</button>
                  </div>
                </form>
              ) : (
                <div className="admin-action-row">
                  <span className="muted">ออเดอร์นี้ยังไม่ชำระ</span>
                  <button className="button secondary" onClick={() => setCancelling(true)}>
                    ยกเลิกออเดอร์
                  </button>
                </div>
              )}
            </section>
          )}
          <OrderNote id={order.id} note={order.note ?? null} />
          <div className="admin-detail-grid">
            <section className="reference-admin-card admin-detail-card">
              <h2>สินค้า</h2>
              <div className="merchant-product-cell">
                <div className="merchant-product-art">
                  <Art small type={order.product.art} name={order.product.name} />
                </div>
                <div>
                  <Link to={"/admin/products/" + order.product.id}>{order.product.name}</Link>
                  <small>
                    {order.product.variant_label} · {order.quantity} ชิ้น
                  </small>
                </div>
                <strong className="num">{money(order.total)}</strong>
              </div>
              <h2>บัญชีที่ส่งให้ลูกค้า</h2>
              {order.status !== "DELIVERED" ? (
                <p className="muted">ยังไม่ได้ส่งของ</p>
              ) : (
                <>
                  <ul className="admin-credential-list">
                    {shown!.credentials.map((c, i) => (
                      <li key={"c" + i}>
                        <span>ID</span>
                        <code>{c.loginId}</code>
                        <span>รหัสผ่าน</span>
                        <code>{c.password}</code>
                        {replaceButton(pairUnits[i]?.id)}
                      </li>
                    ))}
                    {shown!.codes.map((c, i) => (
                      <li key={"k" + i}>
                        <span>โค้ด</span>
                        <code>{c}</code>
                        {replaceButton(codeUnits[i]?.id)}
                      </li>
                    ))}
                  </ul>
                  {replacing && (
                    <form className="admin-reason-form" onSubmit={replace}>
                      <label className="field">
                        บัญชีนี้มีปัญหาอะไร (บันทึกภายใน)
                        <input
                          required
                          minLength={2}
                          maxLength={500}
                          value={replaceReason}
                          onChange={(e) => setReplaceReason(e.target.value)}
                          autoFocus
                        />
                      </label>
                      <p className="field-help">
                        ระบบทำเครื่องหมายบัญชีเดิมว่าเสีย ดึงบัญชีใหม่จากสต็อกตัวเลือกเดียวกันส่งให้ลูกค้าทันที และแจ้งเตือนลูกค้า
                      </p>
                      <div className="admin-action-row">
                        <button type="button" className="button secondary" onClick={() => setReplacing(null)}>
                          ยกเลิก
                        </button>
                        <button className="button primary">ส่งบัญชีใหม่</button>
                      </div>
                    </form>
                  )}
                  {!revealed && (
                    <button className="button secondary" onClick={reveal}>
                      <Eye size={15} />
                      แสดงรหัส (บันทึกว่าใครเปิดดู)
                    </button>
                  )}
                </>
              )}
            </section>
            <section className="reference-admin-card admin-detail-card">
              <h2>ลูกค้า</h2>
              <Link to={"/admin/customers/" + order.customer.id} className="admin-person">
                <UserRound size={18} />
                <span>
                  {order.customer.name}
                  <small>{order.customer.email}</small>
                </span>
              </Link>
              <h2>ไทม์ไลน์</h2>
              <ol className="admin-timeline">
                {order.timeline.map((e, i) => (
                  <li key={i} className={"event-" + e.event}>
                    <strong>{eventText[e.event] ?? e.event}</strong>
                    <time>{dateTime(e.at)}</time>
                  </li>
                ))}
              </ol>
              <h2>การชำระเงิน</h2>
              {order.payments.length === 0 && <p className="muted">ยังไม่มีรายการชำระ</p>}
              {order.payments.map((p) => (
                <div className="settings-row" key={p.id}>
                  <span>
                    {p.provider}
                    <small>{p.provider_ref ?? shortId(p.id)} · {dateTime(p.finalized_at ?? p.created_at)}</small>
                  </span>
                  <strong>
                    {money(p.amount)} · {p.status === "SUCCEEDED" ? "สำเร็จ" : p.status === "FAILED" ? "ไม่สำเร็จ" : "รอ"}
                  </strong>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Customers

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  created_at: string;
  spentSatang?: number;
  orderCount: number;
};

const statusText: Record<string, string> = { ACTIVE: "ปกติ", SUSPENDED: "ระงับ", BANNED: "แบน" };
const CustomerStatus = ({ status }: { status: string }) => (
  <span className={"status customer-status-" + status.toLowerCase()}>{statusText[status] ?? status}</span>
);
const emptyCustomerFilters = { q: "", status: "", hasOrders: "", sort: "created_at", from: "", to: "" };

export function AdminCustomers() {
  const { go, user } = useStore();
  const admin = user?.role === "ADMIN";
  const [filters, setFilters] = useState<Filters>(emptyCustomerFilters);
  const list = useCursorList<CustomerRow>("/admin/customers", "customers", { ...filters, limit: "50" }, ["customers", "orders"]);
  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch }));
  const active = Object.entries(filters).some(([k, v]) => v && !(k === "sort" && v === "created_at"));
  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    try {
      const rows: CustomerRow[] = [];
      let cursor: string | null = null;
      do {
        const page: { customers: CustomerRow[]; nextCursor: string | null } = await api(
          "/admin/customers" + query({ ...filters, limit: "100" }, cursor),
        );
        rows.push(...page.customers);
        cursor = page.nextCursor;
      } while (cursor && rows.length < 20000);
      downloadCsv("customers.csv", [
        ["ชื่อ", "อีเมล", "เบอร์โทร", "สถานะ", "ออเดอร์", ...(admin ? ["ยอดซื้อสะสม (บาท)"] : []), "สมัครเมื่อ"],
        ...rows.map((c) => [
          c.name,
          c.email,
          c.phone ?? "",
          statusText[c.status] ?? c.status,
          c.orderCount,
          ...(admin ? [((c.spentSatang ?? 0) / 100).toFixed(2)] : []),
          c.created_at,
        ]),
      ]);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>ลูกค้า</h1>
          <p>กดที่ลูกค้าเพื่อดูยอดเงิน ออเดอร์ แก้ข้อมูล หรือระงับบัญชี</p>
        </div>
        <button className="button secondary" onClick={exportCsv} disabled={exporting}>
          <Download size={15} />
          {exporting ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลด CSV"}
        </button>
      </div>
      <FilterBar
        search={filters.q}
        placeholder="ค้นชื่อ อีเมล หรือชื่อผู้ใช้"
        onSearch={(q) => set({ q })}
        onReset={() => setFilters(emptyCustomerFilters)}
        active={active}
      >
        <Select
          label="สถานะบัญชี"
          value={filters.status}
          onChange={(status) => set({ status })}
          options={[
            ["", "ทุกสถานะ"],
            ["ACTIVE", "ปกติ"],
            ["SUSPENDED", "ระงับ"],
            ["BANNED", "แบน"],
          ]}
        />
        <Select
          label="ออเดอร์"
          value={filters.hasOrders}
          onChange={(hasOrders) => set({ hasOrders })}
          options={[
            ["", "มีหรือไม่มีออเดอร์"],
            ["true", "เคยสั่งซื้อ"],
            ["false", "ยังไม่เคยสั่ง"],
          ]}
        />
        <Select
          label="เรียงตาม"
          value={filters.sort}
          onChange={(sort) => set({ sort })}
          options={[
            ["created_at", "สมัครล่าสุด"],
            ...(admin ? ([["spent", "ยอดซื้อสูงสุด"]] as [string, string][]) : []),
            ["orders", "ออเดอร์มากสุด"],
            ["name", "ชื่อ ก–ฮ"],
          ]}
        />
        <DateRange from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} />
      </FilterBar>
      <ErrorMessage message={list.error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>ลูกค้า</th>
              <th>สถานะ</th>
              <th className="num">ออเดอร์</th>
              {admin && <th className="num">ยอดซื้อสะสม</th>}
              <th>สมัครเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            {list.rows?.map((c) => (
              <tr key={c.id} className="admin-row-link" onClick={() => go("/admin/customers/" + c.id)}>
                <td>
                  <div className="merchant-customer-cell">
                    <span className="avatar">{c.name.slice(0, 2)}</span>
                    <span>
                      <Link to={"/admin/customers/" + c.id}>{c.name}</Link>
                      <small>{c.email.endsWith(".local") ? "—" : c.email}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <CustomerStatus status={c.status} />
                </td>
                <td className="num">{c.orderCount}</td>
                {admin && <td className="num">{money(c.spentSatang ?? 0)}</td>}
                <td className="nowrap">{dateTime(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.rows === null && !list.error && <p className="reference-empty-text">กำลังโหลด…</p>}
        {list.rows?.length === 0 && (
          <p className="reference-empty-text">{active ? "ไม่พบลูกค้าตามตัวกรอง" : "ยังไม่มีลูกค้า"}</p>
        )}
      </div>
      {list.rows && <MoreRow next={list.next} more={list.more} loading={list.loadingMore} count={list.rows.length} />}
    </>
  );
}

type CustomerDetail = {
  customer: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    username: string | null;
    phone: string | null;
    note: string | null;
    status: string;
    statusReason: string | null;
    statusChangedAt: string | null;
    created_at: string;
  };
  orderCount: number;
  activeSessions: number;
  orders: { id: string; status: string; total: number; quantity: number; created_at: string; product: string; preorder: boolean }[];
  history: { id: number; action: string; detail: Record<string, unknown> | null; created_at: string; actor: string | null }[];
  spentSatang?: number;
  creditSatang?: number;
  ledger?: { id: string; amount: number; label: string; created_at: string }[];
};

const historyText = (h: CustomerDetail["history"][number]) => {
  const d = (h.detail ?? {}) as Record<string, { from?: unknown; to?: unknown } | unknown>;
  if (h.action === "CUSTOMER_STATUS") {
    const s = h.detail as { to: string; reason?: string };
    return "เปลี่ยนสถานะเป็น " + (statusText[s.to] ?? s.to) + (s.reason ? " · " + s.reason : "");
  }
  if (h.action === "CUSTOMER_SIGN_OUT") return "บังคับออกจากระบบทุกอุปกรณ์";
  if (h.action === "CUSTOMER_PASSWORD_RESET") return "ตั้งรหัสผ่านชั่วคราว";
  if (h.action === "CUSTOMER_UPDATE") {
    const labels: Record<string, string> = { firstName: "ชื่อ", lastName: "นามสกุล", email: "อีเมล", phone: "เบอร์โทร", note: "หมายเหตุ" };
    return "แก้ " + Object.keys(d).map((k) => labels[k] ?? k).join(", ");
  }
  return h.action;
};

export function AdminCustomerDetail({ id }: { id: string }) {
  const { toast, user, go } = useStore();
  const admin = user?.role === "ADMIN";
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusDraft, setStatusDraft] = useState<"" | "SUSPENDED" | "BANNED">("");
  const [reason, setReason] = useState("");
  const [temporary, setTemporary] = useState("");
  async function resetPassword() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ temporaryPassword: string }>("/admin/customers/" + id + "/reset-password", {});
      setTemporary(result.temporaryPassword);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    try {
      setData(await api<CustomerDetail>("/admin/customers/" + id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setData(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  async function act(path: string, body: unknown, message: string) {
    setBusy(true);
    setError("");
    try {
      await api("/admin/customers/" + id + path, body);
      toast(message);
      setStatusDraft("");
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void act("", Object.fromEntries(new FormData(e.currentTarget)), "บันทึกข้อมูลลูกค้าแล้ว");
  }
  const c = data?.customer;
  return (
    <>
      <Link to="/admin/customers" className="back-link">
        <ArrowLeft size={15} />
        ลูกค้า
      </Link>
      <ErrorMessage message={error} />
      {data && c && (
        <>
          <div className="reference-admin-heading">
            <div>
              <h1>{c.name}</h1>
              <p>
                {c.email.endsWith(".local") ? c.username ?? "—" : c.email} · สมัคร {dateTime(c.created_at)}
              </p>
            </div>
            <CustomerStatus status={c.status} />
          </div>
          {c.status !== "ACTIVE" && (
            <p className="admin-callout danger">
              บัญชีนี้ถูก{statusText[c.status]}
              {c.statusReason && " · เหตุผล: " + c.statusReason}
              {c.statusChangedAt && " · " + dateTime(c.statusChangedAt)} ลูกค้าเข้าสู่ระบบและสั่งซื้อไม่ได้
            </p>
          )}
          <div className="admin-stat-row">
            <div className="reference-admin-card">
              <small>ออเดอร์</small>
              <strong>{data.orderCount}</strong>
            </div>
            {admin && (
              <>
                <div className="reference-admin-card">
                  <small>ยอดซื้อสะสม</small>
                  <strong>{money(data.spentSatang ?? 0)}</strong>
                </div>
                <div className="reference-admin-card">
                  <small>เครดิตคงเหลือ</small>
                  <strong>{money(data.creditSatang ?? 0)}</strong>
                </div>
              </>
            )}
            <div className="reference-admin-card">
              <small>อุปกรณ์ที่เข้าระบบอยู่</small>
              <strong>{data.activeSessions}</strong>
            </div>
          </div>
          <div className="admin-detail-grid">
            <section className="reference-admin-card admin-detail-card">
              <h2>ข้อมูลลูกค้า</h2>
              <form onSubmit={saveProfile} className="admin-form-grid" key={c.email + c.name + c.phone + c.note}>
                <label className="field">
                  ชื่อ
                  <input name="firstName" required maxLength={40} defaultValue={c.firstName} disabled={!admin} />
                </label>
                <label className="field">
                  นามสกุล
                  <input name="lastName" maxLength={40} defaultValue={c.lastName} disabled={!admin} />
                </label>
                <label className="field span-2">
                  อีเมล
                  <input name="email" type="email" required maxLength={160} defaultValue={c.email} disabled={!admin} />
                </label>
                <label className="field span-2">
                  เบอร์โทร
                  <input name="phone" type="tel" maxLength={20} defaultValue={c.phone ?? ""} disabled={!admin} />
                </label>
                <label className="field span-2">
                  หมายเหตุภายใน (ลูกค้าไม่เห็น)
                  <textarea name="note" maxLength={1000} defaultValue={c.note ?? ""} disabled={!admin} />
                </label>
                {admin && (
                  <button className="button primary span-2" disabled={busy}>
                    บันทึกข้อมูล
                  </button>
                )}
              </form>
            </section>
            <section className="reference-admin-card admin-detail-card">
              <h2>สถานะบัญชี</h2>
              {!admin && <p className="muted">เฉพาะแอดมินเปลี่ยนสถานะบัญชีได้</p>}
              {admin && c.status === "ACTIVE" && !statusDraft && (
                <div className="admin-action-row">
                  <button className="button secondary" onClick={() => setStatusDraft("SUSPENDED")}>
                    ระงับชั่วคราว
                  </button>
                  <button className="button danger" onClick={() => setStatusDraft("BANNED")}>
                    <ShieldBan size={15} />
                    แบนบัญชี
                  </button>
                </div>
              )}
              {admin && statusDraft && (
                <form
                  className="admin-reason-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("/status", { status: statusDraft, reason }, statusDraft === "BANNED" ? "แบนบัญชีแล้ว" : "ระงับบัญชีแล้ว");
                  }}
                >
                  <label className="field">
                    เหตุผล (บันทึกภายใน ลูกค้าไม่เห็น)
                    <input required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                  </label>
                  <p className="field-help">ลูกค้าจะถูกออกจากระบบทุกอุปกรณ์ทันที และเข้าสู่ระบบหรือสั่งซื้อไม่ได้</p>
                  <div className="admin-action-row">
                    <button type="button" className="button secondary" onClick={() => setStatusDraft("")}>
                      ยกเลิก
                    </button>
                    <button className={"button " + (statusDraft === "BANNED" ? "danger" : "primary")} disabled={busy}>
                      ยืนยัน{statusDraft === "BANNED" ? "แบน" : "ระงับ"}
                    </button>
                  </div>
                </form>
              )}
              {admin && c.status !== "ACTIVE" && (
                <button className="button primary" disabled={busy} onClick={() => act("/status", { status: "ACTIVE" }, "เปิดใช้บัญชีแล้ว")}>
                  <ShieldCheck size={15} />
                  ยกเลิกการ{statusText[c.status]}
                </button>
              )}
              {admin && c.status === "ACTIVE" && data.activeSessions > 0 && (
                <button className="button ghost" disabled={busy} onClick={() => act("/sign-out", {}, "ออกจากระบบทุกอุปกรณ์แล้ว")}>
                  <LogOut size={15} />
                  บังคับออกจากระบบ ({data.activeSessions})
                </button>
              )}
              {admin && (
                <>
                  <h2>ลูกค้าลืมรหัสผ่าน</h2>
                  {temporary ? (
                    <div className="admin-temp-password">
                      <p>รหัสผ่านชั่วคราว (แสดงครั้งเดียว ส่งให้ลูกค้าทางช่องทางที่ยืนยันตัวตนแล้ว แล้วให้ลูกค้าเปลี่ยนในหน้าบัญชี)</p>
                      <code>{temporary}</code>
                      <button className="button secondary" onClick={() => void navigator.clipboard?.writeText(temporary)}>
                        คัดลอก
                      </button>
                    </div>
                  ) : (
                    <button className="button secondary" disabled={busy} onClick={resetPassword}>
                      ตั้งรหัสผ่านชั่วคราว
                    </button>
                  )}
                </>
              )}
              {admin && c.status === "ACTIVE" && (
                <>
                  <h2>สิทธิ์เข้าหลังบ้าน</h2>
                  <p className="muted">ให้ลูกค้าคนนี้เป็นทีมงานหรือแอดมิน ใช้รหัสผ่านเดิมเข้าหลังบ้านได้ทันที</p>
                  <GrantAccess userId={c.id} name={c.name} onDone={() => go("/admin/team")} />
                </>
              )}
              <h2>ประวัติการแก้ไข</h2>
              {data.history.length === 0 && <p className="muted">ยังไม่มีการแก้ไขจากแอดมิน</p>}
              <ol className="admin-timeline">
                {data.history.map((h) => (
                  <li key={h.id}>
                    <strong>{historyText(h)}</strong>
                    <time>
                      {h.actor ?? "ระบบ"} · {dateTime(h.created_at)}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          </div>
          <section className="reference-admin-card admin-detail-card">
            <h2>ออเดอร์ล่าสุด</h2>
            {data.orders.length === 0 && <p className="muted">ยังไม่มีออเดอร์</p>}
            {data.orders.map((o) => (
              <Link to={"/admin/orders/" + o.id} className="settings-row admin-order-line" key={o.id}>
                <span>
                  <strong className="order-number">{shortId(o.id)}</strong>
                  <small>
                    {o.product} · {o.quantity} ชิ้น · {dateTime(o.created_at)}
                  </small>
                </span>
                <span className="admin-order-line-end">
                  <Status status={o.status} />
                  <strong>{money(o.total)}</strong>
                </span>
              </Link>
            ))}
          </section>
          {admin && data.ledger && (
            <section className="reference-admin-card admin-detail-card">
              <h2>รายการเครดิต</h2>
              {data.ledger.length === 0 && <p className="muted">ยังไม่มีรายการ</p>}
              {data.ledger.map((l) => (
                <div className="settings-row" key={l.id}>
                  <span>
                    {l.label}
                    <small>{dateTime(l.created_at)}</small>
                  </span>
                  <strong className={l.amount > 0 ? "positive" : ""}>
                    {l.amount > 0 ? "+" : "−"}
                    {money(Math.abs(l.amount))}
                  </strong>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Products

type ProductRow = {
  id: string;
  name: string;
  category: string;
  art: string;
  active: boolean;
  preorder: boolean;
  stock: number;
  stockStatus: "out" | "low" | "in";
  sold: number;
};
const emptyProductFilters = { q: "", category: "", status: "", type: "", stock: "", sort: "name" };
const stockText = { out: "หมด", low: "ใกล้หมด", in: "มีสต็อก" };

export function AdminProducts({
  categories,
  priceOf,
  onStock,
}: {
  categories: { id: string; name: string }[];
  priceOf: (id: string) => string;
  onStock: (name: string) => void;
}) {
  const { go } = useStore();
  const [filters, setFilters] = useState<Filters>(emptyProductFilters);
  const list = useCursorList<ProductRow>("/admin/products", "products", { ...filters, limit: "50" }, ["catalog", "orders"]);
  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch }));
  const active = Object.entries(filters).some(([k, v]) => v && !(k === "sort" && v === "name"));
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>สินค้า</h1>
          <p>สินค้าแต่ละชิ้นมีได้หลายตัวเลือกราคา และแต่ละตัวเลือกมีสต็อกของตัวเอง</p>
        </div>
        <Link to="/admin/products/new" className="button primary">
          <Plus size={16} />
          เพิ่มสินค้า
        </Link>
      </div>
      <FilterBar
        search={filters.q}
        placeholder="ค้นชื่อสินค้า"
        onSearch={(q) => set({ q })}
        onReset={() => setFilters(emptyProductFilters)}
        active={active}
      >
        <Select
          label="หมวดหมู่"
          value={filters.category}
          onChange={(category) => set({ category })}
          options={[["", "ทุกหมวด"], ...categories.map((c) => [c.id, c.name] as [string, string])]}
        />
        <Select
          label="สถานะ"
          value={filters.status}
          onChange={(status) => set({ status })}
          options={[
            ["", "ทุกสถานะ"],
            ["active", "เปิดขาย"],
            ["inactive", "ฉบับร่าง / ปิดขาย"],
          ]}
        />
        <Select
          label="ประเภท"
          value={filters.type}
          onChange={(type) => set({ type })}
          options={[
            ["", "ทุกประเภท"],
            ["ready", "พร้อมส่ง"],
            ["preorder", "พรีออเดอร์"],
          ]}
        />
        <Select
          label="สต็อก"
          value={filters.stock}
          onChange={(stock) => set({ stock })}
          options={[
            ["", "ทุกสต็อก"],
            ["in", "มีสต็อก"],
            ["low", "ใกล้หมด"],
            ["out", "หมด"],
          ]}
        />
        <Select
          label="เรียงตาม"
          value={filters.sort}
          onChange={(sort) => set({ sort })}
          options={[
            ["name", "ชื่อ ก–ฮ"],
            ["sold", "ขายดีสุด"],
            ["stock", "สต็อกมากสุด"],
          ]}
        />
      </FilterBar>
      <ErrorMessage message={list.error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>สินค้า</th>
              <th>ราคา</th>
              <th className="num">สต็อก</th>
              <th className="num">ขายแล้ว</th>
            </tr>
          </thead>
          <tbody>
            {list.rows?.map((p) => (
              <tr key={p.id} className="admin-row-link" onClick={() => go("/admin/products/" + p.id)}>
                <td>
                  <div className="merchant-product-cell">
                    <div className="merchant-product-art">
                      <Art small type={p.art} name={p.name} />
                    </div>
                    <div>
                      <Link to={"/admin/products/" + p.id}>{p.name}</Link>
                      <span className="product-state">
                        <span>{p.active ? "เปิดขาย" : "ฉบับร่าง"}</span>
                        {p.preorder && <span>พรีออเดอร์</span>}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="nowrap">{priceOf(p.id)}</td>
                <td className="num">
                  {p.preorder ? (
                    <span className="muted">ส่งตามคิว</span>
                  ) : (
                    <button
                      className={"stock-link stock-" + p.stockStatus}
                      onClick={(e) => {
                        e.stopPropagation();
                        onStock(p.name);
                      }}
                    >
                      {p.stock} · {stockText[p.stockStatus]}
                    </button>
                  )}
                </td>
                <td className="num">{p.sold}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.rows === null && !list.error && <p className="reference-empty-text">กำลังโหลด…</p>}
        {list.rows?.length === 0 && (
          <p className="reference-empty-text">{active ? "ไม่พบสินค้าตามตัวกรอง" : "ยังไม่มีสินค้า"}</p>
        )}
      </div>
      {list.rows && <MoreRow next={list.next} more={list.more} loading={list.loadingMore} count={list.rows.length} />}
    </>
  );
}

// ---------------------------------------------------------------- Finance (FR-F2–F4, F9)

type Txn = {
  id: string;
  customer: string;
  customer_email: string;
  user_id: string;
  amount: number;
  label: string;
  kind: string;
  direction: "in" | "out";
  fee: number;
  net: number;
  status: string;
  order_id: string | null;
  provider_ref: string | null;
  reference: string;
  created_at: string;
  finalized_at: string | null;
};
type TxnSummary = { in: number; out: number; net: number; pending: number; count: number };

const kindText: Record<string, string> = {
  PAYMENT_IN: "รับชำระ",
  TOPUP: "เติมเครดิต",
  PURCHASE: "ตัดเครดิตซื้อของ",
  REFUND: "คืนเงิน",
  ADJUSTMENT: "ปรับยอด",
  WITHDRAWAL: "ถอน",
  FEE: "ค่าธรรมเนียม",
  DEMO_CREDIT: "เครดิตทดลอง",
};
const txnStatusText: Record<string, string> = {
  PENDING: "รอยืนยัน",
  SUCCEEDED: "สำเร็จ",
  FAILED: "ไม่สำเร็จ",
  REFUNDED: "คืนเงินแล้ว",
};
/** Bangkok calendar day, n days before today. */
const bangkokDay = (daysAgo = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(Date.now() - daysAgo * 86400000));
const emptyFinanceFilters = { q: "", kind: "", direction: "", status: "", from: "", to: "" };

export function AdminFinance() {
  const [filters, setFilters] = useState<Filters>(emptyFinanceFilters);
  const [summary, setSummary] = useState<TxnSummary | null>(null);
  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch }));
  const list = useCursorList<Txn>("/admin/transactions", "transactions", { ...filters, limit: "50" }, ["orders", "customers"]);
  const serial = JSON.stringify(filters);
  useEffect(() => {
    api<{ summary: TxnSummary }>("/admin/transactions" + query({ ...filters, limit: "1" }))
      .then((d) => setSummary(d.summary))
      .catch(() => setSummary(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial]);
  const active = Object.values(filters).some(Boolean);
  const preset = (days: number | null) =>
    days == null ? set({ from: "", to: "" }) : set({ from: bangkokDay(days), to: bangkokDay(0) });
  const presetActive = (days: number | null) =>
    days == null ? !filters.from : filters.from === bangkokDay(days) && filters.to === bangkokDay(0);
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>การเงิน</h1>
          <p>ทุกรายการเงินเข้าและออก พร้อมเวลา ลูกค้า และออเดอร์ที่เกี่ยวข้อง รายการเงินแก้หรือลบไม่ได้</p>
        </div>
        <a className="button secondary" href={"/api/admin/transactions" + query({ ...filters, format: "csv", limit: "100" })}>
          <Download size={15} />
          ดาวน์โหลด CSV
        </a>
      </div>
      <div className="reference-status-tabs" role="group" aria-label="ช่วงเวลา">
        {(
          [
            [null, "ทั้งหมด"],
            [0, "วันนี้"],
            [6, "7 วัน"],
            [29, "30 วัน"],
          ] as [number | null, string][]
        ).map(([days, label]) => (
          <button key={label} className={presetActive(days) ? "active" : ""} onClick={() => preset(days)}>
            {label}
          </button>
        ))}
      </div>
      <div className="admin-stat-row finance-stats">
        <div className="reference-admin-card">
          <small>เงินเข้า</small>
          <strong className="positive">{summary ? money(summary.in) : "–"}</strong>
        </div>
        <div className="reference-admin-card">
          <small>เงินออก (คืนเงิน ถอน ค่าธรรมเนียม)</small>
          <strong>{summary ? money(summary.out) : "–"}</strong>
        </div>
        <div className="reference-admin-card">
          <small>สุทธิ</small>
          <strong>{summary ? money(summary.net) : "–"}</strong>
        </div>
        <div className="reference-admin-card">
          <small>รอยืนยัน · ทั้งหมด</small>
          <strong>
            {summary ? summary.pending + " · " + summary.count : "–"}
          </strong>
        </div>
      </div>
      <FilterBar
        search={filters.q}
        placeholder="ค้นเลขออเดอร์ เลขอ้างอิง หรือเลขรายการ"
        onSearch={(q) => set({ q })}
        onReset={() => setFilters(emptyFinanceFilters)}
        active={active}
      >
        <Select
          label="ประเภทรายการ"
          value={filters.kind}
          onChange={(kind) => set({ kind })}
          options={[
            ["", "ทุกประเภท (ไม่รวมทดลอง)"],
            ...Object.entries(kindText).filter(([k]) => k !== "DEMO_CREDIT"),
            ["DEMO_CREDIT", "เครดิตทดลองเท่านั้น"],
          ]}
        />
        <Select
          label="ทิศทาง"
          value={filters.direction}
          onChange={(direction) => set({ direction })}
          options={[
            ["", "เข้าและออก"],
            ["in", "เงินเข้า"],
            ["out", "เงินออก"],
          ]}
        />
        <Select
          label="สถานะรายการ"
          value={filters.status}
          onChange={(status) => set({ status })}
          options={[["", "ทุกสถานะ"], ...Object.entries(txnStatusText)]}
        />
        <DateRange from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} />
      </FilterBar>
      <ErrorMessage message={list.error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>เวลา</th>
              <th>รายการ</th>
              <th>ลูกค้า</th>
              <th>สถานะ</th>
              <th className="num">ยอด</th>
            </tr>
          </thead>
          <tbody>
            {list.rows?.map((t) => (
              <tr key={t.id}>
                <td className="nowrap">
                  {dateTime(t.created_at)}
                  {t.finalized_at && t.finalized_at !== t.created_at && <small>ยืนยัน {dateTime(t.finalized_at)}</small>}
                </td>
                <td>
                  <span className={"txn-kind txn-" + t.direction}>{kindText[t.kind] ?? t.kind}</span>
                  <small>
                    {t.order_id ? (
                      <Link to={"/admin/orders/" + t.order_id}>ออเดอร์ {shortId(t.order_id)}</Link>
                    ) : (
                      t.label
                    )}
                    {t.provider_ref && " · " + t.provider_ref}
                  </small>
                </td>
                <td>
                  <Link to={"/admin/customers/" + t.user_id}>{t.customer}</Link>
                  <small>{t.customer_email}</small>
                </td>
                <td>
                  <span className={"status txn-status-" + t.status.toLowerCase()}>{txnStatusText[t.status] ?? t.status}</span>
                </td>
                <td className={"num " + (t.direction === "in" ? "positive" : "")}>
                  {t.direction === "in" ? "+" : "−"}
                  {money(Math.abs(t.net))}
                  {t.fee > 0 && <small>ค่าธรรมเนียม {money(t.fee)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.rows === null && !list.error && <p className="reference-empty-text">กำลังโหลด…</p>}
        {list.rows?.length === 0 && (
          <p className="reference-empty-text">
            {active ? "ไม่พบรายการตามตัวกรอง" : "ยังไม่มีรายการเงินจริง (รายการเครดิตทดลองดูได้จากตัวกรองประเภท)"}
          </p>
        )}
      </div>
      {list.rows && <MoreRow next={list.next} more={list.more} loading={list.loadingMore} count={list.rows.length} />}
    </>
  );
}

// ---------------------------------------------------------------- Settings: account + audit (FR-S3, FR-S5)

export function AdminAccount() {
  const { user, toast, refresh, go } = useStore();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      setError("รหัสผ่านใหม่สองช่องไม่ตรงกัน");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/profile", {
        name: form.name,
        ...(form.newPassword ? { currentPassword: form.currentPassword, newPassword: form.newPassword } : {}),
      });
      if (form.newPassword) {
        toast("เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่");
        await refresh();
        go("/login?next=%2Fadmin");
      } else {
        toast("บันทึกแล้ว");
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>บัญชีแอดมิน</h1>
          <p>เปลี่ยนชื่อที่แสดงและรหัสผ่านของบัญชีผู้ดูแล รหัสใหม่มีผลทันทีและอยู่ถาวร</p>
        </div>
      </div>
      <section className="reference-admin-card admin-detail-card admin-account-card">
        <form onSubmit={submit} className="admin-form-grid">
          <ErrorMessage message={error} />
          <label className="field span-2">
            ชื่อที่แสดง
            <input name="name" required minLength={2} maxLength={60} defaultValue={user?.name} />
          </label>
          <label className="field span-2">
            รหัสผ่านปัจจุบัน
            <input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} />
          </label>
          <label className="field">
            รหัสผ่านใหม่
            <input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} />
          </label>
          <label className="field">
            ยืนยันรหัสผ่านใหม่
            <input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} />
          </label>
          <p className="field-help span-2">เว้นช่องรหัสผ่านว่างถ้าต้องการเปลี่ยนแค่ชื่อ · รหัสใหม่อย่างน้อย 10 ตัวอักษร · เปลี่ยนแล้วทุกอุปกรณ์จะถูกออกจากระบบ</p>
          <button className="button primary span-2" disabled={busy}>
            บันทึก
          </button>
        </form>
      </section>
    </>
  );
}

type AuditEntry = {
  id: number;
  action: string;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor: string | null;
  actor_role: string | null;
};
const actionText: Record<string, string> = {
  SAVE_PRODUCT: "บันทึกสินค้า",
  PRODUCT_SET_PREORDER: "ตั้งสินค้าเป็นพรีออเดอร์",
  PRODUCT_SET_READY: "ตั้งสินค้าเป็นพร้อมส่ง",
  IMPORT_CODES: "เติมสต็อก",
  DELIVER_RESERVATION: "ส่งของพรีออเดอร์",
  REVEAL_ORDER_CREDENTIALS: "เปิดดูรหัสในออเดอร์",
  SAVE_SETTINGS: "แก้ตั้งค่าร้าน",
  SET_PAYMENT_CHANNEL: "แก้ช่องทางรับเงิน",
  CUSTOMER_UPDATE: "แก้ข้อมูลลูกค้า",
  CUSTOMER_STATUS: "เปลี่ยนสถานะลูกค้า",
  CUSTOMER_SIGN_OUT: "บังคับลูกค้าออกจากระบบ",
  CUSTOMER_PASSWORD_RESET: "ตั้งรหัสผ่านชั่วคราวให้ลูกค้า",
  UPDATE_PROFILE: "แก้บัญชีตัวเอง",
  CREATE_ORDER: "สร้างออเดอร์",
  CREATE_PREORDER: "สร้างพรีออเดอร์",
  PAYMENT_AND_DELIVERY: "ชำระและส่งของ",
  PREORDER_PAID: "ชำระพรีออเดอร์",
  PAYMENT_FAILED: "ชำระไม่สำเร็จ",
  ADD_REVIEW: "เขียนรีวิว",
  OPEN_CHAT: "เปิดแชท",
  CHAT_MESSAGE: "ส่งข้อความแชท",
  CLOSE_CHAT: "ปิดแชท",
  DEMO_TOPUP: "เติมเครดิตทดลอง",
};

export function AdminAudit() {
  const [scope, setScope] = useState("staff");
  const [action, setAction] = useState("");
  const list = useCursorList<AuditEntry>("/admin/audit", "entries", { scope: scope === "staff" ? "staff" : "", action, limit: "50" });
  const entityLink = (e: AuditEntry) => {
    if (!e.entity_id) return null;
    if (e.action.startsWith("CUSTOMER_")) return "/admin/customers/" + e.entity_id;
    if (["REVEAL_ORDER_CREDENTIALS", "DELIVER_RESERVATION", "CREATE_ORDER", "CREATE_PREORDER", "PAYMENT_AND_DELIVERY", "PREORDER_PAID"].includes(e.action))
      return "/admin/orders/" + e.entity_id;
    if (e.action.startsWith("PRODUCT_") || e.action === "SAVE_PRODUCT") return "/admin/products/" + e.entity_id;
    return null;
  };
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>ประวัติการทำงาน</h1>
          <p>ทุกการกระทำในหลังบ้านถูกบันทึกและแก้ไขไม่ได้ ใคร ทำอะไร กับอะไร เมื่อไหร่</p>
        </div>
      </div>
      <div className="admin-filters">
        <Select
          label="ผู้ทำ"
          value={scope}
          onChange={setScope}
          options={[
            ["staff", "เฉพาะแอดมินและทีมงาน"],
            ["all", "ทุกคน (รวมลูกค้า)"],
          ]}
        />
        <Select
          label="การกระทำ"
          value={action}
          onChange={setAction}
          options={[
            ["", "ทุกการกระทำ"],
            ["CUSTOMER_", "จัดการลูกค้า"],
            ["PRODUCT_", "เปลี่ยนวิธีส่งของ"],
            ["SAVE_PRODUCT", "บันทึกสินค้า"],
            ["IMPORT_CODES", "เติมสต็อก"],
            ["DELIVER_RESERVATION", "ส่งของพรีออเดอร์"],
            ["REVEAL_ORDER_CREDENTIALS", "เปิดดูรหัส"],
            ["SAVE_SETTINGS", "ตั้งค่าร้าน"],
          ]}
        />
      </div>
      <ErrorMessage message={list.error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ผู้ทำ</th>
              <th>การกระทำ</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {list.rows?.map((e) => {
              const link = entityLink(e);
              return (
                <tr key={e.id}>
                  <td className="nowrap">{dateTime(e.created_at)}</td>
                  <td>
                    {e.actor ?? "ระบบ"}
                    <small>{e.actor_role === "ADMIN" ? "แอดมิน" : e.actor_role === "STAFF" ? "ทีมงาน" : e.actor_role ? "ลูกค้า" : ""}</small>
                  </td>
                  <td>{actionText[e.action] ?? e.action}</td>
                  <td>
                    {link ? <Link to={link}>{shortId(e.entity_id!)}</Link> : e.entity_id ? shortId(e.entity_id) : "–"}
                    {e.detail && <small className="audit-detail">{JSON.stringify(e.detail)}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.rows === null && !list.error && <p className="reference-empty-text">กำลังโหลด…</p>}
        {list.rows?.length === 0 && <p className="reference-empty-text">ยังไม่มีรายการ</p>}
      </div>
      {list.rows && <MoreRow next={list.next} more={list.more} loading={list.loadingMore} count={list.rows.length} />}
    </>
  );
}

// ---------------------------------------------------------------- Settings: team (FR-S4)

type Member = { id: string; name: string; email: string; role: string; active: boolean; owner?: boolean; created_at: string };

type TeamRole = "ADMIN" | "STAFF" | "CUSTOMER";
const ROLE_ACTION: Record<TeamRole, string> = {
  ADMIN: "ให้สิทธิ์แอดมิน",
  STAFF: "ตั้งเป็นทีมงาน",
  CUSTOMER: "เปลี่ยนกลับเป็นลูกค้า",
};
const ROLE_DONE: Record<TeamRole, string> = {
  ADMIN: "เป็นแอดมินแล้ว",
  STAFF: "เป็นทีมงานแล้ว",
  CUSTOMER: "กลับเป็นลูกค้าแล้ว",
};

/** Grant back-office rights to an account that already exists (a customer who signed up).
 * Two clicks: pick the role, then confirm. Used on the team page and on customer detail. */
export function GrantAccess({ userId, name, onDone }: { userId: string; name: string; onDone?: () => void }) {
  const { toast } = useStore();
  const [pick, setPick] = useState<TeamRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function apply(role: TeamRole) {
    setBusy(true);
    setError("");
    try {
      await api("/admin/team/" + userId + "/role", { role });
      toast(name + " " + ROLE_DONE[role]);
      setPick(null);
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="admin-row-actions">
      {pick ? (
        <>
          <button className="button primary" disabled={busy} onClick={() => void apply(pick)}>
            ยืนยัน{ROLE_ACTION[pick]}
          </button>
          <button className="button ghost" onClick={() => setPick(null)}>
            ยกเลิก
          </button>
        </>
      ) : (
        <>
          <button className="button secondary" onClick={() => setPick("STAFF")}>
            ตั้งเป็นทีมงาน
          </button>
          <button className="button secondary" onClick={() => setPick("ADMIN")}>
            ให้สิทธิ์แอดมิน
          </button>
        </>
      )}
      <ErrorMessage message={error} />
    </span>
  );
}

type CustomerHit = { id: string; name: string; email: string; username: string | null; status?: string };
function PromoteCustomer({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      api<{ customers: CustomerHit[] }>("/admin/customers?limit=8&q=" + encodeURIComponent(term))
        .then((r) => {
          setHits(r.customers);
          setError("");
        })
        .catch((e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <section className="reference-admin-card admin-detail-card span-2">
      <h2>มอบสิทธิ์ให้ลูกค้าที่สมัครแล้ว</h2>
      <p className="field-help">
        ค้นหาด้วยชื่อ อีเมล หรือชื่อผู้ใช้ แล้วเลือกสิทธิ์ ลูกค้าใช้รหัสผ่านเดิมเข้าหลังบ้านได้ทันที ประวัติการซื้อและเครดิตยังอยู่ครบ
      </p>
      <label className="field">
        ค้นหาลูกค้า
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="อย่างน้อย 2 ตัวอักษร" maxLength={80} />
      </label>
      <ErrorMessage message={error} />
      {hits && hits.length === 0 && <p className="muted">ไม่พบลูกค้าที่ตรงกับคำค้น</p>}
      {hits?.map((c) => (
        <div className="settings-row" key={c.id}>
          <span>
            {c.name}
            <small>
              {c.email.endsWith(".local") ? (c.username ?? "—") : c.email}
              {c.status && c.status !== "ACTIVE" && " · ถูกระงับ"}
            </small>
          </span>
          <GrantAccess
            userId={c.id}
            name={c.name}
            onDone={() => {
              setHits((list) => list?.filter((x) => x.id !== c.id) ?? null);
              onDone();
            }}
          />
        </div>
      ))}
    </section>
  );
}

export function AdminTeam() {
  const { toast, user } = useStore();
  const [team, setTeam] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string; role: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Granting or removing admin rights is asked once more, like other irreversible-feeling actions.
  const [confirming, setConfirming] = useState<string | null>(null);
  const load = () =>
    api<{ team: Member[] }>("/admin/team")
      .then((r) => setTeam(r.team))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  useLive(["team"], () => void load());
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ member: Member; temporaryPassword: string }>("/admin/team", values);
      setCreated({ email: result.member.email, password: result.temporaryPassword, role: result.member.role });
      form.reset();
      toast(result.member.role === "ADMIN" ? "เพิ่มแอดมินแล้ว" : "เพิ่มทีมงานแล้ว");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(m: Member) {
    setError("");
    try {
      await api("/admin/team/" + m.id + "/active", { active: !m.active });
      toast(m.active ? "ปิดบัญชีแล้ว" : "เปิดบัญชีแล้ว");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function changeRole(m: Member, role: TeamRole) {
    setConfirming(null);
    setError("");
    try {
      await api("/admin/team/" + m.id + "/role", { role });
      toast(m.name + " " + ROLE_DONE[role]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const locked = (m: Member) => m.id === user?.id || !!m.owner;
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>ทีมงาน</h1>
          <p>
            แอดมินทำได้ทุกอย่าง รวมถึงการเงินและเพิ่มแอดมินคนอื่น · ทีมงานตอบแชท ดูออเดอร์ ส่งของพรีออเดอร์ และดูลูกค้าได้
            แต่ไม่เห็นการเงิน ตั้งค่า และแก้สินค้าไม่ได้
          </p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="admin-detail-grid">
        <section className="reference-admin-card admin-detail-card">
          <h2>สมาชิก</h2>
          {!team && <p className="muted">กำลังโหลด…</p>}
          {team?.map((m) => (
            <div className="settings-row" key={m.id}>
              <span>
                {m.name} {m.id === user?.id && <span className="admin-chip">ฉัน</span>}
                <small>
                  {m.email} · {m.owner ? "เจ้าของร้าน" : m.role === "ADMIN" ? "แอดมิน" : "ทีมงาน"}
                  {!m.active && " · ปิดอยู่"}
                </small>
              </span>
              {!locked(m) && (
                <span className="admin-row-actions">
                  {confirming?.startsWith(m.id + ":") ? (
                    <>
                      <button
                        className="button primary"
                        onClick={() => void changeRole(m, confirming.split(":")[1] as TeamRole)}
                      >
                        ยืนยัน{ROLE_ACTION[confirming.split(":")[1] as TeamRole]}
                      </button>
                      <button className="button ghost" onClick={() => setConfirming(null)}>
                        ยกเลิก
                      </button>
                    </>
                  ) : (
                    <>
                      {m.active && (
                        <button
                          className="button secondary"
                          onClick={() => setConfirming(m.id + ":" + (m.role === "ADMIN" ? "STAFF" : "ADMIN"))}
                        >
                          {m.role === "ADMIN" ? "ลดเป็นทีมงาน" : "ให้สิทธิ์แอดมิน"}
                        </button>
                      )}
                      {m.active && (
                        <button className="button ghost" onClick={() => setConfirming(m.id + ":CUSTOMER")}>
                          กลับเป็นลูกค้า
                        </button>
                      )}
                      <button className={"button " + (m.active ? "ghost" : "secondary")} onClick={() => void toggle(m)}>
                        {m.active ? "ปิดบัญชี" : "เปิดบัญชี"}
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          ))}
        </section>
        <section className="reference-admin-card admin-detail-card">
          <h2>เพิ่มแอดมินหรือทีมงาน</h2>
          <form onSubmit={add} className="admin-form-grid">
            <label className="field span-2">
              ชื่อ
              <input name="name" required minLength={2} maxLength={60} />
            </label>
            <label className="field span-2">
              อีเมลสำหรับเข้าสู่ระบบ
              <input name="email" type="email" required maxLength={160} />
            </label>
            <label className="field span-2">
              สิทธิ์
              <select name="role" defaultValue="STAFF">
                <option value="STAFF">ทีมงาน (ไม่เห็นการเงิน)</option>
                <option value="ADMIN">แอดมิน (ทำได้ทุกอย่าง)</option>
              </select>
            </label>
            <button className="button primary span-2" disabled={busy}>
              เพิ่มบัญชี
            </button>
          </form>
          {created && (
            <div className="admin-temp-password">
              <p>
                ส่งข้อมูลนี้ให้{created.role === "ADMIN" ? "แอดมินคนใหม่" : "ทีมงาน"} (แสดงครั้งเดียว)
                แล้วให้เปลี่ยนรหัสผ่านหลังเข้าสู่ระบบ
              </p>
              <span>อีเมล: {created.email}</span>
              <code>{created.password}</code>
            </div>
          )}
        </section>
        <PromoteCustomer onDone={() => void load()} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- STAFF back office

type QueueRow = {
  id: string;
  queue_number: number;
  status: string;
  total: number;
  quantity: number;
  created_at: string;
  customer: string;
  product: string;
  label: string;
};

/** FR-O8: preorder queue for admin and team — filter by product, deliver one or many in queue order. */
export function PreorderQueue() {
  const { toast } = useStore();
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState("");
  // Delivery sends the account and cannot be undone, so every send asks once more.
  const [confirming, setConfirming] = useState<string | null>(null);
  const load = () =>
    api<{ queue: QueueRow[] }>("/queue")
      .then((r) => setQueue(r.queue))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  useLive(["orders", "catalog"], () => {
    if (!busy) void load();
  });
  const waiting = (queue ?? [])
    .filter((q) => q.status === "PREORDER")
    .sort((x, y) => x.queue_number - y.queue_number);
  const products = Array.from(new Set(waiting.map((q) => q.product))).sort();
  const shown = waiting.filter((q) => !product || q.product === product);
  const toggle = (id: string) =>
    setPicked((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = shown.length > 0 && shown.every((q) => picked.has(q.id));
  async function deliver(items: QueueRow[]) {
    setBusy(true);
    setError("");
    let done = 0;
    try {
      // In queue order; stop at the first failure (usually stock ran out) so nobody is skipped.
      for (const item of items) {
        setProgress(`กำลังส่งคิว #${item.queue_number} (${done + 1}/${items.length})`);
        await api("/admin/reservations/" + item.id + "/deliver", {});
        done++;
      }
      toast(items.length === 1 ? `ส่งของคิว #${items[0].queue_number} แล้ว` : `ส่งของแล้ว ${done} คิว`);
    } catch (e) {
      setError((done ? `ส่งแล้ว ${done} คิว แล้วหยุดที่คิว #${items[done].queue_number}: ` : "") + (e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
      setConfirming(null);
      setPicked(new Set());
      await load();
    }
  }
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>คิวพรีออเดอร์</h1>
          <p>เลขคิวออกเมื่อลูกค้าชำระเงิน ส่งของตามลำดับคิว ระบบดึง ID และรหัสผ่านจากสต็อกของตัวเลือกนั้นให้อัตโนมัติ</p>
        </div>
      </div>
      <div className="admin-filters">
        <Select
          label="สินค้า"
          value={product}
          onChange={(value) => {
            setProduct(value);
            setPicked(new Set());
          }}
          options={[["", "ทุกสินค้า"], ...products.map((p) => [p, p] as [string, string])]}
        />
        <span className="muted">รอส่ง {shown.length} คิว</span>
        {picked.size > 0 &&
          (confirming === "batch" ? (
            <span className="queue-confirm">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void deliver(shown.filter((q) => picked.has(q.id)))}
              >
                <Package size={15} />
                ยืนยันส่ง {picked.size} คิว
              </button>
              <button className="button secondary" disabled={busy} onClick={() => setConfirming(null)}>
                ยกเลิก
              </button>
            </span>
          ) : (
            <button className="button primary" disabled={busy} onClick={() => setConfirming("batch")}>
              <Package size={15} />
              ส่งที่เลือก {picked.size} คิว
            </button>
          ))}
      </div>
      {progress && <p className="admin-callout">{progress}</p>}
      <ErrorMessage message={error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="เลือกทุกคิวที่แสดง"
                  checked={allPicked}
                  disabled={busy || !shown.length}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((q) => q.id)))}
                />
              </th>
              <th>คิว</th>
              <th>ลูกค้า</th>
              <th>สินค้า</th>
              <th>ชำระเมื่อ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((q) => (
              <tr key={q.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={"เลือกคิว #" + q.queue_number}
                    checked={picked.has(q.id)}
                    disabled={busy}
                    onChange={() => toggle(q.id)}
                  />
                </td>
                <td>
                  <Link to={"/admin/orders/" + q.id} className="order-number">
                    #{q.queue_number}
                  </Link>
                </td>
                <td>{q.customer}</td>
                <td>
                  {q.product}
                  <small>
                    {q.label} · {q.quantity} ชิ้น
                  </small>
                </td>
                <td className="nowrap">{dateTime(q.created_at)}</td>
                <td>
                  {confirming === q.id ? (
                    <span className="queue-confirm">
                      <button className="button primary" disabled={busy} onClick={() => void deliver([q])}>
                        ยืนยันส่งคิว #{q.queue_number}
                      </button>
                      <button className="button secondary" disabled={busy} onClick={() => setConfirming(null)}>
                        ยกเลิก
                      </button>
                    </span>
                  ) : (
                    <button className="button secondary" disabled={busy} onClick={() => setConfirming(q.id)}>
                      ส่งของ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {queue && !shown.length && <p className="reference-empty-text">ไม่มีคิวรอส่ง</p>}
        {!queue && !error && <p className="reference-empty-text">กำลังโหลดคิว…</p>}
      </div>
    </>
  );
}

/** Team members (STAFF): chat, orders, preorder queue, customers (no money), own account. */
export function StaffBackOffice({ tab, sub, detailId }: { tab: string; sub: string; detailId?: string }) {
  if (tab === "chat" || tab === "") return <AdminChatLazy />;
  if (tab === "orders") return detailId ? <AdminOrderDetail id={detailId} /> : <AdminOrders />;
  if (tab === "preorders") return <PreorderQueue />;
  if (tab === "customers") return detailId ? <AdminCustomerDetail id={detailId} /> : <AdminCustomers />;
  if (sub === "settings/account") return <AdminAccount />;
  return (
    <section className="reference-admin-card editor-panel">
      <h1>ไม่มีสิทธิ์เข้าหน้านี้</h1>
      <p>บัญชีทีมงานใช้ได้เฉพาะแชท ออเดอร์ คิวพรีออเดอร์ และลูกค้า</p>
      <Link to="/admin/chat" className="button primary">
        ไปที่แชท
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------- Product variants + stock (FR-P2, FR-P7)

type Variant = {
  id: string;
  label: string;
  price: number;
  active: boolean;
  sort_order: number;
  stock: number;
  stockStatus: "out" | "low" | "in";
};
type StockUnit = {
  id: string;
  status: "available" | "sold" | "defective";
  loginIdMasked?: string;
  codeMasked?: string;
  created_at: string;
  sold_at?: string | null;
  order_id?: string | null;
  reservation_id?: string | null;
  defective_reason?: string | null;
};

function VariantStock({ variant, onChanged }: { variant: Variant; onChanged: () => void }) {
  const { toast } = useStore();
  const [status, setStatus] = useState("available");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useCursorList<StockUnit>(
    "/admin/variants/" + variant.id + "/inventory",
    "inventory",
    { status, limit: "50" },
    ["catalog", "orders"],
  );
  // Excel/Sheets paste uses tabs; "id:password" and "id password" also accepted.
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^\t,:\s]+)[\t,:\s]+(.+)$/);
      return match ? { loginId: match[1], password: match[2].trim() } : null;
    });
  const bad = rows.filter((r) => !r).length;
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!rows.length || bad) return;
    setBusy(true);
    setError("");
    try {
      await api("/admin/inventory", { variantId: variant.id, items: rows });
      toast("เติมสต็อก " + rows.length + " บัญชีแล้ว");
      setText("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function defect(unit: StockUnit) {
    const reason = prompt("เหตุผลที่บัญชีนี้ใช้ไม่ได้");
    if (!reason) return;
    try {
      await api("/admin/inventory/" + unit.id + "/defect", { reason });
      toast("ทำเครื่องหมายว่าเสียแล้ว");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove(unit: StockUnit) {
    if (!confirm("ลบบัญชีนี้ออกจากสต็อก?")) return;
    try {
      await api("/admin/inventory/" + unit.id, {}, "DELETE");
      toast("ลบออกจากสต็อกแล้ว");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="variant-stock">
      <form onSubmit={add} className="variant-stock-add">
        <label className="field">
          เติมสต็อก: ID และรหัสผ่าน บรรทัดละ 1 บัญชี
          <textarea
            aria-label={"เติมสต็อก " + variant.label}
            rows={4}
            placeholder={"user1@mail.com,password1\nuser2@mail.com,password2"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <p className="field-help">
          วางจาก Excel ได้ (2 คอลัมน์) · คั่นด้วย , หรือ : ก็ได้ · รหัสผ่านเก็บแบบเข้ารหัส ลูกค้าเห็นหลังจ่ายเงินเท่านั้น
          {rows.length > 0 && !bad && ` · พร้อมเติม ${rows.length} บัญชี`}
          {bad > 0 && <strong className="danger-text"> · {bad} บรรทัดไม่มีรหัสผ่าน</strong>}
        </p>
        <ErrorMessage message={error} />
        <button className="button primary" disabled={busy || !rows.length || bad > 0}>
          <Plus size={15} />
          เติม {rows.length || ""} บัญชี
        </button>
      </form>
      <div className="variant-stock-list">
        <div className="reference-status-tabs" role="group" aria-label="สถานะสต็อก">
          {[
            ["available", "พร้อมขาย"],
            ["sold", "ขายแล้ว"],
            ["defective", "เสีย"],
          ].map(([key, label]) => (
            <button key={key} type="button" className={status === key ? "active" : ""} onClick={() => setStatus(key)}>
              {label}
            </button>
          ))}
        </div>
        {list.rows?.length === 0 && <p className="muted">ไม่มีรายการ</p>}
        {list.rows?.map((u) => (
          <div className="settings-row" key={u.id}>
            <span>
              <code>{u.loginIdMasked ?? u.codeMasked ?? "•••"}</code>
              <small>
                เติมเมื่อ {dateTime(u.created_at)}
                {u.sold_at && " · ขาย " + dateTime(u.sold_at)}
                {(u.order_id || u.reservation_id) && (
                  <>
                    {" · "}
                    <Link to={"/admin/orders/" + (u.order_id ?? u.reservation_id)}>ออเดอร์</Link>
                  </>
                )}
                {u.defective_reason && " · " + u.defective_reason}
              </small>
            </span>
            {u.status === "available" && (
              <span className="admin-action-row">
                <button type="button" className="button ghost" onClick={() => void defect(u)}>
                  เสีย
                </button>
                <button type="button" className="button ghost" onClick={() => void remove(u)}>
                  ลบ
                </button>
              </span>
            )}
            {u.status === "sold" && (
              <button type="button" className="button ghost" onClick={() => void defect(u)}>
                แจ้งเสีย
              </button>
            )}
          </div>
        ))}
        {list.next && (
          <button type="button" className="button secondary" onClick={list.more}>
            โหลดเพิ่ม
          </button>
        )}
      </div>
    </div>
  );
}

export function VariantManager({ productId, preorder }: { productId: string; preorder: boolean }) {
  const { toast } = useStore();
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api<{ variants: Variant[] }>("/admin/products/" + productId + "/variants")
      .then((r) => setVariants(r.variants))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  useLive(["catalog", "orders"], () => void load());
  const baht = (value: FormDataEntryValue | null) => Math.round(Number(value ?? 0) * 100);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      await api("/admin/products/" + productId + "/variants", { label: data.get("label"), price: baht(data.get("price")) });
      toast("เพิ่มตัวเลือกแล้ว");
      form.reset();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function update(v: Variant, patch: Partial<Variant>) {
    try {
      await api("/admin/variants/" + v.id, patch, "PATCH");
      toast("บันทึกตัวเลือกแล้ว");
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove(v: Variant) {
    if (!confirm("ลบตัวเลือก " + v.label + "? ถ้าเคยมีออเดอร์ ระบบจะให้ปิดแทน")) return;
    try {
      await api("/admin/variants/" + v.id, {}, "DELETE");
      toast("ลบตัวเลือกแล้ว");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <section className="reference-admin-card editor-panel variant-manager">
      <h2>ตัวเลือก ราคา และสต็อก</h2>
      <p className="field-help">
        {preorder
          ? "สินค้าพรีออเดอร์: ลูกค้าจ่ายแล้วได้คิว เติมสต็อกเมื่อของพร้อม แล้วกดส่งในคิวพรีออเดอร์"
          : "ลูกค้าจ่ายแล้วได้ ID และรหัสผ่านจากสต็อกของตัวเลือกนั้นทันที สต็อกหมดหน้าร้านขึ้นว่าหมดเอง"}
      </p>
      <ErrorMessage message={error} />
      {variants?.map((v) => (
        <div className={"variant-row" + (v.active ? "" : " inactive")} key={v.id}>
          {editing === v.id ? (
            <form
              className="variant-edit"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void update(v, { label: String(data.get("label")), price: baht(data.get("price")) });
              }}
            >
              <input name="label" aria-label="ชื่อตัวเลือก" defaultValue={v.label} required maxLength={80} />
              <input name="price" aria-label="ราคา (บาท)" type="number" min="1" step="0.01" defaultValue={v.price / 100} required />
              <button className="button primary">บันทึก</button>
              <button type="button" className="button ghost" onClick={() => setEditing(null)}>
                ยกเลิก
              </button>
            </form>
          ) : (
            <div className="variant-summary">
              <span>
                <strong>{v.label}</strong>
                <small>
                  {money(v.price)} · {v.active ? "เปิดขาย" : "ปิดอยู่"}
                </small>
              </span>
              <button
                type="button"
                className={"stock-link stock-" + v.stockStatus}
                aria-expanded={open === v.id}
                onClick={() => setOpen(open === v.id ? null : v.id)}
              >
                สต็อก {v.stock} {open === v.id ? "▲" : "▼"}
              </button>
              <span className="admin-action-row">
                <button type="button" className="button ghost" onClick={() => setEditing(v.id)}>
                  แก้
                </button>
                <button type="button" className="button ghost" onClick={() => void update(v, { active: !v.active })}>
                  {v.active ? "ปิด" : "เปิด"}
                </button>
                <button type="button" className="button ghost" onClick={() => void remove(v)}>
                  ลบ
                </button>
              </span>
            </div>
          )}
          {open === v.id && <VariantStock variant={v} onChanged={() => void load()} />}
        </div>
      ))}
      <form className="variant-edit variant-new" onSubmit={create}>
        <input name="label" aria-label="ชื่อตัวเลือกใหม่" placeholder="ชื่อตัวเลือก เช่น 30 วัน จอส่วนตัว" required maxLength={80} />
        <input name="price" aria-label="ราคาตัวเลือกใหม่ (บาท)" type="number" min="1" step="0.01" placeholder="ราคา (บาท)" required />
        <button className="button secondary">
          <Plus size={15} />
          เพิ่มตัวเลือก
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- Reports (FR-R)

type SalesRow = { product_id: string; product: string; variant_id: string; variant: string; preorder: boolean; orders: number; units: number; revenue: number };
type DayRow = { day: string; orders: number; units: number; revenue: number; buyers: number };
type SalesReport = {
  totals: { orders: number; units: number; revenue: number; buyers: number; refunds: number; net: number };
  byProduct: SalesRow[];
  byDay: DayRow[];
};

export function AdminReports() {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: bangkokDay(29), to: bangkokDay(0) });
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useLive(["orders"], () => setTick((n) => n + 1));
  useEffect(() => {
    api<SalesReport>("/admin/reports/sales" + query(range))
      .then((r) => {
        setReport(r);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [range.from, range.to, tick]);
  const presets: [string, string, string][] = [
    ["วันนี้", bangkokDay(0), bangkokDay(0)],
    ["7 วัน", bangkokDay(6), bangkokDay(0)],
    ["30 วัน", bangkokDay(29), bangkokDay(0)],
    ["เดือนนี้", bangkokDay(0).slice(0, 8) + "01", bangkokDay(0)],
    ["ทั้งหมด", "", ""],
  ];
  const peak = Math.max(1, ...(report?.byDay ?? []).map((d) => d.revenue));
  const exportCsv = () =>
    report &&
    downloadCsv("sales-report.csv", [
      ["สินค้า", "ตัวเลือก", "ประเภท", "ออเดอร์", "ชิ้น", "ยอดขาย (บาท)"],
      ...report.byProduct.map((r) => [r.product, r.variant, r.preorder ? "พรีออเดอร์" : "พร้อมส่ง", r.orders, r.units, (r.revenue / 100).toFixed(2)]),
      [],
      ["วัน", "ออเดอร์", "ชิ้น", "ผู้ซื้อ", "ยอดขาย (บาท)"],
      ...report.byDay.map((d) => [d.day, d.orders, d.units, d.buyers, (d.revenue / 100).toFixed(2)]),
    ]);
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>รายงานยอดขาย</h1>
          <p>นับเฉพาะออเดอร์ที่ชำระสำเร็จ · เวลาไทย · ยอดสุทธิหักคืนเงินแล้ว</p>
        </div>
        <button className="button secondary" onClick={exportCsv} disabled={!report}>
          <Download size={15} />
          ดาวน์โหลด CSV
        </button>
      </div>
      <div className="admin-filters">
        <div className="reference-status-tabs" role="group" aria-label="ช่วงรายงาน">
          {presets.map(([label, from, to]) => (
            <button key={label} className={range.from === from && range.to === to ? "active" : ""} onClick={() => setRange({ from, to })}>
              {label}
            </button>
          ))}
        </div>
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </div>
      <ErrorMessage message={error} />
      <div className="admin-stat-row">
        {[
          ["ยอดขาย", report ? money(report.totals.revenue) : "–"],
          ["ยอดสุทธิ (หักคืนเงิน)", report ? money(report.totals.net) : "–"],
          ["ออเดอร์ที่ชำระ", report ? String(report.totals.orders) : "–"],
          ["ผู้ซื้อ", report ? String(report.totals.buyers) : "–"],
        ].map(([label, value]) => (
          <div className="reference-admin-card" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="admin-detail-grid">
        <section className="reference-admin-card admin-detail-card">
          <h2>ยอดขายตามสินค้า</h2>
          {report?.byProduct.length === 0 && <p className="muted">ยังไม่มียอดขายในช่วงนี้</p>}
          {report?.byProduct.map((r) => (
            <div className="report-bar-row" key={r.variant_id}>
              <span>
                <Link to={"/admin/products/" + r.product_id}>{r.product}</Link>
                <small>
                  {r.variant} · {r.units} ชิ้น · {r.orders} ออเดอร์{r.preorder ? " · พรีออเดอร์" : ""}
                </small>
              </span>
              <strong>{money(r.revenue)}</strong>
              <i style={{ width: (r.revenue / Math.max(1, report.byProduct[0].revenue)) * 100 + "%" }} />
            </div>
          ))}
        </section>
        <section className="reference-admin-card admin-detail-card">
          <h2>ยอดขายรายวัน</h2>
          {report?.byDay.length === 0 && <p className="muted">ยังไม่มียอดขายในช่วงนี้</p>}
          {report?.byDay
            .slice()
            .reverse()
            .map((d) => (
              <div className="report-bar-row" key={d.day}>
                <span>
                  {new Date(d.day + "T12:00:00+07:00").toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" })}
                  <small>
                    {d.orders} ออเดอร์ · {d.buyers} ผู้ซื้อ
                  </small>
                </span>
                <strong>{money(d.revenue)}</strong>
                <i style={{ width: (d.revenue / peak) * 100 + "%" }} />
              </div>
            ))}
        </section>
      </div>
      <BuyerRankingInline />
    </>
  );
}

// ---------------------------------------------------------------- Product live preview

export type ProductDraft = {
  name: string;
  description: string;
  category: string;
  preorder: boolean;
  active: boolean;
  featured: boolean;
  art: string;
  imageUrl?: string | null;
  variants: { id: string; label: string; price: number; stock: number }[];
};

/** How the product will look on the storefront, updated as the admin types. */
export function ProductPreview({ draft, categoryName }: { draft: ProductDraft; categoryName: string }) {
  const [selected, setSelected] = useState(0);
  const variants = draft.variants.length ? draft.variants : [{ id: "draft", label: "ตัวเลือกแรก", price: 0, stock: 0 }];
  const variant = variants[Math.min(selected, variants.length - 1)];
  const prices = variants.map((v) => v.price).filter((p) => p > 0);
  const low = prices.length ? Math.min(...prices) : 0;
  const high = prices.length ? Math.max(...prices) : 0;
  const available = draft.preorder || variant.stock > 0;
  const stockText = draft.preorder ? "สั่งจอง" : variant.stock <= 0 ? "สินค้าหมด" : variant.stock <= 3 ? "เหลือน้อย" : "มีสินค้า";
  return (
    <div className="product-preview">
      <div className="product-preview-bar">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>ตัวอย่างบนหน้าร้าน</span>
        <span className={"product-preview-state" + (draft.active ? " on" : "")}>{draft.active ? "เปิดขาย" : "ฉบับร่าง · ลูกค้ายังไม่เห็น"}</span>
      </div>
      <div className="product-preview-body">
        <small className="product-preview-label">การ์ดในหน้ารายการสินค้า</small>
        <article className="product-preview-card">
          <div className="product-preview-art">
            {draft.imageUrl ? (
              <img src={draft.imageUrl} alt="" className="product-preview-img" />
            ) : (
              <Art small type={draft.art} name={draft.name || "สินค้า"} />
            )}
          </div>
          <div>
            {draft.preorder && <span className="product-preview-pill">สั่งจอง</span>}
            <strong>{draft.name || "ชื่อสินค้า"}</strong>
            <span>
              {low ? money(low) : "฿–"}
              {high > low && " – " + money(high)}
            </span>
          </div>
        </article>
        <small className="product-preview-label">หน้าสินค้า</small>
        <section className="product-preview-page">
          <span className="product-preview-category">{categoryName}</span>
          <h3>{draft.name || "ชื่อสินค้า"}</h3>
          <div className="product-preview-price">{variant.price ? money(variant.price) : "฿–"}</div>
          {draft.preorder && <p className="product-preview-note">ชำระแล้วได้เลขคิวทันที ร้านส่ง ID และรหัสผ่านตามลำดับคิว</p>}
          <div className="product-preview-variants">
            {variants.map((v, i) => (
              <button
                type="button"
                key={v.id}
                className={i === Math.min(selected, variants.length - 1) ? "selected" : ""}
                onClick={() => setSelected(i)}
              >
                <span>{v.label}</span>
                <b>{v.price ? money(v.price) : "฿–"}</b>
              </button>
            ))}
          </div>
          <div className="product-preview-buy">
            <span className={"product-preview-stock" + (available ? "" : " out")}>{stockText}</span>
            <span className={"product-preview-cta" + (available ? "" : " disabled")}>{draft.preorder ? "จองเลย" : "ซื้อเลย"}</span>
          </div>
          <p className="product-preview-desc">{draft.description || "รายละเอียดสินค้าจะแสดงตรงนี้"}</p>
        </section>
        {draft.featured && <p className="product-preview-hint">★ แสดงในส่วน "สินค้าแนะนำ" บนหน้าแรก</p>}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------- Product images (W5 uploads UI)

type ProductImage = { id: string; url: string };

/** Upload, reorder and remove product images; the first is the cover. Shown once the API exists. */
export function ProductImages({ productId, images }: { productId: string; images: ProductImage[] }) {
  const { toast } = useStore();
  const [list, setList] = useState<ProductImage[]>(images);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Server list changes (live refresh) replace ours; compare ids, not the array object.
  const serverKey = images.map((x) => x.id).join(",");
  useEffect(() => setList(images), [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const MAX = 8;
  async function add(files: FileList | File[]) {
    setError("");
    const picked = Array.from(files).slice(0, MAX - list.length);
    if (!picked.length) return setError("สินค้าหนึ่งชิ้นมีรูปได้สูงสุด " + MAX + " รูป");
    for (const [i, file] of picked.entries()) {
      const problem = checkSource(file);
      if (problem) {
        setError(file.name + ": " + problem);
        continue;
      }
      try {
        setBusy(`กำลังอัปโหลด ${i + 1}/${picked.length}`);
        const blob = await toWebp(file, 1200);
        const { image } = await uploadImage<{ image: ProductImage }>("/admin/products/" + productId + "/images", blob);
        setList((current) => [...current, image]);
      } catch (e) {
        setError(file.name + ": " + (e as Error).message);
      }
    }
    setBusy("");
    toast("อัปโหลดรูปแล้ว");
  }
  async function move(index: number, by: number) {
    const next = list.slice();
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setList(next);
    try {
      await api("/admin/products/" + productId + "/images", { order: next.map((x) => x.id) }, "PATCH");
    } catch (e) {
      setError((e as Error).message);
      setList(list);
    }
  }
  async function remove(image: ProductImage) {
    if (!confirm("ลบรูปนี้?")) return;
    try {
      await api("/admin/product-images/" + image.id, {}, "DELETE");
      setList((current) => current.filter((x) => x.id !== image.id));
      toast("ลบรูปแล้ว");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="reference-admin-card editor-panel product-images">
      <h2>รูปสินค้า</h2>
      <p className="field-help">รูปแรกเป็นรูปปกในหน้ารายการสินค้า · สูงสุด {MAX} รูป · JPG, PNG, WebP · ระบบย่อรูปให้อัตโนมัติ</p>
      <div className="product-image-grid">
        {list.map((image, i) => (
          <figure key={image.id} className={i === 0 ? "cover" : ""}>
            <img src={image.url} alt={"รูปที่ " + (i + 1)} />
            {i === 0 && <span className="product-image-badge">ปก</span>}
            <figcaption>
              <button type="button" className="icon-button" aria-label="เลื่อนไปทางซ้าย" disabled={i === 0} onClick={() => void move(i, -1)}>
                ‹
              </button>
              <button type="button" className="icon-button" aria-label="ลบรูป" onClick={() => void remove(image)}>
                ×
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="เลื่อนไปทางขวา"
                disabled={i === list.length - 1}
                onClick={() => void move(i, 1)}
              >
                ›
              </button>
            </figcaption>
          </figure>
        ))}
        {list.length < MAX && (
          <button
            type="button"
            className={"product-image-drop" + (over ? " over" : "")}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void add(e.dataTransfer.files);
            }}
            disabled={!!busy}
          >
            <Plus size={18} />
            {busy || "เพิ่มรูป หรือลากไฟล์มาวาง"}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        aria-label="เลือกรูปสินค้า"
        onChange={(e) => {
          if (e.target.files) void add(e.target.files);
          e.target.value = "";
        }}
      />
      <ErrorMessage message={error} />
    </section>
  );
}
