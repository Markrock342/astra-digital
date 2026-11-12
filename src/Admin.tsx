import { useEffect, useRef, useState, type FormEvent } from "react";
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
  Copy,
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
  Clock3,
} from "lucide-react";
import { useLive } from "./live";
import { Art, Empty, ErrorMessage, Link, Status, useStore } from "./App";
import { useDialog } from "./dialog";
import { api, dateTime, money } from "./api";
import { AdminDashboard } from "./AdminDashboard";
import { AdminChat, BuyerRanking, BuyerRankingCard, PaymentChannelSettings } from "./Ops";
import {
  PreorderQueue,
  ProductImages,
  ProductPreview,
  AdminAccount,
  AdminAudit,
  AdminReports,
  AdminTeam,
  StaffBackOffice,
  TestModeStockWarning,
  VariantManager,
  AdminCustomerDetail,
  AdminFinance,
  AdminCustomers,
  AdminOrderDetail,
  AdminOrders,
  AdminProducts,
} from "./AdminLists";
import { StockImport } from "./StockImport";
import type { AdminData, Features, Product, QueueItem } from "./types";
const productTabs = [
  ["products", "สินค้าทั้งหมด"],
  ["inventory", "บัญชีสต็อก"],
  ["categories", "หมวดหมู่"],
];
const orderTabs = [
  ["orders", "ออเดอร์ทั้งหมด"],
  ["preorders", "คิวพรีออเดอร์"],
];
const settingTabs = [
  ["settings", "ร้าน"],
  ["settings/payment", "รับเงิน"],
  ["settings/account", "บัญชีแอดมิน"],
  ["settings/audit", "ประวัติการทำงาน"],
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
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [features, setFeatures] = useState<Features>({});
  // Accounts (ID + password) are the default; single license codes stay available.
  const [importKind, setImportKind] = useState<"pair" | "code">("pair");
  const [importVariant, setImportVariant] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const pairMode = features.credentialPair !== false && importKind === "pair";
  const tab = path.split("/")[2] ?? "";
  const sub = path.split("/").slice(2).join("/");
  const productGroup = productTabs.some(([key]) => key === tab);
  const orderGroup = orderTabs.some(([key]) => key === tab);
  const productId = path.split("/")[3];
  const detailId = ["orders", "customers"].includes(tab) ? productId : undefined;
  const editingProduct = data?.products.find(
    (p) => p.id === (editing ?? productId),
  );
  const newProduct = tab === "products" && productId === "new";
  const formOpen = newProduct || !!editingProduct;
  const [formValues, setFormValues] = useState<Record<string, string> | null>(null);
  useEffect(() => setFormValues(null), [editingProduct?.id, newProduct]);
  const realProducts = data?.products ?? [];
  const setupSteps: [string, string, boolean][] = [
    ["ใส่ชื่อร้านและช่องทางติดต่อ", "settings", !!overview?.shop?.shopName],
    ["เพิ่มสินค้าชิ้นแรก", "products", realProducts.length > 0],
    [
      "เติมบัญชีสต็อกให้สินค้าพร้อมส่ง",
      "inventory",
      realProducts.some((p) => !p.preorder && p.variants.some((v) => v.stock > 0)),
    ],
    ["เปิดขายสินค้า", "products", realProducts.some((p) => p.active)],
  ];
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
  // Orders, stock and queue counts refresh the moment anything changes.
  useLive(["orders", "catalog", "customers"], () => {
    if (user?.role === "ADMIN") void load();
  });
  useEffect(() => {
    if (user?.role === "ADMIN") void load();
  }, [user?.id]);
  useEffect(() => {
    setQuery("");
    setImporting(false);
    setEditing(null);
  }, [path]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { type, ...values } = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api<{ id: string }>("/admin/products", {
        ...values,
        preorder: type === "preorder",
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
  /** Draft copy of a product (inactive, no stock), then open it in the editor. */
  async function duplicateProduct(id: string) {
    const result = await api<{ id: string; name: string }>("/admin/products/" + id + "/duplicate", {});
    await load();
    toast("คัดลอกเป็นฉบับร่างแล้ว: " + result.name);
    go("/admin/products/" + result.id);
  }
  if (user?.role === "STAFF")
    return (
      <>
        {orderGroup && <Subnav items={orderTabs} current={tab} />}
        <main className="reference-admin-main">
          <StaffBackOffice tab={tab} sub={sub} detailId={detailId} />
        </main>
      </>
    );
  if (!user || user.role !== "ADMIN")
    return (
      <main className="reference-merchant-login">
        <div className="merchant-login-logo">AX</div>
        <h1>เข้าสู่ระบบ</h1>
        <p>หลังบ้าน ASIA EXTRA สำหรับผู้ดูแลร้าน</p>
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
          onClick={() => go("/admin/orders/" + o.id)}
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
  return (
    <>
      {productGroup && <Subnav items={productTabs} current={tab} />}{" "}
      {orderGroup && <Subnav items={orderTabs} current={tab} />}{" "}
      {tab === "settings" && <Subnav items={settingTabs} current={sub} />}
      <main
        className={
          "reference-admin-main " + (formOpen ? "reference-editor-main" : "")
        }
      >
        {!importing && <ErrorMessage message={error} />}
        {tab === "reports" && <AdminReports />}
        {tab === "" ? (
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
                  <b
                    style={{
                      width:
                        (setupSteps.filter((step) => step[2]).length /
                          setupSteps.length) *
                          100 +
                        "%",
                    }}
                  />
                </i>
                <strong>
                  {setupSteps.filter((step) => step[2]).length}/
                  {setupSteps.length}
                </strong>
              </div>
              {expanded && (
                <div className="setup-checklist">
                  {setupSteps.map(([label, to, done]) => (
                    <Link
                      key={label as string}
                      to={"/admin/" + to}
                      className={done ? "done" : ""}
                    >
                      {done ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                      <span>
                        {label as string}
                      </span>
                      {!done && <ChevronRight size={17} />}
                    </Link>
                  ))}
                </div>
              )}
            </section>
            <AdminDashboard
              pendingPayment={data.pendingPayment}
              preorderQueue={data.preorderQueue}
            >
              <BuyerRankingCard />
              {recent}
            </AdminDashboard>
          </>
        ) : null}
        {tab === "products" && !formOpen && (
          <AdminProducts
            categories={overview?.categories ?? []}
            priceOf={(id) => {
              const p = data.products.find((x) => x.id === id);
              if (!p || !p.variants.length) return "–";
              const prices = p.variants.map((v) => v.price);
              const low = money(Math.min(...prices));
              return Math.max(...prices) > Math.min(...prices)
                ? low + " – " + money(Math.max(...prices))
                : low;
            }}
            onStock={(name) => {
              go("/admin/inventory");
              setQuery(name);
            }}
            onDuplicate={duplicateProduct}
          />
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
                <span className="reference-heading-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={duplicating}
                    onClick={async () => {
                      setDuplicating(true);
                      setError("");
                      try {
                        await duplicateProduct(editingProduct.id);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setDuplicating(false);
                      }
                    }}
                  >
                    {duplicating ? <LoaderCircle className="spin" size={15} /> : <Copy size={15} />}
                    คัดลอกสินค้า
                  </button>
                  <Link
                    to={"/products/" + editingProduct.id}
                    className="button secondary"
                  >
                    ดูหน้าสินค้า
                    <ArrowUpRight size={15} />
                  </Link>
                </span>
              )}
            </div>
            <div className="product-editor-layout">
            <aside className="product-preview-col" aria-label="ตัวอย่างบนหน้าร้าน">
              <ProductPreview
                categoryName={
                  overview?.categories.find(
                    (c) => c.id === (formValues?.category ?? editingProduct?.category ?? "streaming"),
                  )?.name ?? ""
                }
                draft={{
                  name: formValues?.name ?? editingProduct?.name ?? "",
                  description: formValues?.description ?? editingProduct?.description ?? "",
                  category: formValues?.category ?? editingProduct?.category ?? "streaming",
                  preorder: formValues ? formValues.type === "preorder" : !!editingProduct?.preorder,
                  active: formValues ? formValues.active === "on" : !!editingProduct?.active,
                  featured: formValues ? formValues.featured === "on" : !!editingProduct?.featured,
                  art: editingProduct?.art ?? "gift",
                  imageUrl: editingProduct?.images?.[0]?.url ?? editingProduct?.imageUrl ?? null,
                  variants: editingProduct
                    ? editingProduct.variants.map((v) => ({ id: v.id, label: v.label, price: v.price, stock: v.stock }))
                    : [
                        {
                          id: "new",
                          label: "ตัวเลือกแรก",
                          price: Math.round(Number(formValues?.price || 0) * 100),
                          stock: 0,
                        },
                      ],
                }}
              />
            </aside>
            <div className="product-editor-col">
            <form
              onSubmit={save}
              className="reference-product-editor"
              key={editingProduct?.id ?? "new"}
              onInput={(e) =>
                setFormValues(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>)
              }
              onChange={(e) =>
                setFormValues(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>)
              }
            >
              <section className="reference-admin-card editor-panel">
                <h2>ข้อมูลสินค้า</h2>
                <p>
                  สินค้าใหม่เริ่มเป็นฉบับร่าง ลูกค้ายังไม่เห็น
                  เพิ่มราคาและสต็อกให้เรียบร้อยแล้วค่อยกดเปิดขาย
                </p>
                <fieldset className="product-type-group">
                  <legend className="field">วิธีส่งของ</legend>
                  <label className="product-type-option">
                    <input
                      type="radio"
                      name="type"
                      value="ready"
                      defaultChecked={!editingProduct?.preorder}
                    />
                    <Package size={22} />
                    <div>
                      <strong>พร้อมส่ง</strong>
                      <small>
                        ส่ง ID และรหัสผ่านจากสต็อกให้อัตโนมัติทันทีหลังชำระเงิน
                      </small>
                    </div>
                    <CheckCircle2 size={17} className="product-type-check" />
                  </label>
                  <label className="product-type-option">
                    <input
                      type="radio"
                      name="type"
                      value="preorder"
                      defaultChecked={!!editingProduct?.preorder}
                    />
                    <Clock3 size={22} />
                    <div>
                      <strong>พรีออเดอร์</strong>
                      <small>
                        ลูกค้าจ่ายแล้วได้เลขคิว แอดมินส่งของภายหลังจากเมนูคิวพรีออเดอร์
                      </small>
                    </div>
                    <CheckCircle2 size={17} className="product-type-check" />
                  </label>
                </fieldset>
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
                {!newProduct && editingProduct && (
                  <div className="field">
                    ลิงก์สินค้า
                    <div className="slug-input">
                      <span>{location.origin}/products/</span>
                      <input readOnly aria-label="ลิงก์สินค้า" value={editingProduct.id} />
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(location.origin + "/products/" + editingProduct.id);
                          toast("คัดลอกลิงก์แล้ว");
                        }}
                      >
                        คัดลอก
                      </button>
                    </div>
                  </div>
                )}
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
                {newProduct && (
                  <label className="field">
                    ราคาตัวเลือกแรก (บาท)
                    <input name="price" type="number" step="0.01" min="1" max="100000" required />
                    <small>เพิ่มตัวเลือกอื่น (เช่น 30 วัน / 90 วัน) และเติมสต็อกได้หลังสร้าง</small>
                  </label>
                )}
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
                    ? "สร้างแล้วจะไปหน้าตัวเลือกและสต็อก จากนั้นเติมบัญชีแล้วกดเปิดขาย"
                    : "บันทึกข้อมูลสินค้า (ตัวเลือกและสต็อกบันทึกทันทีด้านล่าง)"}
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
            {editingProduct && !newProduct && features.uploads && (
              <ProductImages productId={editingProduct.id} images={editingProduct.images ?? []} />
            )}
            {editingProduct && !newProduct && (
              <VariantManager productId={editingProduct.id} preorder={!!editingProduct.preorder} />
            )}
            </div>
            </div>
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
                onClick={() => {
                  setImportVariant(
                    editingProduct?.variants.find((v) => v.stock > 0)?.id ??
                      editingProduct?.variants[0]?.id ??
                      data.products[0]?.variants[0]?.id ??
                      "",
                  );
                  setImporting(true);
                }}
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
        {tab === "orders" &&
          (detailId ? <AdminOrderDetail id={detailId} /> : <AdminOrders />)}
        {tab === "preorders" && <PreorderQueue />}
        {tab === "customers" &&
          (detailId ? (
            <AdminCustomerDetail id={detailId} />
          ) : (
            <AdminCustomers />
          ))}
        {["payments", "top-ups", "ledger"].includes(tab) && <AdminFinance />}
        {tab === "settings" &&
          (sub === "settings/payment" ? (
            <PaymentChannelSettings />
          ) : sub === "settings/team" ? (
            <AdminTeam />
          ) : sub === "settings/account" ? (
            <AdminAccount />
          ) : sub === "settings/audit" ? (
            <AdminAudit />
          ) : (
            <ReferenceSettings sub={sub} />
          ))}
        {tab === "team" && <AdminTeam />}
        {tab === "chat" && <AdminChat />}
        {tab === "rankings" && <BuyerRanking />}
        {tab === "guide" && (
          <div className="reference-admin-card editor-panel">
            <h1>คู่มือร้านค้า</h1>
            <h2>เริ่มขายสินค้าดิจิทัล</h2>
            <p>
              เพิ่มสินค้า → เลือกวิธีส่งของ (พร้อมส่ง หรือพรีออเดอร์) → ตั้งราคา →
              เติมบัญชีสต็อกแบบ ID + รหัสผ่าน (เฉพาะสินค้าพร้อมส่ง) → เปิดขาย
            </p>
            <h2>สินค้าพรีออเดอร์</h2>
            <p>
              ลูกค้าจ่ายแล้วได้เลขคิว เปิดเมนูออเดอร์ › คิวพรีออเดอร์
              แล้วกดส่งของเมื่อมีบัญชีพร้อม ลูกค้าจะได้แจ้งเตือนในเว็บ
            </p>
            <h2>ตอบแชทลูกค้า</h2>
            <p>
              เมนูแชทแสดงห้องที่ยังไม่อ่าน กระดิ่งมุมบนจะเด้งเมื่อมีแชทใหม่
              ออเดอร์ใหม่ หรือสต็อกใกล้หมด
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
          "team",
          "guide",
          "chat",
          "rankings",
        ].includes(tab) && (
          <section className="reference-admin-card editor-panel">
            <h1>
              {[...productTabs, ...orderTabs].find(
                ([key]) => key === tab,
              )?.[1] ?? "รายการ"}
            </h1>
            {tab !== "categories" && <p>ไม่พบหน้านี้</p>}
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
              <TestModeStockWarning />
              <div className="stock-import-body">
                <label className="field">
                  สินค้าและตัวเลือก
                  <select
                    value={importVariant}
                    onChange={(e) => setImportVariant(e.target.value)}
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
                {features.credentialPair !== false && (
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
                {importVariant && (
                  <StockImport
                    key={importVariant + ":" + (pairMode ? "pair" : "code")}
                    variantId={importVariant}
                    kind={pairMode ? "pair" : "code"}
                    label={pairMode ? "ไอดีและรหัสผ่าน (บรรทัดละ 1 บัญชี)" : "โค้ด (หนึ่งโค้ดต่อบรรทัด)"}
                    onCancel={() => setImporting(false)}
                    onDone={async () => {
                      await load();
                      await refresh();
                      setImporting(false);
                    }}
                  />
                )}
              </div>
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
