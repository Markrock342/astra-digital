// Server-filtered admin tables (FR-O2–O4, O9, C1–C6, P1). Layout follows the
// shadcn/ui "Tasks" data-table example (MIT): filter bar → table → load more.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Download,
  Eye,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  ShieldBan,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useLive, type LiveTopic } from "./live";
import { AdminChat as AdminChatLazy } from "./Ops";
import { Art, ErrorMessage, Link, Status, useStore } from "./App";
import { api, dateTime, money } from "./api";

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
};

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
                      </li>
                    ))}
                    {shown!.codes.map((c, i) => (
                      <li key={"k" + i}>
                        <span>โค้ด</span>
                        <code>{c}</code>
                      </li>
                    ))}
                  </ul>
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
  const { toast, user } = useStore();
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

type Member = { id: string; name: string; email: string; role: string; active: boolean; created_at: string };

export function AdminTeam() {
  const { toast, user } = useStore();
  const [team, setTeam] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
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
      setCreated({ email: result.member.email, password: result.temporaryPassword });
      form.reset();
      toast("เพิ่มทีมงานแล้ว");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(m: Member) {
    try {
      await api("/admin/team/" + m.id + "/active", { active: !m.active });
      toast(m.active ? "ปิดบัญชีทีมงานแล้ว" : "เปิดบัญชีทีมงานแล้ว");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>ทีมงาน</h1>
          <p>ทีมงานตอบแชท ดูออเดอร์ ส่งของพรีออเดอร์ และดูลูกค้าได้ · ไม่เห็นการเงิน ตั้งค่า และแก้สินค้าไม่ได้</p>
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
                  {m.email} · {m.role === "ADMIN" ? "แอดมิน (เจ้าของ)" : "ทีมงาน"}
                  {!m.active && " · ปิดอยู่"}
                </small>
              </span>
              {m.role === "STAFF" && (
                <button className={"button " + (m.active ? "ghost" : "secondary")} onClick={() => void toggle(m)}>
                  {m.active ? "ปิดบัญชี" : "เปิดบัญชี"}
                </button>
              )}
            </div>
          ))}
        </section>
        <section className="reference-admin-card admin-detail-card">
          <h2>เพิ่มทีมงาน</h2>
          <form onSubmit={add} className="admin-form-grid">
            <label className="field span-2">
              ชื่อ
              <input name="name" required minLength={2} maxLength={60} />
            </label>
            <label className="field span-2">
              อีเมลสำหรับเข้าสู่ระบบ
              <input name="email" type="email" required maxLength={160} />
            </label>
            <button className="button primary span-2" disabled={busy}>
              เพิ่มทีมงาน
            </button>
          </form>
          {created && (
            <div className="admin-temp-password">
              <p>ส่งข้อมูลนี้ให้ทีมงาน (แสดงครั้งเดียว) แล้วให้เปลี่ยนรหัสผ่านหลังเข้าสู่ระบบ</p>
              <span>อีเมล: {created.email}</span>
              <code>{created.password}</code>
            </div>
          )}
        </section>
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

function StaffQueue() {
  const { toast } = useStore();
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () =>
    api<{ queue: QueueRow[] }>("/queue")
      .then((r) => setQueue(r.queue))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  useLive(["orders", "catalog"], () => void load());
  async function deliver(item: QueueRow) {
    setBusy(item.id);
    setError("");
    try {
      await api("/admin/reservations/" + item.id + "/deliver", {});
      toast("ส่งของคิว #" + item.queue_number + " แล้ว");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const waiting = (queue ?? []).filter((q) => q.status === "PREORDER");
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>คิวพรีออเดอร์</h1>
          <p>ส่งของตามลำดับคิว ระบบดึง ID และรหัสผ่านจากสต็อกให้อัตโนมัติ (แอดมินต้องเติมสต็อกก่อน)</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>คิว</th>
              <th>ลูกค้า</th>
              <th>สินค้า</th>
              <th>วันที่</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {waiting.map((q) => (
              <tr key={q.id}>
                <td>
                  <strong>#{q.queue_number}</strong>
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
                  <button className="button primary" disabled={!!busy} onClick={() => void deliver(q)}>
                    {busy === q.id ? "กำลังส่ง…" : "ส่งของ"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {queue && !waiting.length && <p className="reference-empty-text">ไม่มีคิวรอส่ง</p>}
      </div>
    </>
  );
}

/** Team members (STAFF): chat, orders, preorder queue, customers (no money), own account. */
export function StaffBackOffice({ tab, sub, detailId }: { tab: string; sub: string; detailId?: string }) {
  if (tab === "chat" || tab === "") return <AdminChatLazy />;
  if (tab === "orders") return detailId ? <AdminOrderDetail id={detailId} /> : <AdminOrders />;
  if (tab === "preorders") return <StaffQueue />;
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
