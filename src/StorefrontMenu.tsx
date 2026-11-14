// Phone menu (bottom nav "เมนู"): a bottom sheet (Sheet.tsx, shadcn/ui Sheet/Drawer, MIT) with
// the customer card (photo, name, credit, top-up only while test payments are on), a grid of
// shortcuts, the shop's contact chips and sign out. Signed out: sign in / sign up instead.
import {
  CircleUserRound,
  History,
  Info,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquareWarning,
  Newspaper,
  Package,
  Plus,
  Star,
  type LucideIcon,
} from "lucide-react";
import { Link, UserAvatar, useStore, useTestPayments } from "./App";
import { api, money } from "./api";
import { lineHref } from "./Contact";
import { EN_STRINGS } from "./i18n-en";
import { t } from "./i18n";
import { BottomSheet } from "./Sheet";
import "./storefront-menu.css";

const EN_MENU: Record<string, string> = {
  "ข่าวสารและกิจกรรม": "News & events",
  "เกี่ยวกับเรา": "About us",
  "แจ้งปัญหา": "Report a problem",
  "เติมเงิน": "Top up",
  "เมนูทั้งหมด": "Menu",
  "เข้าสู่ระบบเพื่อดูยอดเงินและคำสั่งซื้อ": "Sign in to see your balance and orders",
};
for (const [th, en] of Object.entries(EN_MENU)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

type Tile = { label: string; icon: LucideIcon; to?: string; action?: () => void };

export function StorefrontMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, overview, refresh, toast, go } = useStore();
  const testPayments = useTestPayments();
  const line = overview?.shop?.line ?? "";
  const email = overview?.shop?.email ?? "";
  const lineLink = line ? lineHref(line) : null;
  const tiles: Tile[] = [
    { label: t("สินค้าทั้งหมด"), icon: Package, to: "/products" },
    { label: t("เครดิตร้าน"), icon: Star, to: "/credits" },
    { label: t("ประวัติการซื้อ"), icon: History, to: "/orders" },
    {
      label: t("แจ้งปัญหา"),
      icon: MessageSquareWarning,
      action: () => {
        onClose();
        // CustomerChat (Ops.tsx) opens on this event (sign-in prompt when signed out).
        setTimeout(() => dispatchEvent(new Event("open-chat")), 60);
      },
    },
    { label: t("บัญชีของฉัน"), icon: CircleUserRound, to: "/account" },
    { label: t("ข่าวสารและกิจกรรม"), icon: Newspaper, to: "/news" },
    { label: t("เกี่ยวกับเรา"), icon: Info, to: "/about" },
  ];
  return (
    <BottomSheet id="storefront-menu" open={open} onClose={onClose} title={t("เมนูทั้งหมด")} hideTitle className="menu-sheet">
      {user ? (
        <div className="menu-user-card" data-testid="menu-user-card">
          <UserAvatar user={user} />
          <div className="menu-user-text">
            <strong className="menu-user-name">{user.name}</strong>
            <small className="msheet-balance-label">{t("ยอดเงินคงเหลือ")}</small>
            <span className="msheet-balance">{money(user.balance)}</span>
          </div>
          {testPayments && (
            <Link to="/wallet" className="menu-topup">
              <Plus size={16} aria-hidden="true" />
              {t("เติมเงิน")}
            </Link>
          )}
        </div>
      ) : (
        <div className="menu-guest-card">
          <p>{t("เข้าสู่ระบบเพื่อดูยอดเงินและคำสั่งซื้อ")}</p>
          <div className="menu-guest-actions">
            <Link to="/login" className="button primary">
              {t("เข้าสู่ระบบ")}
            </Link>
            <Link to="/register" className="button secondary">
              {t("สมัครสมาชิก")}
            </Link>
          </div>
        </div>
      )}
      <ul className="menu-tiles">
        {tiles.map(({ label, icon: Icon, to, action }) => (
          <li key={label}>
            {to ? (
              <Link to={to} className="menu-tile">
                <span className="menu-tile-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                {label}
              </Link>
            ) : (
              <button type="button" className="menu-tile" onClick={action}>
                <span className="menu-tile-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                {label}
              </button>
            )}
          </li>
        ))}
      </ul>
      {(line || email) && (
        <div className="menu-contact">
          <strong>{t("ติดต่อร้าน")}</strong>
          <div className="menu-contact-chips">
            {line &&
              (lineLink ? (
                <a href={lineLink} target="_blank" rel="noopener noreferrer" className="menu-chip">
                  <MessageCircle size={16} aria-hidden="true" />
                  LINE
                </a>
              ) : (
                <Link to="/support" className="menu-chip">
                  <MessageCircle size={16} aria-hidden="true" />
                  LINE
                </Link>
              ))}
            {email && (
              <a href={"mailto:" + email} className="menu-chip">
                <Mail size={16} aria-hidden="true" />
                {t("อีเมล")}
              </a>
            )}
          </div>
        </div>
      )}
      {user && (
        <button
          type="button"
          className="menu-logout"
          onClick={async () => {
            await api("/logout", {});
            await refresh();
            onClose();
            toast(t("ออกจากระบบแล้ว"));
            go("/");
          }}
        >
          <LogOut size={18} aria-hidden="true" />
          {t("ออกจากระบบ")}
        </button>
      )}
    </BottomSheet>
  );
}
