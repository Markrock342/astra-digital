/**
 * Shared rules for ข่าวสารและกิจกรรม (news.mjs) and เกี่ยวกับเรา (about.mjs): limits, the safe
 * text format, link checks, event dates and the About defaults. Pure functions, imported by
 * the server and by the React app (types in content-rules.d.mts).
 *
 * Text format (never HTML — the app renders text nodes and <a> elements it builds itself):
 *   - blank line → new paragraph, single line break → <br>
 *   - lines starting with "- " / "• " → bullet list, "1. " → numbered list
 *   - [label](/path) or [label](https://…) → link; a bare https://… URL → link
 *   Anything else that looks like a link (javascript:, http:, //host, data:) stays plain text.
 */
import { TRUST_ICONS } from "./appearance-rules.mjs";

export const NEWS_LIMITS = {
  title: 120,
  summary: 300,
  body: 8000,
  linkLabel: 40,
  link: 500,
  maxPosts: 300,
  publicList: 100,
};
export const ABOUT_LIMITS = {
  heading: 80,
  body: 6000,
  highlightTitle: 60,
  highlightText: 200,
  highlights: 6,
};
/** Fixed lucide icon set for About highlights (same set as the trust cards). */
export const ABOUT_ICONS = TRUST_ICONS;

const BKK_MS = 7 * 3600000;
/** Bangkok calendar date "YYYY-MM-DD" of an instant. */
export const bangkokDate = (ms) => new Date(ms + BKK_MS).toISOString().slice(0, 10);

/** In-shop path ("/products", never "//host" or "/api/…") or an https URL with a host. */
export function isSafeHref(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > NEWS_LIMITS.link) return false;
  if (/[\s\u0000-\u001f\u007f\\]/.test(text)) return false;
  if (text.startsWith("/")) {
    if (text.startsWith("//")) return false;
    try {
      const url = new URL(text, "https://shop.invalid");
      return url.origin === "https://shop.invalid" && !/^\/api(?:\/|$)/i.test(url.pathname);
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** One line → text / link pieces. */
export function parseInline(line) {
  const out = [];
  const pattern = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|(https:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(line))) {
    const href = match[2] ?? match[3];
    if (!isSafeHref(href)) continue;
    if (match.index > last) out.push({ type: "text", text: line.slice(last, match.index) });
    out.push({ type: "link", text: match[1] ?? match[3], href: href.trim() });
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push({ type: "text", text: line.slice(last) });
  return out;
}

/** Plain text → paragraphs (lines) and lists (items), each line split into inline pieces. */
export function parseRichText(text) {
  const blocks = [];
  for (const chunk of String(text ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let current = null;
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^[-•*·]\s+(.+)$/.exec(line);
      const numbered = /^\d{1,2}[.)]\s+(.+)$/.exec(line);
      const kind = bullet ? "ul" : numbered ? "ol" : "p";
      const content = parseInline(bullet?.[1] ?? numbered?.[1] ?? line);
      if (!current || current.kind !== kind) {
        current = { kind, lines: [] };
        blocks.push(current);
      }
      current.lines.push(content);
    }
  }
  return blocks;
}

/** Text without the link syntax, whitespace collapsed (meta descriptions, card summaries). */
export function richTextPlain(text) {
  return String(text ?? "")
    .replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, "$1")
    .replace(/^\s*(?:[-•*·]|\d{1,2}[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** upcoming · ongoing · ended (Bangkok dates), or null when the post has no event dates. */
export function eventState(starts, ends, today) {
  if (!starts && !ends) return null;
  const from = starts || ends;
  const to = ends || starts;
  if (today < from) return "upcoming";
  if (today > to) return "ended";
  return "ongoing";
}

/** Text in the visitor's language: English when picked and filled in, else Thai. */
export const pickText = (th, en, lang) => (lang === "en" && en ? en : (th ?? ""));

/** About page defaults (shown until the admin saves their own text). */
export function defaultAbout(shopName) {
  const name = String(shopName || "").trim() || "ASIA EXTRA";
  return {
    heading: { th: "เกี่ยวกับเรา", en: "About us" },
    body: {
      th:
        name +
        " เป็นร้านสินค้าดิจิทัลออนไลน์ เราคัดสินค้าที่ใช้งานได้จริง ส่งให้รวดเร็วผ่านหน้าคำสั่งซื้อ และดูแลหลังการขายผ่านแชทของร้าน\n\nมีคำถามเรื่องสินค้าหรือคำสั่งซื้อ ติดต่อเราได้ตามช่องทางด้านล่าง",
      en:
        name +
        " is an online shop for digital products. We pick products that work, deliver them quickly on your order page and help after the sale through the shop chat.\n\nQuestions about a product or an order? Reach us through the channels below.",
    },
    highlights: [
      { icon: "Zap", title: { th: "ส่งไว", en: "Fast delivery" }, text: { th: "รับสินค้าในหน้าคำสั่งซื้อทันทีที่ชำระเงิน", en: "Get your item on the order page right after payment" } },
      { icon: "ShieldCheck", title: { th: "ปลอดภัย", en: "Safe" }, text: { th: "ข้อมูลบัญชีเข้ารหัสและเห็นได้เฉพาะเจ้าของคำสั่งซื้อ", en: "Account details are encrypted and only shown to the buyer" } },
      { icon: "Headphones", title: { th: "ดูแลหลังการขาย", en: "After-sale care" }, text: { th: "แจ้งปัญหาผ่านแชทของร้านได้ทุกวัน", en: "Report a problem through the shop chat any day" } },
    ],
    showContact: true,
  };
}
