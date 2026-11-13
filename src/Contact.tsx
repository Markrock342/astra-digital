// Storefront "ติดต่อเรา" page (/support). Everything shown comes from the shop settings the
// admin edits in ตั้งค่า › ร้าน › ช่องทางติดต่อ; blank fields are hidden. Layout follows the
// shadcn/ui Card pattern (MIT, https://ui.shadcn.com/docs/components/card): white cards with a
// header row (icon + title) and content, styled with the storefront theme tokens in brand.css
// so light/dark and every accent work. Admin text is rendered as React text nodes only.
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Mail,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "./App";
import { t } from "./i18n";
import type { ShopSettings } from "./types";
import "./contact.css";

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);
/** "https://facebook.com/shop/" → "facebook.com/shop" for display. */
const shortUrl = (value: string) => value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

export function phoneHref(phone: string) {
  const digits = phone.replace(/[\s\-().]/g, "");
  return /^\+?\d{3,}$/.test(digits) ? "tel:" + digits : null;
}
export function lineHref(line: string) {
  if (line.startsWith("@")) return "https://line.me/R/ti/p/" + encodeURIComponent(line);
  return isHttpUrl(line) ? line : null;
}
export function mapsHref(address: string) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address.replace(/\s+/g, " "));
}

type Channel = {
  key: string;
  label: string;
  value: string;
  icon: ReactNode;
  href: string | null;
  external: boolean;
  multiline?: boolean;
};

/** Filled contact channels in display order, each with its link (or null = text only). */
export function contactChannels(shop: Partial<ShopSettings> | undefined): Channel[] {
  const get = (key: keyof ShopSettings) => String(shop?.[key] ?? "").trim();
  const list: Channel[] = [];
  const line = get("line");
  if (line)
    list.push({ key: "line", label: "LINE", value: isHttpUrl(line) ? shortUrl(line) : line, icon: <MessageCircle />, href: lineHref(line), external: true });
  const phone = get("phone");
  if (phone)
    list.push({ key: "phone", label: t("โทรศัพท์"), value: phone, icon: <Phone />, href: phoneHref(phone), external: false });
  const email = get("email");
  if (email)
    list.push({ key: "email", label: t("อีเมล"), value: email, icon: <Mail />, href: email.includes("@") ? "mailto:" + email : null, external: false });
  const facebook = get("facebook");
  if (facebook)
    list.push({ key: "facebook", label: "Facebook", value: isHttpUrl(facebook) ? shortUrl(facebook) : facebook, icon: <Users />, href: isHttpUrl(facebook) ? facebook : null, external: true });
  const discord = get("discord");
  if (discord)
    list.push({ key: "discord", label: "Discord", value: isHttpUrl(discord) ? shortUrl(discord) : discord, icon: <MessagesSquare />, href: isHttpUrl(discord) ? discord : null, external: true });
  const address = get("address");
  if (address)
    list.push({ key: "address", label: t("ที่อยู่"), value: address, icon: <MapPin />, href: mapsHref(address), external: true, multiline: true });
  return list;
}

function ChannelCard({ channel }: { channel: Channel }) {
  const body = (
    <>
      <span className="contact-channel-icon" aria-hidden="true">
        {channel.icon}
      </span>
      <span className="contact-channel-text">
        <span className="contact-channel-label">{channel.label}</span>
        <span className={"contact-channel-value" + (channel.multiline ? " is-multiline" : "")}>
          {channel.value}
        </span>
        {channel.key === "address" && <span className="contact-channel-hint">{t("เปิดในแผนที่")}</span>}
      </span>
      {channel.href && <ArrowUpRight className="contact-channel-go" size={18} aria-hidden="true" />}
    </>
  );
  const className = "contact-channel contact-channel-" + channel.key;
  // id="email": the footer links to /support#email.
  const id = channel.key === "email" ? "email" : undefined;
  if (!channel.href)
    return (
      <div className={className} id={id} data-channel={channel.key}>
        {body}
      </div>
    );
  return (
    <a
      className={className + " is-link"}
      id={id}
      data-channel={channel.key}
      href={channel.href}
      {...(channel.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {body}
    </a>
  );
}

export function ContactPage({ shop, shopName }: { shop: ShopSettings | undefined; shopName: string }) {
  const message = String(shop?.contactMessage ?? "").trim();
  const channels = contactChannels(shop);
  return (
    <main className="container page-main narrow-main reference-info-page contact-page">
      <div className="page-heading">
        <span className="eyebrow">{shopName}</span>
        <h1>{t("ติดต่อเรา")}</h1>
        <p>{t("ข้อมูลสำหรับการใช้งานเว็บไซต์")}</p>
      </div>
      <section className="panel prose contact-intro">
        <h2>{t("เราพร้อมช่วยเหลือคุณ")}</h2>
        <p className="contact-message">
          {message ||
            t("หากมีปัญหาเกี่ยวกับการรับโค้ด ให้ตรวจสอบหน้าคำสั่งซื้อของคุณก่อน โดยโค้ดจะปรากฏเมื่อสถานะเป็น “จัดส่งสำเร็จ”")}
        </p>
        <Link to="/orders" className="button secondary">
          {t("ตรวจสอบคำสั่งซื้อ")}
          <ArrowRight size={16} />
        </Link>
      </section>
      {channels.length > 0 && (
        <section className="contact-channels" aria-labelledby="contact-channels-title">
          <h2 id="contact-channels-title">{t("ช่องทางติดต่อ")}</h2>
          <div className="contact-grid">
            {channels.map((channel) => (
              <ChannelCard key={channel.key} channel={channel} />
            ))}
          </div>
        </section>
      )}
      <section className="panel prose contact-tips">
        <h3>
          <ShieldCheck size={18} aria-hidden="true" />
          {t("ข้อมูลที่ควรเตรียมเมื่อแจ้งปัญหา")}
        </h3>
        <p>
          {t("เลขคำสั่งซื้อ ชื่อสินค้า และรายละเอียดปัญหา กรุณาอย่าส่งรหัสผ่านหรือข้อมูลส่วนตัวที่ไม่เกี่ยวข้อง")}
        </p>
      </section>
    </main>
  );
}
