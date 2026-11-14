import { useLive } from "./live";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type ChangeEvent,
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
  LogOut,
  Mail,
  Megaphone,
  Menu,
  MessageCircle,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
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
  Download,
  Upload,
  RotateCcw,
  TicketPercent,
} from "lucide-react";
import { t, getLang, locale, setLang, setMerchantScope, type Lang } from "./i18n";
import {
  BrandLogo,
  Marquee,
  PrefsPanel,
  ScrollProgress,
  shopName,
  ThemeSwitch,
  useCardTilt,
} from "./Theme";
import { flushSync } from "react-dom";
import { api, money, dateTime, relativeTime, uploadImage } from "./api";
import type {
  Product,
  Variant,
  User,
  Order,
  Overview,
  Ledger,
  Review,
  CouponCheck,
  CouponPreview,
} from "./types";
import { MAX_PER_ORDER } from "./types";
import { NAVIGATE_EVENT, confirmLeave } from "./navigation";
import { confirmDialog } from "./dialogs";
import Stores, { MerchantHeader } from "./Stores";
import { CustomerChat, NotificationBell } from "./Ops";
import { CountUp, useRouteMotion } from "./motion";
import { WarrantyStatus } from "./Warranty";
import { SessionsCard } from "./Sessions";
import { StockWatchList } from "./StockWatch";
import { DeliveredExtras, hasReceipt, ReceiptLink, ReceiptPage, receiptRoute } from "./OrderExtras";
import { AskInChat } from "./ChatAttachments";
import { ShopClosedNote, useShopOpen } from "./ShopClosed";
import { CheckoutPreorderRow, isQueueMode, PreorderProgress, preorderHeading } from "./Preorder";
import { EmailVerifyNotice, useEmailVerifyNeeded, VerifyEmailPage } from "./EmailVerify";
import { ResetPasswordPage } from "./AccountRecovery";
import { FaqPage } from "./Faq";
import { ContactPage } from "./Contact";
import { AboutPage, NewsDetailPage, NewsListPage } from "./News";
import { CheckoutFields, DeliveredLinks, FulfilmentCard, checkoutFieldsReady } from "./Delivery";
import { RebuyActions } from "./Rebuy";
import { HistoryPage } from "./OrderList";
import { CartPage, CheckoutGroupPage, CheckoutPage, loadCart, saveCart, withLine, type CartLine } from "./Cart";
import { ManualOrderNote } from "./ManualOrderNote";
import { DiscountBadge, PriceNote, PurchaseLimitNote, quantityCap, WasPrice } from "./Pricing";
import { HomeCategoryRow } from "./Categories";
import { HomeBanners } from "./HomeBanners";
import {
  ReferenceCatalog,
  ReferenceCatalogPage,
  ReferenceAuth,
  ReferenceReviews,
  ReferenceProduct,
} from "./ReferenceStore";
import { AppearanceEffects, ShopLink, text, useAppearance } from "./Appearance";
import { heroTitleFallback, type Appearance } from "../server/appearance-rules.mjs";
import { StorefrontMenu } from "./StorefrontMenu";
const Admin = lazy(() => import("./Admin"));
const LegalPage = lazy(() =>
  import("./Legal").then((m) => ({ default: m.LegalPage })),
);
import "./footer-credit.css";
type Basket = { variantId: string; quantity: number };
type Store = {
  user: User | null;
  products: Product[];
  overview: Overview | null;
  /** The one ticked basket line (single-order checkout); null when 0 or 2+ are ticked. */
  basket: Basket | null;
  /** Set that line's quantity and tick only it; null removes the ticked lines. */
  setBasket: (basket: Basket | null) => void;
  cart: CartLine[];
  setCart: (lines: CartLine[]) => void;
  /** Add to the basket; `only` (buy now) ticks just this line. */
  addToCart: (variantId: string, quantity: number, only?: boolean) => void;
  refresh: () => Promise<void>;
  /** keepScroll: same-page URL changes (e.g. the /products category chips). */
  go: (path: string, options?: { keepScroll?: boolean }) => void;
  toast: (message: string) => void;
  path: string;
  loading: boolean;
  lang: Lang;
  changeLang: (lang: Lang, origin?: { x: number; y: number }) => void;
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
  image,
}: {
  type: string;
  name: string;
  small?: boolean;
  /** Uploaded cover (product images[0]); wins over the generated artwork. */
  image?: string | null;
}) {
  if (image)
    return (
      <div className={`product-art art-photo ${small ? "art-small" : ""}`} role="img" aria-label={name}>
        <img src={image} alt="" loading={small ? "eager" : "lazy"} />
      </div>
    );
  if (type === "stream" || type === "cinema")
    return (
      <div
        className={`product-art art-${type} ${small ? "art-small" : ""}`}
        role="img"
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
      role="img"
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
    DELIVERED: t("จัดส่งสำเร็จ"),
    PENDING_PAYMENT: t("รอชำระเงิน"),
    FAILED: t("ชำระเงินไม่สำเร็จ"),
    CANCELLED: t("ยกเลิกแล้ว"),
    EXPIRED: t("หมดเวลาชำระเงิน"),
    OUT_OF_STOCK: t("สินค้าหมด"),
    PREORDER: t("รอส่งสินค้าสั่งจอง"),
    // Shop-fulfilled product (Delivery.tsx): paid, the shop still has to send it.
    WAITING: t("รอร้านส่งมอบ"),
    // Deposit / free preorders (Preorder.tsx): called and waiting for the balance, or ran out of time.
    CALLED: t("ถึงคิวแล้ว · รอชำระ"),
    LAPSED: t("หมดเวลาชำระ"),
    REFUNDED: t("คืนเงินแล้ว"),
    PARTIALLY_REFUNDED: t("คืนเงินบางส่วน"),
  };
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      {labels[status] ?? status}
    </span>
  );
}
/** Unpaid order cancelled by the payment window: shown as its own status to the customer. */
export const shownStatus = (o: Order) =>
  o.status === "DELIVERED" && o.fulfilment?.state === "waiting"
    ? "WAITING"
    : o.status === "PREORDER" && o.stage === "called"
    ? "CALLED"
    : o.stage === "lapsed"
      ? "LAPSED"
      : o.refundStatus ?? (o.status === "CANCELLED" && o.expired_at ? "EXPIRED" : o.status);
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
      {t(message)}
    </div>
  ) : null;
}
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export function UserAvatar({ user, large = false }: { user: User; large?: boolean }) {
  const [brokenUrl, setBrokenUrl] = useState("");
  const photo = user.avatarUrl && brokenUrl !== user.avatarUrl ? user.avatarUrl : "";
  return (
    <span className={large ? "avatar large" : "avatar"}>
      {photo ? (
        <img src={photo} alt="" onError={() => setBrokenUrl(photo)} />
      ) : (
        user.name.slice(0, 1) || "?"
      )}
    </span>
  );
}

function Header() {
  const { path, user, cart, go, refresh, toast, lang, changeLang } = useStore();
  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);
  const testPayments = useTestPayments();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
  useEffect(() => {
    setOpen(false);
    setAccount(false);
  }, [path]);
  const links = [
    ["/", t("หน้าแรก")],
    ["/products", t("สินค้า")],
    ["/reviews", t("รีวิว")],
    ["/orders", t("ประวัติการซื้อ")],
  ];
  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label={t("หน้าแรก")}>
            <BrandLogo />
          </Link>
          <nav aria-label={t("เมนูหลัก")} className="main-nav">
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
          {/* Exactly: ภาษา + ธีม · bell · balance · profile (the cart lives in the bottom nav). */}
          <div className="header-actions">
            <PrefsPanel lang={lang} onLangChange={changeLang} />
            <NotificationBell />
            {user && (
              <Link
                to={testPayments ? "/wallet" : "/account"}
                className="balance-pill"
                aria-label={t("ยอดเงินคงเหลือ") + " " + money(user.balance)}
              >
                <Wallet size={15} aria-hidden="true" />
                <span>{money(user.balance)}</span>
              </Link>
            )}
            {user ? (
              <div className="account-wrap">
                <button
                  className="account-button"
                  onClick={() => setAccount(!account)}
                  aria-expanded={account}
                  aria-label={t("บัญชีของฉัน")}
                >
                  <UserAvatar user={user} />
                  <span className="account-name">{user.name}</span>
                  <ChevronDown size={14} />
                </button>
                {account && (
                  <div className="account-menu">
                    <Link to="/account">{t("บัญชีของฉัน")}</Link>
                    <Link to="/orders">{t("คำสั่งซื้อของฉัน")}</Link>
                    {user.role === "ADMIN" && (
                      <Link to="/admin">{t("จัดการร้านค้า")}</Link>
                    )}
                    <button
                      onClick={async () => {
                        await api("/logout", {});
                        await refresh();
                        setAccount(false);
                        toast(t("ออกจากระบบแล้ว"));
                        go("/");
                      }}
                    >
                      <LogOut size={15} />
                      {t("ออกจากระบบ")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link to="/login" className="login-link">
                  {t("เข้าสู่ระบบ")}
                </Link>
                <Link to="/register" className="register-link">
                  {t("สมัครสมาชิก")}
                </Link>
              </>
            )}
            <button
              className="icon-button mobile-menu"
              aria-label={t("เปิดเมนู")}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
          </div>
        </div>
      </header>
      <nav className="mobile-bottom-nav" aria-label={t("เมนูมือถือ")}>
        <Link to="/" className={path === "/" ? "active" : ""}>
          <HomeIcon size={21} />
          <span>{t("หน้าร้าน")}</span>
        </Link>
        <Link to="/cart" className={path === "/cart" ? "active cart-tab" : "cart-tab"}>
          <ShoppingBag size={21} />
          {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
          <span>{t("ตะกร้า")}</span>
        </Link>
        <Link
          to="/orders"
          className={path.startsWith("/orders") ? "active" : ""}
        >
          <History size={21} />
          <span>{t("ประวัติ")}</span>
        </Link>
        <button
          className={open ? "active" : ""}
          aria-label={t("เมนูลัด")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu size={21} />
          <span>{t("เมนู")}</span>
        </button>
      </nav>
      {/* Outside the sticky header: its backdrop-filter would trap the fixed sheet. */}
      <StorefrontMenu open={open} onClose={() => setOpen(false)} />
    </>
  );
}
function Footer() {
  const { overview } = useStore();
  const line = overview?.shop?.line ?? "";
  const email = overview?.shop?.email ?? "";
  const phone = overview?.shop?.phone ?? "";
  // ตั้งค่า › หน้าตาร้าน › ส่วนท้าย: description (empty = automatic) and the menu links.
  const footer = useAppearance().footer;
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div className="footer-about">
          <Link to="/" className="brand footer-brand" aria-label={t("หน้าแรก")}>
            <BrandLogo />
          </Link>
          <p>
            {text(footer.description) || overview?.shop?.description || t("ร้านสินค้าดิจิทัล")}
          </p>
        </div>
        {(line || phone || email) && (
          <div className="footer-contact">
            <h3>{t("ติดต่อเรา")}</h3>
            <div className="contact-links">
              {line && (
                <Link to="/support" className="contact-card">
                  <span className="line-icon">
                    <MessageCircle size={23} />
                  </span>
                  <span>
                    LINE<small>{line}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              )}
              {phone && (
                <Link to="/support" className="contact-card">
                  <span className="phone-icon">
                    <Phone size={21} />
                  </span>
                  <span>
                    {t("โทรศัพท์")}
                    <small>{phone}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              )}
              {email && (
                <Link to="/support#email" className="contact-card">
                  <span className="mail-icon">
                    <Mail size={23} />
                  </span>
                  <span>
                    {t("อีเมล")}
                    <small>{email}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              )}
            </div>
          </div>
        )}
        {footer.links.length > 0 && (
          <div className="footer-menu">
            <h3>{t("เมนู")}</h3>
            {footer.links.map((item, i) => (
              <ShopLink to={item.link} key={i}>
                {text(item.label)}
              </ShopLink>
            ))}
          </div>
        )}
      </div>
      <div className="footer-bottom">
        <div className="container footer-bottom-inner">
          <span>
            © {new Date().getFullYear() + (getLang() === "th" ? 543 : 0)}{" "}
            {shopName(overview?.shop?.shopName)}
          </span>
          <div className="footer-legal">
            <Link to="/terms">{t("ข้อกำหนดการใช้บริการ")}</Link>
            <Link to="/privacy">{t("นโยบายความเป็นส่วนตัว")}</Link>
            <ThemeSwitch />
          </div>
        </div>
        <p className="container footer-credit">
          Theme By{" "}
          <a href="https://limitcode.shop" target="_blank" rel="noopener">
            limitcode studio
          </a>
        </p>
      </div>
    </footer>
  );
}
export function ProductCard({ product }: { product: Product }) {
  const soldOut = product.variants.every((v) => v.stockStatus === "out");
  const preorder = !!product.preorder;
  // Cheapest option for this viewer (sale / tag price already applied by the server).
  const cheapest = product.variants.reduce<Product["variants"][number] | undefined>(
    (best, v) => (!best || v.price < best.price ? v : best),
    undefined,
  );
  // One clear action under the price: solid = ready stock, outlined = preorder. The whole card
  // is the link (options are picked on the product page), so this is a styled label, not a
  // nested button.
  const choose = (product.optionGroups?.length ?? 0) > 0 || product.variants.length > 1;
  const action = preorder
    ? t("จองล่วงหน้า")
    : soldOut
      ? t("ดูรายละเอียด")
      : choose
        ? t("เลือกตัวเลือก")
        : t("ซื้อเลย");
  return (
    <Link to={"/products/" + product.id} className="product-card">
      <div className="product-image">
        <Art type={product.art} name={product.name} image={product.imageUrl} />
        {!preorder && soldOut ? <span className="stock-tag">{t("สินค้าหมด")}</span> : null}
      </div>
      <div className="product-card-info">
        <div className="product-title">
          <h3>{product.name}</h3>
          <ArrowUpRight size={18} />
        </div>
        <p className="product-card-price">
          <span>
            {t("เริ่ม")}{" "}
            <strong>
              {money(Math.min(...product.variants.map((v) => v.price)))}
            </strong>
          </span>
          {cheapest && <WasPrice variant={cheapest} />}
          {cheapest && <DiscountBadge variant={cheapest} />}
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
            {t("ขายแล้ว")}{" "}{product.sold} <span>{t("รายการ")}</span>
          </div>
        )}
        <span
          className={
            "card-action " +
            (preorder ? "card-action-preorder" : soldOut ? "card-action-muted" : "card-action-ready")
          }
          data-kind={preorder ? "preorder" : soldOut ? "soldout" : "ready"}
        >
          {action}
        </span>
      </div>
    </Link>
  );
}
function Home() {
  const { overview, loading, user } = useStore();
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
  const showStats =
    !loading &&
    [overview?.customers, overview?.products, overview?.orders].some(
      (value) => (value ?? 0) > 0,
    );
  const showActivity = loading || (overview?.activity.length ?? 0) > 0;
  // ตั้งค่า › หน้าตาร้าน: hero texts and buttons, marquee items, which blocks show and in
  // what order. Defaults = the page as it always was.
  const appearance = useAppearance();
  const hero = appearance.hero;
  const subtext = text(hero.subtext);
  // Second button: reviews for signed-in customers, sign in for everyone else (both editable).
  const second = user ? hero.secondary : hero.guest;
  const secondLabel = text(second.label);
  const heroTitle = text(hero.title) || heroTitleFallback(shopName(overview?.shop?.shopName));
  const blocks: Record<string, ReactNode> = {
    banners: <HomeBanners />,
    hero: (
        <section className="home-hero" aria-labelledby="home-hero-title">
          {/* Plain background; the shop name as a big display line (ตั้งค่า › หน้าตาร้าน › ส่วนหัว). */}
          <h1 className="hero-title hero-display" id="home-hero-title">
            {heroTitle}
          </h1>
          <p className="hero-tagline">
            {text(hero.headline) ||
              overview?.shop?.description ||
              t("ร้านสินค้าดิจิทัล ส่งไว ปลอดภัย ใช้งานได้ทันที")}
          </p>
          {subtext && <p className="hero-subtext">{subtext}</p>}
          <div className="hero-actions">
            <ShopLink to={hero.primary.link} className="button primary hero-cta">
              {text(hero.primary.label)}
            </ShopLink>
            {secondLabel && second.link && (
              <ShopLink to={second.link} className="button hero-ghost">
                {secondLabel}
              </ShopLink>
            )}
          </div>
        </section>
    ),
    marquee: <Marquee items={appearance.marquee.map(text)} />,
    stats: showStats && (
        <section className="stats-panel" aria-label={t("สถิติร้านค้า")}>
          {[
            [Users, t("ลูกค้า"), overview?.customers, t("คน")],
            [Package, t("สินค้า"), overview?.products, t("ชิ้น")],
            [CreditCard, t("คำสั่งซื้อ"), overview?.orders, t("รายการ")],
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
    ),
    activity: showActivity && (
        <section className="activity-panel">
          {latestActivity && (
            <div className="mobile-activity-ticker">
              <span className="live-pill">
                <span className="service-dot" />
                {t("สด")}
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
                      t("สมัครสมาชิก")
                    ) : (
                      <>
                        {t("สั่งซื้อ")}{" "}<b>{latestActivity.product}</b>
                      </>
                    )}
                  </p>
                  <time>{relativeTime(latestActivity.time)}</time>
                </div>
              </div>
            </div>
          )}
          <div className="panel-heading">
            <h2>{t("กิจกรรมล่าสุด")}</h2>
            <span className="live-pill">
              <span className="service-dot" />
              {t("สด")}
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
                    t("สมัครสมาชิก")
                  ) : (
                    <>
                      {t("สั่งซื้อ")}{" "}<b>{activity.product}</b>
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
              {t("กำลังโหลดกิจกรรม")}
            </div>
          )}
        </section>
    ),
    announcement: overview?.shop?.announcement ? (
          <aside className="announcement">
            <span className="announcement-icon">
              <Megaphone size={22} />
            </span>
            <div>
              <h2>{t("ประกาศจากร้าน")}</h2>
              <p>{overview.shop.announcement}</p>
            </div>
          </aside>
        ) : null,
    categories: <HomeCategoryRow />,
    products: <ReferenceCatalog />,
  };
  return (
    <>
      <main className="container home-main">
        {appearance.sections
          .filter((section) => section.visible)
          .map((section) => (
            <Fragment key={section.id}>{blocks[section.id]}</Fragment>
          ))}
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
        (!available || p.variants.some((v) => v.stockStatus !== "out")),
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
        <span className="eyebrow">{t("คอลเลกชันดิจิทัล")}</span>
        <h1>{t("สินค้าทั้งหมด")}</h1>
        <p>{t("เลือกสินค้าดิจิทัลที่ใช่สำหรับคุณ")}</p>
      </div>
      <div className="catalog-toolbar">
        <label className="search-field">
          <Search size={19} />
          <input
            aria-label={t("ค้นหาสินค้า")}
            placeholder={t("ค้นหาชื่อสินค้า...")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              onClick={() => setQuery("")}
              aria-label={t("ล้างการค้นหา")}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <label className="sort-field">
          <SlidersHorizontal size={16} />
          <select
            aria-label={t("เรียงสินค้า")}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="featured">{t("สินค้าแนะนำ")}</option>
            <option value="low">{t("ราคา: ต่ำไปสูง")}</option>
            <option value="high">{t("ราคา: สูงไปต่ำ")}</option>
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
          {t("ทั้งหมด")}{" "}<span>{products.length}</span>
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
        <span>{t("พบ")}{" "}{filtered.length}{" "}{t("สินค้า")}</span>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
          />
          {t("เฉพาะสินค้าที่พร้อมขาย")}
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
          heading={t("ไม่พบสินค้าที่ค้นหา")}
          description={t("ลองใช้คำค้นอื่น หรือเลือกหมวดหมู่ทั้งหมด")}
          action={
            <button
              className="button secondary"
              onClick={() => {
                setQuery("");
                setCategory("all");
                setAvailable(false);
              }}
            >
              {t("ล้างตัวกรอง")}
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
        aria-label={t("ลดจำนวน")}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={15} />
      </button>
      <span aria-live="polite">{value}</span>
      <button
        aria-label={t("เพิ่มจำนวน")}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
function ProductDetail({ id }: { id: string }) {
  const { products, addToCart, go, toast, loading } = useStore();
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
    addToCart(variant.id, quantity, checkout);
    if (checkout) go("/checkout");
    else {
      toast(t("เพิ่มสินค้าในตะกร้าแล้ว"));
      go("/cart");
    }
  };
  return (
    <main className="container page-main">
      <div className="breadcrumbs">
        <Link to="/">{t("หน้าแรก")}</Link>
        <span>/</span>
        <Link to="/products">{t("สินค้า")}</Link>
        <span>/</span>
        <span>{p.name}</span>
      </div>
      <div className="product-detail">
        <div className="detail-art">
          <Art type={p.art} name={p.name} image={p.imageUrl} />
        </div>
        <div className="detail-info">
          <span className="eyebrow">{t("สินค้า")}</span>
          <h1>{p.name}</h1>
          <div className="detail-stock">
            {variant.available ? (
              <>
                <span className="service-dot" />
                {t("พร้อมจัดส่ง")}
                {variant.stockStatus === "low" ? t(" · เหลือน้อย") : ""}
              </>
            ) : (
              <span className="muted">{t("สินค้าหมดชั่วคราว")}</span>
            )}
          </div>
          <p className="detail-description">{p.description}</p>
          <div className="detail-price">
            {money(variant.price)}
            <span>/ {variant.label}</span>
          </div>
          <fieldset className="variant-fieldset">
            <legend>{t("เลือกแพ็กเกจ")}</legend>
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
            <span>{t("จำนวน")}</span>
            <Quantity
              value={quantity}
              max={variant.available ? MAX_PER_ORDER : 0}
              onChange={setQuantity}
            />
          </div>
          <button
            className="button primary full"
            disabled={!variant.available}
            onClick={() => buy(true)}
          >
            <ShoppingBag size={18} />
            {variant.available ? t("ซื้อสินค้าเลย") : t("สินค้าหมดชั่วคราว")}
            {variant.available && (
              <span className="button-end">
                {money(variant.price * quantity)}
              </span>
            )}
          </button>
          <button
            className="button secondary full"
            disabled={!variant.available}
            onClick={() => buy(false)}
          >
            {t("เพิ่มลงตะกร้า")}
            <Plus size={17} />
          </button>
          <p className="detail-trust">
            <ShieldCheck size={17} />
            {t("รับโค้ดผ่านหน้าคำสั่งซื้อหลังยืนยันการชำระเงิน")}
          </p>
        </div>
      </div>
      <section className="product-notes">
        <h2>{t("รายละเอียดสินค้าและการใช้งาน")}</h2>
        <p>
          {p.description}{" "}{t("เลือกแพ็กเกจที่ต้องการ ตรวจสอบคำสั่งซื้อ แล้วบันทึกคำสั่งซื้อ โค้ดจะส่งหลังยืนยันการชำระเงิน")}
        </p>
        <h3>{t("รับสินค้าทางไหน?")}</h3>
        <p>
          {t("เมื่อทำรายการสำเร็จ โค้ดจะปรากฏในหน้าคำสั่งซื้อ และสามารถเปิดดูซ้ำได้ที่ “ประวัติการซื้อ” ของบัญชีคุณ")}
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
          ? t("สมัครสมาชิกสำเร็จ")
          : t("เข้าสู่ระบบสำเร็จ"),
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
        {t("กลับหน้าร้าน")}
      </Link>
      <div className="auth-panel">
        <img src="/brand/favicon-64.png" className="auth-logo" alt="ASIA EXTRA" />
        <h1>{register ? t("สมัครสมาชิก") : t("เข้าสู่ระบบ")}</h1>
        <p>
          {register
            ? t("สมัครสมาชิกเพื่อสั่งซื้อสินค้า")
            : t("เข้าสู่ระบบเพื่อดูคำสั่งซื้อ")}
        </p>
        <form onSubmit={submit}>
          <ErrorMessage message={error} />
          {register && (
            <label className="field">
              {t("ชื่อที่แสดง")}
              <input
                name="name"
                autoComplete="nickname"
                placeholder={t("ชื่อของคุณ")}
                minLength={2}
                maxLength={60}
                required
              />
            </label>
          )}
          <label className="field">
            {t("อีเมล")}
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
            {t("รหัสผ่าน")}
            <div className="password-field">
              <input
                type={show ? "text" : "password"}
                name="password"
                autoComplete={register ? "new-password" : "current-password"}
                placeholder={
                  register ? t("อย่างน้อย 10 ตัวอักษร") : t("กรอกรหัสผ่าน")
                }
                minLength={register ? 10 : 1}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="icon-button"
                aria-label={show ? t("ซ่อนรหัสผ่าน") : t("แสดงรหัสผ่าน")}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {register && (
            <label className="checkbox-label consent">
              <input type="checkbox" required />
              {t("ยอมรับ")}<Link to="/terms">{t("ข้อกำหนดการใช้บริการ")}</Link>{t("และ")}
              <Link to="/privacy">{t("นโยบายความเป็นส่วนตัว")}</Link>
            </label>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : register ? (
              t("สร้างบัญชี")
            ) : (
              t("เข้าสู่ระบบ")
            )}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-switch">
          {register ? t("มีบัญชีแล้ว?") : t("ยังไม่มีบัญชี?")}{" "}
          <Link
            to={
              (register ? "/login" : "/register") +
              (next ? "?next=" + encodeURIComponent(destination) : "")
            }
          >
            {register ? t("เข้าสู่ระบบ") : t("สมัครสมาชิก")}
          </Link>
        </p>
        <div className="auth-footnote">
          <ShieldCheck size={15} />
          {t("รหัสผ่านถูกเก็บแบบเข้ารหัส")}
        </div>
      </div>
    </main>
  );
}
/** Server test mode (ASTRA_TEST_PAYMENTS): sandbox pay + test credit until a real provider is live. */
let testModeCache: Promise<boolean> | null = null;
export function useTestPayments() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    testModeCache ??= api<{ mode?: string }>("/health")
      .then((h) => h.mode === "sandbox")
      .catch(() => false);
    void testModeCache.then(setOn);
  }, []);
  return on;
}
export function RequireLogin() {
  return (
    <Empty
      icon={<KeyRound />}
      heading={t("เข้าสู่ระบบเพื่อดูข้อมูลของคุณ")}
      description={t("จัดการเครดิต คำสั่งซื้อ และโค้ดสินค้าที่คุณได้รับ")}
      action={
        <Link
          className="button primary"
          to={"/login?next=" + encodeURIComponent(location.pathname)}
        >
          {t("เข้าสู่ระบบ")}
          <ArrowRight size={17} />
        </Link>
      }
    />
  );
}
/** Credit history type (เติม / ซื้อ / คืนเงิน / ปรับยอด). */
export const ledgerTypeText: Record<string, string> = {
  TOPUP: "เติม",
  PURCHASE: "ซื้อ",
  REFUND: "คืนเงิน",
  ADJUSTMENT: "ปรับยอด",
};
function ledgerText(label: string) {
  const prefixes = ["ชำระสินค้าสั่งจอง ", "ชำระคำสั่งซื้อ "];
  for (const prefix of prefixes) {
    if (label.startsWith(prefix))
      return t(prefix.trimEnd()) + " " + label.slice(prefix.length);
  }
  return t(label);
}
export function PayShell({ total }: { total: number }) {
  const [slipName, setSlipName] = useState("");
  const [preview, setPreview] = useState("");
  return (
    <section className="pay-shell" aria-label={t("สถานะการชำระเงิน")}>
      <p>{t("การชำระเงินจะเชื่อมต่อภายหลัง ระบบยังไม่ส่งโค้ด")}</p>
      <div className="pay-steps">
        <span aria-current="step">{t("รอตรวจสลิป")}</span>
        <span>{t("ชำระสำเร็จ")}</span>
        <span>{t("ชำระไม่ผ่าน")}</span>
      </div>
      <div className="pay-qr">
        <span className="pay-qr-mark" aria-hidden="true" />
        <div>
          <small>{t("พร้อมเพย์")}</small>
          <strong>{money(total)}</strong>
          <p>{t("ช่องทางจ่ายยังไม่เปิด")}</p>
        </div>
      </div>
      <label className="pay-slip">
        <Upload size={18} />
        {t("อัปโหลดสลิป")}
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            setSlipName(file?.name ?? "");
            setPreview("");
            if (!file || !file.type.startsWith("image/")) return;
            const reader = new FileReader();
            reader.onload = () => setPreview(String(reader.result || ""));
            reader.readAsDataURL(file);
          }}
        />
      </label>
      {slipName && (
        <p className="pay-slip-note">
          {slipName}
          {" · "}
          {t("เลือกสลิปแล้ว ยังไม่ส่งไฟล์นี้")}
        </p>
      )}
      {preview && <img className="pay-slip-preview" src={preview} alt="" />}
    </section>
  );
}
function OrderPage({ id, payment = false }: { id: string; payment?: boolean }) {
  const { user, refresh, toast, go, setBasket, cart, setCart } = useStore();
  const shopOpen = useShopOpen();
  const verifyEmail = useEmailVerifyNeeded();
  usePageTitle(
    payment ? t("ชำระเงิน") : t("คำสั่งซื้อ"),
    t("รายละเอียดคำสั่งซื้อ การชำระเงิน และสินค้าที่ได้รับ"),
  );
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const testPayments = useTestPayments();
  useLive(["orders"], () => {
    if (user && !busy)
      api<Order>("/orders/" + id)
        .then(setOrder)
        .catch(() => {});
  });
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
      if (result.status === "PREORDER") {
        setCart(cart.filter((l) => l.variantId !== result.variant_id));
        sessionStorage.removeItem("astra-pay-" + id);
        await refresh();
        toast(t("ชำระเงินสำเร็จ ได้เลขคิวแล้ว"));
      }
      if (result.status === "DELIVERED") {
        setCart(cart.filter((l) => l.variantId !== result.variant_id));
        sessionStorage.removeItem("astra-pay-" + id);
        setRevealed(true);
        await refresh();
        toast(t("ทำรายการสำเร็จ ได้รับโค้ดแล้ว"));
        go("/orders/" + id);
      }
    } catch (e) {
      setError((e as Error).message);
      // e.g. the payment window ran out: show the order's real state.
      api<Order>("/orders/" + id)
        .then(setOrder)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  // Deposit / free preorder (Preorder.tsx): balance is paid with a fresh token from /retry.
  function payBalance() {
    sessionStorage.removeItem("astra-pay-" + id);
    return pay("success");
  }
  async function cancelReservation() {
    setBusy(true);
    setError("");
    try {
      await api("/orders/" + id + "/cancel", {});
      setOrder(await api<Order>("/orders/" + id));
      await refresh();
      toast(t("ยกเลิกการจองแล้ว"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast(t("คัดลอกโค้ดแล้ว"));
    } catch {
      toast(t("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกโค้ดแล้วคัดลอก"));
    }
  }
  return (
    <main className="container page-main narrow-main reference-order-page">
      {!user ? (
        <RequireLogin />
      ) : !order ? (
        <>
          <ErrorMessage message={error} />
          {!error && (
            <div className="skeleton-order" aria-busy="true" aria-label={t("กำลังโหลดคำสั่งซื้อ")}>
              <div className="skeleton-block skeleton-line" />
              <div className="skeleton-block skeleton-panel" />
            </div>
          )}
        </>
      ) : (
        <>
          <Link to="/orders" className="back-link">
            <ArrowLeft size={16} />
            {t("ประวัติการซื้อ")}
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
              {preorderHeading(order)?.[0] ?? (order.status === "DELIVERED" && order.fulfilment?.state === "waiting"
                ? t("ชำระแล้ว รอร้านส่งมอบ")
                : order.status === "DELIVERED"
                ? t("สั่งซื้อสำเร็จ พร้อมรับสินค้า")
                : order.status === "PREORDER"
                  ? t("บันทึกการสั่งจองแล้ว")
                  : order.status === "PENDING_PAYMENT"
                    ? t("บันทึกคำสั่งซื้อแล้ว")
                    : order.status === "FAILED"
                      ? t("การชำระเงินไม่สำเร็จ")
                      : order.status === "CANCELLED" && order.expired_at
                        ? t("หมดเวลาชำระเงิน")
                      : order.status === "CANCELLED"
                        ? t("คำสั่งซื้อถูกยกเลิก")
                        : t("สินค้าหมดก่อนทำรายการ"))}
            </h1>
            <p>
              {preorderHeading(order)?.[1] ?? (order.status === "DELIVERED" && order.fulfilment
                ? t("ร้านกำลังทำรายการให้คุณ")
                : order.status === "DELIVERED"
                ? t("ID และรหัสผ่านของคุณอยู่ด้านล่าง")
                : order.status === "PENDING_PAYMENT"
                  ? t("ชำระเงินเพื่อรับสินค้า")
                  : order.status === "PREORDER"
                    ? t("ร้านจะส่งสินค้าให้ตามลำดับคิว และแจ้งเตือนในเว็บเมื่อส่งแล้ว")
                    : order.status === "CANCELLED" && order.expired_at
                      ? t("ระบบยกเลิกคำสั่งซื้อนี้แล้ว ไม่มีการตัดเงิน")
                      : t("รายการนี้ไม่มีการส่งสินค้า"))}
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
                  {order.label}{" "}{t("· จำนวน")}{" "}{order.quantity}{" "}{t("ชิ้น")}
                </p>
              </div>
              <Status status={shownStatus(order)} />
            </div>
            {!!order.refundedTotal && (
              <div className="note-box refund-note">
                <RotateCcw size={20} />
                <div>
                  <strong>
                    {order.refundStatus === "REFUNDED" ? t("ร้านคืนเงินคำสั่งซื้อนี้แล้ว") : t("ร้านคืนเงินบางส่วนแล้ว")}{" "}
                    {money(order.refundedTotal)}
                  </strong>
                  <p>{t("ดูรายละเอียดได้ที่การแจ้งเตือนและหน้าเครดิตของฉัน")}</p>
                </div>
              </div>
            )}
            <div className="order-meta">
              <span>{t("คำสั่งซื้อ #")}{order.id.slice(0, 8).toUpperCase()}</span>
              <span>{dateTime(order.created_at)}</span>
              {order.createdByAdmin && <ManualOrderNote method={order.paymentMethodLabel} />}
              {order.checkout_id && (
                <Link to={"/checkouts/" + order.checkout_id} className="receipt-link">
                  {t("ทั้งคำสั่งซื้อ #{id}", { id: order.checkout_id.slice(0, 8).toUpperCase() })}
                </Link>
              )}
              {hasReceipt(order) && <ReceiptLink id={order.id} />}
              <AskInChat order={{ id: order.id, name: order.name }} />
            </div>
            {!!order.discount && (
              <dl className="order-price-breakdown" aria-label={t("สรุปยอด")}>
                <div>
                  <dt>{t("ราคาสินค้า")}</dt>
                  <dd>{money(order.subtotal ?? order.total + order.discount)}</dd>
                </div>
                <div className="is-discount">
                  <dt>
                    <TicketPercent size={15} />
                    {t("ส่วนลด")}
                    {order.coupon_code ? " (" + order.coupon_code + ")" : ""}
                  </dt>
                  <dd>−{money(order.discount)}</dd>
                </div>
                <div className="is-total">
                  <dt>{t("ยอดชำระ")}</dt>
                  <dd>{money(order.total)}</dd>
                </div>
              </dl>
            )}
            {order.status === "DELIVERED" && <WarrantyStatus until={order.warranty_until} />}
            <PreorderProgress
              order={order}
              busy={busy}
              canPay={user.balance >= (order.amountDue ?? 0)}
              testPayments={testPayments}
              balance={user.balance}
              shopOpen={shopOpen}
              error={error}
              onPay={() => void payBalance()}
              onCancel={cancelReservation}
            />
            {order.status === "CANCELLED" && order.expired_at ? (
              <div className="note-box expired-note" role="status">
                <Clock size={20} />
                <div>
                  <strong>{t("หมดเวลาชำระเงิน · สั่งใหม่ได้")}</strong>
                  <p>{t("คำสั่งซื้อที่ยังไม่ชำระจะถูกยกเลิกอัตโนมัติเมื่อเกินเวลา สินค้าในร้านยังสั่งซื้อใหม่ได้ตามปกติ")}</p>
                  <Link to="/products" className="button primary">
                    {t("สั่งซื้อใหม่")}
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            ) : order.status === "PREORDER" ? (
              isQueueMode(order) ? null : (
              <div className="note-box">
                <Clock size={20} />
                <div>
                  <strong>
                    {order.queueNumber != null
                      ? t("คิวที่ {n}", { n: order.queueNumber })
                      : t("สินค้าสั่งจอง · รอส่งตามคิว")}
                  </strong>
                  <p>{t("ชำระเงินแล้ว ร้านจะส่ง ID และรหัสผ่านมาที่หน้านี้ และแจ้งเตือนเมื่อส่งแล้ว")}</p>
                </div>
              </div>
              )
            ) : order.status === "DELIVERED" && order.fulfilment ? (
              <>
                <FulfilmentCard order={order} />
                <DeliveredExtras order={order} />
              </>
            ) : order.status === "DELIVERED" ? (
              <div className="delivered-codes">
                <div className="code-heading">
                  <strong>
                    <KeyRound size={17} />
                    {order.credentials?.length ? t("บัญชีของคุณ") : t("โค้ดสินค้าของคุณ")}
                  </strong>
                  <button
                    className="text-button"
                    onClick={() => setRevealed(!revealed)}
                  >
                    {revealed ? <EyeOff size={16} /> : <Eye size={16} />}{" "}
                    {revealed ? t("ซ่อนโค้ด") : t("แสดงโค้ด")}
                  </button>
                </div>
                {order.credentials?.map((pair, i) => (
                  <div className="credential-pair" key={"pair-" + i}>
                    {pair.seat != null && (
                      // Shared account: which seat / profile is the customer's.
                      <span className="seat-label">
                        <Users size={14} />
                        {t("ที่นั่ง {n}", { n: pair.seat })}
                      </span>
                    )}
                    {[
                      [t("ไอดี"), pair.loginId],
                      [t("รหัสผ่าน"), pair.password],
                      ...(pair.profile ? [[t("โปรไฟล์"), pair.profile]] : []),
                      ...(pair.pin ? [["PIN", pair.pin]] : []),
                    ].map(([label, value]) => (
                      <div className="code-row" key={label}>
                        <small>{label}</small>
                        <code>{revealed ? value : "••••••••"}</code>
                        <button
                          className="icon-button"
                          onClick={() => copy(value)}
                          aria-label={t("คัดลอก") + label + t(" รายการที่ ") + (i + 1)}
                        >
                          <Copy size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
                {order.codes.map((code, i) => (
                  <div className="code-row" key={i}>
                    <code>{revealed ? code : "••••-••••-••••-••••"}</code>
                    <button
                      className="icon-button"
                      onClick={() => copy(code)}
                      aria-label={t("คัดลอกโค้ด ") + (i + 1)}
                    >
                      <Copy size={18} />
                    </button>
                  </div>
                ))}
                <DeliveredLinks links={order.links ?? []} />
                <p className="sandbox-note">{t("เก็บโค้ดนี้ไว้ในที่ปลอดภัย")}</p>
                <DeliveredExtras order={order} />
              </div>
            ) : (
              order.status === "PENDING_PAYMENT" && (
                <>
                  <div className="note-box">
                    <Clock size={20} />
                    <div>
                      <strong>
                        {order.preorderMode === "deposit" ? t("ชำระตอนจอง (มัดจำ)") : t("ยอดคำสั่งซื้อ")}{" "}
                        {money(order.amountDue ?? order.total)}
                      </strong>
                      <PayDeadline createdAt={order.created_at} />
                      {testPayments ? (
                        <>
                          <p>
                            {t("โหมดทดสอบ: ชำระด้วยเครดิตทดลอง")} · {t("เครดิตคงเหลือ")} {money(user.balance)}
                          </p>
                          <ErrorMessage message={error} />
                          <ShopClosedNote pay />
                          <EmailVerifyNotice compact />
                          <div className="pay-actions">
                            <button
                              className="button primary"
                              disabled={busy || user.balance < (order.amountDue ?? order.total) || !shopOpen || verifyEmail}
                              onClick={() => pay("success")}
                            >
                              {busy ? <LoaderCircle className="spin" size={17} /> : <CreditCard size={17} />}
                              {t("ชำระเงิน")} {money(order.amountDue ?? order.total)}
                            </button>
                            {user.balance < (order.amountDue ?? order.total) && (
                              <Link to="/wallet" className="button secondary">
                                {t("เติมเครดิตทดลอง")}
                              </Link>
                            )}
                          </div>
                        </>
                      ) : (
                        <p>{t("รอเชื่อมช่องทางชำระเงิน ระบบจะส่ง ID และรหัสผ่านหลังยืนยันยอดแล้วเท่านั้น")}</p>
                      )}
                    </div>
                  </div>
                  {/* Bank's PromptPay/slip shell is the UI for the real provider; test mode pays with test credit. */}
                  {!testPayments && <PayShell total={order.amountDue ?? order.total} />}
                </>
              )
            )}
          </section>
          {["FAILED", "OUT_OF_STOCK"].includes(order.status) && (
            <div className="result-actions">
              <p>{t("ไม่มีการหักเครดิตหรือส่งมอบโค้ดสำหรับรายการนี้")}</p>
              <Link to="/products" className="button secondary">
                {t("กลับไปเลือกสินค้า")}
              </Link>
            </div>
          )}
          {order.status === "DELIVERED" && (
            <div className="result-actions">
              <RebuyActions order={order} />
              <Link to="/products" className="button secondary">
                {t("เลือกซื้อสินค้าเพิ่มเติม")}
                <ArrowRight size={17} />
              </Link>
              <p>
                <ShieldCheck size={16} />
                {t("เปิดดู ID และรหัสผ่านซ้ำได้เสมอในประวัติการซื้อ")}
              </p>
              {/* The server only accepts reviews for ready-stock orders. */}
              {!order.preorder && (
                <Link to={"/reviews?order=" + id} className="subtle-link">
                  <Star size={16} />
                  {t("รีวิวคำสั่งซื้อนี้")}
                </Link>
              )}
            </div>
          )}

        </>
      )}
    </main>
  );
}
/** "Pay by HH:MM": unpaid orders are cancelled after the shop's payment window. */
export function PayDeadline({ createdAt }: { createdAt: string }) {
  const { overview } = useStore();
  const minutes = Number(overview?.shop?.pendingExpiryMinutes) || 30;
  const deadline = new Date(new Date(createdAt.replace(" ", "T") + "Z").getTime() + minutes * 60000);
  if (Number.isNaN(deadline.getTime())) return null;
  const time = deadline.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
  return (
    <p className="pay-deadline">
      {t("กรุณาชำระภายใน {time} หากเกินเวลา ระบบจะยกเลิกคำสั่งซื้ออัตโนมัติ", { time })}
    </p>
  );
}
function WalletPage() {
  const { user, refresh, toast } = useStore();
  const [entries, setEntries] = useState<Ledger[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(0);
  const testPayments = useTestPayments();
  async function topup(amount: number) {
    setBusy(amount);
    setError("");
    try {
      await api("/topup", { amount, requestKey: crypto.randomUUID() });
      await Promise.all([refresh(), load()]);
      toast(t("เติมเครดิตทดลองแล้ว"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(0);
    }
  }
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
        <span className="eyebrow">{t("กระเป๋าเงิน")}</span>
        <h1>{t("เครดิตของฉัน")}</h1>
        <p>
          {testPayments
            ? t("โหมดทดสอบ: เติมเครดิตทดลองเพื่อลองสั่งซื้อได้ ไม่ใช่เงินจริง")
            : t("ยอดเครดิตและประวัติการใช้งานของคุณ")}
        </p>
      </div>
      {!user ? (
        <RequireLogin />
      ) : (
        <div className="wallet-layout">
          <div>
            <section className="wallet-balance panel">
              <span>
                <Wallet size={20} />
                {t("เครดิตคงเหลือ")}
              </span>
              <strong>{money(user.balance)}</strong>
              <small>{testPayments ? t("เครดิตทดลอง") : t("ใช้ชำระคำสั่งซื้อในร้าน")}</small>
            </section>
            {testPayments && (
              <section className="panel topup-panel">
                <h2>{t("เติมเครดิตทดลอง")}</h2>
                <p>{t("สำหรับทดสอบระบบเท่านั้น ไม่มีการเก็บเงินจริง")}</p>
                <div className="topup-amounts">
                  {[100, 300, 500, 1000].map((amount) => (
                    <button
                      key={amount}
                      className="button secondary"
                      disabled={!!busy}
                      onClick={() => topup(amount)}
                    >
                      {busy === amount ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                      {money(amount * 100)}
                    </button>
                  ))}
                </div>
                <ErrorMessage message={error} />
              </section>
            )}
            {!testPayments && <ErrorMessage message={error} />}
          </div>
          <section className="panel wallet-history">
            <div className="panel-heading">
              <h2>{t("ประวัติเครดิต")}</h2>
              <History size={18} />
            </div>
            {entries === null ? (
              <div className="loading-row">
                <LoaderCircle className="spin" />
                {t("กำลังโหลด")}
              </div>
            ) : entries.length ? (
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
                    <strong>
                      {e.type && <span className={"ledger-type ledger-type-" + e.type.toLowerCase()}>{t(ledgerTypeText[e.type])}</span>}
                      {ledgerText(e.label)}
                    </strong>
                    <small>{dateTime(e.created_at)}</small>
                  </div>
                  <b className={e.amount > 0 ? "positive" : ""}>
                    {e.amount > 0 ? "+" : e.amount < 0 ? "−" : ""}
                    {money(Math.abs(e.amount))}
                    {e.balanceAfter != null && (
                      <small className="ledger-balance">
                        {t("คงเหลือ")} {money(e.balanceAfter)}
                      </small>
                    )}
                  </b>
                </div>
              ))
            ) : (
              <p className="empty-inline">{t("ยังไม่มีรายการเครดิต")}</p>
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
      toast(t("ขอบคุณสำหรับรีวิวของคุณ"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container page-main reference-reviews-page">
      <div className="page-heading">
        <span className="eyebrow">{t("รีวิวจากลูกค้า")}</span>
        <h1>
          {t("เครดิตร้าน")}
          <br />
          {shopName(overview?.shop?.shopName)}
        </h1>
        <p>{t("รีวิวจากคนที่ซื้อจริง ทุกรายการตรวจสอบจากออเดอร์")}</p>
      </div>
      <div className="reviews-layout">
        <aside>
          <div className="panel review-summary">
            <Star size={24} />
            <strong>{reviews.length ? average.toFixed(1) : "—"}</strong>
            <div className="review-stars" aria-label={t("คะแนนเฉลี่ย")}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  size={17}
                  key={n}
                  fill={n <= Math.round(average) ? "currentColor" : "none"}
                />
              ))}
            </div>
            <span>{reviews.length}{" "}{t("รีวิวจากผู้ซื้อ")}</span>
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
              {t("เขียนรีวิวได้หลังได้รับสินค้าแล้วเท่านั้น หนึ่งรีวิวต่อหนึ่งคำสั่งซื้อ")}
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
                {n ? n + t(" ดาว") : t("ทั้งหมด")}
              </button>
            ))}
          </div>
          <ErrorMessage message={error} />
          {orders.length > 0 && (
            <form className="panel review-form" onSubmit={submit}>
              <h2>{t("แบ่งปันประสบการณ์ของคุณ")}</h2>
              <label className="field">
                {t("คำสั่งซื้อ")}
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
                {t("คะแนน")}
                <select name="rating" defaultValue="5">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}{" "}{t("ดาว")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t("ความคิดเห็น")}
                <textarea
                  name="comment"
                  placeholder={t("บอกเล่าประสบการณ์การสั่งซื้อของคุณ")}
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
                {t("ส่งรีวิว")}
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
                      aria-label={r.rating + t(" ดาว")}
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
                      {t("ผู้ซื้อที่ได้รับสินค้าแล้ว ·")}{" "}{r.product}
                    </small>
                  </article>
                ))
            : loaded && (
                <Empty
                  icon={<Star />}
                  heading={t("ยังไม่มีรีวิว")}
                  description={t("เมื่อซื้อและได้รับสินค้าแล้ว คุณสามารถเป็นคนแรกที่แบ่งปันประสบการณ์ได้")}
                  action={
                    <Link to="/products" className="button secondary">
                      {t("เลือกดูสินค้า")}
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
  const testPayments = useTestPayments();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  async function onAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarError("");
    if (!AVATAR_TYPES.has(file.type) || file.size < 1 || file.size > AVATAR_MAX_BYTES) {
      setAvatarError("รูปต้องเป็น JPEG, PNG หรือ WebP และไม่เกิน 2MB");
      return;
    }
    setAvatarBusy(true);
    try {
      await uploadImage("/profile/avatar", file, file.type);
      await refresh();
      toast(t("อัปเดตรูปโปรไฟล์แล้ว"));
    } catch (err) {
      setAvatarError((err as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  }
  async function removeAvatar() {
    setAvatarError("");
    setAvatarBusy(true);
    try {
      await api("/profile/avatar", undefined, "DELETE");
      await refresh();
      toast(t("ลบรูปโปรไฟล์แล้ว"));
    } catch (err) {
      setAvatarError((err as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/profile", data);
      await refresh();
      toast(t("บันทึกข้อมูลแล้ว"));
      if (data.newPassword) go("/login");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container page-main narrow-main reference-account-page">
      <div className="page-heading">
        <span className="eyebrow">{t("บัญชีของฉัน")}</span>
        <h1>{t("บัญชีของฉัน")}</h1>
        <p>{t("ข้อมูลและการตั้งค่าบัญชีของคุณ")}</p>
      </div>
      {!user ? (
        <RequireLogin />
      ) : (
        <>
          <EmailVerifyNotice />
          <div className="account-summary panel">
            <UserAvatar user={user} large />
            <div>
              <h2>{user.name}</h2>
              <p>{user.email}</p>
              <div className="account-avatar-actions">
                <label className="button secondary" htmlFor="account-avatar">
                  {avatarBusy ? <LoaderCircle className="spin" size={17} /> : null}
                  {t("เปลี่ยนรูปโปรไฟล์")}
                </label>
                <input
                  id="account-avatar"
                  className="account-avatar-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={onAvatar}
                  disabled={avatarBusy}
                />
                {user.avatarUrl ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={removeAvatar}
                    disabled={avatarBusy}
                  >
                    {t("ลบรูปโปรไฟล์")}
                  </button>
                ) : null}
              </div>
              <ErrorMessage message={avatarError} />
            </div>
            <span className="service-pill">
              {user.role === "ADMIN" ? t("ผู้ดูแลร้าน") : t("สมาชิก")}
            </span>
          </div>
          <div className="account-shortcuts">
            <Link to="/orders" className="panel">
              <History size={21} />
              <span>{t("ประวัติการซื้อ")}</span>
              <ArrowUpRight size={17} />
            </Link>
            {testPayments && (
              <Link to="/wallet" className="panel">
                <Wallet size={21} />
                <span>{money(user.balance)}</span>
                <ArrowUpRight size={17} />
              </Link>
            )}
          </div>
          <StockWatchList />
          <form className="panel profile-form" onSubmit={save}>
            <h2>{t("ข้อมูลส่วนตัว")}</h2>
            <ErrorMessage message={error} />
            <label className="field">
              {t("ชื่อที่แสดง")}
              <input
                name="name"
                defaultValue={user.name}
                required
                minLength={2}
                maxLength={60}
              />
            </label>
            <label className="field">
              {t("อีเมล")}
              <input value={user.email} disabled />
            </label>
            <h3>{t("เปลี่ยนรหัสผ่าน")}</h3>
            <p className="muted">{t("เว้นว่างหากไม่ต้องการเปลี่ยนรหัสผ่าน")}</p>
            <label className="field">
              {t("รหัสผ่านปัจจุบัน")}
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              {t("รหัสผ่านใหม่")}
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
              {t("บันทึกการเปลี่ยนแปลง")}
            </button>
          </form>
          <SessionsCard variant="store" />
          <PrivacyDataPanel />
        </>
      )}
    </main>
  );
}

/** PDPA: download own JSON + request account deletion (CUSTOMER). */
function PrivacyDataPanel() {
  const { toast } = useStore();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState("");
  async function downloadExport() {
    setBusy(true);
    setError("");
    try {
      const data = await api<Record<string, unknown>>("/account/privacy/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "astra-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
      toast(t("ดาวน์โหลดสำเนาข้อมูลแล้ว"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function requestDelete() {
    if (!(await confirmDialog({
      title: t("ยืนยันขอลบบัญชี? แอดมินจะตรวจสอบก่อนปิดบังข้อมูลส่วนตัว และเก็บประวัติออเดอร์ไว้"),
      confirmText: t("ยืนยัน"),
      cancelText: t("ยกเลิก"),
      danger: true,
    })))
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string; status: string }>("/account/privacy/delete", {
        reason: "ขอลบจากหน้าบัญชี",
      });
      setRequestId(result.id);
      toast(t("ส่งคำขอลบบัญชีแล้ว รอแอดมินอนุมัติ"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>{t("ข้อมูลส่วนบุคคล (PDPA)")}</h2>
      <p className="muted">
        {t("ดาวน์โหลดสำเนาข้อมูลของคุณ หรือขอลบบัญชีตามสิทธิ์เจ้าของข้อมูล — ร้านจะปิดบังชื่อ/อีเมล/เบอร์ แต่เก็บออเดอร์และการเงินไว้")}
      </p>
      <ErrorMessage message={error} />
      {requestId && (
        <p className="field-help">
          {t("รหัสคำขอ")}: <code>{requestId.slice(0, 8)}</code> · {t("สถานะรออนุมัติ")}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={() => void downloadExport()}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
          {t("ดาวน์โหลดข้อมูลของฉัน")}
        </button>
        <button type="button" className="button ghost" disabled={busy} onClick={() => void requestDelete()}>
          <Trash2 size={15} />
          {t("ขอลบบัญชี")}
        </button>
      </div>
    </section>
  );
}

function InfoPage({ kind }: { kind: string }) {
  const { overview } = useStore();
  const name = shopName(overview?.shop?.shopName);
  if (kind === "support") return <ContactPage shop={overview?.shop} shopName={name} />;
  const title = t("เครดิตร้าน");
  return (
    <main className="container page-main narrow-main reference-info-page">
      <div className="page-heading">
        <span className="eyebrow">{name}</span>
        <h1>{title}</h1>
        <p>
          {t("ข้อมูลร้านค้าและมาตรฐานการให้บริการ")}
        </p>
      </div>
      <div className="panel prose">
        {kind === "credits" ? (
          <>
            <h2>
              <ShieldCheck size={23} />
              {t("ซื้อสินค้าอย่างมั่นใจ")}
            </h2>
            <p>
              {name}{" "}{t("บันทึกคำสั่งซื้อทุกครั้ง โค้ดจะถูกส่งหลังยืนยันการชำระเงินเท่านั้น")}
            </p>
            <div className="trust-list">
              <div>
                <KeyRound />
                <h3>{t("โค้ดแยกเฉพาะคำสั่งซื้อ")}</h3>
                <p>
                  {t("หนึ่งโค้ดสำหรับหนึ่งหน่วยสินค้า ระบบจัดสรรจากคลังหลังยืนยันการชำระเท่านั้น")}
                </p>
              </div>
              <div>
                <History />
                <h3>{t("ดูย้อนหลังได้")}</h3>
                <p>{t("เปิดดูโค้ดและคำสั่งซื้อผ่านบัญชีของคุณได้ตลอดเวลา")}</p>
              </div>
              <div>
                <Wallet />
                <h3>{t("เครดิตตรวจสอบได้")}</h3>
                <p>{t("ทุกรายการเติมและใช้เครดิตมีประวัติที่ตรวจสอบได้")}</p>
              </div>
            </div>
            <Link to="/products" className="button primary">
              {t("เลือกดูสินค้า")}
              <ArrowRight size={17} />
            </Link>
          </>
        ) : null}
      </div>
    </main>
  );
}
function NotFound() {
  return (
    <main className="container page-main reference-missing-page">
      <Empty
        icon={<Search />}
        heading={t("ไม่พบหน้านี้")}
        description={t("หน้านี้อาจถูกย้าย หรือที่อยู่ไม่ถูกต้อง")}
        action={
          <Link className="button primary" to="/">
            {t("กลับหน้าร้าน")}
            <ArrowRight size={16} />
          </Link>
        }
      />
    </main>
  );
}
function writeMeta(name: string, content: string, property = false) {
  const attr = property ? "property" : "name";
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}
export function usePageTitle(page: string, description = "") {
  const { overview } = useStore();
  // ตั้งค่า › หน้าตาร้าน › SEO: site title / description / share image (empty = automatic).
  const seo = useAppearance().seo;
  const name = text(seo.title) || shopName(overview?.shop?.shopName);
  const siteDescription = text(seo.description);
  const image = location.origin + (seo.ogImageUrl || "/brand/og.png");
  useEffect(() => {
    if (!page) return;
    const summary = (
      description ||
      siteDescription ||
      t("ร้านสินค้าดิจิทัล ส่งไว ปลอดภัย ใช้งานได้ทันที")
    ).slice(0, 180);
    document.title = page + " — " + name;
    writeMeta("description", summary);
    writeMeta("og:title", page + " — " + name, true);
    writeMeta("og:description", summary, true);
    writeMeta("og:image", image, true);
  }, [page, description, name, siteDescription, image, getLang()]);
}
function Router() {
  const { path } = useStore();
  const siteSeo = useAppearance().seo;
  const testPayments = useTestPayments();
  const walletHidden = (path === "/wallet" || path === "/top-up") && !testPayments;
  const titles: Record<string, string> = {
    "/": t("หน้าร้าน"),
    "/products": t("สินค้าทั้งหมด"),
    "/login": t("เข้าสู่ระบบ"),
    "/register": t("สมัครสมาชิก"),
    "/reset-password": t("ตั้งรหัสผ่านใหม่"),
    "/verify-email": t("ยืนยันอีเมล"),
    "/orders": t("ประวัติการซื้อ"),
    "/cart": t("ตะกร้าสินค้า"),
    "/checkout": t("ตรวจสอบคำสั่งซื้อ"),
    "/account": t("บัญชีของฉัน"),
    "/wallet": t("บัญชีของร้าน"),
    "/top-up": t("บัญชีของร้าน"),
    "/reviews": t("เครดิตร้าน"),
    "/credits": t("เครดิตร้าน"),
    "/support": t("ติดต่อเรา"),
    "/faq": t("คำถามที่พบบ่อย"),
    "/news": t("ข่าวสารและกิจกรรม"),
    "/about": t("เกี่ยวกับเรา"),
    "/terms": t("ข้อกำหนดการใช้บริการ"),
    "/privacy": t("นโยบายความเป็นส่วนตัว"),
    "/stores": t("ร้านค้า"),
    "/admin": t("แดชบอร์ด"),
  };
  const descriptions: Record<string, string> = {
    "/": text(siteSeo.description) || t("ร้านสินค้าดิจิทัล ส่งไว ปลอดภัย ใช้งานได้ทันที"),
    "/products": t("สินค้าดิจิทัลทั้งหมดของร้าน"),
    "/cart": t("สินค้าที่คุณเลือกไว้ พร้อมเมื่อคุณพร้อม"),
    "/reset-password": t("ตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ"),
    "/verify-email": t("ยืนยันอีเมลของบัญชีของคุณ"),
    "/checkout": t("ตรวจสอบข้อมูลให้ครบ ระบบจะบันทึกคำสั่งซื้อไว้ก่อน"),
    "/orders": t("ติดตามคำสั่งซื้อและเปิดดูโค้ดสินค้าของคุณ"),
    "/account": t("ข้อมูลและการตั้งค่าบัญชีของคุณ"),
    "/wallet": t("ช่องทางจ่ายยังไม่เปิด โค้ดจะถูกส่งหลังยืนยันยอดแล้วเท่านั้น"),
    "/top-up": t("ช่องทางจ่ายยังไม่เปิด โค้ดจะถูกส่งหลังยืนยันยอดแล้วเท่านั้น"),
    "/reviews": t("รีวิวจากคนที่ซื้อจริง ทุกรายการตรวจสอบจากออเดอร์"),
    "/credits": t("รีวิวจากคนที่ซื้อจริง ทุกรายการตรวจสอบจากออเดอร์"),
    "/support": t("เราพร้อมช่วยเหลือคุณ"),
    "/faq": t("คำตอบเรื่องการรับสินค้า การรับประกัน และการติดต่อร้าน"),
    "/news": t("ข่าวสาร โปรโมชัน และกิจกรรมของร้าน"),
    "/about": t("รู้จักร้านและช่องทางติดต่อ"),
    "/terms": t("ข้อกำหนดการใช้บริการ การสั่งซื้อ การรับประกัน และการคืนเงินของร้าน"),
    "/privacy": t("วิธีที่ร้านเก็บรวบรวม ใช้ และคุ้มครองข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562"),
  };
  // /products sets its own title ("<หมวด> — <ร้าน>" when a category is picked).
  const dynamic =
    path === "/products" ||
    path.startsWith("/products/") ||
    path.startsWith("/orders/") ||
    path.startsWith("/checkout/") ||
    path.startsWith("/checkouts/") ||
    path.startsWith("/news/");
  const page = dynamic
    ? ""
    : walletHidden
      ? t("ไม่พบหน้านี้")
      : path.startsWith("/admin")
        ? t("แดชบอร์ด")
        : (titles[path] ?? t("ไม่พบหน้านี้"));
  usePageTitle(
    page,
    dynamic
      ? ""
      : walletHidden
        ? t("หน้านี้อาจถูกย้าย หรือที่อยู่ไม่ถูกต้อง")
        : (descriptions[path] ?? t("หน้านี้อาจถูกย้าย หรือที่อยู่ไม่ถูกต้อง")),
  );
  if (path === "/stores") return <Stores />;
  if (path === "/") return <Home />;
  if (path === "/products") return <ReferenceCatalogPage />;
  if (path.startsWith("/products/"))
    return (
      <ReferenceProduct key={path} id={decodeURIComponent(path.slice(10))} />
    );
  if (path === "/login" || path === "/register")
    return <ReferenceAuth key={path} register={path === "/register"} />;
  if (path === "/reset-password") return <ResetPasswordPage />;
  if (path === "/verify-email") return <VerifyEmailPage />;
  if (path === "/cart") return <CartPage />;
  if (path === "/checkout") return <CheckoutPage />;
  if (path.startsWith("/checkouts/")) return <CheckoutGroupPage key={path} id={path.split("/")[2]} />;
  if (path.startsWith("/orders/") || path.startsWith("/checkout/"))
    return (
      <OrderPage
        key={path.split("/")[2]}
        id={path.split("/")[2]}
        payment={path.startsWith("/checkout/")}
      />
    );
  if (path === "/orders") return <HistoryPage />;
  if (path === "/wallet" || path === "/top-up")
    return testPayments ? <WalletPage /> : <NotFound />;
  if (path === "/reviews" || path === "/credits") return <ReferenceReviews />;
  if (path === "/account") return <Account />;
  if (path.startsWith("/admin"))
    return (
      <Suspense
        fallback={
          <main className="container page-main">
            {t("กำลังโหลดระบบจัดการร้าน...")}
          </main>
        }
      >
        <Admin />
      </Suspense>
    );
  if (path === "/terms" || path === "/privacy")
    return (
      <Suspense
        fallback={
          <main className="container page-main narrow-main">
            <div className="loading-row">
              <LoaderCircle className="spin" size={18} />
              {t("กำลังโหลด")}
            </div>
          </main>
        }
      >
        <LegalPage kind={path === "/terms" ? "terms" : "privacy"} />
      </Suspense>
    );
  if (path === "/support") return <InfoPage kind="support" />;
  if (path === "/faq") return <FaqPage />;
  if (path === "/news") return <NewsListPage />;
  if (path.startsWith("/news/")) return <NewsDetailPage key={path} id={path.slice(6).replace(/\/$/, "")} />;
  if (path === "/about") return <AboutPage />;
  return <NotFound />;
}
export default function App() {
  const [path, setPath] = useState(location.pathname);
  const merchant = path.startsWith("/admin") || path === "/stores";
  // Printable receipt pages render on their own (no header, footer or chat).
  const receipt = receiptRoute(path);
  const [lang, setLangState] = useState<Lang>(getLang);
  setMerchantScope(merchant);
  useRouteMotion(path);
  useCardTilt();
  const changeLang = (value: Lang, origin?: { x: number; y: number }) => {
    if (value === lang) return;
    const root = document.documentElement;
    const x = origin?.x ?? innerWidth - 120;
    const y = origin?.y ?? 32;
    // Radius that reaches the farthest corner from the toggle.
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.style.setProperty("--lx", x + "px");
    root.style.setProperty("--ly", y + "px");
    root.style.setProperty("--lr", Math.ceil(r) + "px");
    let ring: HTMLDivElement | null = null;
    const swap = () => {
      setLang(value);
      flushSync(() => setLangState(value));
      ring = document.createElement("div");
      ring.className = "lang-ring";
      ring.setAttribute("aria-hidden", "true");
      (document.querySelector(".storefront-shell") ?? document.body).append(ring);
    };
    const cleanup = () => {
      ring?.remove();
      root.classList.remove("lang-swap");
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      swap();
      return cleanup();
    }
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    if (doc.startViewTransition) {
      doc.startViewTransition(swap).finished.finally(cleanup);
      return;
    }
    // Fallback without View Transitions: ring + text rising in.
    swap();
    root.classList.remove("lang-swap");
    void root.offsetWidth;
    root.classList.add("lang-swap");
    setTimeout(cleanup, 900);
  };
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  // Admin's live preview embeds the storefront with ?shop-preview and posts
  // unsaved shop fields here; they only change this framed page.
  const [previewShop, setPreviewShop] = useState<Record<string, string> | null>(null);
  // ตั้งค่า › หน้าตาร้าน posts the unsaved appearance (and which page to show) the same way.
  const [previewAppearance, setPreviewAppearance] = useState<Appearance | null>(null);
  const [preview] = useState(
    () => window.parent !== window && new URLSearchParams(location.search).has("shop-preview"),
  );
  useEffect(() => {
    if (!preview) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== "shop-preview") return;
      setPreviewShop(e.data.shop ?? null);
      setPreviewAppearance(e.data.appearance ?? null);
      const page = e.data.path;
      if (typeof page === "string" && page.startsWith("/") && !page.startsWith("//") && page !== location.pathname)
        go(page + "?shop-preview=1");
      // The editor's tab changed: bring the part being edited into view.
      if (e.data.focus === "footer")
        setTimeout(() => document.querySelector(".site-footer")?.scrollIntoView({ block: "end" }), 120);
      else if (e.data.focus === "top") setTimeout(() => scrollTo({ top: 0 }), 120);
    };
    addEventListener("message", onMessage);
    window.parent.postMessage({ type: "shop-preview-ready" }, location.origin);
    return () => removeEventListener("message", onMessage);
  }, []);
  const shownOverview =
    overview && (previewShop || previewAppearance)
      ? ({
          ...overview,
          shop: { ...overview.shop, ...previewShop },
          appearance: previewAppearance ?? overview.appearance,
        } as Overview)
      : overview;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [cart, setCartState] = useState<CartLine[]>(loadCart);
  const setCart = (lines: CartLine[]) => {
    setCartState(lines);
    saveCart(lines);
  };
  const ticked = cart.filter((l) => l.selected);
  const basket: Basket | null = ticked.length === 1 ? { variantId: ticked[0].variantId, quantity: ticked[0].quantity } : null;
  const setBasket = (value: Basket | null) =>
    setCart(value ? withLine(cart, value.variantId, value.quantity, true) : cart.filter((l) => !l.selected));
  const addToCart = (variantId: string, quantity: number, only = false) =>
    setCart(withLine(cart, variantId, quantity, only));
  // The URL on screen, so a cancelled back/forward can be put back.
  const shownUrl = useRef(location.pathname + location.search);
  function go(to: string, options: { keepScroll?: boolean } = {}) {
    // A page with unsaved changes (useUnsavedChangesGuard) may cancel.
    void confirmLeave().then((ok) => {
      if (!ok) return;
      history.pushState({}, "", to);
      shownUrl.current = location.pathname + location.search;
      setPath(location.pathname);
      dispatchEvent(new Event(NAVIGATE_EVENT));
      if (!options.keepScroll) window.scrollTo({ top: 0, behavior: "instant" });
    });
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
  // Stock, prices and products update live on every open tab.
  useLive(["catalog"], () => void refresh());
  useEffect(() => {
    void refresh();
    const onPop = () => {
      const next = location.pathname + location.search;
      if (next === shownUrl.current) return;
      void confirmLeave().then((ok) => {
        if (!ok) {
          history.pushState({}, "", shownUrl.current);
          return;
        }
        shownUrl.current = location.pathname + location.search;
        setPath(location.pathname);
        dispatchEvent(new Event(NAVIGATE_EVENT));
      });
    };
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
        overview: shownOverview,
        basket,
        setBasket,
        cart,
        setCart,
        addToCart,
        refresh,
        go,
        toast: setToast,
        path,
        loading,
        lang,
        changeLang,
      }}
    >
      {receipt ? (
        <ReceiptPage key={path} id={receipt.id} admin={receipt.admin} kind={receipt.kind} />
      ) : (
      <>
      <a className="skip-link" href="#content">
        {t("ข้ามไปเนื้อหา")}
      </a>
      <div className={merchant ? "merchant-shell" : "storefront-shell"}>
        <AppearanceEffects preview={preview} />
        {!merchant && <ScrollProgress />}
        {merchant ? <MerchantHeader /> : <Header />}
        <div id="content" tabIndex={-1}>
          {error ? (
            <main className="container page-main">
              <Empty
                icon={<AlertCircle />}
                heading={t("เชื่อมต่อร้านค้าไม่ได้")}
                description={error}
                action={
                  <button
                    className="button primary"
                    onClick={() => {
                      setLoading(true);
                      void refresh();
                    }}
                  >
                    {t("ลองอีกครั้ง")}
                  </button>
                }
              />
            </main>
          ) : (
            <div className="page-transition" key={path}>
              <Router />
            </div>
          )}
        </div>
        {!merchant && <Footer />}
        {!merchant && <CustomerChat />}
      </div>
      </>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {t(toast)}
          <button
            className="icon-button"
            aria-label={t("ปิดแจ้งเตือน")}
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
