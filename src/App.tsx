import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
  type MouseEvent,
  lazy,
  Suspense,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  History,
  Home as HomeIcon,
  Languages,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  MessageCircle,
  Minus,
  Monitor,
  Moon,
  Package,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Sun,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
  LoaderCircle,
  KeyRound,
  AlertCircle,
  SlidersHorizontal,
  Clock,
} from "lucide-react";
import { api, money, dateTime, relativeTime } from "./api";
import type {
  Product,
  Variant,
  User,
  Order,
  Overview,
  Ledger,
  Review,
} from "./types";
import Stores, { MerchantHeader } from "./Stores";
import { CountUp, useRouteMotion } from "./motion";
import {
  ReferenceCatalog,
  ReferenceCatalogPage,
  ReferenceAuth,
  ReferenceReviews,
  ReferenceProduct,
} from "./ReferenceStore";
const Admin = lazy(() => import("./Admin"));
type Basket = { variantId: string; quantity: number };
type Store = {
  user: User | null;
  products: Product[];
  overview: Overview | null;
  basket: Basket | null;
  setBasket: (basket: Basket | null) => void;
  refresh: () => Promise<void>;
  go: (path: string) => void;
  toast: (message: string) => void;
  path: string;
  loading: boolean;
};
const Context = createContext<Store>(null!);
export const useStore = () => useContext(Context);
export function Link({
  to,
  children,
  className = "",
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  [key: string]: unknown;
}) {
  const { go } = useStore();
  return (
    <a
      href={to}
      className={className}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (
          e.button === 0 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey
        ) {
          e.preventDefault();
          go(to);
        }
      }}
    >
      {children}
    </a>
  );
}
export function Art({
  type,
  name,
  small = false,
}: {
  type: string;
  name: string;
  small?: boolean;
}) {
  if (type === "stream" || type === "cinema")
    return (
      <div
        className={`product-art art-${type} ${small ? "art-small" : ""}`}
        aria-label={name}
      >
        <img
          src={
            "/products/" + (type === "stream" ? "disney" : "monomax") + ".webp"
          }
          alt=""
          loading={small ? "eager" : "lazy"}
        />
      </div>
    );
  return (
    <div
      className={`product-art art-${type} ${small ? "art-small" : ""}`}
      aria-label={name}
    >
      <div className="art-grain" />
      {type === "stream" ? (
        <div className="stream-wordmark">
          <i />
          <span>
            Stream<span className="stream-plus">+</span>
          </span>
        </div>
      ) : type === "cinema" ? (
        <div className="cinema-wordmark">
          <span className="cinema-stamp">
            CI
            <br />
            NE
          </span>
          <strong>MAX</strong>
        </div>
      ) : (
        <div className="other-wordmark">
          <span className="art-symbol">
            {["sound", "audio", "podcast", "studio"].includes(type)
              ? "◖◗"
              : type === "gift"
                ? "A"
                : type === "play"
                  ? "▷"
                  : type === "cloud"
                    ? "◌"
                    : "✳"}
          </span>
          <strong>{name}</strong>
          <span className="art-caption">DIGITAL GOODS</span>
        </div>
      )}
    </div>
  );
}
export function Status({ status }: { status: string }) {
  const labels: Record<string, string> = {
    DELIVERED: "จัดส่งสำเร็จ",
    PENDING_PAYMENT: "รอชำระเงิน",
    FAILED: "ชำระเงินไม่สำเร็จ",
    CANCELLED: "ยกเลิกแล้ว",
    OUT_OF_STOCK: "สินค้าหมด",
    PREORDER: "รอส่งสินค้าสั่งจอง",
  };
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      {labels[status] ?? status}
    </span>
  );
}
export function Empty({
  icon,
  heading,
  description,
  action,
}: {
  icon: ReactNode;
  heading: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h2>{heading}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div role="alert" className="error-message">
      <AlertCircle size={17} />
      {message}
    </div>
  ) : null;
}
function Header() {
  const { path, user, basket, go, refresh, toast, overview } = useStore();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
  useEffect(() => {
    setOpen(false);
    setAccount(false);
  }, [path]);
  const links = [
    ["/", "หน้าแรก"],
    ["/products", "สินค้า"],
    ["/reviews", "รีวิว"],
    ["/orders", "ประวัติการซื้อ"],
  ];
  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" />
            <span>{overview?.shop?.shopName || "ร้านค้า"}</span>
          </Link>
          <nav
            aria-label="เมนูหลัก"
            className={open ? "main-nav nav-open" : "main-nav"}
          >
            {links.map(([to, label]) => (
              <Link
                key={to}
                to={to}
                className={
                  (
                    to === "/"
                      ? path === "/"
                      : path.startsWith(to) ||
                        (to === "/reviews" && path === "/credits")
                  )
                    ? "nav-link active"
                    : "nav-link"
                }
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <span className="language-label">
              <Languages size={19} />
              <span>ไทย</span>
            </span>
            <Link
              to="/cart"
              className="icon-button cart-button"
              aria-label="ตะกร้าสินค้า"
            >
              <ShoppingBag size={21} />
              {basket && <span className="cart-count">{basket.quantity}</span>}
            </Link>
            {user ? (
              <div className="account-wrap">
                <button
                  className="account-button"
                  onClick={() => setAccount(!account)}
                  aria-expanded={account}
                >
                  <span className="avatar">{user.name[0]}</span>
                  <span className="account-name">{user.name}</span>
                  <ChevronDown size={14} />
                </button>
                {account && (
                  <div className="account-menu">
                    <Link to="/account">บัญชีของฉัน</Link>
                    <Link to="/orders">คำสั่งซื้อของฉัน</Link>
                    {user.role === "ADMIN" && (
                      <Link to="/admin">จัดการร้านค้า</Link>
                    )}
                    <button
                      onClick={async () => {
                        await api("/logout", {});
                        await refresh();
                        setAccount(false);
                        toast("ออกจากระบบแล้ว");
                        go("/");
                      }}
                    >
                      <LogOut size={15} />
                      ออกจากระบบ
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link to="/login" className="login-link">
                  เข้าสู่ระบบ
                </Link>
                <Link to="/register" className="register-link">
                  สมัครสมาชิก
                </Link>
              </>
            )}
            <button
              className="icon-button mobile-menu"
              aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <nav className="mobile-bottom-nav" aria-label="เมนูมือถือ">
        <Link to="/" className={path === "/" ? "active" : ""}>
          <HomeIcon size={21} />
          <span>หน้าร้าน</span>
        </Link>
        <Link to="/cart" className={path === "/cart" ? "active" : ""}>
          <ShoppingBag size={21} />
          <span>ตะกร้า</span>
        </Link>
        <Link
          to="/orders"
          className={path.startsWith("/orders") ? "active" : ""}
        >
          <History size={21} />
          <span>ประวัติ</span>
        </Link>
        <button
          className={open ? "active" : ""}
          aria-label="เมนูลัด"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Menu size={21} />
          <span>เมนู</span>
        </button>
      </nav>
    </>
  );
}
function ThemeSwitch() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("astra-theme") ?? "dark",
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const update = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "light" : "dark") : theme);
    update();
    media.addEventListener("change", update);
    localStorage.setItem("astra-theme", theme);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  return (
    <div className="theme-switch" aria-label="รูปแบบสี">
      {[
        ["system", Monitor, "ตามระบบ"],
        ["light", Sun, "สว่าง"],
        ["dark", Moon, "มืด"],
      ].map(([value, Icon, label]) => {
        const Comp = Icon as typeof Sun;
        return (
          <button
            key={value as string}
            className={theme === value ? "selected" : ""}
            aria-label={`ธีม${label}`}
            aria-pressed={theme === value}
            onClick={() => setTheme(value as string)}
          >
            <Comp size={17} />
          </button>
        );
      })}
    </div>
  );
}
function Footer() {
  const { overview } = useStore();
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div className="footer-about">
          <Link to="/" className="brand footer-brand">
            <img src="/favicon.svg" alt="" />
            <span>{overview?.shop?.shopName || "ร้านค้า"}</span>
          </Link>
          <p>
            {overview?.shop?.description || "ร้านสินค้าดิจิทัล"}
          </p>
        </div>
        <div className="footer-contact">
          <h3>ติดต่อร้าน</h3>
          <div className="contact-links">
            <Link to="/support" className="contact-card">
              <span className="line-icon">
                <MessageCircle size={23} />
              </span>
              <span>
                LINE<small>{overview?.shop?.line || "ยังไม่ได้ตั้งค่า"}</small>
              </span>
              <ArrowUpRight size={16} />
            </Link>
            <Link to="/support#email" className="contact-card">
              <span className="mail-icon">
                <Mail size={23} />
              </span>
              <span>
                อีเมล
                <small>
                  {overview?.shop?.email || "ยังไม่ได้ตั้งค่า"}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <div className="footer-menu">
          <h3>เมนู</h3>
          <Link to="/products">สินค้าทั้งหมด</Link>
          <Link to="/reviews">เครดิตร้าน</Link>
          <Link to="/orders">ประวัติการซื้อ</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="container footer-bottom-inner">
          <span>
            © {new Date().getFullYear() + 543}{" "}
            {overview?.shop?.shopName || "ร้านค้า"}
          </span>
          <div className="footer-legal">
            <Link to="/terms">ข้อกำหนดร้าน</Link>
            <Link to="/privacy">ความเป็นส่วนตัว</Link>
            <span className="built-label">
              A<span>สร้างด้วย ASTRA</span>
            </span>
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </footer>
  );
}
export function ProductCard({ product }: { product: Product }) {
  const stock = product.variants.reduce((n, v) => n + v.stock, 0);
  return (
    <Link to={"/products/" + product.id} className="product-card">
      <div className="product-image">
        <Art type={product.art} name={product.name} />
        {!!product.preorder ? (
          <span className="stock-tag">สั่งจอง</span>
        ) : stock === 0 ? (
          <span className="stock-tag">สินค้าหมด</span>
        ) : null}
        <span className="card-hover-action">เลือกตัวเลือก</span>
      </div>
      <div className="product-card-info">
        <div className="product-title">
          <h3>{product.name}</h3>
          <ArrowUpRight size={18} />
        </div>
        <p>
          เริ่ม{" "}
          <strong>
            {money(Math.min(...product.variants.map((v) => v.price)))}
          </strong>
        </p>
        {(product.sold > 0 || product.rating?.count > 0) && (
          <div className="product-sold">
            {product.rating?.count > 0 && (
              <>
                <Star size={13} className="rating-star" />
                {product.rating.average?.toFixed(1)}
                <span> · </span>
              </>
            )}
            ขายแล้ว {product.sold} <span>รายการ</span>
          </div>
        )}
      </div>
    </Link>
  );
}
function Home() {
  const { overview, products, loading } = useStore();
  const [activityIndex, setActivityIndex] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(
      () =>
        setActivityIndex(
          (index) => (index + 1) % Math.max(overview?.activity.length ?? 1, 1),
        ),
      6000,
    );
    return () => clearInterval(timer);
  }, [overview?.activity.length]);
  const latestActivity =
    overview?.activity[activityIndex % (overview?.activity.length ?? 1)];
  return (
    <>
      <main className="container home-main">
        <section className="home-hero">
          <div className="hero-grid" aria-hidden="true">
            <i className="grid-streak streak-y streak-y-one" />
            <i className="grid-streak streak-y streak-y-two" />
            <i className="grid-streak streak-y streak-y-three" />
            <i className="grid-streak streak-x streak-x-one" />
            <i className="grid-streak streak-x streak-x-two" />
          </div>
          <span className="service-pill">
            <span className="service-dot" />
            {overview?.shop?.shopOpen === false
              ? "ปิดให้บริการ"
              : "เปิดให้บริการ"}
          </span>
          <h1>{overview?.shop?.shopName || "ร้านค้า"}</h1>
          <p>
            {overview?.shop?.description ||
              "เพิ่มสินค้าและข้อมูลร้านได้จากหลังบ้าน"}
          </p>
        </section>
        <section className="stats-panel" aria-label="สถิติร้านค้า">
          {[
            [Users, "ลูกค้า", overview?.customers, "คน"],
            [Package, "สินค้า", overview?.products, "ชิ้น"],
            [CreditCard, "คำสั่งซื้อ", overview?.orders, "รายการ"],
          ].map(([Icon, label, value, unit]) => {
            const Comp = Icon as typeof Users;
            return (
              <div className="stat" key={label as string}>
                <div className="stat-label">
                  <Comp size={20} />
                  {label as string}
                </div>
                <div className="stat-value">
                  {loading ? (
                    <span className="skeleton-number" />
                  ) : (
                    <CountUp value={(value as number) ?? 0} />
                  )}
                  <span>{unit as string}</span>
                </div>
              </div>
            );
          })}
        </section>
        <section className="activity-panel">
          {latestActivity && (
            <div className="mobile-activity-ticker">
              <span className="live-pill">
                <span className="service-dot" />
                สด
              </span>
              <div key={activityIndex} className="ticker-event">
                {latestActivity.kind === "register" ? (
                  <span className="activity-avatar">
                    <UserPlus size={20} />
                  </span>
                ) : (
                  <div className="activity-art">
                    <Art
                      small
                      type={latestActivity.art!}
                      name={latestActivity.product!}
                    />
                  </div>
                )}
                <div>
                  <p>
                    <strong>{latestActivity.name}</strong>{" "}
                    {latestActivity.kind === "register" ? (
                      "สมัครสมาชิก"
                    ) : (
                      <>
                        สั่งซื้อ <b>{latestActivity.product}</b>
                      </>
                    )}
                  </p>
                  <time>{relativeTime(latestActivity.time)}</time>
                </div>
              </div>
            </div>
          )}
          <div className="panel-heading">
            <h2>กิจกรรมล่าสุด</h2>
            <span className="live-pill">
              <span className="service-dot" />
              สด
            </span>
          </div>
          {overview?.activity.slice(0, 3).map((activity, i) => (
            <div className="activity-row" key={i}>
              {activity.kind === "register" ? (
                <span className="activity-avatar">
                  <UserPlus size={22} />
                </span>
              ) : (
                <div className="activity-art">
                  <Art small type={activity.art!} name={activity.product!} />
                </div>
              )}
              <div className="activity-text">
                <p>
                  <strong>{activity.name}</strong>{" "}
                  {activity.kind === "register" ? (
                    "สมัครสมาชิก"
                  ) : (
                    <>
                      สั่งซื้อ <b>{activity.product}</b>
                    </>
                  )}
                </p>
                {activity.kind === "purchase" && (
                  <small>{activity.label} · ×1</small>
                )}
              </div>
              <time>{relativeTime(activity.time)}</time>
            </div>
          ))}
          {loading && (
            <div className="loading-row">
              <LoaderCircle className="spin" />
              กำลังโหลดกิจกรรม
            </div>
          )}
        </section>
        {overview?.shop?.announcement ? (
          <aside className="announcement">
            <span className="announcement-icon">
              <Megaphone size={22} />
            </span>
            <div>
              <h2>ประกาศจากร้าน</h2>
              <p>{overview.shop.announcement}</p>
            </div>
          </aside>
        ) : null}
        <ReferenceCatalog />
      </main>
    </>
  );
}
function Catalog() {
  const { products, overview, loading } = useStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("featured");
  const [available, setAvailable] = useState(false);
  const filtered = products
    .filter(
      (p) =>
        (category === "all" || p.category === category) &&
        `${p.name} ${p.description}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!available || p.variants.some((v) => v.stock > 0)),
    )
    .sort((a, b) =>
      sort === "low"
        ? a.variants[0].price - b.variants[0].price
        : sort === "high"
          ? b.variants[0].price - a.variants[0].price
          : b.featured - a.featured,
    );
  return (
    <main className="container page-main">
      <div className="page-heading">
        <span className="eyebrow">DIGITAL COLLECTION</span>
        <h1>สินค้าทั้งหมด</h1>
        <p>เลือกสินค้าดิจิทัลที่ใช่สำหรับคุณ</p>
      </div>
      <div className="catalog-toolbar">
        <label className="search-field">
          <Search size={19} />
          <input
            aria-label="ค้นหาสินค้า"
            placeholder="ค้นหาชื่อสินค้า..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              onClick={() => setQuery("")}
              aria-label="ล้างการค้นหา"
            >
              <X size={16} />
            </button>
          )}
        </label>
        <label className="sort-field">
          <SlidersHorizontal size={16} />
          <select
            aria-label="เรียงสินค้า"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="featured">สินค้าแนะนำ</option>
            <option value="low">ราคา: ต่ำไปสูง</option>
            <option value="high">ราคา: สูงไปต่ำ</option>
          </select>
        </label>
      </div>
      <div className="category-bar">
        <button
          className={
            category === "all" ? "category-chip selected" : "category-chip"
          }
          onClick={() => setCategory("all")}
        >
          ทั้งหมด <span>{products.length}</span>
        </button>
        {overview?.categories.map((c) => (
          <button
            key={c.id}
            className={
              category === c.id ? "category-chip selected" : "category-chip"
            }
            onClick={() => setCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="catalog-meta">
        <span>พบ {filtered.length} สินค้า</span>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
          />
          เฉพาะสินค้าที่พร้อมขาย
        </label>
      </div>
      {loading ? (
        <div className="product-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="product-skeleton" />
          ))}
        </div>
      ) : filtered.length ? (
        <div className="product-grid">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <Empty
          icon={<Search />}
          heading="ไม่พบสินค้าที่ค้นหา"
          description="ลองใช้คำค้นอื่น หรือเลือกหมวดหมู่ทั้งหมด"
          action={
            <button
              className="button secondary"
              onClick={() => {
                setQuery("");
                setCategory("all");
                setAvailable(false);
              }}
            >
              ล้างตัวกรอง
            </button>
          }
        />
      )}
    </main>
  );
}
export function Quantity({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="quantity-control">
      <button
        aria-label="ลดจำนวน"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={15} />
      </button>
      <span aria-live="polite">{value}</span>
      <button
        aria-label="เพิ่มจำนวน"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
function ProductDetail({ id }: { id: string }) {
  const { products, setBasket, go, toast, loading } = useStore();
  const p = products.find((p) => p.id === id);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const variant = p?.variants.find((v) => v.id === variantId) ?? p?.variants[0];
  if (loading)
    return (
      <main className="container page-main">
        <div className="product-skeleton" />
      </main>
    );
  if (!p || !variant) return <NotFound />;
  const buy = (checkout: boolean) => {
    setBasket({ variantId: variant.id, quantity });
    if (checkout) go("/checkout");
    else {
      toast("เพิ่มสินค้าในตะกร้าแล้ว");
      go("/cart");
    }
  };
  return (
    <main className="container page-main">
      <div className="breadcrumbs">
        <Link to="/">หน้าแรก</Link>
        <span>/</span>
        <Link to="/products">สินค้า</Link>
        <span>/</span>
        <span>{p.name}</span>
      </div>
      <div className="product-detail">
        <div className="detail-art">
          <Art type={p.art} name={p.name} />
        </div>
        <div className="detail-info">
          <span className="eyebrow">สินค้า</span>
          <h1>{p.name}</h1>
          <div className="detail-stock">
            {variant.stock > 0 ? (
              <>
                <span className="service-dot" />
                พร้อมจัดส่ง · เหลือ {variant.stock} ชิ้น
              </>
            ) : (
              <span className="muted">สินค้าหมดชั่วคราว</span>
            )}
          </div>
          <p className="detail-description">{p.description}</p>
          <div className="detail-price">
            {money(variant.price)}
            <span>/ {variant.label}</span>
          </div>
          <fieldset className="variant-fieldset">
            <legend>เลือกแพ็กเกจ</legend>
            <div className="variant-options">
              {p.variants.map((v) => (
                <button
                  key={v.id}
                  className={
                    variant.id === v.id ? "variant selected" : "variant"
                  }
                  onClick={() => {
                    setVariantId(v.id);
                    setQuantity(1);
                  }}
                >
                  <span>{v.label}</span>
                  <strong>{money(v.price)}</strong>
                  {variant.id === v.id && <Check size={16} />}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="quantity-row">
            <span>จำนวน</span>
            <Quantity
              value={quantity}
              max={Math.min(10, variant.stock)}
              onChange={setQuantity}
            />
          </div>
          <button
            className="button primary full"
            disabled={!variant.stock}
            onClick={() => buy(true)}
          >
            <ShoppingBag size={18} />
            {variant.stock ? "ซื้อสินค้าเลย" : "สินค้าหมดชั่วคราว"}
            {variant.stock > 0 && (
              <span className="button-end">
                {money(variant.price * quantity)}
              </span>
            )}
          </button>
          <button
            className="button secondary full"
            disabled={!variant.stock}
            onClick={() => buy(false)}
          >
            เพิ่มลงตะกร้า
            <Plus size={17} />
          </button>
          <p className="detail-trust">
            <ShieldCheck size={17} />
            รับโค้ดผ่านหน้าคำสั่งซื้อหลังยืนยันการชำระเงิน
          </p>
        </div>
      </div>
      <section className="product-notes">
        <h2>รายละเอียดสินค้าและการใช้งาน</h2>
        <p>
          {p.description} เลือกแพ็กเกจที่ต้องการ ตรวจสอบคำสั่งซื้อ
          แล้วบันทึกคำสั่งซื้อ โค้ดจะส่งหลังยืนยันการชำระเงิน
        </p>
        <h3>รับสินค้าทางไหน?</h3>
        <p>
          เมื่อทำรายการสำเร็จ โค้ดจะปรากฏในหน้าคำสั่งซื้อ
          และสามารถเปิดดูซ้ำได้ที่ “ประวัติการซื้อ” ของบัญชีคุณ
        </p>
      </section>
    </main>
  );
}
function Auth({ register = false }: { register?: boolean }) {
  const { go, refresh, toast, user } = useStore();
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(location.search).get("next");
  const destination =
    next?.startsWith("/") && !next.startsWith("//") ? next : "/account";
  useEffect(() => {
    if (user) go(destination);
  }, [user]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(register ? "/register" : "/login", fields);
      await refresh();
      toast(
        register
          ? "สมัครสมาชิกสำเร็จ"
          : "เข้าสู่ระบบสำเร็จ",
      );
      go(destination);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-main">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} />
        กลับหน้าร้าน
      </Link>
      <div className="auth-panel">
        <img src="/favicon.svg" className="auth-logo" alt="ASTRA" />
        <h1>{register ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</h1>
        <p>
          {register
            ? "สมัครสมาชิกเพื่อสั่งซื้อสินค้า"
            : "เข้าสู่ระบบเพื่อดูคำสั่งซื้อ"}
        </p>
        <form onSubmit={submit}>
          <ErrorMessage message={error} />
          {register && (
            <label className="field">
              ชื่อที่แสดง
              <input
                name="name"
                autoComplete="nickname"
                placeholder="ชื่อของคุณ"
                minLength={2}
                maxLength={60}
                required
              />
            </label>
          )}
          <label className="field">
            อีเมล
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={160}
              required
            />
          </label>
          <label className="field">
            รหัสผ่าน
            <div className="password-field">
              <input
                type={show ? "text" : "password"}
                name="password"
                autoComplete={register ? "new-password" : "current-password"}
                placeholder={
                  register ? "อย่างน้อย 10 ตัวอักษร" : "กรอกรหัสผ่าน"
                }
                minLength={register ? 10 : 1}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="icon-button"
                aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {register && (
            <label className="checkbox-label consent">
              <input type="checkbox" required />
              ยอมรับ<Link to="/terms">ข้อกำหนด</Link>และ
              <Link to="/privacy">ความเป็นส่วนตัว</Link>
            </label>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : register ? (
              "สร้างบัญชี"
            ) : (
              "เข้าสู่ระบบ"
            )}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-switch">
          {register ? "มีบัญชีแล้ว?" : "ยังไม่มีบัญชี?"}{" "}
          <Link
            to={
              (register ? "/login" : "/register") +
              (next ? "?next=" + encodeURIComponent(destination) : "")
            }
          >
            {register ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
          </Link>
        </p>
        <div className="auth-footnote">
          <ShieldCheck size={15} />
          รหัสผ่านถูกเก็บแบบเข้ารหัส
        </div>
      </div>
    </main>
  );
}
function RequireLogin() {
  return (
    <Empty
      icon={<KeyRound />}
      heading="เข้าสู่ระบบเพื่อดูข้อมูลของคุณ"
      description="จัดการเครดิต คำสั่งซื้อ และโค้ดสินค้าที่คุณได้รับ"
      action={
        <Link
          className="button primary"
          to={"/login?next=" + encodeURIComponent(location.pathname)}
        >
          เข้าสู่ระบบ
          <ArrowRight size={17} />
        </Link>
      }
    />
  );
}
function Cart({ checkout = false }: { checkout?: boolean }) {
  const { basket, products, setBasket, user, go } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const p = products.find((p) =>
    p.variants.some((v) => v.id === basket?.variantId),
  );
  const variant = p?.variants.find((v) => v.id === basket?.variantId);
  async function order() {
    if (!user) return go("/login?next=%2Fcheckout");
    setBusy(true);
    setError("");
    try {
      const key = crypto.randomUUID();
      const o = await api<Order>("/orders", {
        variantId: variant!.id,
        quantity: basket!.quantity,
        requestKey: key,
      });
      sessionStorage.setItem("astra-pay-" + o.id, o.paymentToken!);
      go("/checkout/" + o.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container page-main">
      <div className="page-heading">
        <span className="eyebrow">{checkout ? "CHECKOUT" : "YOUR BAG"}</span>
        <h1>{checkout ? "ตรวจสอบคำสั่งซื้อ" : "ตะกร้าสินค้า"}</h1>
        <p>
          {checkout
            ? "ตรวจสอบข้อมูลให้ครบ ระบบจะบันทึกคำสั่งซื้อไว้ก่อน"
            : "สินค้าที่คุณเลือกไว้ พร้อมเมื่อคุณพร้อม"}
        </p>
      </div>
      {!basket || !p || !variant ? (
        <Empty
          icon={<ShoppingBag />}
          heading="ตะกร้าของคุณยังว่าง"
          description="เลือกสินค้าที่ชอบ แล้วกลับมาที่นี่เพื่อทำรายการ"
          action={
            <Link to="/products" className="button primary">
              เลือกดูสินค้า
              <ArrowRight size={17} />
            </Link>
          }
        />
      ) : (
        <div className="checkout-layout">
          <section className="panel cart-panel">
            <div className="cart-product">
              <div className="cart-art">
                <Art type={p.art} name={p.name} />
              </div>
              <div className="cart-info">
                <Link to={"/products/" + p.id}>{p.name}</Link>
                <p>{variant.label}</p>
                <strong>{money(variant.price)}</strong>
                <Quantity
                  value={basket.quantity}
                  max={Math.min(10, variant.stock)}
                  onChange={(quantity) => setBasket({ ...basket, quantity })}
                />
              </div>
              <button
                className="icon-button"
                aria-label="ลบสินค้า"
                onClick={() => setBasket(null)}
              >
                <Trash2 size={18} />
              </button>
            </div>
            <p className="small-note">
              <ShieldCheck size={16} />
              โค้ดถูกส่งไปยังบัญชีที่ใช้สั่งซื้อเท่านั้น
            </p>
          </section>
          <aside className="panel order-summary">
            <h2>สรุปคำสั่งซื้อ</h2>
            <div>
              <span>สินค้า ({basket.quantity} ชิ้น)</span>
              <span>{money(variant.price * basket.quantity)}</span>
            </div>
            <div>
              <span>ค่าจัดส่งดิจิทัล</span>
              <span>ฟรี</span>
            </div>
            <div className="summary-total">
              <strong>ยอดรวม</strong>
              <strong>{money(variant.price * basket.quantity)}</strong>
            </div>
            <ErrorMessage message={error} />
            <button
              className="button primary full"
              disabled={busy || variant.stock < basket.quantity}
              onClick={checkout ? order : () => go("/checkout")}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : checkout ? (
                "บันทึกคำสั่งซื้อ"
              ) : (
                "ไปบันทึกคำสั่งซื้อ"
              )}
              <ArrowRight size={17} />
            </button>
            <p className="sandbox-note">
              การชำระเงินจะเชื่อมต่อภายหลัง ตอนนี้ยังไม่ส่งโค้ด
            </p>
            {user && (
              <p className="balance-note">
                คำสั่งซื้อจะถูกบันทึกไว้ก่อน โค้ดจะส่งหลังยืนยันการชำระเงิน
              </p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
function OrderPage({ id, payment = false }: { id: string; payment?: boolean }) {
  const { user, refresh, toast, go, setBasket } = useStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (user)
      api<Order>("/orders/" + id)
        .then(setOrder)
        .catch((e) => setError(e.message));
  }, [id, user?.id]);
  async function pay(outcome: string) {
    setBusy(true);
    setError("");
    try {
      let token = sessionStorage.getItem("astra-pay-" + id);
      if (!token) {
        const result = await api<Order>("/orders/" + id + "/retry", {});
        token = result.paymentToken!;
        sessionStorage.setItem("astra-pay-" + id, token);
      }
      const result = await api<Order>("/orders/" + id + "/pay", {
        paymentToken: token,
        outcome,
      });
      setOrder(result);
      if (result.status === "DELIVERED") {
        setBasket(null);
        sessionStorage.removeItem("astra-pay-" + id);
        setRevealed(true);
        await refresh();
        toast("ทำรายการสำเร็จ ได้รับโค้ดแล้ว");
        go("/orders/" + id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast("คัดลอกโค้ดแล้ว");
    } catch {
      toast("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกโค้ดแล้วคัดลอก");
    }
  }
  return (
    <main className="container page-main narrow-main">
      {!user ? (
        <RequireLogin />
      ) : !order ? (
        <>
          <ErrorMessage message={error} />
          {!error && (
            <div className="loading-row">
              <LoaderCircle className="spin" />
              กำลังโหลดคำสั่งซื้อ
            </div>
          )}
        </>
      ) : (
        <>
          <Link to="/orders" className="back-link">
            <ArrowLeft size={16} />
            ประวัติการซื้อ
          </Link>
          <div className="order-result-heading">
            {order.status === "DELIVERED" ? (
              <span className="success-ring">
                <Check size={28} />
              </span>
            ) : (
              <span className="empty-icon">
                <CreditCard size={26} />
              </span>
            )}
            <h1>
              {order.status === "DELIVERED"
                ? "สั่งซื้อสำเร็จ พร้อมรับสินค้า"
                : order.status === "PREORDER"
                  ? "บันทึกการสั่งจองแล้ว"
                  : order.status === "PENDING_PAYMENT"
                    ? "บันทึกคำสั่งซื้อแล้ว"
                    : order.status === "FAILED"
                      ? "การชำระเงินไม่สำเร็จ"
                      : "สินค้าหมดก่อนทำรายการ"}
            </h1>
            <p>
              {order.status === "DELIVERED"
                ? "โค้ดของคุณอยู่ด้านล่าง"
                : order.status === "PENDING_PAYMENT"
                  ? "การชำระเงินจะเชื่อมต่อภายหลัง ระบบยังไม่ส่งโค้ด"
                  : "รายการนี้ยังไม่ส่งโค้ด"}
            </p>
          </div>
          <section className="panel delivery-panel">
            <div className="delivery-product">
              <div className="activity-art">
                <Art small type={order.art} name={order.name} />
              </div>
              <div>
                <h2>{order.name}</h2>
                <p>
                  {order.label} · จำนวน {order.quantity} ชิ้น
                </p>
              </div>
              <Status status={order.status} />
            </div>
            <div className="order-meta">
              <span>คำสั่งซื้อ #{order.id.slice(0, 8).toUpperCase()}</span>
              <span>{dateTime(order.created_at)}</span>
            </div>
            {order.status === "PREORDER" ? (
              <div className="note-box">
                <Clock size={20} />
                <div>
                  <strong>สินค้าสั่งจอง · รอส่งตามกำหนด</strong>
                  <p>
                    บันทึกการสั่งจองแล้ว ยังไม่ส่งโค้ด
                  </p>
                </div>
              </div>
            ) : order.status === "DELIVERED" ? (
              <div className="delivered-codes">
                <div className="code-heading">
                  <strong>
                    <KeyRound size={17} />
                    โค้ดสินค้าของคุณ
                  </strong>
                  <button
                    className="text-button"
                    onClick={() => setRevealed(!revealed)}
                  >
                    {revealed ? <EyeOff size={16} /> : <Eye size={16} />}{" "}
                    {revealed ? "ซ่อนโค้ด" : "แสดงโค้ด"}
                  </button>
                </div>
                {order.codes.map((code, i) => (
                  <div className="code-row" key={i}>
                    <code>{revealed ? code : "••••-••••-••••-••••"}</code>
                    <button
                      className="icon-button"
                      onClick={() => copy(code)}
                      aria-label={"คัดลอกโค้ด " + (i + 1)}
                    >
                      <Copy size={18} />
                    </button>
                  </div>
                ))}
                <p className="sandbox-note">เก็บโค้ดนี้ไว้ในที่ปลอดภัย</p>
              </div>
            ) : (
              order.status === "PENDING_PAYMENT" && (
                <div className="note-box">
                  <Clock size={20} />
                  <div>
                    <strong>ยอดคำสั่งซื้อ {money(order.total)}</strong>
                    <p>รอเชื่อมช่องทางชำระเงิน โค้ดจะถูกส่งหลังยืนยันยอดแล้วเท่านั้น</p>
                  </div>
                </div>
              )
            )}
          </section>
          {["FAILED", "OUT_OF_STOCK"].includes(order.status) && (
            <div className="result-actions">
              <p>ไม่มีการหักเครดิตหรือส่งมอบโค้ดสำหรับรายการนี้</p>
              <Link to="/products" className="button secondary">
                กลับไปเลือกสินค้า
              </Link>
            </div>
          )}
          {order.status === "DELIVERED" && (
            <div className="result-actions">
              <Link to="/products" className="button secondary">
                เลือกซื้อสินค้าเพิ่มเติม
                <ArrowRight size={17} />
              </Link>
              <p>
                <ShieldCheck size={16} />
                เปิดดูโค้ดซ้ำได้เสมอในประวัติการซื้อ
              </p>
              <Link to={"/reviews?order=" + id} className="subtle-link">
                <Star size={16} />
                รีวิวคำสั่งซื้อนี้
              </Link>
            </div>
          )}
          {order.status === "PENDING_PAYMENT" && (
            <p className="sandbox-note">
              คำสั่งซื้อนี้ถูกบันทึกแล้ว และยังไม่มีการส่งโค้ด
            </p>
          )}
        </>
      )}
    </main>
  );
}
function HistoryPage() {
  const { user } = useStore();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    if (user)
      api<{ orders: Order[] }>("/orders")
        .then((r) => setOrders(r.orders))
        .catch((e) => setError(e.message));
  }, [user?.id]);
  const filtered = orders?.filter(
    (o) => filter === "all" || o.status === filter,
  );
  return (
    <main className="container page-main reference-history-page">
      <div className="page-heading">
        <span className="eyebrow">MY ORDERS</span>
        <h1>ประวัติการซื้อ</h1>
        <p>ติดตามคำสั่งซื้อและเปิดดูโค้ดสินค้าของคุณ</p>
      </div>
      {!user ? (
        <RequireLogin />
      ) : (
        <>
          <div className="category-bar">
            {[
              ["all", "ทั้งหมด"],
              ["DELIVERED", "จัดส่งสำเร็จ"],
              ["PENDING_PAYMENT", "รอชำระเงิน"],
              ["FAILED", "ไม่สำเร็จ"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={
                  filter === value ? "category-chip selected" : "category-chip"
                }
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <ErrorMessage message={error} />
          {!orders && !error ? (
            <div className="loading-row">
              <LoaderCircle className="spin" />
              กำลังโหลดคำสั่งซื้อ
            </div>
          ) : filtered?.length ? (
            <div className="orders-list">
              {filtered.map((o) => (
                <Link
                  to={"/orders/" + o.id}
                  className="panel history-card"
                  key={o.id}
                >
                  <div className="history-card-top">
                    <span>
                      #{o.id.slice(0, 8).toUpperCase()}{" "}
                      <small>{dateTime(o.created_at)}</small>
                    </span>
                    <Status status={o.status} />
                  </div>
                  <div className="history-card-body">
                    <div className="history-art">
                      <Art type={o.art} name={o.name} />
                    </div>
                    <div>
                      <h2>{o.name}</h2>
                      <p>
                        {o.label} · {o.quantity} ชิ้น
                      </p>
                    </div>
                    <strong>{money(o.total)}</strong>
                    <ArrowUpRight size={18} />
                  </div>
                  <div className="history-card-bottom">
                    {o.status === "DELIVERED" ? (
                      <>
                        <KeyRound size={16} />
                        ดูโค้ดสินค้า
                      </>
                    ) : o.status === "PENDING_PAYMENT" ? (
                      "รอเชื่อมการชำระเงิน"
                    ) : (
                      "ดูรายละเอียด"
                    )}
                    <ArrowRight size={15} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            !error && (
              <Empty
                icon={<History />}
                heading="ยังไม่มีคำสั่งซื้อในรายการนี้"
                description="เมื่อคุณเลือกซื้อสินค้า คำสั่งซื้อจะปรากฏที่นี่"
                action={
                  <Link to="/products" className="button primary">
                    เลือกดูสินค้า
                    <ArrowRight size={16} />
                  </Link>
                }
              />
            )
          )}
        </>
      )}
    </main>
  );
}
function WalletPage() {
  const { user } = useStore();
  const [entries, setEntries] = useState<Ledger[]>([]);
  const [error, setError] = useState("");
  const load = () =>
    api<{ entries: Ledger[] }>("/ledger")
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (user) void load();
  }, [user?.id]);
  return (
    <main className="container page-main reference-wallet-page">
      <div className="page-heading">
        <span className="eyebrow">ORDERS</span>
        <h1>บัญชีของร้าน</h1>
        <p>ช่องทางจ่ายยังไม่เปิด โค้ดจะถูกส่งหลังยืนยันยอดแล้วเท่านั้น</p>
      </div>
      {!user ? (
        <RequireLogin />
      ) : (
        <div className="wallet-layout">
          <div>
            <section className="wallet-balance panel">
              <span>
                <Wallet size={20} />
                เครดิตคงเหลือ
              </span>
              <strong>{money(user.balance)}</strong>
              <small>ช่องทางจ่ายยังไม่เปิด</small>
            </section>
            <section className="panel topup-panel">
              <h2>ช่องทางชำระเงิน</h2>
              <p>ยังไม่เปิดรับเงิน โค้ดจะถูกส่งหลังยืนยันยอดแล้วเท่านั้น</p>
              <ErrorMessage message={error} />
            </section>
          </div>
          <section className="panel wallet-history">
            <div className="panel-heading">
              <h2>ประวัติเครดิต</h2>
              <History size={18} />
            </div>
            {entries.length ? (
              entries.map((e) => (
                <div className="ledger-row" key={e.id}>
                  <span
                    className={
                      "ledger-icon " + (e.amount > 0 ? "positive" : "")
                    }
                  >
                    {e.amount > 0 ? (
                      <Plus size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}
                  </span>
                  <div>
                    <strong>{e.label}</strong>
                    <small>{dateTime(e.created_at)}</small>
                  </div>
                  <b className={e.amount > 0 ? "positive" : ""}>
                    {e.amount > 0 ? "+" : ""}
                    {money(e.amount)}
                  </b>
                </div>
              ))
            ) : (
              <p className="empty-inline">ยังไม่มีรายการเครดิต</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
function ReviewsPage() {
  const { user, refresh, toast, overview } = useStore();
  const [ratingFilter, setRatingFilter] = useState(0);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const result = await api<{ reviews: Review[] }>("/reviews");
      setReviews(result.reviews);
      if (user) {
        const own = await api<{ orders: Order[] }>("/orders");
        setOrders(
          own.orders.filter((o) => o.status === "DELIVERED" && !o.reviewed),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void load();
  }, [user?.id]);
  const average = reviews.length
    ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length
    : 0;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/reviews", { ...fields, rating: Number(fields.rating) });
      await load();
      await refresh();
      toast("ขอบคุณสำหรับรีวิวของคุณ");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container page-main reference-reviews-page">
      <div className="page-heading">
        <span className="eyebrow">CUSTOMER REVIEWS</span>
        <h1>
          เครดิตร้าน
          <br />
          {overview?.shop?.shopName || "ร้านค้า"}
        </h1>
        <p>รีวิวจากคนที่ซื้อจริง ทุกรายการตรวจสอบจากออเดอร์</p>
      </div>
      <div className="reviews-layout">
        <aside>
          <div className="panel review-summary">
            <Star size={24} />
            <strong>{reviews.length ? average.toFixed(1) : "—"}</strong>
            <div className="review-stars" aria-label="คะแนนเฉลี่ย">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  size={17}
                  key={n}
                  fill={n <= Math.round(average) ? "currentColor" : "none"}
                />
              ))}
            </div>
            <span>{reviews.length} รีวิวจากผู้ซื้อ</span>
            {[5, 4, 3, 2, 1].map((n) => (
              <div className="rating-bar" key={n}>
                <span>{n}</span>
                <i>
                  <b
                    style={{
                      width:
                        (reviews.length
                          ? (100 *
                              reviews.filter((r) => r.rating === n).length) /
                            reviews.length
                          : 0) + "%",
                    }}
                  />
                </i>
                <span>{reviews.filter((r) => r.rating === n).length}</span>
              </div>
            ))}
          </div>
          <div className="note-box">
            <ShieldCheck size={18} />
            <p>
              เขียนรีวิวได้หลังได้รับสินค้าแล้วเท่านั้น
              หนึ่งรีวิวต่อหนึ่งคำสั่งซื้อ
            </p>
          </div>
        </aside>
        <section>
          <div className="review-filter-row">
            {[0, 5, 4, 3, 2, 1].map((n) => (
              <button
                key={n}
                className={ratingFilter === n ? "active" : ""}
                onClick={() => setRatingFilter(n)}
              >
                {n ? n + " ดาว" : "ทั้งหมด"}
              </button>
            ))}
          </div>
          <ErrorMessage message={error} />
          {orders.length > 0 && (
            <form className="panel review-form" onSubmit={submit}>
              <h2>แบ่งปันประสบการณ์ของคุณ</h2>
              <label className="field">
                คำสั่งซื้อ
                <select
                  name="orderId"
                  defaultValue={
                    new URLSearchParams(location.search).get("order") ??
                    orders[0].id
                  }
                >
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · #{o.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                คะแนน
                <select name="rating" defaultValue="5">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} ดาว
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                ความคิดเห็น
                <textarea
                  name="comment"
                  placeholder="บอกเล่าประสบการณ์การสั่งซื้อของคุณ"
                  minLength={2}
                  maxLength={600}
                  required
                />
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Star size={16} />
                )}
                ส่งรีวิว
              </button>
            </form>
          )}
          {reviews.length > 0
            ? reviews
                .filter((r) => !ratingFilter || r.rating === ratingFilter)
                .map((r) => (
                  <article className="panel review-card" key={r.id}>
                    <div>
                      <span className="avatar">{r.name[0]}</span>
                      <strong>{r.name}</strong>
                      <time>{dateTime(r.created_at)}</time>
                    </div>
                    <div
                      className="review-stars"
                      aria-label={r.rating + " ดาว"}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          size={13}
                          fill={n <= r.rating ? "currentColor" : "none"}
                        />
                      ))}
                    </div>
                    <p>{r.comment}</p>
                    <small>
                      <CheckCircle2 size={13} />
                      ผู้ซื้อที่ได้รับสินค้าแล้ว · {r.product}
                    </small>
                  </article>
                ))
            : loaded && (
                <Empty
                  icon={<Star />}
                  heading="ยังไม่มีรีวิว"
                  description="เมื่อซื้อและได้รับสินค้าแล้ว คุณสามารถเป็นคนแรกที่แบ่งปันประสบการณ์ได้"
                  action={
                    <Link to="/products" className="button secondary">
                      เลือกดูสินค้า
                      <ArrowRight size={16} />
                    </Link>
                  }
                />
              )}
        </section>
      </div>
    </main>
  );
}
function Account() {
  const { user, refresh, toast, go } = useStore();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/profile", data);
      await refresh();
      toast("บันทึกข้อมูลแล้ว");
      if (data.newPassword) go("/login");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container page-main narrow-main">
      <div className="page-heading">
        <span className="eyebrow">MY ACCOUNT</span>
        <h1>บัญชีของฉัน</h1>
        <p>ข้อมูลและการตั้งค่าบัญชีของคุณ</p>
      </div>
      {!user ? (
        <RequireLogin />
      ) : (
        <>
          <div className="account-summary panel">
            <span className="avatar large">{user.name[0]}</span>
            <div>
              <h2>{user.name}</h2>
              <p>{user.email}</p>
            </div>
            <span className="service-pill">
              {user.role === "ADMIN" ? "ผู้ดูแลร้าน" : "สมาชิก"}
            </span>
          </div>
          <div className="account-shortcuts">
            <Link to="/orders" className="panel">
              <History size={21} />
              <span>ประวัติการซื้อ</span>
              <ArrowUpRight size={17} />
            </Link>
            <Link to="/wallet" className="panel">
              <Wallet size={21} />
              <span>{money(user.balance)}</span>
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <form className="panel profile-form" onSubmit={save}>
            <h2>ข้อมูลส่วนตัว</h2>
            <ErrorMessage message={error} />
            <label className="field">
              ชื่อที่แสดง
              <input
                name="name"
                defaultValue={user.name}
                required
                minLength={2}
                maxLength={60}
              />
            </label>
            <label className="field">
              อีเมล
              <input value={user.email} disabled />
            </label>
            <h3>เปลี่ยนรหัสผ่าน</h3>
            <p className="muted">เว้นว่างหากไม่ต้องการเปลี่ยนรหัสผ่าน</p>
            <label className="field">
              รหัสผ่านปัจจุบัน
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              รหัสผ่านใหม่
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Check size={17} />
              )}
              บันทึกการเปลี่ยนแปลง
            </button>
          </form>
        </>
      )}
    </main>
  );
}
function InfoPage({ kind }: { kind: string }) {
  const { overview } = useStore();
  const shopName = overview?.shop?.shopName || "ร้านค้า";
  const title =
    kind === "credits"
      ? "เครดิตร้าน"
      : kind === "support"
        ? "ติดต่อร้าน"
        : kind === "privacy"
          ? "ความเป็นส่วนตัว"
          : "ข้อกำหนดร้าน";
  return (
    <main className="container page-main narrow-main">
      <div className="page-heading">
        <span className="eyebrow">{shopName}</span>
        <h1>{title}</h1>
        <p>
          {kind === "credits"
            ? "ข้อมูลร้านค้าและมาตรฐานการให้บริการ"
            : "ข้อมูลสำหรับการใช้งานเว็บไซต์"}
        </p>
      </div>
      <div className="panel prose">
        {kind === "credits" ? (
          <>
            <h2>
              <ShieldCheck size={23} />
              ซื้อสินค้าอย่างมั่นใจ
            </h2>
            <p>
              {shopName} บันทึกคำสั่งซื้อทุกครั้ง
              โค้ดจะถูกส่งหลังยืนยันการชำระเงินเท่านั้น
            </p>
            <div className="trust-list">
              <div>
                <KeyRound />
                <h3>โค้ดแยกเฉพาะคำสั่งซื้อ</h3>
                <p>
                  หนึ่งโค้ดสำหรับหนึ่งหน่วยสินค้า
                  ระบบจัดสรรจากคลังหลังยืนยันการชำระเท่านั้น
                </p>
              </div>
              <div>
                <History />
                <h3>ดูย้อนหลังได้</h3>
                <p>เปิดดูโค้ดและคำสั่งซื้อผ่านบัญชีของคุณได้ตลอดเวลา</p>
              </div>
              <div>
                <Wallet />
                <h3>เครดิตตรวจสอบได้</h3>
                <p>ทุกรายการเติมและใช้เครดิตมีประวัติที่ตรวจสอบได้</p>
              </div>
            </div>
            <Link to="/products" className="button primary">
              เลือกดูสินค้า
              <ArrowRight size={17} />
            </Link>
          </>
        ) : kind === "support" ? (
          <>
            <h2>เราพร้อมช่วยเหลือคุณ</h2>
            <p>
              หากมีปัญหาเกี่ยวกับการรับโค้ด ให้ตรวจสอบหน้าคำสั่งซื้อของคุณก่อน
              โดยโค้ดจะปรากฏเมื่อสถานะเป็น “จัดส่งสำเร็จ”
            </p>
            <Link to="/orders" className="button secondary">
              ตรวจสอบคำสั่งซื้อ
              <ArrowRight size={16} />
            </Link>
            <h3>การติดต่อในโหมดทดลอง</h3>
            <p>
              ยังไม่ได้ตั้งค่า LINE และอีเมลจริงของร้าน
              เจ้าของร้านต้องกำหนดช่องทางบริการลูกค้าก่อนเปิดใช้งานจริง
            </p>
            <h3 id="email">ข้อมูลที่ควรเตรียมเมื่อแจ้งปัญหา</h3>
            <p>
              เลขคำสั่งซื้อ ชื่อสินค้า และรายละเอียดปัญหา
              กรุณาอย่าส่งรหัสผ่านหรือข้อมูลส่วนตัวที่ไม่เกี่ยวข้อง
            </p>
          </>
        ) : kind === "privacy" ? (
          <>
            <h2>ข้อมูลที่ระบบจัดเก็บ</h2>
            <p>
              ระบบจัดเก็บชื่อ อีเมล รหัสผ่านที่ผ่านการแฮช
              และประวัติคำสั่งซื้อ เพื่อให้เปิดดูรายการของตนเองได้
            </p>
            <h3>การเข้าถึงข้อมูล</h3>
            <p>
              ลูกค้าเห็นเฉพาะคำสั่งซื้อของตนเอง
              ผู้ดูแลเห็นข้อมูลการขายและคลังสินค้า
              คุกกี้ใช้เพื่อรักษาการเข้าสู่ระบบ
            </p>
          </>
        ) : (
          <>
            <h2>ข้อกำหนดร้าน</h2>
            <p>
              {overview?.shop?.policy ||
                "ผู้ดูแลสามารถกำหนดข้อกำหนดร้านได้จากหลังบ้าน"}
            </p>
            <h3>คำสั่งซื้อและการส่งมอบ</h3>
            <p>
              ระบบตรวจสต็อกก่อนรับคำสั่งซื้อ
              โค้ดจะถูกส่งหลังยืนยันการชำระเงินเท่านั้น
            </p>
          </>
        )}
      </div>
    </main>
  );
}
function NotFound() {
  return (
    <main className="container page-main">
      <Empty
        icon={<Search />}
        heading="ไม่พบหน้านี้"
        description="หน้านี้อาจถูกย้าย หรือที่อยู่ไม่ถูกต้อง"
        action={
          <Link className="button primary" to="/">
            กลับหน้าร้าน
            <ArrowRight size={16} />
          </Link>
        }
      />
    </main>
  );
}
function Router() {
  const { path, overview } = useStore();
  const shopName = overview?.shop?.shopName || "ร้านค้า";
  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "หน้าร้าน",
      "/products": "สินค้าทั้งหมด",
      "/login": "เข้าสู่ระบบ",
      "/register": "สมัครสมาชิก",
      "/orders": "ประวัติการซื้อ",
      "/cart": "ตะกร้าสินค้า",
      "/checkout": "ตรวจสอบคำสั่งซื้อ",
      "/account": "บัญชีของฉัน",
      "/admin": "แดชบอร์ด",
    };
    const page = path.startsWith("/admin")
      ? "แดชบอร์ด"
      : (titles[path] ?? shopName);
    document.title = page + " — " + shopName;
  }, [path, shopName]);
  if (path === "/stores") return <Stores />;
  if (path === "/") return <Home />;
  if (path === "/products") return <ReferenceCatalogPage />;
  if (path.startsWith("/products/"))
    return (
      <ReferenceProduct key={path} id={decodeURIComponent(path.slice(10))} />
    );
  if (path === "/login" || path === "/register")
    return <ReferenceAuth key={path} register={path === "/register"} />;
  if (path === "/cart" || path === "/checkout")
    return <Cart checkout={path === "/checkout"} />;
  if (path.startsWith("/orders/") || path.startsWith("/checkout/"))
    return (
      <OrderPage
        key={path.split("/")[2]}
        id={path.split("/")[2]}
        payment={path.startsWith("/checkout/")}
      />
    );
  if (path === "/orders") return <HistoryPage />;
  if (path === "/wallet" || path === "/top-up") return <WalletPage />;
  if (path === "/reviews" || path === "/credits") return <ReferenceReviews />;
  if (path === "/account") return <Account />;
  if (path.startsWith("/admin"))
    return (
      <Suspense
        fallback={
          <main className="container page-main">
            กำลังโหลดระบบจัดการร้าน...
          </main>
        }
      >
        <Admin />
      </Suspense>
    );
  if (["/support", "/terms", "/privacy"].includes(path))
    return <InfoPage kind={path.slice(1)} />;
  return <NotFound />;
}
export default function App() {
  const [path, setPath] = useState(location.pathname);
  const merchant = path.startsWith("/admin") || path === "/stores";
  useRouteMotion(path);
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [basket, setBasketState] = useState<Basket | null>(() => {
    try {
      const b = JSON.parse(localStorage.getItem("astra-basket") ?? "null");
      return b &&
        typeof b.variantId === "string" &&
        Number.isInteger(b.quantity) &&
        b.quantity >= 1 &&
        b.quantity <= 10
        ? b
        : null;
    } catch {
      return null;
    }
  });
  const setBasket = (value: Basket | null) => {
    setBasketState(value);
    localStorage.setItem("astra-basket", JSON.stringify(value));
  };
  function go(to: string) {
    history.pushState({}, "", to);
    setPath(location.pathname);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function refresh() {
    try {
      const [me, catalog, stats] = await Promise.all([
        api<{ user: User | null }>("/me"),
        api<{ products: Product[] }>("/products"),
        api<Overview>("/overview"),
      ]);
      setUser(me.user);
      setProducts(catalog.products);
      setOverview(stats);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <Context.Provider
      value={{
        user,
        products,
        overview,
        basket,
        setBasket,
        refresh,
        go,
        toast: setToast,
        path,
        loading,
      }}
    >
      <a className="skip-link" href="#content">
        ข้ามไปเนื้อหา
      </a>
      <div className={merchant ? "merchant-shell" : "storefront-shell"}>
        {merchant ? <MerchantHeader /> : <Header />}
        <div id="content" tabIndex={-1}>
          {error ? (
            <main className="container page-main">
              <Empty
                icon={<AlertCircle />}
                heading="เชื่อมต่อร้านค้าไม่ได้"
                description={error}
                action={
                  <button
                    className="button primary"
                    onClick={() => {
                      setLoading(true);
                      void refresh();
                    }}
                  >
                    ลองอีกครั้ง
                  </button>
                }
              />
            </main>
          ) : (
            <Router />
          )}
        </div>
        {!merchant && <Footer />}
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="ปิดแจ้งเตือน"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
