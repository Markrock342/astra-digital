// Server-filtered admin tables (FR-O2–O4, O9, C1–C6, P1). Layout follows the
// shadcn/ui "Tasks" data-table example (MIT): filter bar → table → load more.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Copy,
  Download,
  Eye,
  LoaderCircle,
  LogOut,
  Minus,
  Package,
  Plus,
  RotateCcw,
  X,
  Search,
  ShieldBan,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useLive, type LiveTopic } from "./live";
import { AdminChat as AdminChatLazy, BuyerRankingCard as BuyerRankingInline } from "./Ops";
import { Art, ErrorMessage, Link, Status, ledgerTypeText, useStore } from "./App";
import { SessionsCard } from "./Sessions";
import { Change, TestMoneyBanner } from "./AdminDashboard";
import { api, dateTime, money } from "./api";
import { checkSource, toWebp, uploadImage } from "./image-upload";
import {
  ORDER_TABS,
  OrderActivity,
  OrderNotes,
  OrderStatusTabs,
  ReplacementHistory,
  type ActivityEvent,
  type OrderCounts,
  type OrderNoteItem,
  type OrderTab,
  type ReplacementItem,
} from "./OrderHistory";
import { StockImport } from "./StockImport";
import { CopyValue, ResendCredentials } from "./OrderCredentials";
import { WarrantyStatus } from "./Warranty";

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
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
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
        setMeta(data);
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
  return { rows, next, error, more, loadingMore, meta };
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

const emptyOrderFilters = { q: "", type: "", from: "", to: "" };
const ORDER_LIST_QUERY = "astra-admin-orders-query";

/** Tab + filters live in the URL so reload and back keep them. */
function readOrderUrl(defaultTab: OrderTab): { tab: OrderTab; filters: Filters } {
  const params = new URLSearchParams(location.search);
  const raw = params.get("tab") as OrderTab | null;
  const tab = raw && ORDER_TABS.includes(raw) ? raw : defaultTab;
  const filters: Filters = { ...emptyOrderFilters };
  for (const key of Object.keys(emptyOrderFilters)) filters[key] = params.get(key) ?? "";
  return { tab, filters };
}

/** Where the order detail "back" link returns to (same tab and filters). */
export function ordersListHref() {
  try {
    return "/admin/orders" + (sessionStorage.getItem(ORDER_LIST_QUERY) ?? "");
  } catch {
    return "/admin/orders";
  }
}

export function AdminOrders() {
  const { go, user } = useStore();
  const staff = user?.role === "STAFF";
  const defaultTab: OrderTab = staff ? "todo" : "all";
  const [initial] = useState(() => readOrderUrl(defaultTab));
  const [tab, setTab] = useState<OrderTab>(initial.tab);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [exporting, setExporting] = useState(false);
  const serverFilters: Filters = { ...filters, group: tab === "all" ? "" : tab };
  const list = useCursorList<OrderRow>("/admin/orders", "orders", { ...serverFilters, limit: "50" }, ["orders"]);
  const counts = (list.meta?.counts as OrderCounts | undefined) ?? null;
  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch }));
  const active = Object.values(filters).some(Boolean);
  useEffect(() => {
    const search = query({ ...filters, tab: tab === defaultTab ? "" : tab });
    if (location.pathname === "/admin/orders" && location.search !== search)
      history.replaceState(history.state, "", "/admin/orders" + search);
    try {
      sessionStorage.setItem(ORDER_LIST_QUERY, search);
    } catch {
      // private mode: the back link just opens the default view
    }
  }, [filters, tab, defaultTab]);
  async function exportCsv() {
    setExporting(true);
    try {
      const all: OrderRow[] = [];
      let cursor: string | null = null;
      do {
        const page: { orders: OrderRow[]; nextCursor: string | null } = await api(
          "/admin/orders" + query({ ...serverFilters, limit: "100" }, cursor),
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
      <OrderStatusTabs value={tab} counts={counts} staff={staff} onChange={setTab} />
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
          <p className="reference-empty-text">
            {tab === "todo" && !active
              ? "ไม่มีงานค้าง พรีออเดอร์ที่ชำระแล้วส่งครบหมดแล้ว"
              : active || tab !== "all"
                ? "ไม่พบออเดอร์ในแท็บนี้ตามตัวกรอง"
                : "ยังไม่มีออเดอร์"}
          </p>
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
  timeline: ActivityEvent[];
  codes: string[];
  credentials: { loginId: string; password: string }[];
  units?: { id: string; kind: "pair" | "code" }[];
  notes?: OrderNoteItem[];
  replacements?: ReplacementItem[];
  note?: string | null;
  /** ADMIN only (money). */
  paymentSummary?: PaymentSummary;
  warranty_until?: string | null;
};

type PaymentSummary = {
  paid: number;
  refunded: number;
  outstanding: number;
  fee: number;
  net: number;
  refundable: number;
  refundStatus: "REFUNDED" | "PARTIALLY_REFUNDED" | null;
  refunds: {
    id: string;
    amount: number;
    destination: "CREDIT" | "EXTERNAL";
    reason: string | null;
    externalRef: string | null;
    actor: string | null;
    created_at: string;
  }[];
};

const refundReasons: [string, string][] = [
  ["CUSTOMER_CANCEL", "ลูกค้าขอยกเลิก"],
  ["ACCOUNT_BROKEN", "บัญชีใช้งานไม่ได้"],
  ["CANNOT_DELIVER", "ส่งของไม่ได้"],
  ["OTHER", "อื่นๆ"],
];

/** Baht text from an input -> satang integer, or null when it is not a valid amount. */
const toSatang = (text: string) => {
  const value = Number(text.replace(/,/g, "").trim());
  if (!text.trim() || !Number.isFinite(value) || value <= 0) return null;
  const satang = Math.round(value * 100);
  return Math.abs(satang - value * 100) < 1e-6 ? satang : null;
};

/**
 * FR-F6 order money: paid / refunded / outstanding / fee, refund history and the
 * refund form. Money actions follow one pattern (Medusa refund modal, MIT): amount and
 * reason first, then a confirm step that repeats the amount and needs a second click.
 */
function OrderMoney({
  id,
  summary,
  paidState,
  onChanged,
}: {
  id: string;
  summary: PaymentSummary;
  paidState: boolean;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [destination, setDestination] = useState<"CREDIT" | "EXTERNAL">("CREDIT");
  const [externalRef, setExternalRef] = useState("");
  const requestKey = useRef("");
  const satang = toSatang(amount);
  function start() {
    setOpen(true);
    setConfirming(false);
    setError("");
    setAmount((summary.refundable / 100).toFixed(2));
    setReasonCode("");
    setNote("");
    setDestination("CREDIT");
    setExternalRef("");
    requestKey.current = crypto.randomUUID();
  }
  function review(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (satang == null) return setError("กรุณาใส่ยอดคืนเงินเป็นบาท เช่น 50 หรือ 49.50");
    if (satang > summary.refundable) return setError("ยอดคืนเกินยอดที่คืนได้ (" + money(summary.refundable) + ")");
    if (!reasonCode) return setError("กรุณาเลือกเหตุผลการคืนเงิน");
    if (reasonCode === "OTHER" && note.trim().length < 3) return setError("กรุณาใส่รายละเอียดเหตุผล");
    if (destination === "EXTERNAL" && externalRef.trim().length < 3) return setError("กรุณาใส่เลขอ้างอิงการโอนคืน");
    setConfirming(true);
  }
  async function submit() {
    if (satang == null) return;
    setBusy(true);
    setError("");
    try {
      await api("/admin/orders/" + id + "/refund", {
        amount: satang,
        reasonCode,
        note,
        destination,
        externalRef: destination === "EXTERNAL" ? externalRef : undefined,
        requestKey: requestKey.current,
      });
      toast("คืนเงิน " + money(satang) + (destination === "CREDIT" ? " เข้าเครดิตลูกค้าแล้ว" : " บันทึกการคืนนอกระบบแล้ว"));
      setOpen(false);
      setConfirming(false);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }
  const full = satang != null && satang >= summary.refundable;
  return (
    <section className="reference-admin-card admin-detail-card order-money">
      <div className="order-money-heading">
        <h2>สรุปการเงิน</h2>
        {summary.refundStatus && <Status status={summary.refundStatus} />}
      </div>
      <dl className="money-summary">
        <div>
          <dt>ชำระแล้ว</dt>
          <dd>{money(summary.paid)}</dd>
        </div>
        <div>
          <dt>คืนเงินแล้ว</dt>
          <dd className={summary.refunded ? "negative" : ""}>{summary.refunded ? "−" + money(summary.refunded) : money(0)}</dd>
        </div>
        <div>
          <dt>ค้างชำระ</dt>
          <dd>{money(summary.outstanding)}</dd>
        </div>
        <div>
          <dt>ค่าธรรมเนียม</dt>
          <dd>{money(summary.fee)}</dd>
        </div>
      </dl>
      {summary.refunds.length > 0 && (
        <ol className="admin-timeline refund-list">
          {summary.refunds.map((r) => (
            <li key={r.id}>
              <strong>
                คืน {money(r.amount)} · {r.destination === "CREDIT" ? "เข้าเครดิตร้าน" : "คืนนอกระบบ" + (r.externalRef ? " (" + r.externalRef + ")" : "")}
              </strong>
              <time>
                {r.reason} · {r.actor ?? "ระบบ"} · {dateTime(r.created_at)}
              </time>
            </li>
          ))}
        </ol>
      )}
      <ErrorMessage message={error} />
      {!open && paidState && summary.refundable > 0 && (
        <div className="admin-action-row">
          <button className="button secondary" onClick={start}>
            <RotateCcw size={15} />
            คืนเงิน
          </button>
          <span className="muted money-hint">คืนได้อีก {money(summary.refundable)}</span>
        </div>
      )}
      {open && !confirming && (
        <form className="admin-reason-form refund-form" onSubmit={review}>
          <label className="field">
            ยอดคืน (บาท)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </label>
          <p className="field-help">
            คืนได้สูงสุด {money(summary.refundable)} · ถ้าคืนครบยอด พรีออเดอร์ที่ยังไม่ส่งจะออกจากคิว และบัญชีที่ส่งไปแล้วจะไม่ถูกนำไปขายซ้ำ
          </p>
          <label className="field">
            เหตุผล
            <select aria-label="เหตุผลการคืนเงิน" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">เลือกเหตุผล</option>
              {refundReasons.map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {reasonCode === "OTHER" ? "รายละเอียดเหตุผล" : "รายละเอียด (ไม่บังคับ)"}
            <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <fieldset className="refund-destination">
            <legend>คืนเงินไปที่</legend>
            <label className={destination === "CREDIT" ? "selected" : ""}>
              <input type="radio" name="refund-destination" checked={destination === "CREDIT"} onChange={() => setDestination("CREDIT")} />
              <span>
                เครดิตร้าน
                <small>ยอดเข้ากระเป๋าเครดิตของลูกค้าทันที</small>
              </span>
            </label>
            <label className={destination === "EXTERNAL" ? "selected" : ""}>
              <input type="radio" name="refund-destination" checked={destination === "EXTERNAL"} onChange={() => setDestination("EXTERNAL")} />
              <span>
                คืนนอกระบบ
                <small>ร้านโอนคืนเอง ระบบบันทึกไว้เท่านั้น</small>
              </span>
            </label>
          </fieldset>
          {destination === "EXTERNAL" && (
            <label className="field">
              เลขอ้างอิงการโอนคืน
              <input maxLength={120} value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="เช่น เลขที่รายการธนาคาร" />
            </label>
          )}
          <div className="admin-action-row">
            <button type="button" className="button secondary" onClick={() => setOpen(false)}>
              ยกเลิก
            </button>
            <button className="button primary">ตรวจสอบการคืนเงิน</button>
          </div>
        </form>
      )}
      {open && confirming && satang != null && (
        <div className="money-confirm" role="group" aria-label="ยืนยันการคืนเงิน">
          <p>
            คืนเงิน <strong>{money(satang)}</strong>{" "}
            {destination === "CREDIT" ? "เข้าเครดิตร้านของลูกค้า" : "แบบคืนนอกระบบ (" + externalRef + ")"}
          </p>
          <small>
            เหตุผล: {refundReasons.find(([key]) => key === reasonCode)?.[1]}
            {note ? " — " + note : ""}
            {full ? " · คืนครบยอด" : " · คืนบางส่วน"} · ลูกค้าได้รับแจ้งเตือน · ยกเลิกรายการนี้ไม่ได้
          </small>
          <div className="admin-action-row">
            <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>
              แก้ไข
            </button>
            <button type="button" className="button danger" disabled={busy} onClick={() => void submit()}>
              ยืนยันคืนเงิน {money(satang)}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

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
      failed(err);
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
  // Another team member may deliver, cancel or replace this order while it is open.
  const reload = () =>
    api<OrderDetail>("/admin/orders/" + id)
      .then(setOrder)
      .catch(() => {});
  useLive(["orders"], () => void reload());
  /** Usually someone else changed the order first (409): show the error and the fresh state. */
  function failed(err: unknown) {
    setError((err as Error).message);
    void reload();
  }
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
      failed(err);
    }
  }
  const replaceButton = (unitId?: string) =>
    user?.role === "ADMIN" && unitId ? (
      <button type="button" className="button ghost admin-replace-btn" onClick={() => setReplacing(unitId)}>
        บัญชีเสีย · เปลี่ยนให้ลูกค้า
      </button>
    ) : null;
  // Reveals need a reason (kept in the audit log) and are budgeted per hour on the server.
  const [revealReason, setRevealReason] = useState<string | null>(null);
  async function reveal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const reason = values.reason === "อื่นๆ" ? (values.other ?? "").trim() : values.reason;
    try {
      setRevealed(await api("/admin/orders/" + id + "/reveal", { reason }));
      setRevealReason(null);
      toast("บันทึกการเปิดดูรหัสแล้ว");
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const shown = revealed ?? order;
  return (
    <>
      <Link to={ordersListHref()} className="back-link">
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
            <Status status={order.paymentSummary?.refundStatus ?? order.status} />
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
          {order.paymentSummary && (
            <OrderMoney
              id={order.id}
              summary={order.paymentSummary}
              paidState={order.status === "DELIVERED" || order.status === "PREORDER"}
              onChanged={async () => {
                setRevealed(null);
                setOrder(await api<OrderDetail>("/admin/orders/" + id));
              }}
            />
          )}
          <OrderNotes
            id={order.id}
            notes={order.notes ?? []}
            onAdded={() => void reload()}
          />
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
              <WarrantyStatus until={order.warranty_until} />
              <h2>บัญชีที่ส่งให้ลูกค้า</h2>
              {order.status !== "DELIVERED" ? (
                <p className="muted">ยังไม่ได้ส่งของ</p>
              ) : (
                <>
                  <ul className="admin-credential-list">
                    {/* Copy buttons only once revealed; masked values are never copied. */}
                    {shown!.credentials.map((c, i) => (
                      <li key={"c" + i}>
                        <span>ID</span>
                        <CopyValue value={c.loginId} label="ID" copyable={!!revealed} />
                        <span>รหัสผ่าน</span>
                        <CopyValue value={c.password} label="รหัสผ่าน" copyable={!!revealed} />
                        {replaceButton(pairUnits[i]?.id)}
                      </li>
                    ))}
                    {shown!.codes.map((c, i) => (
                      <li key={"k" + i}>
                        <span>โค้ด</span>
                        <CopyValue value={c} label="โค้ด" copyable={!!revealed} />
                        {replaceButton(codeUnits[i]?.id)}
                      </li>
                    ))}
                  </ul>
                  <ResendCredentials orderId={order.id} onSent={() => void reload()} />
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
                  <ReplacementHistory items={order.replacements ?? []} />
                  {!revealed && revealReason === null && (
                    <button className="button secondary" onClick={() => setRevealReason("")}>
                      <Eye size={15} />
                      แสดงรหัส (บันทึกว่าใครเปิดดู)
                    </button>
                  )}
                  {!revealed && revealReason !== null && (
                    <form className="admin-reveal-form" onSubmit={reveal}>
                      <label className="field">
                        เหตุผลที่เปิดดูรหัส
                        <select name="reason" required value={revealReason} onChange={(e) => setRevealReason(e.target.value)}>
                          <option value="" disabled>
                            เลือกเหตุผล
                          </option>
                          <option>ลูกค้าแจ้งว่าเข้าใช้งานไม่ได้</option>
                          <option>ลูกค้าขอให้ส่งรหัสอีกครั้ง</option>
                          <option>ตรวจสอบก่อนเปลี่ยนบัญชีให้ลูกค้า</option>
                          <option>อื่นๆ</option>
                        </select>
                      </label>
                      {revealReason === "อื่นๆ" && (
                        <label className="field">
                          ระบุเหตุผล
                          <input name="other" required minLength={3} maxLength={200} />
                        </label>
                      )}
                      <p className="field-help">ทุกครั้งที่เปิดดูจะบันทึกชื่อคนเปิดและเหตุผลไว้ในประวัติการทำงาน</p>
                      <div className="admin-action-row">
                        <button type="button" className="button ghost" onClick={() => setRevealReason(null)}>
                          ยกเลิก
                        </button>
                        <button className="button primary" disabled={!revealReason}>
                          <Eye size={15} />
                          แสดงรหัส
                        </button>
                      </div>
                    </form>
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
              <h2>ความเคลื่อนไหว</h2>
              <OrderActivity events={order.timeline} />
              <h2>การชำระเงิน</h2>
              {user?.role !== "ADMIN" && <p className="muted">รายละเอียดการชำระเงินดูได้เฉพาะแอดมิน</p>}
              {user?.role === "ADMIN" && order.payments.length === 0 && <p className="muted">ยังไม่มีรายการชำระ</p>}
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
  ledger?: {
    id: string;
    amount: number;
    label: string;
    created_at: string;
    type: "TOPUP" | "PURCHASE" | "REFUND" | "ADJUSTMENT";
    balanceAfter: number;
    reason: string | null;
    order_id: string | null;
  }[];
};

/** FR-C7: 10,000 THB per adjustment (same cap as the server). */
const CREDIT_ADJUST_CAP = 1_000_000;

/** FR-C7 add or subtract customer credit: reason required, cap, two-step confirm. */
function CreditAdjust({ id, balance, onChanged }: { id: string; balance: number; onChanged: () => Promise<void> }) {
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const requestKey = useRef("");
  const satang = toSatang(amount);
  function start() {
    setOpen(true);
    setConfirming(false);
    setError("");
    setSign(1);
    setAmount("");
    setReason("");
    requestKey.current = crypto.randomUUID();
  }
  function review(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (satang == null) return setError("กรุณาใส่ยอดเป็นบาท เช่น 100 หรือ 49.50");
    if (satang > CREDIT_ADJUST_CAP) return setError("ปรับได้ไม่เกิน " + money(CREDIT_ADJUST_CAP) + " ต่อครั้ง");
    if (sign < 0 && satang > balance) return setError("หักได้ไม่เกินยอดคงเหลือ " + money(balance));
    if (reason.trim().length < 3) return setError("กรุณาใส่เหตุผลอย่างน้อย 3 ตัวอักษร");
    setConfirming(true);
  }
  async function submit() {
    if (satang == null) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ balance: number }>("/admin/customers/" + id + "/credit", {
        amount: sign * satang,
        reason,
        requestKey: requestKey.current,
      });
      toast((sign > 0 ? "เพิ่มเครดิต " : "หักเครดิต ") + money(satang) + " แล้ว · คงเหลือ " + money(result.balance));
      setOpen(false);
      setConfirming(false);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorMessage message={error} />
      {!open && (
        <button className="button secondary" onClick={start}>
          ปรับยอดเครดิต
        </button>
      )}
      {open && !confirming && (
        <form className="admin-reason-form" onSubmit={review}>
          <div className="segmented-control credit-sign" role="group" aria-label="ประเภทการปรับ">
            <button type="button" className={sign > 0 ? "active" : ""} onClick={() => setSign(1)}>
              <Plus size={14} />
              เพิ่มเครดิต
            </button>
            <button type="button" className={sign < 0 ? "active" : ""} onClick={() => setSign(-1)}>
              <Minus size={14} />
              หักเครดิต
            </button>
          </div>
          <label className="field">
            ยอด (บาท)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </label>
          <label className="field">
            เหตุผล (บันทึกภายใน)
            <input minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="field-help">
            ไม่เกิน {money(CREDIT_ADJUST_CAP)} ต่อครั้ง · ยอดเครดิตติดลบไม่ได้ · ลูกค้าได้รับแจ้งเตือน
          </p>
          <div className="admin-action-row">
            <button type="button" className="button secondary" onClick={() => setOpen(false)}>
              ยกเลิก
            </button>
            <button className="button primary">ตรวจสอบ</button>
          </div>
        </form>
      )}
      {open && confirming && satang != null && (
        <div className="money-confirm" role="group" aria-label="ยืนยันการปรับเครดิต">
          <p>
            {sign > 0 ? "เพิ่ม" : "หัก"}เครดิต <strong>{money(satang)}</strong> · คงเหลือหลังปรับ{" "}
            <strong>{money(balance + sign * satang)}</strong>
          </p>
          <small>เหตุผล: {reason} · ยกเลิกรายการนี้ไม่ได้ ถ้าผิดให้ปรับกลับด้วยรายการใหม่</small>
          <div className="admin-action-row">
            <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>
              แก้ไข
            </button>
            <button type="button" className={"button " + (sign > 0 ? "primary" : "danger")} disabled={busy} onClick={() => void submit()}>
              ยืนยัน{sign > 0 ? "เพิ่ม" : "หัก"}เครดิต {money(satang)}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const historyText = (h: CustomerDetail["history"][number]) => {
  const d = (h.detail ?? {}) as Record<string, { from?: unknown; to?: unknown } | unknown>;
  if (h.action === "CUSTOMER_STATUS") {
    const s = h.detail as { to: string; reason?: string };
    return "เปลี่ยนสถานะเป็น " + (statusText[s.to] ?? s.to) + (s.reason ? " · " + s.reason : "");
  }
  if (h.action === "CUSTOMER_SIGN_OUT") return "บังคับออกจากระบบทุกอุปกรณ์";
  if (h.action === "CUSTOMER_PASSWORD_RESET") return "ตั้งรหัสผ่านชั่วคราว";
  if (h.action === "CREDIT_ADJUST") {
    const a = h.detail as { amount: number; reason?: string };
    return (a.amount > 0 ? "เพิ่มเครดิต " : "หักเครดิต ") + money(Math.abs(a.amount)) + (a.reason ? " · " + a.reason : "");
  }
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
              <div className="order-money-heading">
                <h2>รายการเครดิต</h2>
                <span className="muted">คงเหลือ {money(data.creditSatang ?? 0)}</span>
              </div>
              <CreditAdjust id={c.id} balance={data.creditSatang ?? 0} onChanged={load} />
              {data.ledger.length === 0 && <p className="muted">ยังไม่มีรายการ</p>}
              {data.ledger.length > 0 && (
                <div className="table-scroll reference-table credit-history">
                  <table>
                    <thead>
                      <tr>
                        <th>เวลา</th>
                        <th>ประเภท</th>
                        <th>รายการ</th>
                        <th className="num">ยอด</th>
                        <th className="num">คงเหลือหลังรายการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger.map((l) => (
                        <tr key={l.id}>
                          <td className="nowrap">{dateTime(l.created_at)}</td>
                          <td>
                            <span className={"ledger-type ledger-type-" + l.type.toLowerCase()}>{ledgerTypeText[l.type]}</span>
                          </td>
                          <td>
                            {l.order_id ? <Link to={"/admin/orders/" + l.order_id}>{l.label}</Link> : l.label}
                            {l.reason && l.type !== "ADJUSTMENT" && <small>{l.reason}</small>}
                          </td>
                          <td className={"num " + (l.amount > 0 ? "positive" : "")}>
                            {l.amount > 0 ? "+" : "−"}
                            {money(Math.abs(l.amount))}
                          </td>
                          <td className="num">{money(l.balanceAfter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Products

type ProductVariantStock = {
  id: string;
  label: string;
  active: boolean;
  stock: number;
  stockStatus: "out" | "low" | "in" | null;
};
type ProductRow = {
  id: string;
  name: string;
  category: string;
  art: string;
  active: boolean;
  featured: boolean;
  preorder: boolean;
  stock: number;
  stockStatus: "out" | "low" | "in";
  sold: number;
  imageUrl?: string | null;
  variants?: ProductVariantStock[];
};
const emptyProductFilters = { q: "", category: "", status: "", type: "", stock: "", sort: "name" };
const stockText = { out: "หมด", low: "ใกล้หมด", in: "มีสต็อก" };
type BulkAction = "activate" | "deactivate" | "feature" | "unfeature";
const bulkText: Record<BulkAction, [string, string]> = {
  activate: ["เปิดขาย", "เปิดขายแล้ว"],
  deactivate: ["ปิดขาย", "ปิดขายแล้ว"],
  feature: ["ตั้งเป็นสินค้าแนะนำ", "ตั้งเป็นสินค้าแนะนำแล้ว"],
  unfeature: ["เลิกแนะนำ", "เลิกแนะนำแล้ว"],
};

/** Stock per option, so one empty option is not hidden inside the product total. */
function VariantStockList({ product, onStock }: { product: ProductRow; onStock: () => void }) {
  if (product.preorder) return <span className="muted">ส่งตามคิว</span>;
  const variants = (product.variants ?? []).filter((v) => v.active);
  if (!variants.length) return <span className="muted">ยังไม่มีตัวเลือก</span>;
  return (
    <button
      type="button"
      className="variant-stock-summary"
      aria-label={"ดูสต็อก " + product.name}
      onClick={(e) => {
        e.stopPropagation();
        onStock();
      }}
    >
      {variants.map((v) => (
        <span key={v.id} className={"variant-stock-line stock-" + v.stockStatus}>
          <span className="variant-stock-label">{v.label}</span>
          <strong>{v.stock}</strong>
          {v.stockStatus && v.stockStatus !== "in" && (
            <em className={"stock-badge stock-badge-" + v.stockStatus}>{stockText[v.stockStatus]}</em>
          )}
        </span>
      ))}
    </button>
  );
}

export function AdminProducts({
  categories,
  priceOf,
  onStock,
  onDuplicate,
}: {
  categories: { id: string; name: string }[];
  priceOf: (id: string) => string;
  onStock: (name: string) => void;
  onDuplicate: (id: string) => Promise<void>;
}) {
  const { go, toast } = useStore();
  const [filters, setFilters] = useState<Filters>(emptyProductFilters);
  const list = useCursorList<ProductRow>("/admin/products", "products", { ...filters, limit: "50" }, ["catalog", "orders"]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Bulk changes touch many products at once, so each one asks again before running.
  const [confirming, setConfirming] = useState<BulkAction | "duplicate" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Filters) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPicked(new Set());
    setConfirming(null);
  };
  const active = Object.entries(filters).some(([k, v]) => v && !(k === "sort" && v === "name"));
  const rows = list.rows ?? [];
  const pickedIds = rows.filter((p) => picked.has(p.id)).map((p) => p.id);
  const allPicked = rows.length > 0 && rows.every((p) => picked.has(p.id));
  const toggle = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(null);
  };
  async function runBulk(action: BulkAction) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ updated: number }>("/admin/products/bulk", { action, ids: pickedIds });
      toast(
        `${bulkText[action][1]} ${pickedIds.length} สินค้า` +
          (result.updated < pickedIds.length ? ` (เปลี่ยนจริง ${result.updated})` : ""),
      );
      setPicked(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }
  async function duplicate() {
    if (pickedIds.length !== 1) return;
    setBusy(true);
    setError("");
    try {
      await onDuplicate(pickedIds[0]);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setConfirming(null);
    }
  }
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
        onReset={() => set(emptyProductFilters)}
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
      {pickedIds.length > 0 && (
        <div className="bulk-action-bar" role="region" aria-label="จัดการสินค้าที่เลือก">
          <strong>เลือก {pickedIds.length} สินค้า</strong>
          {confirming ? (
            <span className="queue-confirm">
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void (confirming === "duplicate" ? duplicate() : runBulk(confirming))}
              >
                {busy && <LoaderCircle className="spin" size={15} />}
                {confirming === "duplicate"
                  ? "ยืนยันคัดลอกเป็นฉบับร่าง"
                  : `ยืนยัน${bulkText[confirming][0]} ${pickedIds.length} สินค้า`}
              </button>
              <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(null)}>
                ยกเลิก
              </button>
            </span>
          ) : (
            <span className="bulk-action-buttons">
              {(Object.keys(bulkText) as BulkAction[]).map((action) => (
                <button key={action} type="button" className="button secondary" onClick={() => setConfirming(action)}>
                  {bulkText[action][0]}
                </button>
              ))}
              {pickedIds.length === 1 && (
                <button type="button" className="button secondary" onClick={() => setConfirming("duplicate")}>
                  <Copy size={14} />
                  คัดลอกสินค้า
                </button>
              )}
              <button type="button" className="button ghost" onClick={() => setPicked(new Set())}>
                ล้างที่เลือก
              </button>
            </span>
          )}
        </div>
      )}
      <ErrorMessage message={list.error || error} />
      {rows.length > 0 && (
        // Phones hide the table header (rows become cards), so select-all lives here.
        <label className="product-select-all checkbox-label">
          <input
            type="checkbox"
            checked={allPicked}
            disabled={busy}
            onChange={() => {
              setPicked(allPicked ? new Set() : new Set(rows.map((p) => p.id)));
              setConfirming(null);
            }}
          />
          เลือกทั้งหมด {rows.length} รายการ
        </label>
      )}
      <div className="table-scroll reference-table admin-list-table product-list-table">
        <table>
          <thead>
            <tr>
              <th className="select-col">
                <input
                  type="checkbox"
                  aria-label="เลือกสินค้าทั้งหมดที่แสดง"
                  checked={allPicked}
                  disabled={busy || !rows.length}
                  onChange={() => {
                    setPicked(allPicked ? new Set() : new Set(rows.map((p) => p.id)));
                    setConfirming(null);
                  }}
                />
              </th>
              <th>สินค้า</th>
              <th>ราคา</th>
              <th>สต็อกต่อตัวเลือก</th>
              <th className="num">ขายแล้ว</th>
            </tr>
          </thead>
          <tbody>
            {list.rows?.map((p) => (
              <tr
                key={p.id}
                className={"admin-row-link" + (picked.has(p.id) ? " is-picked" : "")}
                onClick={() => go("/admin/products/" + p.id)}
              >
                <td className="select-col" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={"เลือก " + p.name}
                    checked={picked.has(p.id)}
                    disabled={busy}
                    onChange={() => toggle(p.id)}
                  />
                </td>
                <td>
                  <div className="merchant-product-cell">
                    <div className="merchant-product-art">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <Art small type={p.art} name={p.name} />
                      )}
                    </div>
                    <div>
                      <Link to={"/admin/products/" + p.id}>{p.name}</Link>
                      <span className="product-state">
                        <span>{p.active ? "เปิดขาย" : "ฉบับร่าง"}</span>
                        {p.preorder && <span>พรีออเดอร์</span>}
                        {p.featured && <span className="featured-tag">แนะนำ</span>}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="nowrap">{priceOf(p.id)}</td>
                <td>
                  <VariantStockList product={p} onStock={() => onStock(p.name)} />
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
  /** Shop view: refunds are always money out. */
  flow?: "in" | "out";
  fee: number;
  net: number;
  status: string;
  order_id: string | null;
  provider_ref: string | null;
  reference: string;
  created_at: string;
  finalized_at: string | null;
};
type TxnSummary = {
  in: number;
  out: number;
  net: number;
  refunds?: number;
  pending: number;
  count: number;
  csvMaxRows?: number;
  customerCredit?: number | null;
  mode?: "sandbox" | "live";
};
type TxnDetail = {
  transaction: {
    id: string;
    kind: string;
    direction: "in" | "out";
    flow: "in" | "out";
    amount: number;
    fee: number;
    net: number;
    status: string;
    label: string;
    reason: string | null;
    reference: string | null;
    provider_ref: string | null;
    created_at: string;
    finalized_at: string | null;
    test: boolean;
  };
  customer: { id: string; name: string; email: string };
  actor: { id: string; name: string } | null;
  order: { id: string; status: string; total: number; quantity: number; created_at: string; preorder: boolean } | null;
  payment: {
    id: string;
    amount: number;
    status: string;
    provider: string;
    provider_ref: string | null;
    idempotency_key: string | null;
    created_at: string;
    finalized_at: string | null;
  } | null;
  related: { id: string; kind: string; flow: "in" | "out"; amount: number; net: number; label: string; created_at: string; actor: string | null; current: boolean }[];
  events: { at: string; event: string; action?: string; actor?: string | null; text?: string }[];
};

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
const txnEventText: Record<string, string> = {
  created: "บันทึกรายการ",
  finalized: "ยืนยันรายการ",
  payment_created: "เริ่มการชำระ",
  payment_succeeded: "ชำระสำเร็จ",
  payment_failed: "ชำระไม่สำเร็จ",
  payment_cancelled: "ยกเลิกการชำระ",
  PAYMENT_AND_DELIVERY: "ชำระและส่งของ",
  PREORDER_PAID: "ชำระพรีออเดอร์",
  DELIVER_RESERVATION: "ส่งของพรีออเดอร์",
  ORDER_REFUND: "คืนเงิน",
  CANCEL_ORDER: "ยกเลิกออเดอร์",
  REPLACE_ORDER_CREDENTIAL: "เปลี่ยนบัญชีให้ลูกค้า",
};
/** Bangkok calendar day, n days before today. */
const bangkokDay = (daysAgo = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(Date.now() - daysAgo * 86400000));
/** The same number of days just before [from, to]. */
const previousRange = (from: string, to: string) => {
  const dayMs = 86400000;
  const start = Date.parse(from + "T00:00:00Z");
  const length = Math.round((Date.parse(to + "T00:00:00Z") - start) / dayMs) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(start - length * dayMs), to: iso(start - dayMs) };
};
const emptyFinanceFilters = { q: "", kind: "", direction: "", status: "", from: "", to: "", customer: "", min: "", max: "" };
const signed = (flow: "in" | "out", value: number) => (flow === "in" ? "+" : "−") + money(Math.abs(value));

/** FR-F5 detail panel: a side sheet in the shadcn/ui Sheet pattern (MIT). */
function TxnDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<TxnDetail | null>(null);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setDetail(null);
    setError("");
    api<TxnDetail>("/admin/transactions/" + id)
      .then(setDetail)
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);
  const t = detail?.transaction;
  return (
    <div className="txn-sheet-layer">
      <button className="txn-sheet-backdrop" aria-label="ปิดรายละเอียด" tabIndex={-1} onClick={onClose} />
      <aside className="txn-sheet" role="dialog" aria-modal="true" aria-label="รายละเอียดรายการเงิน">
        <header>
          <div>
            <small>รายการเงิน {shortId(id)}</small>
            <h2>{t ? kindText[t.kind] ?? t.kind : "กำลังโหลด…"}</h2>
          </div>
          <button ref={closeRef} className="icon-button" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <ErrorMessage message={error} />
        {detail && t && (
          <div className="txn-sheet-body">
            <div className="txn-sheet-amount">
              <strong className={t.flow === "in" ? "positive" : "negative"}>{signed(t.flow, t.net)}</strong>
              <span className={"status txn-status-" + t.status.toLowerCase()}>{txnStatusText[t.status] ?? t.status}</span>
              {t.test && <span className="test-chip">เงินทดสอบ</span>}
            </div>
            <dl className="txn-facts">
              <div>
                <dt>รายการ</dt>
                <dd>{t.label}</dd>
              </div>
              {t.reason && (
                <div>
                  <dt>เหตุผล</dt>
                  <dd>{t.reason}</dd>
                </div>
              )}
              <div>
                <dt>ยอด · ค่าธรรมเนียม · สุทธิ</dt>
                <dd>
                  {money(t.amount)} · {money(t.fee)} · {money(Math.abs(t.net))}
                </dd>
              </div>
              <div>
                <dt>ลูกค้า</dt>
                <dd>
                  <Link to={"/admin/customers/" + detail.customer.id}>{detail.customer.name}</Link>
                  <small>{detail.customer.email}</small>
                </dd>
              </div>
              {detail.order && (
                <div>
                  <dt>ออเดอร์</dt>
                  <dd>
                    <Link to={"/admin/orders/" + detail.order.id}>
                      {shortId(detail.order.id)} · {money(detail.order.total)}
                    </Link>
                    <small>{detail.order.preorder ? "พรีออเดอร์" : "พร้อมส่ง"}</small>
                  </dd>
                </div>
              )}
              <div>
                <dt>ผู้ทำรายการ</dt>
                <dd>{detail.actor ? detail.actor.name : "ระบบ / ลูกค้า"}</dd>
              </div>
              {detail.payment && (
                <div>
                  <dt>ช่องทาง</dt>
                  <dd>
                    {detail.payment.provider}
                    <small>
                      อ้างอิง <code>{detail.payment.provider_ref ?? "–"}</code>
                    </small>
                  </dd>
                </div>
              )}
              {t.provider_ref && (
                <div>
                  <dt>เลขอ้างอิง</dt>
                  <dd>
                    <code>{t.provider_ref}</code>
                  </dd>
                </div>
              )}
              <div>
                <dt>เวลา</dt>
                <dd>
                  {dateTime(t.created_at)}
                  {t.finalized_at && t.finalized_at !== t.created_at && <small>ยืนยัน {dateTime(t.finalized_at)}</small>}
                </dd>
              </div>
            </dl>
            <h3>ไทม์ไลน์</h3>
            <ol className="admin-timeline">
              {detail.events.map((e, i) => (
                <li key={i}>
                  <strong>
                    {txnEventText[e.action ?? e.event] ?? e.action ?? e.event}
                    {e.text ? " · " + e.text : ""}
                  </strong>
                  <time>
                    {e.actor ? e.actor + " · " : ""}
                    {dateTime(e.at)}
                  </time>
                </li>
              ))}
            </ol>
            {detail.related.length > 1 && (
              <>
                <h3>รายการเงินของออเดอร์นี้</h3>
                {detail.related.map((r) => (
                  <div className={"settings-row" + (r.current ? " is-current" : "")} key={r.id}>
                    <span>
                      {kindText[r.kind] ?? r.kind}
                      <small>
                        {r.label} · {dateTime(r.created_at)}
                      </small>
                    </span>
                    <strong className={r.flow === "in" ? "positive" : ""}>{signed(r.flow, r.net)}</strong>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

export function AdminFinance() {
  const [filters, setFilters] = useState<Filters>(emptyFinanceFilters);
  const [summary, setSummary] = useState<TxnSummary | null>(null);
  const [previous, setPrevious] = useState<TxnSummary | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [csvNote, setCsvNote] = useState("");
  const set = (patch: Filters) => setFilters((f) => ({ ...f, ...patch }));
  // Amount filters are typed in baht; the API compares satang.
  const apiFilters = (f: Filters): Filters => ({
    ...f,
    min: f.min && toSatang(f.min) != null ? String(toSatang(f.min)) : "",
    max: f.max && toSatang(f.max) != null ? String(toSatang(f.max)) : "",
  });
  const list = useCursorList<Txn>("/admin/transactions", "transactions", { ...apiFilters(filters), limit: "50" }, ["orders", "customers"]);
  const serial = JSON.stringify(filters);
  useEffect(() => {
    const current = apiFilters(filters);
    api<{ summary: TxnSummary }>("/admin/transactions" + query({ ...current, limit: "1" }))
      .then((d) => setSummary(d.summary))
      .catch(() => setSummary(null));
    if (filters.from && filters.to) {
      api<{ summary: TxnSummary }>("/admin/transactions" + query({ ...current, ...previousRange(filters.from, filters.to), limit: "1" }))
        .then((d) => setPrevious(d.summary))
        .catch(() => setPrevious(undefined));
    } else setPrevious(undefined);
    setCsvNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial]);
  const active = Object.values(filters).some(Boolean);
  const preset = (days: number | null) =>
    days == null ? set({ from: "", to: "" }) : set({ from: bangkokDay(days), to: bangkokDay(0) });
  const presetActive = (days: number | null) =>
    days == null ? !filters.from : filters.from === bangkokDay(days) && filters.to === bangkokDay(0);
  const csvMax = summary?.csvMaxRows ?? 10000;
  const rows = summary?.count ?? 0;
  const tooMany = rows > csvMax;
  const compare = (key: "in" | "out" | "net") =>
    summary && previous ? <Change now={summary[key]} before={previous[key]} /> : <small>{filters.from ? "" : "ตั้งแต่เปิดร้าน"}</small>;
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>การเงิน</h1>
          <p>ทุกรายการเงินเข้าและออก พร้อมเวลา ลูกค้า และออเดอร์ที่เกี่ยวข้อง รายการเงินแก้หรือลบไม่ได้ คลิกแถวเพื่อดูรายละเอียด</p>
        </div>
        {tooMany ? (
          <button
            className="button secondary"
            onClick={() =>
              setCsvNote(
                "มี " + rows.toLocaleString("th-TH") + " รายการ เกินที่ดาวน์โหลดได้ครั้งละ " + csvMax.toLocaleString("th-TH") + " แถว กรุณาเลือกช่วงวันให้แคบลงหรือเพิ่มตัวกรอง",
              )
            }
          >
            <Download size={15} />
            ดาวน์โหลด CSV ({rows.toLocaleString("th-TH")} แถว)
          </button>
        ) : (
          <a
            className={"button secondary" + (summary && !rows ? " is-disabled" : "")}
            aria-disabled={summary ? !rows : undefined}
            href={"/api/admin/transactions" + query({ ...apiFilters(filters), format: "csv", limit: "100" })}
          >
            <Download size={15} />
            ดาวน์โหลด CSV{summary ? " (" + rows.toLocaleString("th-TH") + " แถว)" : ""}
          </a>
        )}
      </div>
      <TestMoneyBanner />
      {csvNote && (
        <p className="admin-callout warning" role="alert">
          {csvNote}
        </p>
      )}
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
          <small>เงินเข้า (รับชำระ เติมเครดิต)</small>
          <strong className="positive">{summary ? money(summary.in) : "–"}</strong>
          {compare("in")}
        </div>
        <div className="reference-admin-card">
          <small>เงินออก (คืนเงิน ถอน ค่าธรรมเนียม)</small>
          <strong>{summary ? money(summary.out) : "–"}</strong>
          {compare("out")}
        </div>
        <div className="reference-admin-card">
          <small>สุทธิ</small>
          <strong>{summary ? money(summary.net) : "–"}</strong>
          {compare("net")}
        </div>
        <div className="reference-admin-card">
          <small>รอยืนยัน · ทั้งหมด</small>
          <strong>{summary ? summary.pending + " · " + summary.count : "–"}</strong>
          <small>รายการตามตัวกรอง</small>
        </div>
        <div className="reference-admin-card liability-card">
          <small>เครดิตลูกค้าคงค้าง (หนี้สิน)</small>
          <strong>{summary?.customerCredit != null ? money(summary.customerCredit) : "–"}</strong>
          <small>เงินที่ร้านติดลูกค้า ไม่นับเป็นรายได้ · ทุกช่วงเวลา</small>
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
            ["", summary?.mode === "live" ? "ทุกประเภท" : "ทุกประเภท (ไม่รวมทดลอง)"],
            ...Object.entries(kindText).filter(([k]) => k !== "DEMO_CREDIT"),
            ...(summary?.mode === "live" ? [] : ([["DEMO_CREDIT", "เครดิตทดลองเท่านั้น"]] as [string, string][])),
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
        <label className={"admin-filter-text" + (filters.customer ? " is-set" : "")}>
          <span className="sr-only">ลูกค้า</span>
          <input
            aria-label="ลูกค้า"
            placeholder="ลูกค้า (ชื่อหรืออีเมล)"
            value={filters.customer}
            onChange={(e) => set({ customer: e.target.value })}
          />
        </label>
        <span className={"admin-filter-amounts" + (filters.min || filters.max ? " is-set" : "")}>
          <input aria-label="ยอดต่ำสุด (บาท)" inputMode="decimal" placeholder="฿ ต่ำสุด" value={filters.min} onChange={(e) => set({ min: e.target.value })} />
          <span aria-hidden="true">–</span>
          <input aria-label="ยอดสูงสุด (บาท)" inputMode="decimal" placeholder="฿ สูงสุด" value={filters.max} onChange={(e) => set({ max: e.target.value })} />
        </span>
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
            {list.rows?.map((t) => {
              const flow = t.flow ?? t.direction;
              return (
                <tr
                  key={t.id}
                  className={"admin-row-link" + (openId === t.id ? " is-open" : "")}
                  tabIndex={0}
                  aria-label={"ดูรายละเอียด " + (kindText[t.kind] ?? t.kind) + " " + money(Math.abs(t.net))}
                  onClick={() => setOpenId(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenId(t.id);
                    }
                  }}
                >
                  <td className="nowrap">
                    {dateTime(t.created_at)}
                    {t.finalized_at && t.finalized_at !== t.created_at && <small>ยืนยัน {dateTime(t.finalized_at)}</small>}
                  </td>
                  <td>
                    <span className={"txn-kind txn-" + flow}>{kindText[t.kind] ?? t.kind}</span>
                    <small>
                      {t.order_id ? (
                        <Link to={"/admin/orders/" + t.order_id}>ออเดอร์ {shortId(t.order_id)}</Link>
                      ) : (
                        t.label
                      )}
                      {t.provider_ref && " · " + (t.provider_ref.length > 24 ? t.provider_ref.slice(0, 20) + "…" : t.provider_ref)}
                    </small>
                  </td>
                  <td>
                    <Link to={"/admin/customers/" + t.user_id}>{t.customer}</Link>
                    <small>{t.customer_email}</small>
                  </td>
                  <td>
                    <span className={"status txn-status-" + t.status.toLowerCase()}>{txnStatusText[t.status] ?? t.status}</span>
                  </td>
                  <td className={"num " + (flow === "in" ? "positive" : "")}>
                    {signed(flow, t.net)}
                    {t.fee > 0 && <small>ค่าธรรมเนียม {money(t.fee)}</small>}
                  </td>
                </tr>
              );
            })}
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
      {openId && <TxnDetailPanel id={openId} onClose={() => setOpenId(null)} />}
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
      <TwoFactorCard />
      <SessionsCard variant="admin" />
    </>
  );
}

type TotpStatus = { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number };
type TotpSetup = { secret: string; otpauthUrl: string };

/** Settings › บัญชีแอดมิน › ยืนยันตัวตน 2 ขั้น (TOTP). Optional per account; form layout
 * follows shadcn/ui (MIT) form patterns with the existing admin classes. */
function TwoFactorCard() {
  const { toast } = useStore();
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [step, setStep] = useState<"idle" | "password" | "scan" | "codes" | "disable">("idle");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    api<TotpStatus>("/account/totp")
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const values = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  };
  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const start = (e: FormEvent<HTMLFormElement>) => {
    const form = values(e);
    void attempt(async () => {
      setSetup(await api<TotpSetup>("/account/totp/setup", { currentPassword: form.currentPassword }));
      setStep("scan");
    });
  };
  const enable = (e: FormEvent<HTMLFormElement>) => {
    const form = values(e);
    void attempt(async () => {
      const result = await api<{ recoveryCodes: string[] }>("/account/totp/enable", { code: form.code });
      setCodes(result.recoveryCodes);
      setSetup(null);
      setStep("codes");
      toast("เปิดยืนยันตัวตน 2 ขั้นแล้ว");
      await load();
    });
  };
  const disable = (e: FormEvent<HTMLFormElement>) => {
    const form = values(e);
    void attempt(async () => {
      await api("/account/totp/disable", { currentPassword: form.currentPassword, code: form.code });
      setStep("idle");
      toast("ปิดยืนยันตัวตน 2 ขั้นแล้ว");
      await load();
    });
  };
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("คัดลอก" + what + "แล้ว");
    } catch {
      setError("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง");
    }
  }
  const cancel = () => {
    setStep("idle");
    setSetup(null);
    setError("");
  };
  return (
    <section className="reference-admin-card admin-detail-card admin-account-card totp-card" aria-labelledby="totp-title">
      <div className="totp-head">
        <div>
          <h2 id="totp-title">ยืนยันตัวตน 2 ขั้น</h2>
          <p className="muted">
            เข้าสู่ระบบด้วยรหัสผ่านแล้วต้องกรอกรหัส 6 หลักจากแอปในโทรศัพท์ (เช่น Google Authenticator หรือ Microsoft
            Authenticator) อีกชั้น ถึงรหัสผ่านหลุดก็เข้าบัญชีไม่ได้
          </p>
        </div>
        {status && (
          <span className={status.enabled ? "status status-delivered" : "status"}>
            {status.enabled ? "เปิดอยู่" : "ปิดอยู่"}
          </span>
        )}
      </div>
      <ErrorMessage message={error} />
      {!status ? (
        <p className="muted">กำลังโหลด…</p>
      ) : step === "codes" ? (
        <div className="admin-temp-password totp-recovery">
          <p>
            <strong>รหัสกู้คืน (แสดงครั้งเดียว)</strong> เก็บไว้ในที่ปลอดภัย ถ้าโทรศัพท์หาย ใช้รหัสเหล่านี้แทนรหัสจากแอปได้
            รหัสละครั้ง
          </p>
          <ol className="totp-recovery-codes" aria-label="รหัสกู้คืน">
            {codes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ol>
          <div className="admin-row-actions">
            <button type="button" className="button secondary" onClick={() => void copy(codes.join("\n"), "รหัสกู้คืน")}>
              <Copy size={15} /> คัดลอกทั้งหมด
            </button>
            <button
              type="button"
              className="button primary"
              onClick={() => {
                setCodes([]);
                setStep("idle");
              }}
            >
              บันทึกรหัสแล้ว
            </button>
          </div>
        </div>
      ) : status.enabled ? (
        step === "disable" ? (
          <form onSubmit={disable} className="admin-form-grid">
            <label className="field span-2">
              รหัสผ่านปัจจุบัน
              <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
            </label>
            <label className="field span-2">
              รหัส 6 หลักจากแอป หรือรหัสกู้คืน
              <input name="code" autoComplete="one-time-code" required minLength={6} maxLength={11} />
            </label>
            <p className="field-help span-2">ปิดแล้วการเข้าสู่ระบบจะใช้แค่รหัสผ่าน และรหัสกู้คืนเดิมทั้งหมดใช้ไม่ได้อีก</p>
            <button className="button primary" disabled={busy}>
              ยืนยันปิดการยืนยัน 2 ขั้น
            </button>
            <button type="button" className="button ghost" onClick={cancel}>
              ยกเลิก
            </button>
          </form>
        ) : (
          <>
            <div className="settings-row">
              <span>
                เปิดใช้งานเมื่อ
                <small>{status.enabledAt ? dateTime(status.enabledAt) : "–"}</small>
              </span>
              <span>
                รหัสกู้คืนเหลือ <strong>{status.recoveryCodesLeft}</strong> ชุด
              </span>
            </div>
            <button type="button" className="button secondary" onClick={() => setStep("disable")}>
              ปิดการยืนยัน 2 ขั้น
            </button>
          </>
        )
      ) : step === "password" ? (
        <form onSubmit={start} className="admin-form-grid">
          <label className="field span-2">
            รหัสผ่านปัจจุบัน
            <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} autoFocus />
          </label>
          <p className="field-help span-2">ยืนยันรหัสผ่านก่อน ระบบจึงจะสร้างคีย์สำหรับแอปยืนยันตัวตน</p>
          <button className="button primary" disabled={busy}>
            เริ่มตั้งค่า
          </button>
          <button type="button" className="button ghost" onClick={cancel}>
            ยกเลิก
          </button>
        </form>
      ) : step === "scan" && setup ? (
        <form onSubmit={enable} className="admin-form-grid">
          <div className="span-2 totp-steps">
            <p>
              <strong>1.</strong> ในแอปยืนยันตัวตน เลือก “เพิ่มบัญชี” › “กรอกคีย์ตั้งค่า” แล้วใส่คีย์นี้ (ชนิด: ตามเวลา)
            </p>
            <div className="totp-secret">
              <code aria-label="คีย์ตั้งค่า">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
              <button type="button" className="button secondary" onClick={() => void copy(setup.secret, "คีย์")}>
                <Copy size={15} /> คัดลอกคีย์
              </button>
            </div>
            <p className="field-help">
              เปิดหน้านี้บนโทรศัพท์อยู่? <a href={setup.otpauthUrl}>แตะเพื่อเพิ่มบัญชีในแอปยืนยันตัวตน</a>
            </p>
            <p>
              <strong>2.</strong> กรอกรหัส 6 หลักที่แอปแสดงเพื่อยืนยันว่าตั้งค่าถูกต้อง
            </p>
          </div>
          <label className="field span-2">
            รหัส 6 หลักจากแอป
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              placeholder="000000"
              required
            />
          </label>
          <button className="button primary" disabled={busy}>
            ยืนยันและเปิดใช้งาน
          </button>
          <button type="button" className="button ghost" onClick={cancel}>
            ยกเลิก
          </button>
        </form>
      ) : (
        <button type="button" className="button primary" onClick={() => setStep("password")}>
          <ShieldCheck size={15} /> เปิดใช้งาน
        </button>
      )}
    </section>
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
  PRODUCT_BULK_ACTIVATE: "เปิดขาย (หลายรายการ)",
  PRODUCT_BULK_DEACTIVATE: "ปิดขาย (หลายรายการ)",
  PRODUCT_BULK_FEATURE: "ตั้งเป็นสินค้าแนะนำ (หลายรายการ)",
  PRODUCT_BULK_UNFEATURE: "เลิกแนะนำ (หลายรายการ)",
  DUPLICATE_PRODUCT: "คัดลอกสินค้า",
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
  REVEAL_LIMIT: "เปิดดูรหัสครบโควตาต่อชั่วโมง",
  TEAM_ROLE: "เปลี่ยนสิทธิ์ทีมงาน",
  STAFF_CREATE: "เพิ่มบัญชีทีมงาน",
  STAFF_UPDATE: "แก้ชื่อทีมงาน",
  STAFF_ENABLE: "เปิดบัญชีทีมงาน",
  STAFF_DISABLE: "ปิดบัญชีทีมงาน",
  CHAT_ASSIGN: "มอบหมายแชท",
  ORDER_NOTE: "เขียนหมายเหตุออเดอร์",
  CANCEL_ORDER: "ยกเลิกออเดอร์",
  PRODUCT_IMAGE_ADD: "เพิ่มรูปสินค้า",
  PRODUCT_IMAGE_REMOVE: "ลบรูปสินค้า",
  PRODUCT_IMAGE_REORDER: "เรียงรูปสินค้า",
  LOGIN_FAILED: "เข้าสู่ระบบไม่สำเร็จ",
  LOGIN_LOCKED: "พักการเข้าสู่ระบบ (ผิดหลายครั้ง)",
  LOGIN_TOTP_FAILED: "รหัสยืนยัน 2 ขั้นไม่ถูกต้อง",
  REAUTH_FAILED: "ยืนยันรหัสผ่านไม่สำเร็จ",
  TOTP_ENABLE: "เปิดยืนยันตัวตน 2 ขั้น",
  TOTP_DISABLE: "ปิดยืนยันตัวตน 2 ขั้น",
  TOTP_RESET: "ล้างยืนยันตัวตน 2 ขั้น (เปลี่ยนรหัสลับระบบ)",
  RECOVERY_CODE_USED: "ใช้รหัสกู้คืน",
  SESSION_REVOKE: "ออกจากระบบอุปกรณ์หนึ่งเครื่อง",
  SESSION_REVOKE_OTHERS: "ออกจากระบบอุปกรณ์อื่นทั้งหมด",
  ORDER_EXPIRED: "ยกเลิกออเดอร์ (หมดเวลาชำระเงิน)",
};
const roleText: Record<string, string> = { ADMIN: "แอดมิน", STAFF: "ทีมงาน", CUSTOMER: "ลูกค้า" };
/** Readable one-liner for the audit detail JSON instead of raw braces. */
// Stock import / bulk / duplicate audit details.
const detailLabel: Record<string, string> = {
  total: "ทั้งหมด",
  imported: "เพิ่ม",
  skippedDuplicates: "ข้ามซ้ำ",
  skippedInvalid: "ข้ามรูปแบบผิด",
  skipDuplicates: "ข้ามบัญชีซ้ำ:",
  batch: "ในชุด",
  updated: "เปลี่ยนจริง:",
  variants: "ตัวเลือก",
  images: "รูป",
  sessions: "จำนวนเครื่อง",
  device: "อุปกรณ์",
  current: "เครื่องที่ใช้อยู่:",
  minutes: "ตั้งไว้ (นาที)",
};
function auditDetailText(detail: Record<string, unknown>) {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value == null || value === "") continue;
    if (key === "reason") parts.push("เหตุผล: " + value);
    else if (key === "from" && typeof value === "string") parts.push("จาก " + (roleText[value] ?? value));
    else if (key === "to" && typeof value === "string") parts.push("เป็น " + (roleText[value] ?? value));
    else if (key === "role" && typeof value === "string") parts.push("สิทธิ์ " + (roleText[value] ?? value));
    else if (key === "limit") parts.push("โควตา " + value + " ครั้ง/ชม.");
    else if (key in detailLabel)
      parts.push(detailLabel[key] + " " + (typeof value === "boolean" ? (value ? "ใช่" : "ไม่") : String(value)));
    else if (key === "changed" && value && typeof value === "object")
      for (const [field, diff] of Object.entries(value as Record<string, { from: unknown; to: unknown }>))
        parts.push(field + ": " + String(diff.from ?? "—") + " → " + String(diff.to ?? "—"));
    else parts.push(key + ": " + (typeof value === "object" ? JSON.stringify(value) : String(value)));
  }
  return parts.join(" · ");
}

export function AdminAudit() {
  const [scope, setScope] = useState("staff");
  const [action, setAction] = useState("");
  const list = useCursorList<AuditEntry>("/admin/audit", "entries", { scope: scope === "staff" ? "staff" : "", action, limit: "50" });
  const entityLink = (e: AuditEntry) => {
    if (!e.entity_id) return null;
    if (e.action.startsWith("CUSTOMER_")) return "/admin/customers/" + e.entity_id;
    if (["REVEAL_ORDER_CREDENTIALS", "REVEAL_LIMIT", "ORDER_NOTE", "CANCEL_ORDER", "ORDER_EXPIRED", "DELIVER_RESERVATION", "CREATE_ORDER", "CREATE_PREORDER", "PAYMENT_AND_DELIVERY", "PREORDER_PAID"].includes(e.action))
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
            ["LOGIN_", "เข้าสู่ระบบไม่สำเร็จ / ถูกพัก"],
            ["TOTP_", "ยืนยันตัวตน 2 ขั้น"],
            ["RECOVERY_CODE_USED", "ใช้รหัสกู้คืน"],
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
                    {e.actor ?? (e.action.startsWith("LOGIN") ? "ไม่ทราบตัวตน" : "ระบบ")}
                    <small>{e.actor_role === "ADMIN" ? "แอดมิน" : e.actor_role === "STAFF" ? "ทีมงาน" : e.actor_role ? "ลูกค้า" : ""}</small>
                  </td>
                  <td>{actionText[e.action] ?? e.action}</td>
                  <td>
                    {link ? <Link to={link}>{shortId(e.entity_id!)}</Link> : e.entity_id ? shortId(e.entity_id) : "–"}
                    {e.detail && <small className="audit-detail">{auditDetailText(e.detail)}</small>}
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

let healthMode: Promise<string> | null = null;
/** While test payments are on, anyone can buy with free test credit, so real accounts must not go into stock. */
export function TestModeStockWarning() {
  const [sandbox, setSandbox] = useState(false);
  useEffect(() => {
    healthMode ??= api<{ mode?: string }>("/health")
      .then((h) => h.mode ?? "")
      .catch(() => "");
    void healthMode.then((m) => setSandbox(m === "sandbox"));
  }, []);
  if (!sandbox) return null;
  return (
    <p className="admin-test-warning" role="note">
      โหมดทดสอบเปิดอยู่: ใครสมัครก็ใช้เครดิตทดลองซื้อได้ ใส่เฉพาะบัญชีทดสอบ ห้ามใส่บัญชีจริงจนกว่าจะปิดโหมดทดสอบ
    </p>
  );
}

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
  async function apply(role: TeamRole, currentPassword?: string) {
    setBusy(true);
    setError("");
    try {
      await api("/admin/team/" + userId + "/role", { role, ...(currentPassword ? { currentPassword } : {}) });
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
      {pick === "ADMIN" ? (
        <form
          className="admin-inline-confirm"
          onSubmit={(e) => {
            e.preventDefault();
            void apply("ADMIN", String(new FormData(e.currentTarget).get("currentPassword") ?? ""));
          }}
        >
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            aria-label="รหัสผ่านของคุณเพื่อยืนยัน"
            placeholder="รหัสผ่านของคุณ"
            required
            maxLength={128}
            autoFocus
          />
          <button className="button primary" disabled={busy}>
            ยืนยันให้สิทธิ์แอดมิน
          </button>
          <button type="button" className="button ghost" onClick={() => setPick(null)}>
            ยกเลิก
          </button>
        </form>
      ) : pick ? (
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
  // A new admin needs the acting admin's password again (server checks currentPassword).
  const [addRole, setAddRole] = useState("STAFF");
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
      setAddRole("STAFF");
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
  async function changeRole(m: Member, role: TeamRole, currentPassword?: string) {
    setError("");
    try {
      await api("/admin/team/" + m.id + "/role", { role, ...(currentPassword ? { currentPassword } : {}) });
      setConfirming(null);
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
                  {confirming === m.id + ":ADMIN" ? (
                    <form
                      className="admin-inline-confirm"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void changeRole(m, "ADMIN", String(new FormData(e.currentTarget).get("currentPassword") ?? ""));
                      }}
                    >
                      <input
                        name="currentPassword"
                        type="password"
                        autoComplete="current-password"
                        aria-label="รหัสผ่านของคุณเพื่อยืนยัน"
                        placeholder="รหัสผ่านของคุณ"
                        required
                        maxLength={128}
                        autoFocus
                      />
                      <button className="button primary">ยืนยันให้สิทธิ์แอดมิน</button>
                      <button type="button" className="button ghost" onClick={() => setConfirming(null)}>
                        ยกเลิก
                      </button>
                    </form>
                  ) : confirming?.startsWith(m.id + ":") ? (
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
              <select name="role" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                <option value="STAFF">ทีมงาน (ไม่เห็นการเงิน)</option>
                <option value="ADMIN">แอดมิน (ทำได้ทุกอย่าง)</option>
              </select>
            </label>
            {addRole === "ADMIN" && (
              <label className="field span-2">
                รหัสผ่านของคุณ (ยืนยันการเพิ่มแอดมิน)
                <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
              </label>
            )}
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
  warranty_days?: number;
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
  const [error, setError] = useState("");
  const list = useCursorList<StockUnit>(
    "/admin/variants/" + variant.id + "/inventory",
    "inventory",
    { status, limit: "50" },
    ["catalog", "orders"],
  );
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
      <TestModeStockWarning />
      <div className="variant-stock-add">
        <StockImport
          variantId={variant.id}
          kind="pair"
          label={"เติมสต็อก " + variant.label}
          onDone={onChanged}
        />
        <ErrorMessage message={error} />
      </div>
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
            {u.status === "sold" && (u.order_id || u.reservation_id) && (
              // A sold account is fixed from its order (replace + notify the customer), not here.
              <Link className="button ghost" to={"/admin/orders/" + (u.order_id ?? u.reservation_id)}>
                บัญชีเสีย? เปลี่ยนในออเดอร์
              </Link>
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

/** Warranty in days per option (0 = none). Sold orders keep the warranty they were sold with. */
function WarrantyInput({ defaultValue = 0, label = "วันรับประกัน" }: { defaultValue?: number; label?: string }) {
  return (
    <label className="variant-warranty">
      <span>ประกัน</span>
      <input
        name="warranty_days"
        aria-label={label}
        type="number"
        min="0"
        max="365"
        step="1"
        inputMode="numeric"
        defaultValue={defaultValue}
      />
      <span>วัน</span>
    </label>
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
  const days = (value: FormDataEntryValue | null) => Math.max(0, Math.min(365, Math.round(Number(value || 0))));
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      await api("/admin/products/" + productId + "/variants", {
        label: data.get("label"),
        price: baht(data.get("price")),
        warranty_days: days(data.get("warranty_days")),
      });
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
        {" · ประกัน 0 วัน = ไม่มีประกัน แก้ภายหลังไม่กระทบออเดอร์ที่ขายไปแล้ว"}
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
                void update(v, {
                  label: String(data.get("label")),
                  price: baht(data.get("price")),
                  warranty_days: days(data.get("warranty_days")),
                });
              }}
            >
              <input name="label" aria-label="ชื่อตัวเลือก" defaultValue={v.label} required maxLength={80} />
              <input name="price" aria-label="ราคา (บาท)" type="number" min="1" step="0.01" defaultValue={v.price / 100} required />
              <WarrantyInput defaultValue={v.warranty_days ?? 0} />
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
                  {(v.warranty_days ?? 0) > 0 ? " · รับประกัน " + v.warranty_days + " วัน" : " · ไม่มีประกัน"}
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
        <WarrantyInput label="วันรับประกันตัวเลือกใหม่" />
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
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>รายงานยอดขาย</h1>
          <p>นับเฉพาะออเดอร์ที่ชำระสำเร็จ · เวลาไทย · ยอดสุทธิหักคืนเงินแล้ว</p>
        </div>
        <a className="button secondary" href={"/api/admin/reports/sales" + query({ ...range, format: "csv" })}>
          <Download size={15} />
          ดาวน์โหลด CSV
        </a>
      </div>
      <TestMoneyBanner />
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
          ["คืนเงิน", report ? money(report.totals.refunds) : "–"],
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
