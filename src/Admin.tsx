import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Gift,
  History,
  Image,
  LayoutGrid,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
  Smartphone,
  Store,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Art, Empty, ErrorMessage, Link, Status, useStore } from "./App";
import { useDialog } from "./dialog";
import { api, dateTime, money } from "./api";
import type { AdminData, Credential, Features, Product, QueueItem } from "./types";
const productTabs = [
  ["products", "สินค้าทั้งหมด"],
  ["inventory", "บัญชีสต็อก"],
  ["categories", "หมวดหมู่"],
  ["coupons", "โค้ดส่วนลด"],
  ["stamps", "บัตรสะสมแสตมป์"],
  ["reviews", "รีวิว"],
];
const orderTabs = [
  ["orders", "ออเดอร์ทั้งหมด"],
  ["preorders", "คิวพรีออเดอร์"],
  ["rentals", "เช่าไอดี"],
  ["issues", "แจ้งปัญหา"],
  ["otp", "รับ OTP"],
];
const settingTabs = [
  ["settings", "ร้าน"],
  ["settings/storefront", "หน้าร้าน"],
  ["settings/payment", "รับเงิน"],
  ["settings/shipping", "จัดส่ง"],
  ["settings/rentals", "เช่าไอดี"],
  ["settings/line", "บอท LINE"],
  ["settings/otp", "บัญชีรับรหัส"],
  ["settings/members", "ทีมงาน"],
  ["settings/domains", "โดเมน"],
  ["settings/billing", "แพ็กเกจ"],
];
function Subnav({ items, current }: { items: string[][]; current: string }) {
  return (
    <nav className="reference-subnav" aria-label="เมนูย่อย">
      {items.map(([key, label]) => (
        <Link
          className={current === key ? "active" : ""}
          key={key}
          to={"/admin/" + key}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
function codeId(id: string) {
  return id.slice(0, 8).toUpperCase();
}
export default function Admin() {
  const { user, path, overview, refresh, toast, go } = useStore();
  const [data, setData] = useState<AdminData | null>(null);
  // Phones show each table row as a card; label every cell with its column title.
  useEffect(() => {
    const label = () =>
      document.querySelectorAll(".merchant-shell table").forEach((table) => {
        const heads = [...table.querySelectorAll("thead th")].map(
          (th) => th.textContent?.trim() ?? "",
        );
        table.querySelectorAll("tbody tr").forEach((row) =>
          [...row.children].forEach((cell, i) => {
            if (cell.getAttribute("data-label") !== (heads[i] ?? ""))
              cell.setAttribute("data-label", heads[i] ?? "");
          }),
        );
      });
    label();
    const observer = new MutationObserver(label);
    const root = document.querySelector(".merchant-shell") ?? document.body;
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [importing, setImporting] = useState(false);
  const [range, setRange] = useState("today");
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [features, setFeatures] = useState<Features>({});
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pairs, setPairs] = useState<Credential[]>([{ loginId: "", password: "" }]);
  // Accounts (ID + password) are the default; single license codes stay available.
  const [importKind, setImportKind] = useState<"pair" | "code">("pair");
  const pairMode = features.credentialPair && importKind === "pair";
  const tab = path.split("/")[2] ?? "";
  const sub = path.split("/").slice(2).join("/");
  const productGroup = productTabs.some(([key]) => key === tab);
  const orderGroup = orderTabs.some(([key]) => key === tab);
  const productId = path.split("/")[3];
  const editingProduct = data?.products.find(
    (p) => p.id === (editing ?? productId),
  );
  const newProduct = tab === "products" && productId === "new";
  const formOpen = newProduct || !!editingProduct;
  useDialog(importing, ".reference-import-modal", () => setImporting(false));
  async function load() {
    try {
      setData(await api<AdminData>("/admin"));
      const health = await api<{ features?: Features }>("/health");
      setFeatures(health.features ?? {});
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (user?.role === "ADMIN") void load();
  }, [user?.id]);
  async function loadQueue() {
    try {
      setQueue((await api<{ queue: QueueItem[] }>("/queue")).queue);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (user?.role === "ADMIN" && tab === "preorders") void loadQueue();
  }, [user?.id, tab]);
  useEffect(() => {
    if (importing) setPairs([{ loginId: "", password: "" }]);
  }, [importing]);
  async function deliver(item: QueueItem) {
    setBusy(true);
    setError("");
    try {
      await api("/admin/reservations/" + item.id + "/deliver", {});
      setConfirming(null);
      await loadQueue();
      await load();
      toast("ส่งของคิว #" + item.queue_number + " แล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function pastePairs(e: ClipboardEvent<HTMLInputElement>, index: number) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const rows = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const [loginId = "", ...rest] = line.split("\t");
        return { loginId: loginId.trim(), password: rest.join("\t") };
      });
    setPairs((current) => [
      ...current.slice(0, index),
      ...rows,
      ...current.slice(index + 1),
    ]);
  }
  useEffect(() => {
    setQuery("");
    setStatus("all");
    setImporting(false);
    setConfirming(null);
    setEditing(null);
  }, [path]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api<{ id: string }>("/admin/products", {
        ...values,
        name: values.name,
        description: values.description,
        category: values.category ?? "streaming",
        price: Math.round(Number(values.price ?? 1) * 100),
        active: newProduct ? false : values.active === "on",
        ...(editingProduct ? { id: editingProduct.id } : {}),
      });
      await load();
      await refresh();
      toast(newProduct ? "สร้างฉบับร่างแล้ว" : "บันทึกสินค้าแล้ว");
      go("/admin/products/" + result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importCodes(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = Object.fromEntries(new FormData(e.currentTarget));
      const items = pairs.filter((p) => p.loginId.trim() || p.password);
      if (pairMode) {
        if (!items.length) throw new Error("กรุณาใส่ไอดีและรหัสผ่านอย่างน้อยหนึ่งรายการ");
        if (items.some((p) => !p.loginId.trim() || !p.password))
          throw new Error("ทุกแถวต้องมีทั้งไอดีและรหัสผ่าน");
      }
      const result = await api<{ imported: number }>(
        "/admin/inventory",
        pairMode
          ? {
              variantId: form.variantId,
              items: items.map((p) => ({
                loginId: p.loginId.trim(),
                password: p.password,
              })),
            }
          : form,
      );
      await load();
      await refresh();
      setImporting(false);
      toast(
        pairMode
          ? `นำเข้า ${result.imported} บัญชีสำเร็จ`
          : `นำเข้า ${result.imported} โค้ดสำเร็จ`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!data) return;
    const rows = [
      [
        "order",
        "customer",
        "product",
        "quantity",
        "test_thb",
        "status",
        "date",
      ],
      ...data.orders.map((o) => [
        o.id,
        o.customer,
        o.product,
        o.quantity,
        o.total / 100,
        o.status,
        o.created_at,
      ]),
    ];
    const csv =
      "\ufeff" +
      rows
        .map((row) =>
          row
            .map((x) => {
              let s = String(x);
              if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
              return '"' + s.replaceAll('"', '""') + '"';
            })
            .join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "astra-demo-orders.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  if (!user || user.role !== "ADMIN")
    return (
      <main className="reference-merchant-login">
        <div className="merchant-login-logo">A</div>
        <h1>เข้าสู่ระบบ</h1>
        <p>จัดการร้านค้าของคุณบน ASTRA</p>
        {user && (
          <p className="error-message">
            บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบจัดการร้านค้า
          </p>
        )}
        <Link to="/login?next=%2Fadmin" className="button primary full">
          เข้าสู่ระบบ
        </Link>
      </main>
    );
  if (!data)
    return (
      <main className="reference-admin-main">
        <ErrorMessage message={error} />
        <div className="loading-row">
          <LoaderCircle className="spin" />
          กำลังโหลด
        </div>
      </main>
    );
  const orders = data.orders.filter(
    (o) =>
      (status === "all" || o.status === status) &&
      (o.id + " " + o.product + " " + o.customer)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const filteredProducts = data.products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) &&
        (status === "all" || (status === "active" ? !!p.active : !p.active)),
    )
    .sort((a, b) => Number(b.preorder ?? 0) - Number(a.preorder ?? 0));
  const toolbar = (
    <div className="reference-table-toolbar">
      <label className="search-field">
        <Search size={16} />
        <input
          aria-label="ค้นหาในระบบจัดการร้าน"
          placeholder={
            tab === "products"
              ? "ค้นหาชื่อสินค้า"
              : tab === "customers"
                ? "ค้นหาลูกค้า"
                : "ค้นหาออเดอร์"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button
        className="button secondary filter-toggle"
        onClick={() => setStatus(status === "all" ? "DELIVERED" : "all")}
      >
        <Filter size={15} />
        ตัวกรอง
      </button>
    </div>
  );
  const recent = (
    <section className="reference-admin-card recent-orders">
      <div className="reference-card-heading">
        <h2>ออเดอร์ล่าสุด</h2>
        <Link to="/admin/orders">
          ดูทั้งหมด
          <ArrowRight size={15} />
        </Link>
      </div>
      {data.orders.slice(0, 6).map((o) => (
        <button
          className="reference-order-row"
          key={o.id}
          onClick={() => {
            go("/admin/orders");
            setQuery(o.id);
          }}
        >
          <span>
            <strong>{codeId(o.id)}</strong>
            <small>
              {o.customer} · {dateTime(o.created_at)}
            </small>
          </span>
          <span>
            <strong>{money(o.total)}</strong>
            <Status status={o.status} />
          </span>
        </button>
      ))}
    </section>
  );
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const start = new Date();
  if (range === "week") start.setDate(start.getDate() - 7);
  else if (range === "month") start.setDate(start.getDate() - 30);
  const period = data.orders.filter(
    (o) =>
      range === "all" ||
      (range === "today"
        ? o.created_at.startsWith(todayKey)
        : new Date(o.created_at + "Z") >= start),
  );
  const paid = period.filter(
    (o) => o.status === "DELIVERED" || o.status === "PREORDER",
  );
  const revenue = paid.reduce((n, o) => n + o.total, 0);
  const tasks = data.orders.filter(
    (o) => o.status === "PENDING_PAYMENT",
  ).length;
  return (
    <>
      {productGroup && <Subnav items={productTabs} current={tab} />}{" "}
      {orderGroup && <Subnav items={orderTabs} current={tab} />}{" "}
      {(tab === "payments" || tab === "top-ups") && (
        <Subnav
          items={[
            ["payments", "รับเงิน"],
            ["ledger", "ประวัติเงินเข้าออก"],
          ]}
          current={tab === "top-ups" ? "payments" : tab}
        />
      )}{" "}
      {tab === "settings" && <Subnav items={settingTabs} current={sub} />}
      <main
        className={
          "reference-admin-main " + (formOpen ? "reference-editor-main" : "")
        }
      >
        {!importing && <ErrorMessage message={error} />}
        {tab === "" || tab === "reports" ? (
          <>
            <div className="reference-overview-title">
              <div>
                <h1>{overview?.shop?.shopName || "ร้านค้า"}</h1>
                <p>{location.host}</p>
              </div>
              <div>
                <button
                  role="switch"
                  aria-checked={overview?.shop?.shopOpen !== false}
                  className="store-open-pill"
                  onClick={async () => {
                    try {
                      await api("/admin/settings", {
                        shopOpen: overview?.shop?.shopOpen === false,
                      });
                      await refresh();
                      toast("เปลี่ยนสถานะร้านแล้ว");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {overview?.shop?.shopOpen === false
                    ? "ร้านปิดอยู่"
                    : "ร้านเปิดอยู่"}
                  <span className="store-switch" />
                </button>
                <Link to="/" className="button secondary">
                  ดูหน้าร้าน
                  <ArrowUpRight size={15} />
                </Link>
              </div>
            </div>
            <ShopConfigCard />
            <section className="reference-admin-card setup-card">
              <div className="reference-card-heading">
                <button onClick={() => setExpanded(!expanded)}>
                  <h2>ตั้งร้านให้พร้อมขาย</h2>
                  <ChevronDown size={16} />
                </button>
                <Link to="/admin/guide">
                  อ่านคู่มือ
                  <ArrowRight size={15} />
                </Link>
              </div>
              <div className="setup-progress">
                <i>
                  <b />
                </i>
                <strong>4/5</strong>
              </div>
              {expanded && (
                <div className="setup-checklist">
                  {[
                    ["ตั้งช่องทางรับเงิน", "settings/payment", true],
                    ["ใส่โลโก้และคำอธิบายร้าน", "settings", true],
                    ["ตั้งวิธีจัดส่ง", "settings/shipping", false],
                    ["เพิ่มสินค้าชิ้นแรก", "products", true],
                    ["เปิดขายสินค้า", "products", true],
                  ].map(([label, to, done]) => (
                    <Link
                      key={label as string}
                      to={"/admin/" + to}
                      className={done ? "done" : ""}
                    >
                      {done ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                      <span>
                        {label as string}
                        {!done && <small>ถ้าขายของที่ต้องส่ง</small>}
                      </span>
                      {!done && <ChevronRight size={17} />}
                    </Link>
                  ))}
                </div>
              )}
            </section>
            <div className="reference-section-heading">
              <div>
                <h2>ยอดขายและเงินเข้า</h2>
                <p>เทียบเมื่อวาน</p>
              </div>
              <div className="segmented-control">
                {[
                  ["today", "วันนี้"],
                  ["week", "สัปดาห์นี้"],
                  ["month", "เดือนนี้"],
                  ["all", "เลือกเอง"],
                ].map(([key, label]) => (
                  <button
                    className={range === key ? "active" : ""}
                    key={key}
                    onClick={() => setRange(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <section className="reference-admin-metrics">
              {[
                ["ยอดขาย", money(revenue), "ยังไม่มีทั้งสองช่วง"],
                [
                  "ออเดอร์ที่ชำระแล้ว",
                  String(paid.length),
                  "ยังไม่มีทั้งสองช่วง",
                ],
                ["รหัสสินค้าคงเหลือ", String(data.stock), "ชิ้นที่ยังไม่ถูกส่ง"],
                [
                  "ลูกค้าใหม่",
                  String(
                    data.customers.filter((c) =>
                      c.created_at.startsWith(todayKey),
                    ).length,
                  ),
                  "ลูกค้าทั้งหมด " +
                    data.customers.filter((c) => c.role === "CUSTOMER").length +
                    " คน",
                ],
              ].map(([label, value, note]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{note}</small>
                </div>
              ))}
            </section>
            <div className="reference-dashboard-grid">
              <section className="reference-admin-card sales-graph">
                <div className="reference-card-heading">
                  <h2>ยอดขายตามช่วงเวลา</h2>
                  <div className="segmented-control small">
                    <button className="active">ยอดขาย</button>
                    <button onClick={() => go("/admin/payments")}>
                      เงินเติมเข้า
                    </button>
                  </div>
                </div>
                {paid.length ? (
                  <div className="reference-sales-bars">
                    {paid.slice(-7).map((o) => (
                      <div key={o.id}>
                        <span>{money(o.total)}</span>
                        <i
                          style={{
                            height: Math.max(
                              5,
                              (o.total /
                                Math.max(...paid.map((x) => x.total))) *
                                180,
                            ),
                          }}
                        />
                        <small>{dateTime(o.created_at).split(" ").slice(0,3).join(" ")}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="reference-chart-empty">
                    ยังไม่มียอดขายในช่วงนี้
                  </div>
                )}
              </section>
              <section className="reference-admin-card tasks-card">
                <div className="reference-card-heading">
                  <h2>งานที่ต้องทำ</h2>
                  <span>{tasks} เรื่อง</span>
                </div>
                {tasks ? (
                  <Link to="/admin/orders" className="task-item">
                    <span className="task-icon">
                      <Receipt size={24} />
                    </span>
                    <div>
                      <strong>ออเดอร์รอชำระ</strong>
                      <p>คำสั่งซื้อที่บันทึกแล้วและยังรอการชำระเงิน</p>
                    </div>
                    <b>{tasks}</b>
                    <ChevronRight size={17} />
                  </Link>
                ) : (
                  <p className="reference-empty-text">ไม่มีงานค้างในขณะนี้</p>
                )}
              </section>
              <section className="reference-admin-card">
                <div className="reference-card-heading">
                  <h2>ลูกค้าจ่ายด้วยอะไร</h2>
                </div>
                <p className="reference-empty-text">
                  {tasks
                    ? tasks + " รายการรอเชื่อมช่องทางชำระเงิน"
                    : paid.length
                      ? paid.length + " รายการที่จัดส่งแล้ว"
                      : "ยังไม่มีออเดอร์ในช่วงนี้"}
                </p>
              </section>
              <section className="reference-admin-card">
                <div className="reference-card-heading">
                  <h2>ขายดีที่สุด</h2>
                </div>
                {paid.length ? (
                  data.products
                    .filter((p) => paid.some((o) => o.product_id === p.id))
                    .map((p) => (
                      <div className="reference-bestseller" key={p.id}>
                        <span>{p.name}</span>
                        <strong>
                          {paid
                            .filter((o) => o.product_id === p.id)
                            .reduce((n, o) => n + o.quantity, 0)}{" "}
                          ชิ้น
                        </strong>
                      </div>
                    ))
                ) : (
                  <p className="reference-empty-text">
                    ยังไม่มีสินค้าที่ขายได้ในช่วงนี้
                  </p>
                )}
              </section>
              {recent}
            </div>
          </>
        ) : null}
        {tab === "products" && !formOpen && (
          <>
            <div className="reference-admin-heading">
              <div>
                <h1>สินค้า</h1>
                <p>
                  สินค้าแต่ละชิ้นมีได้หลายตัวเลือกราคา
                  และแต่ละตัวเลือกมีสต็อกของตัวเอง
                </p>
              </div>
              <Link to="/admin/products/new" className="button primary">
                <Plus size={16} />
                เพิ่มสินค้า
              </Link>
            </div>
            <div className="reference-status-tabs">
              {[
                ["all", "ทั้งหมด"],
                ["active", "เปิดขาย"],
                ["draft", "ฉบับร่าง"],
                ["inactive", "ปิดขาย"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={status === key ? "active" : ""}
                  onClick={() => setStatus(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {toolbar}
            <div className="table-scroll reference-table">
              <table>
                <thead>
                  <tr>
                    <th>สินค้า</th>
                    <th>ราคา</th>
                    <th>สต็อก</th>
                    <th>อัปเดต</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="merchant-product-cell">
                          <div className="merchant-product-art">
                            <Art small type={p.art} name={p.name} />
                          </div>
                          <div>
                            <Link to={"/admin/products/" + p.id}>{p.name}</Link>
                            <span className="product-state">
                              <span>{p.active ? "เปิดขาย" : "ฉบับร่าง"}</span>
                              {!!p.preorder && <span>เปิดจอง</span>}
                            </span>
                            <small>
                              /
                              {p.id === "stream-plus"
                                ? "disney"
                                : p.id === "cinema-max"
                                  ? "monomax"
                                  : p.id}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {money(Math.min(...p.variants.map((v) => v.price)))}
                        {p.variants.length > 1 &&
                          " – " +
                            money(Math.max(...p.variants.map((v) => v.price)))}
                      </td>
                      <td>
                        <button
                          className="stock-link"
                          onClick={() => {
                            go("/admin/inventory");
                            setQuery(p.name);
                          }}
                        >
                          {p.variants.reduce((n, v) => n + v.stock, 0)}
                        </button>
                      </td>
                      <td className="muted">เมื่อวานซืน</td>
                      <td>
                        <Link
                          to={"/admin/products/" + p.id}
                          className="icon-button"
                          aria-label={"แก้ไข " + p.name}
                        >
                          <MoreHorizontal size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {formOpen && (
          <>
            <Link to="/admin/products" className="back-link">
              <ArrowLeft size={15} />
              สินค้า
            </Link>
            <div className="reference-admin-heading">
              <h1>{newProduct ? "เพิ่มสินค้า" : editingProduct?.name}</h1>
              {editingProduct && (
                <Link
                  to={"/products/" + editingProduct.id}
                  className="button secondary"
                >
                  ดูหน้าสินค้า
                  <ArrowUpRight size={15} />
                </Link>
              )}
            </div>
            <form
              onSubmit={save}
              className="reference-product-editor"
              key={editingProduct?.id ?? "new"}
            >
              <section className="reference-admin-card editor-panel">
                <h2>ข้อมูลสินค้า</h2>
                <p>
                  สินค้าใหม่เริ่มเป็นฉบับร่าง ลูกค้ายังไม่เห็น
                  เพิ่มราคาและสต็อกให้เรียบร้อยแล้วค่อยกดเปิดขาย
                </p>
                <label className="field">ประเภทสินค้า</label>
                <div className="product-type-option">
                  <Package size={22} />
                  <div>
                    <strong>สินค้าดิจิทัล</strong>
                    <small>
                      ไอดี คีย์ โค้ด ส่งให้อัตโนมัติทันทีหลังชำระเงิน
                    </small>
                  </div>
                  <CheckCircle2 size={17} />
                </div>
                <label className="field">
                  ชื่อสินค้า
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={editingProduct?.name}
                  />
                </label>
                <label className="field">
                  ลิงก์สินค้า
                  <div className="slug-input">
                    <span>/products/</span>
                    <input
                      name="slug"
                      readOnly
                      defaultValue={
                        editingProduct?.id === "stream-plus"
                          ? "disney"
                          : editingProduct?.id === "cinema-max"
                            ? "monomax"
                            : (editingProduct?.id ??
                              "กำหนดให้อัตโนมัติหลังสร้าง")
                      }
                    />
                  </div>
                  <small>
                    ลิงก์สำหรับสินค้าจะถูกกำหนดให้อัตโนมัติในร้านทดลอง
                  </small>
                </label>
                <label className="field">
                  รายละเอียด
                  <textarea
                    aria-label="รายละเอียด"
                    name="description"
                    minLength={5}
                    maxLength={1000}
                    required
                    defaultValue={editingProduct?.description}
                  />
                  <small>แสดงในหน้าสินค้า รองรับการขึ้นบรรทัดใหม่</small>
                </label>
                <label className="field">
                  หมวดหมู่
                  <select
                    name="category"
                    defaultValue={editingProduct?.category ?? "streaming"}
                  >
                    {overview?.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="featured"
                    defaultChecked={!!editingProduct?.featured}
                  />
                  สินค้าแนะนำ
                </label>
                <p className="field-help">
                  แสดงในส่วน “สินค้าแนะนำ” บนหน้าแรกของร้าน
                </p>
              </section>
              {!newProduct && (
                <>
                  <section className="reference-admin-card editor-panel">
                    <h2>รูปภาพ</h2>
                    <div className="editor-product-image">
                      <Art
                        type={editingProduct!.art}
                        name={editingProduct!.name}
                      />
                    </div>
                  </section>
                  <section className="reference-admin-card editor-panel">
                    <h2>ตัวเลือกราคาและสต็อก</h2>
                    <label className="field">
                      ราคา (บาท)
                      <input
                        name="price"
                        type="number"
                        step="0.01"
                        min="1"
                        max="100000"
                        required
                        defaultValue={
                          Math.max(
                            1,
                            editingProduct!.variants.find((v) => v.price > 0)
                              ?.price ?? 100,
                          ) / 100
                        }
                      />
                    </label>
                    <div className="editor-variant-list">
                      {editingProduct!.variants.map((v) => (
                        <div key={v.id}>
                          <span>
                            {v.label}
                            <small>{money(v.price)}</small>
                          </span>
                          <strong>{v.stock} ชิ้น</strong>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setImporting(true)}
                    >
                      <Plus size={15} />
                      เติมสต็อก
                    </button>
                  </section>
                  <section className="reference-admin-card editor-panel">
                    <h2>สถานะสินค้า</h2>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={!!editingProduct?.active}
                      />
                      เปิดขายสินค้า
                    </label>
                  </section>
                </>
              )}
              <div className="editor-save-bar">
                <span>
                  {newProduct
                    ? "ขั้นถัดไป: รูปภาพ ตัวเลือกราคา และสต็อก แล้วกดเปิดขาย"
                    : "มีการแก้ไขที่ยังไม่บันทึก"}
                </span>
                <Link className="button secondary" to="/admin/products">
                  ยกเลิก
                </Link>
                <button className="button primary" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : null}
                  {newProduct ? "สร้างฉบับร่าง" : "บันทึก"}
                </button>
              </div>
            </form>
          </>
        )}
        {tab === "inventory" && (
          <>
            <div className="reference-admin-heading">
              <div>
                <h1>บัญชีสต็อก</h1>
                <p>สต็อกพร้อมส่งแยกตามสินค้าและตัวเลือก</p>
              </div>
              <button
                className="button primary"
                onClick={() => setImporting(true)}
              >
                <Plus size={16} />
                นำเข้าโค้ด
              </button>
            </div>
            {toolbar}
            <div className="table-scroll reference-table">
              <table>
                <thead>
                  <tr>
                    <th>สินค้า</th>
                    <th>ตัวเลือก</th>
                    <th>ราคา</th>
                    <th>พร้อมส่ง</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products
                    .filter((p) =>
                      p.name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .flatMap((p) =>
                      p.variants.map((v) => (
                        <tr key={v.id}>
                          <td>{p.name}</td>
                          <td>{v.label}</td>
                          <td>{money(v.price)}</td>
                          <td>{v.stock}</td>
                          <td>
                            <span
                              className={
                                "status " + (v.stock ? "status-delivered" : "")
                              }
                            >
                              {p.preorder
                                ? "สั่งจอง"
                                : v.stock
                                  ? "พร้อมส่ง"
                                  : "สินค้าหมด"}
                            </span>
                          </td>
                        </tr>
                      )),
                    )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === "orders" && (
          <>
            <div className="reference-admin-heading">
              <div>
                <h1>ออเดอร์</h1>
                <p>ออเดอร์ที่ยังไม่ชำระแสดงแยกจากสินค้าที่จัดส่งสำเร็จแล้ว</p>
              </div>
              <button className="button secondary" onClick={download}>
                <Download size={15} />
                ดาวน์โหลด CSV
              </button>
            </div>
            <div className="reference-status-tabs">
              {[
                ["all", "ทั้งหมด"],
                ["PENDING_PAYMENT", "รอชำระ"],
                ["PREORDER", "ต้องจัดส่ง"],
                ["DELIVERED", "สำเร็จ"],
                ["FAILED", "ยกเลิก"],
                ["OUT_OF_STOCK", "สินค้าหมด"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={status === key ? "active" : ""}
                  onClick={() => setStatus(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {toolbar}
            <div className="table-scroll reference-table">
              <table>
                <thead>
                  <tr>
                    <th>ออเดอร์</th>
                    <th>ลูกค้า</th>
                    <th>สถานะ</th>
                    <th>การชำระ</th>
                    <th>ยอดรวม</th>
                    <th>วันที่</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong className="order-number">{codeId(o.id)}</strong>
                        <small>
                          {o.product} · {o.quantity} ชิ้น
                        </small>
                      </td>
                      <td>{o.customer}</td>
                      <td>
                        <Status status={o.status} />
                      </td>
                      <td>
                        {["DELIVERED", "PREORDER"].includes(o.status)
                          ? "ชำระแล้ว"
                          : "ยังไม่ชำระ"}
                      </td>
                      <td>{money(o.total)}</td>
                      <td>{dateTime(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!orders.length && (
                <p className="reference-empty-text">ยังไม่มีออเดอร์</p>
              )}
            </div>
          </>
        )}
        {tab === "preorders" && (
          <>
            <div className="reference-admin-heading">
              <div>
                <h1>คิวพรีออเดอร์</h1>
                <p>
                  เลขคิวออกเมื่อลูกค้าชำระเงินสำเร็จ เรียงตามลำดับการจ่าย
                  ส่งของตามคิวจากบนลงล่าง
                </p>
              </div>
              <button className="button secondary" onClick={() => void loadQueue()}>
                <History size={15} />
                โหลดใหม่
              </button>
            </div>
            {!features.preorderDelivery && (
              <p className="note-box queue-pending-note" role="note">
                ปุ่มส่งของจะใช้ได้หลังอัปเดตฐานข้อมูลรอบถัดไป ตอนนี้ดูลำดับคิวได้อย่างเดียว
              </p>
            )}
            <div className="table-scroll reference-table">
              <table>
                <thead>
                  <tr>
                    <th>คิว</th>
                    <th>ลูกค้า</th>
                    <th>สินค้า</th>
                    <th>ยอดรวม</th>
                    <th>ชำระเมื่อ</th>
                    <th>สถานะ</th>
                    <th>ส่งของ</th>
                  </tr>
                </thead>
                <tbody>
                  {(queue ?? []).map((q) => (
                    <tr key={q.id}>
                      <td>
                        <strong className="order-number">#{q.queue_number}</strong>
                      </td>
                      <td>{q.customer}</td>
                      <td>
                        {q.product}
                        <small>
                          {q.label} · {q.quantity} ชิ้น
                        </small>
                      </td>
                      <td>{money(q.total)}</td>
                      <td>{dateTime(q.created_at)}</td>
                      <td>
                        <Status status={q.status} />
                      </td>
                      <td>
                        {q.status === "DELIVERED" ? (
                          <span className="muted">ส่งแล้ว</span>
                        ) : q.status !== "PREORDER" ? (
                          <span className="muted">—</span>
                        ) : confirming === q.id ? (
                          <span className="queue-confirm">
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => void deliver(q)}
                            >
                              {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                              ยืนยันส่งคิว #{q.queue_number}
                            </button>
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() => setConfirming(null)}
                            >
                              ยกเลิก
                            </button>
                          </span>
                        ) : (
                          <button
                            className="button secondary"
                            disabled={!features.preorderDelivery}
                            title={
                              features.preorderDelivery
                                ? undefined
                                : "รออัปเดตฐานข้อมูล (DB-005)"
                            }
                            onClick={() => setConfirming(q.id)}
                          >
                            <Package size={15} />
                            ส่งของ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {queue && !queue.length && (
                <p className="reference-empty-text">ยังไม่มีคิวพรีออเดอร์ที่ชำระแล้ว</p>
              )}
              {!queue && <p className="reference-empty-text">กำลังโหลดคิว…</p>}
            </div>
          </>
        )}
        {tab === "customers" && (
          <>
            <div className="reference-admin-heading">
              <div>
                <h1>ลูกค้า</h1>
                <p>
                  บัญชีลูกค้าแยกตามร้าน ลูกค้าคนเดียวกันต้องสมัครใหม่ในแต่ละร้าน
                </p>
              </div>
            </div>
            {toolbar}
            <div className="table-scroll reference-table">
              <table>
                <thead>
                  <tr>
                    <th>ลูกค้า</th>
                    <th>สถานะ</th>
                    <th>ยอดเงิน</th>
                    <th>สมัครเมื่อ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers
                    .filter(
                      (c) =>
                        c.role === "CUSTOMER" &&
                        (c.name + " " + c.email)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div className="merchant-customer-cell">
                            <span className="avatar">{c.name.slice(0, 2)}</span>
                            <span>
                              {c.name}
                              <small>
                                {c.email.endsWith(".local") ? "—" : c.email}
                              </small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="status">ปกติ</span>
                        </td>
                        <td>
                          {money(
                            data.ledger
                              .filter(
                                (l) =>
                                  (l as { user_id?: string }).user_id === c.id,
                              )
                              .reduce((n, l) => n + l.amount, 0),
                          )}
                        </td>
                        <td>{dateTime(c.created_at).split(" ").slice(0,3).join(" ")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {["payments", "top-ups", "ledger"].includes(tab) && (
          <>
            <div className="reference-admin-heading">
              <div>
                <h1>{tab === "ledger" ? "ประวัติเงินเข้าออก" : "รับเงิน"}</h1>
                <p>
                  รายการรับเงินในระบบ ช่องทางจ่ายภายนอกยังไม่เชื่อม
                </p>
              </div>
            </div>
            <div className="reference-status-tabs">
              <button className="active">รายการ</button>
              <Link to="/admin/ledger">ประวัติเงินเข้าออก</Link>
            </div>
            {toolbar}
            <div className="table-scroll reference-table">
              <table>
                <thead>
                  <tr>
                    <th>ลูกค้า</th>
                    <th>สถานะ</th>
                    <th>หมายเหตุ</th>
                    <th>ยอดโอน</th>
                    <th>เข้ายอด</th>
                    <th>วันที่</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger
                    .filter(
                      (l) =>
                        (tab === "ledger" || l.amount > 0) &&
                        (l.name + " " + l.label)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((l) => (
                      <tr key={l.id}>
                        <td>{l.name}</td>
                        <td>
                          <span className="status status-delivered">
                            {l.amount > 0 ? "สำเร็จ" : "ชำระแล้ว"}
                          </span>
                        </td>
                        <td>{l.label}</td>
                        <td>{money(Math.abs(l.amount))}</td>
                        <td className={l.amount > 0 ? "positive" : ""}>
                          {l.amount > 0 ? "+" : "−"}
                          {money(Math.abs(l.amount))}
                        </td>
                        <td>{dateTime(l.created_at)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === "settings" && <ReferenceSettings sub={sub} />}
        {tab === "guide" && (
          <div className="reference-admin-card editor-panel">
            <h1>คู่มือร้านค้า</h1>
            <h2>เริ่มขายสินค้าดิจิทัล</h2>
            <p>
              เพิ่มสินค้า → ตั้งตัวเลือกราคา → เติมโค้ดทดลอง → เปิดขาย →
              เปิดหน้าร้านและทดลองสั่งซื้อ
            </p>
            <Link to="/admin/products" className="button primary">
              ไปที่สินค้า
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
        {![
          "",
          "reports",
          "products",
          "inventory",
          "orders",
          "preorders",
          "customers",
          "payments",
          "top-ups",
          "ledger",
          "settings",
          "guide",
        ].includes(tab) && (
          <section className="reference-admin-card editor-panel">
            <h1>
              {[...productTabs, ...orderTabs].find(
                ([key]) => key === tab,
              )?.[1] ?? "รายการ"}
            </h1>
            <p>ยังไม่มีรายการในร้านทดลองนี้</p>
            {tab === "categories" &&
              overview?.categories.map((c) => (
                <div className="settings-row" key={c.id}>
                  <span>{c.name}</span>
                  <strong>
                    {data.products.filter((p) => p.category === c.id).length}{" "}
                    สินค้า
                  </strong>
                </div>
              ))}
            {tab === "reviews" && (
              <Link to="/reviews" className="button secondary">
                เปิดเครดิตร้าน
                <ArrowUpRight size={15} />
              </Link>
            )}
          </section>
        )}
        {importing && (
          <div
            className="reference-modal-backdrop"
            onClick={() => setImporting(false)}
          >
            <section
              className="reference-import-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="reference-card-heading">
                <h2 id="import-title">เติมสต็อก</h2>
                <button
                  className="icon-button"
                  aria-label="ปิด"
                  onClick={() => setImporting(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={importCodes}>
                <ErrorMessage message={error} />
                <label className="field">
                  สินค้าและตัวเลือก
                  <select
                    name="variantId"
                    defaultValue={
                      editingProduct?.variants.find((v) => v.stock > 0)?.id ??
                      editingProduct?.variants[0]?.id
                    }
                  >
                    {data.products.flatMap((p) =>
                      p.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {p.name} · {v.label}
                        </option>
                      )),
                    )}
                  </select>
                </label>
                {features.credentialPair && (
                  <div className="import-kind" role="radiogroup" aria-label="รูปแบบสินค้า">
                    {(
                      [
                        ["pair", "ไอดี + รหัสผ่าน"],
                        ["code", "โค้ดเดี่ยว"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="import-kind"
                          checked={importKind === value}
                          onChange={() => setImportKind(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
                {pairMode ? (
                  <fieldset className="credential-rows">
                    <legend>ไอดีและรหัสผ่าน</legend>
                    {pairs.map((pair, i) => (
                      <div className="credential-row" key={i}>
                        <label className="field">
                          ไอดี {i + 1}
                          <input
                            value={pair.loginId}
                            autoComplete="off"
                            maxLength={200}
                            onPaste={(e) => pastePairs(e, i)}
                            onChange={(e) =>
                              setPairs(pairs.map((p, j) => (j === i ? { ...p, loginId: e.target.value } : p)))
                            }
                          />
                        </label>
                        <label className="field">
                          รหัสผ่าน {i + 1}
                          <input
                            value={pair.password}
                            autoComplete="off"
                            maxLength={200}
                            onChange={(e) =>
                              setPairs(pairs.map((p, j) => (j === i ? { ...p, password: e.target.value } : p)))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={"ลบแถว " + (i + 1)}
                          disabled={pairs.length === 1}
                          onClick={() => setPairs(pairs.filter((_, j) => j !== i))}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="button secondary"
                      disabled={pairs.length >= 100}
                      onClick={() => setPairs([...pairs, { loginId: "", password: "" }])}
                    >
                      <Plus size={15} />
                      เพิ่มแถว
                    </button>
                    <p className="field-help">
                      คัดลอกสองคอลัมน์ (ไอดี, รหัสผ่าน) จาก Google Sheets หรือ Excel
                      แล้ววางในช่องไอดีแรกได้ทีเดียว · สูงสุด 100 รายการต่อครั้ง ·
                      รหัสผ่านเก็บแบบเข้ารหัส และส่งให้ลูกค้าหลังยืนยันการชำระเงินเท่านั้น
                    </p>
                  </fieldset>
                ) : (
                  <>
                    <label className="field">
                      โค้ด (หนึ่งโค้ดต่อบรรทัด)
                      <textarea
                        name="codes"
                        rows={7}
                        placeholder="รหัสสินค้าหนึ่งรายการต่อบรรทัด"
                        required
                      />
                    </label>
                    <p className="field-help">
                      ใส่รหัสสินค้าจริงได้ ระบบตรวจรหัสซ้ำก่อนบันทึก และยังไม่ส่งให้ลูกค้าก่อนยืนยันการชำระเงิน
                    </p>
                  </>
                )}
                <div className="form-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setImporting(false)}
                  >
                    ยกเลิก
                  </button>
                  <button className="button primary" disabled={busy}>
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Plus size={15} />
                    )}
                    นำเข้าโค้ด
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
function ShopConfigCard() {
  const { overview, refresh, toast } = useStore();
  const shop = overview?.shop;
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const initial = {
    shopName: shop?.shopName ?? "",
    line: shop?.line ?? "",
    email: shop?.email ?? "",
    description: shop?.description ?? "",
    announcement: shop?.announcement ?? "",
  };
  const [form, setForm] = useState(initial);
  const signature = Object.values(initial).join("|");
  // Reload the fields when the saved settings change (after save / refresh).
  useEffect(() => setForm(initial), [signature]);
  const dirty = Object.values(form).join("|") !== signature;
  const field =
    (name: keyof typeof form) =>
    (e: { target: { value: string } }) => {
      setSaved(false);
      setForm({ ...form, [name]: e.target.value });
    };
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      await api("/admin/settings", form);
      setSaved(true);
      toast("บันทึกข้อมูลร้านแล้ว");
      await refresh();
    } catch (err) {
      setSaved(false);
      setError((err as Error).message);
    }
  }
  return (
    <section className="reference-admin-card editor-panel shop-config">
      <div className="reference-card-heading">
        <div>
          <h2>ข้อมูลร้าน</h2>
          <p>พิมพ์ด้านขวา ดูผลบนหน้าร้านจริงด้านซ้ายทันที กดบันทึกเพื่อให้ลูกค้าเห็น</p>
        </div>
        <Link to="/admin/settings">
          ตั้งค่าเพิ่มเติม
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="shop-config-grid">
        <ShopPreview {...form} />
        <form onSubmit={save} className="shop-config-form">
          <ErrorMessage message={error} />
          <label className="field">
            ชื่อร้าน
            <input name="shopName" value={form.shopName} onChange={field("shopName")} required minLength={2} maxLength={80} />
          </label>
          <label className="field">
            ไอดี LINE
            <input name="line" value={form.line} onChange={field("line")} maxLength={200} placeholder="@lineid" />
          </label>
          <label className="field">
            อีเมลร้าน
            <input name="email" type="email" value={form.email} onChange={field("email")} maxLength={200} />
          </label>
          <label className="field">
            คำโปรยหน้าแรกและท้ายเว็บ
            <textarea name="description" value={form.description} onChange={field("description")} maxLength={1000} />
          </label>
          <label className="field">
            ประกาศหน้าแรก
            <textarea name="announcement" value={form.announcement} onChange={field("announcement")} maxLength={1000} />
          </label>
          <div className="form-actions">
            <span className={dirty ? "unsaved-dot" : ""}>
              {dirty ? "ยังไม่ได้บันทึก" : saved ? "บันทึกแล้ว" : "ตรงกับหน้าร้าน"}
            </span>
            {dirty && (
              <button type="button" className="button secondary" onClick={() => setForm(initial)}>
                ย้อนกลับ
              </button>
            )}
            <button className="button primary" disabled={!dirty}>
              บันทึกข้อมูลร้าน
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
/** The real storefront in a frame; unsaved fields are posted in as you type. */
function ShopPreview(draft: {
  shopName: string;
  line: string;
  email: string;
  description: string;
  announcement: string;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [ready, setReady] = useState(false);
  const [box, setBox] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const name =
    draft.shopName.trim() && draft.shopName.trim() !== "ร้านค้า"
      ? draft.shopName.trim()
      : "ASIA EXTRA";
  const send = () =>
    frame.current?.contentWindow?.postMessage(
      { type: "shop-preview", shop: draft },
      location.origin,
    );
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (
        e.origin === location.origin &&
        e.source === frame.current?.contentWindow &&
        e.data?.type === "shop-preview-ready"
      ) {
        setReady(true);
        send();
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  });
  useEffect(send, [draft.shopName, draft.line, draft.email, draft.description, draft.announcement]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => setBox(entry.contentRect.width));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const height = 560;
  const width = device === "desktop" ? 1280 : 390;
  const scale =
    device === "desktop" ? (box || 600) / width : Math.min(1, height / 800);
  return (
    <div className="shop-preview" aria-label="ตัวอย่างหน้าร้าน">
      <div className="shop-preview-bar">
        <i />
        <i />
        <i />
        <span className="shop-preview-tab">หน้าร้าน — {name}</span>
        <div className="shop-preview-devices" role="group" aria-label="ขนาดจอ">
          <button
            type="button"
            aria-pressed={device === "desktop"}
            aria-label="ดูแบบคอมพิวเตอร์"
            onClick={() => setDevice("desktop")}
          >
            <Monitor size={14} />
          </button>
          <button
            type="button"
            aria-pressed={device === "mobile"}
            aria-label="ดูแบบมือถือ"
            onClick={() => setDevice("mobile")}
          >
            <Smartphone size={14} />
          </button>
        </div>
        <a href="/" target="_blank" rel="noreferrer" aria-label="เปิดหน้าร้านในแท็บใหม่">
          <ExternalLink size={14} />
        </a>
      </div>
      <div
        ref={stage}
        className={"shop-preview-stage " + device}
        style={{ height }}
      >
        {!ready && (
          <div className="shop-preview-loading">
            <LoaderCircle className="spin" size={18} />
            กำลังโหลดหน้าร้าน
          </div>
        )}
        <iframe
          ref={frame}
          title="หน้าร้านจริง"
          src="/?shop-preview=1"
          style={{
            width,
            height: height / scale,
            transform: `scale(${scale})`,
          }}
        />
      </div>
      <p className="shop-preview-note">
        หน้าร้านจริง กดเล่นได้ · ข้อความที่ยังไม่บันทึกเห็นเฉพาะในกรอบนี้
      </p>
    </div>
  );
}
function ReferenceSettings({ sub }: { sub: string }) {
  const { toast, refresh, overview } = useStore();
  const shop = overview?.shop;
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      await api("/admin/settings", {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        requireTerms:
          new FormData(e.currentTarget).get("requireTerms") === "on",
      });
      setSaved(true);
      toast("บันทึกการตั้งค่าแล้ว");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const section = sub.split("/")[1] ?? "";
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>
            {section
              ? (settingTabs.find(([key]) => key === sub)?.[1] ?? "ร้าน")
              : "ร้าน"}
          </h1>
          <p>
            ชื่อ โลโก้ ช่องทางติดต่อ ประกาศ ข้อกำหนดร้าน ลำดับการส่งสต็อก
            และแจ้งเตือน
          </p>
        </div>
      </div>
      <form
        className="reference-settings-form"
        key={shop?.shopName + "|" + shop?.line + "|" + shop?.email}
        onSubmit={save}
      >
        <ErrorMessage message={error} />
        <section className="reference-admin-card editor-panel">
          <h2>ข้อมูลร้าน</h2>
          <p>ชื่อและคำอธิบายที่แสดงบนหน้าร้าน</p>
          <label className="field">
            ชื่อร้าน
            <input
              name="shopName"
              defaultValue={shop?.shopName ?? ""}
              required
              minLength={2}
              maxLength={80}
            />
          </label>
          <label className="field">
            คำอธิบายร้าน
            <textarea
              aria-label="รายละเอียด"
              name="description"
              defaultValue={shop?.description ?? ""}
              maxLength={1000}
            />
          </label>
        </section>
        <section className="reference-admin-card editor-panel">
          <h2>โลโก้</h2>
          <p>แนะนำรูปสี่เหลี่ยมจัตุรัสอย่างน้อย 256×256 px</p>
          <img
            src="/brand/favicon-64.png"
            className="settings-logo"
            alt=""
          />
        </section>
        <section className="reference-admin-card editor-panel">
          <h2>ช่องทางติดต่อ</h2>
          <p>แสดงที่ส่วนท้ายของหน้าร้าน ไม่บังคับ</p>
          {[
            ["facebook", "Facebook", ""],
            ["line", "LINE", "@832wjrpn"],
            ["discord", "Discord", ""],
            ["phone", "โทรศัพท์", ""],
            ["email", "อีเมล", "ceo.natthanan@shipx.sbs"],
          ].map(([key, label, value]) => (
            <label className="field" key={key}>
              {label}
              <input
                name={key}
                defaultValue={String(shop?.[key as keyof typeof shop] ?? value)}
                maxLength={200}
              />
            </label>
          ))}
        </section>
        <section className="reference-admin-card editor-panel">
          <h2>ประกาศ</h2>
          <p>
            แสดงเป็นการ์ดประกาศบนหน้าแรกของร้าน ใต้ส่วนหัว เว้นว่างเพื่อซ่อน
          </p>
          <label className="field">
            <textarea
              name="announcement"
              defaultValue={shop?.announcement ?? ""}
              maxLength={1000}
            />
          </label>
        </section>
        <section className="reference-admin-card editor-panel">
          <h2>ข้อกำหนดร้าน</h2>
          <p>ลูกค้าอ่านได้ที่ท้ายหน้าร้าน</p>
          <label className="field">
            ข้อกำหนด
            <textarea
              name="policy"
              maxLength={10000}
              defaultValue={shop?.policy ?? ""}
            />
          </label>
          <label className="checkbox-label">
            <input
              name="requireTerms"
              type="checkbox"
              defaultChecked={shop?.requireTerms !== false}
            />
            ให้ลูกค้ากดยอมรับก่อนสั่งซื้อ
          </label>
        </section>
        <section className="reference-admin-card editor-panel">
          <h2>ลำดับการส่งสต็อก</h2>
          <p>ลูกค้าซื้อแล้วได้ชิ้นไหนในสต็อก</p>
          <label className="field">
            <select
              name="stockOrder"
              defaultValue={shop?.stockOrder ?? "oldest"}
            >
              <option value="oldest">
                เก่าสุดก่อน · ชิ้นที่เติมก่อน ส่งก่อน
              </option>
              <option value="newest">
                ใหม่สุดก่อน · ชิ้นที่เพิ่งเติม ส่งก่อน
              </option>
              <option value="random">สุ่ม · หยิบชิ้นไหนก็ได้ในสต็อก</option>
            </select>
          </label>
        </section>
        <div className="editor-save-bar">
          <span>
            {saved ? "บันทึกการเปลี่ยนแปลงแล้ว" : "มีการแก้ไขที่ยังไม่บันทึก"}
          </span>
          <button type="reset" className="button secondary">
            ยกเลิก
          </button>
          <button className="button primary">บันทึก</button>
        </div>
      </form>
    </>
  );
}
