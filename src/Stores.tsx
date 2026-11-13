import { useEffect, useState } from "react";
import {
  BarChart3,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { useDialog } from "./dialog";
import { api } from "./api";
import { NotificationBell } from "./Ops";
import { useLiveStatus } from "./live";

function LiveDot() {
  const on = useLiveStatus();
  return (
    <span className={"live-dot" + (on ? " on" : "")} title={on ? "ข้อมูลอัปเดตทันที" : "อัปเดตทุก 3 วินาที"}>
      {on ? "สด" : "ซิงก์"}
    </span>
  );
}
const nav = [
  ["", "ภาพรวม", LayoutDashboard],
  ["reports", "รายงาน", BarChart3],
  ["products", "สินค้า", Package],
  ["orders", "ออเดอร์", Receipt],
  ["chat", "แชท", MessageCircle],
  ["payments", "การเงิน", Wallet],
  ["customers", "ลูกค้า", Users],
  ["team", "ทีมงาน", ShieldCheck],
  ["settings", "ตั้งค่า", Settings],
] as const;
// Team members reply to reviews (สินค้า › รีวิว for the admin); they have no products menu.
const staffReviews = ["reviews", "รีวิว", Star] as const;
export function MerchantHeader() {
  const { user, path, go, refresh, overview } = useStore();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [term, setTerm] = useState("");
  const tab = path.split("/")[2] ?? "";
  const staff = path.startsWith("/admin") && user?.role === "STAFF";
  const admin = (path.startsWith("/admin") && user?.role === "ADMIN") || staff;
  // Team members only see the operations menus.
  const navItems = staff
    ? [...nav.filter(([key]) => ["orders", "chat", "customers"].includes(key)), staffReviews]
    : nav;
  useDialog(search, ".merchant-command-dialog", () => setSearch(false));
  const shop = overview?.shop?.shopName || "ร้านค้า";
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
    go("/login?next=%2Fadmin");
  }
  return (
    <>
      <header className="reference-merchant-header">
        <div className="reference-merchant-identity">
          <Link to="/admin" className="platform-mark" aria-label="ASIA EXTRA หลังบ้าน">
            AX
          </Link>
          <span className="header-slash">/</span>
          {admin ? (
            <>
              <Link to="/admin">{shop}</Link>
              <span className="owner-badge">หลังบ้าน</span>
            </>
          ) : (
            <span>หลังบ้าน</span>
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
                <BookOpen size={18} />
                คู่มือ
              </Link>
              <Link to="/" className="button secondary merchant-front-link">
                หน้าร้าน
                <ArrowUpRight size={17} />
              </Link>
            </>
          )}
          {admin && <LiveDot />}
          {admin && <NotificationBell admin />}
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
                <Link to="/admin/settings/account">บัญชีแอดมิน</Link>
                <Link to="/">หน้าร้าน</Link>
                {user ? (
                  <button onClick={logout}>
                    <LogOut size={15} />
                    ออกจากระบบ
                  </button>
                ) : (
                  <Link to="/login?next=%2Fadmin">เข้าสู่ระบบ</Link>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      {admin && (
        <nav className="reference-primary-nav" aria-label="จัดการร้านค้า">
          {navItems.map(([key, label, Icon]) => {
            const active =
              key === ""
                ? tab === "" || tab === "rankings"
                : key === "products"
                  ? [
                      "products",
                      "inventory",
                      "categories",
                      "coupons",
                      ...(staff ? [] : ["reviews"]),
                    ].includes(tab)
                  : key === "orders"
                    ? ["orders", "preorders"].includes(tab)
                    : key === "payments"
                      ? ["payments", "ledger", "top-ups", "daily-close", "reconcile", "withdrawals"].includes(tab)
                      : key === "customers"
                        ? ["customers", "broadcasts"].includes(tab)
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
/** Single-shop install: the old multi-store picker just forwards to the back office. */
export default function Stores() {
  const { go } = useStore();
  useEffect(() => {
    go("/admin");
  }, [go]);
  return null;
}
