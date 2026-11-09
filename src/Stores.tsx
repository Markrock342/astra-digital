import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  Sparkles,
  Store,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { useDialog } from "./dialog";
import { api } from "./api";
const nav = [
  ["", "ภาพรวม", LayoutDashboard],
  ["products", "สินค้า", Package],
  ["orders", "ออเดอร์", Receipt],
  ["payments", "การเงิน", Wallet],
  ["customers", "ลูกค้า", Users],
  ["settings", "ตั้งค่า", Settings],
] as const;
export function MerchantHeader() {
  const { user, path, go, refresh, overview } = useStore();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [term, setTerm] = useState("");
  const tab = path.split("/")[2] ?? "";
  const admin = path.startsWith("/admin") && user?.role === "ADMIN";
  useDialog(search, ".merchant-command-dialog", () => setSearch(false));
  const shop = overview?.shop?.shopName ?? "ASTRA DIGITAL";
  useEffect(() => {
    setMenu(false);
    setSearch(false);
  }, [path]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  async function logout() {
    await api("/logout", {});
    await refresh();
    go("/stores");
  }
  return (
    <>
      <header className="reference-merchant-header">
        <div className="reference-merchant-identity">
          <Link to="/stores" className="platform-mark" aria-label="ASTRA">
            A
          </Link>
          <span className="header-slash">/</span>
          {admin ? (
            <>
              <span className="merchant-shop-avatar">AS</span>
              <Link to="/stores">{shop}</Link>
              <span className="owner-badge">เจ้าของ</span>
              <button
                className="icon-button"
                aria-label="เปลี่ยนร้าน"
                onClick={() => go("/stores")}
              >
                <ChevronsUpDown size={15} />
              </button>
            </>
          ) : (
            <Link to="/stores">ร้านค้าของฉัน</Link>
          )}
        </div>
        <div className="reference-merchant-actions">
          {admin && (
            <>
              <button
                className="merchant-command"
                onClick={() => setSearch(true)}
              >
                <Search size={18} />
                <span>ค้นหาการตั้งค่า...</span>
                <kbd>⌘K</kbd>
              </button>
              <Link to="/admin/guide" className="header-quiet">
                <Sparkles size={18} />
                มีอะไรใหม่
              </Link>
              <Link to="/admin/guide" className="header-quiet">
                <BookOpen size={18} />
                คู่มือ
              </Link>
              <Link to="/" className="button secondary merchant-front-link">
                หน้าร้าน
                <ArrowUpRight size={17} />
              </Link>
            </>
          )}
          <div className="merchant-profile-wrap">
            <button
              className="merchant-profile"
              aria-label="เมนูบัญชี"
              onClick={() => setMenu(!menu)}
            >
              {user?.name.slice(0, 2) ?? "AS"}
            </button>
            {menu && (
              <div className="account-menu">
                <Link to="/stores">ร้านค้าของฉัน</Link>
                <Link to="/">หน้าร้าน</Link>
                {user ? (
                  <button onClick={logout}>
                    <LogOut size={15} />
                    ออกจากระบบ
                  </button>
                ) : (
                  <Link to="/login?next=%2Fstores">เข้าสู่ระบบ</Link>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      {admin && (
        <nav className="reference-primary-nav" aria-label="จัดการร้านค้า">
          {nav.map(([key, label, Icon]) => {
            const active =
              key === ""
                ? tab === "" || tab === "reports"
                : key === "products"
                  ? [
                      "products",
                      "inventory",
                      "categories",
                      "coupons",
                      "stamps",
                      "reviews",
                    ].includes(tab)
                  : key === "orders"
                    ? ["orders", "rentals", "issues", "otp"].includes(tab)
                    : key === "payments"
                      ? ["payments", "ledger", "top-ups"].includes(tab)
                      : key === tab;
            return (
              <Link
                key={key}
                to={"/admin" + (key ? "/" + key : "")}
                className={active ? "active" : ""}
              >
                <Icon size={19} />
                {label}
              </Link>
            );
          })}
        </nav>
      )}
      {search && (
        <div
          className="reference-modal-backdrop"
          onClick={() => setSearch(false)}
        >
          <section
            className="merchant-command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="ค้นหาการตั้งค่า"
            onClick={(e) => e.stopPropagation()}
          >
            <label>
              <Search size={19} />
              <input
                placeholder="ค้นหาการตั้งค่า..."
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <button
                className="icon-button"
                aria-label="ปิด"
                onClick={() => setSearch(false)}
              >
                <X size={17} />
              </button>
            </label>
            <div>
              {nav
                .filter(([, label]) => label.includes(term))
                .map(([key, label, Icon]) => (
                  <Link key={key} to={"/admin" + (key ? "/" + key : "")}>
                    <Icon size={17} />
                    {label}
                    <ArrowRight size={15} />
                  </Link>
                ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
export function DemoMerchantButton({
  label = "ลองจัดการร้านค้า",
  to = "/admin",
  className = "button primary",
}: {
  label?: string;
  to?: string;
  className?: string;
}) {
  const { user, go, refresh, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    if (user?.role === "ADMIN") return go(to);
    setBusy(true);
    setError("");
    try {
      await api("/demo-merchant", {});
      await refresh();
      toast("พื้นที่ทดลองร้านค้าพร้อมแล้ว");
      go(to);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className={className}
        aria-label={label === "สร้างร้าน" ? "เริ่มทดลองเป็นเจ้าของร้าน" : label}
        disabled={busy}
        onClick={start}
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Plus size={16} />
        )}{" "}
        {label}
      </button>
      {error && <ErrorMessage message={error} />}
    </>
  );
}
export default function Stores() {
  const { user, overview } = useStore();
  const active = user?.role === "ADMIN";
  const shop = overview?.shop?.shopName ?? "ASTRA DIGITAL";
  return (
    <main className="container stores-main reference-stores">
      <div className="stores-heading">
        <div>
          <h1>ร้านค้าของฉัน</h1>
          <p>
            ร้านทั้งหมดที่คุณเป็นเจ้าของหรือเป็นทีมงาน · เป็นเจ้าของ{" "}
            {active ? "1" : "0"}/10 ร้าน
          </p>
        </div>
        {active ? (
          <Link to="/admin" className="button primary">
            <Plus size={15} />
            จัดการร้าน
          </Link>
        ) : (
          <DemoMerchantButton to="/stores" label="สร้างร้าน" />
        )}
      </div>
      <section className="stores-grid">
        <article className="store-card">
          <div className="store-card-top">
            <span className="store-avatar">AS</span>
            <div>
              {active ? (
                <Link to="/admin" className="store-name">
                  {shop}
                </Link>
              ) : (
                <h2>{shop}</h2>
              )}
              <span className="store-domain">{location.host}</span>
            </div>
            <Link
              to="/"
              className="icon-button"
              aria-label="เปิดหน้าร้าน ASTRA DIGITAL"
            >
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="store-card-meta">
            <span className="store-active">
              <span className="service-dot" />
              ใช้งาน
            </span>
            <span>{active ? "เจ้าของ" : "ร้านค้าทดลอง"}</span>
            <span>สร้างเมื่อ วันนี้</span>
          </div>
          {!active && (
            <div className="reference-store-demo">
              <DemoMerchantButton
                label="เริ่มทดลองเป็นเจ้าของร้าน"
                to="/stores"
              />
            </div>
          )}
        </article>
      </section>
      {!active && (
        <p className="reference-store-note">
          เริ่มทดลองจัดการร้านได้ทันที ใช้เครดิตและโค้ดตัวอย่างเท่านั้น
        </p>
      )}
    </main>
  );
}
