// Storefront appearance (ตั้งค่า › หน้าตาร้าน): pure rules shared by the server (validation on
// save, defaults, link previews) and the React app (storefront rendering, admin form checks,
// colour derivation). No Node or Workers APIs here.
//
// Stored as JSON in runtime_flags 'storefront-appearance' (server/appearance.mjs). Every part
// falls back to DEFAULT_APPEARANCE, and the defaults are today's exact storefront text, so the
// shop looks the same until the admin edits something. Text the admin types is plain text in
// Thai (th) and optionally English (en); the storefront shows en when the visitor picked
// English and falls back to th. It never goes through the UI translation table.
//
// What is deliberately NOT here: the "Theme By limitcode studio" credit in the footer. It is not
// a setting, there is no field for it, and the colour rules below only touch the accent
// tokens, never the footer text/background tokens the credit uses.
import { normalizeBannerLink } from "./banners.mjs";

export const APPEARANCE_PARTS = ["hero", "marquee", "sections", "colors", "trust", "footer", "seo"];

/** Home page blocks in today's order. `products` (the product list) can move but never hide. */
export const HOME_SECTIONS = [
  "banners",
  "hero",
  "marquee",
  "stats",
  "activity",
  "announcement",
  "categories",
  "products",
];
export const ALWAYS_VISIBLE_SECTIONS = ["products"];
/** Blocks that start hidden (the admin can switch them back on). */
export const DEFAULT_HIDDEN_SECTIONS = ["categories"];
export const SECTION_LABELS = {
  banners: "แบนเนอร์โปรโมชัน",
  hero: "ส่วนหัว (ข้อความและปุ่ม)",
  marquee: "แถบข้อความเลื่อน",
  stats: "สถิติร้าน",
  activity: "กิจกรรมล่าสุด",
  announcement: "ประกาศจากร้าน",
  categories: "หมวดหมู่",
  products: "รายการสินค้า",
};

/** Icons the admin may pick for a trust card (lucide-react names). */
export const TRUST_ICONS = [
  "ShieldCheck",
  "KeyRound",
  "History",
  "Wallet",
  "Zap",
  "Clock",
  "Lock",
  "BadgeCheck",
  "Headphones",
  "MessageCircle",
  "CreditCard",
  "Gift",
  "Star",
  "ThumbsUp",
  "Sparkles",
  "Award",
];
export const ACCENTS = ["blue", "yellow", "duo", "mono"];

export const LIMITS = {
  heroTitle: 60,
  heroHeadline: 120,
  heroSubtext: 200,
  buttonLabel: 40,
  marqueeItem: 80,
  marqueeMax: 10,
  trustHeading: 80,
  trustText: 300,
  cardTitle: 60,
  cardText: 200,
  cardsMax: 6,
  footerDescription: 300,
  linkLabel: 40,
  footerLinksMax: 8,
  seoTitle: 60,
  seoDescription: 200,
  link: 500,
};

const pair = (th, en = "") => ({ th, en });

/** Today's storefront, word for word (English = the current translations in i18n-en.ts). */
export const DEFAULT_APPEARANCE = Object.freeze({
  hero: {
    // Big display line at the top of the home page. Empty = automatic:
    // "WELCOME TO " + the shop name from ตั้งค่า › ร้าน (heroTitleFallback below).
    title: pair(""),
    // Empty = automatic: the shop description (ตั้งค่า › ร้าน), else the standard tagline.
    headline: pair(""),
    // Empty = no second line.
    subtext: pair(""),
    primary: { label: pair("สินค้าทั้งหมด", "All products"), link: "/products" },
    // Second button for signed-in customers. Empty label = no second button.
    secondary: { label: pair("รีวิวจากลูกค้า", "Customer reviews"), link: "/reviews" },
    // Second button for visitors who are not signed in. Empty label = no second button.
    guest: { label: pair("เข้าสู่ระบบ", "Sign in"), link: "/login" },
  },
  marquee: [
    pair("สินค้าพร้อมส่ง ได้รับทันทีหลังชำระเงิน", "Ready-stock items arrive right after payment"),
    pair("เก็บ ID และรหัสผ่านแบบเข้ารหัส", "IDs and passwords stored encrypted"),
    pair("แชทกับร้านได้ในเว็บ", "Chat with the shop on the website"),
    pair("รีวิวจากผู้ซื้อจริง", "Reviews from verified buyers"),
    pair("สั่งจองล่วงหน้าได้", "Preorders available"),
  ],
  // The category block moved to /products only (client round, Nov 2026): hidden by default.
  sections: HOME_SECTIONS.map((id) => ({ id, visible: !DEFAULT_HIDDEN_SECTIONS.includes(id) })),
  // null = the built-in ASIA EXTRA blue / yellow.
  colors: { primary: null, secondary: null, defaultAccent: "blue" },
  trust: {
    // The block on the เครดิตร้าน page is new, so it starts switched off (page unchanged).
    show: false,
    heading: pair("ซื้อสินค้าอย่างมั่นใจ", "Shop with confidence"),
    text: pair(
      "บันทึกคำสั่งซื้อทุกครั้ง โค้ดจะถูกส่งหลังยืนยันการชำระเงินเท่านั้น",
      "Orders are always saved first. Codes are sent only after payment is confirmed.",
    ),
    cards: [
      {
        icon: "KeyRound",
        title: pair("โค้ดแยกเฉพาะคำสั่งซื้อ", "Order-specific codes"),
        text: pair(
          "หนึ่งโค้ดสำหรับหนึ่งหน่วยสินค้า ระบบจัดสรรจากคลังหลังยืนยันการชำระเท่านั้น",
          "One code per unit of product. Codes are allocated from inventory only after payment is confirmed.",
        ),
      },
      {
        icon: "History",
        title: pair("ดูย้อนหลังได้", "View anytime"),
        text: pair(
          "เปิดดูโค้ดและคำสั่งซื้อผ่านบัญชีของคุณได้ตลอดเวลา",
          "View your codes and orders anytime through your account",
        ),
      },
      {
        icon: "Wallet",
        title: pair("เครดิตตรวจสอบได้", "Auditable credit"),
        text: pair(
          "ทุกรายการเติมและใช้เครดิตมีประวัติที่ตรวจสอบได้",
          "Every credit top-up and spend has an auditable history",
        ),
      },
    ],
  },
  footer: {
    // Empty = automatic: the shop description, else "ร้านสินค้าดิจิทัล".
    description: pair(""),
    links: [
      { label: pair("สินค้าทั้งหมด", "All products"), link: "/products" },
      { label: pair("เครดิตร้าน", "Store credit"), link: "/reviews" },
      { label: pair("ประวัติการซื้อ", "Purchase history"), link: "/orders" },
      { label: pair("คำถามที่พบบ่อย", "FAQ"), link: "/faq" },
      { label: pair("ติดต่อเรา", "Contact us"), link: "/support" },
    ],
  },
  // Empty = automatic (shop name / page descriptions); images null = /brand/og.png, favicon-64.png.
  seo: { title: pair(""), description: pair("") },
});

/** Deep copy of the defaults (callers may mutate it). */
export const defaultAppearance = () => JSON.parse(JSON.stringify(DEFAULT_APPEARANCE));

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** One line of plain text: trimmed, inner whitespace collapsed, no control characters. */
function line(value, max, label, fail, { required = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") fail(400, label + "ไม่ถูกต้อง");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(400, label + "มีอักขระที่ใช้ไม่ได้");
  const text = value.replace(/\s+/g, " ").trim();
  if (required && !text) fail(400, "กรุณาใส่" + label);
  if ([...text].length > max) fail(400, label + "ยาวเกิน " + max + " ตัวอักษร");
  return text;
}

/** { th, en } text pair. A required pair needs Thai; English is always optional. */
function textPair(value, max, label, fail, { required = false } = {}) {
  if (value === undefined || value === null) value = {};
  if (typeof value === "string") value = { th: value };
  if (!isObject(value)) fail(400, label + "ไม่ถูกต้อง");
  return {
    th: line(value.th, max, label + " (ไทย)", fail, { required }),
    en: line(value.en, max, label + " (อังกฤษ)", fail),
  };
}

/** In-shop path ("/products") or https URL, same rule as banner links. Required. */
function link(value, label, fail) {
  const normalized = normalizeBannerLink(value, (status, message) => fail(status, label + ": " + message));
  if (!normalized) fail(400, "กรุณาใส่ลิงก์ของ" + label);
  return normalized;
}

function list(value, label, max, fail, { min = 0 } = {}) {
  if (!Array.isArray(value)) fail(400, label + "ไม่ถูกต้อง");
  if (value.length > max) fail(400, label + "ได้สูงสุด " + max + " รายการ");
  if (value.length < min) fail(400, label + "ต้องมีอย่างน้อย " + min + " รายการ");
  return value;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/* ---------- Colours (WCAG 2.x relative luminance / contrast) ---------- */
/** Page backgrounds the colours must work on (brand.css --bg light / dark). */
export const LIGHT_BG = "#ffffff";
export const DARK_BG = "#0a0a0a";
const INK_LIGHT = "#ffffff";
const INK_DARK = "#0b0b0c";

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");
export function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** a mixed toward b by amount (0..1). */
export function mix(a, b, amount) {
  const [x, y] = [channels(a), channels(b)];
  return toHex(x.map((c, i) => c + (y[i] - c) * amount));
}
/** Nudge `hex` toward `toward` in small steps until it reaches `ratio` against `bg`. */
function reach(hex, bg, ratio, toward) {
  let out = hex;
  for (let step = 0; step <= 20 && contrast(out, bg) < ratio; step++) out = mix(hex, toward, step / 20);
  return out;
}
/** Readable text colour on top of a fill: white or near-black, whichever contrasts more. */
export const inkOn = (fill) => (contrast(fill, INK_LIGHT) >= contrast(fill, INK_DARK) ? INK_LIGHT : INK_DARK);

/** Below this the fill is all but invisible on the page (refused). */
export const MIN_FILL_CONTRAST = 1.3;
/** Below this a button shape looks faint on the page (warning only). */
export const SOFT_FILL_CONTRAST = 3;
/** Normal text (WCAG AA). */
export const TEXT_CONTRAST = 4.5;

/**
 * Tokens for one brand colour in light and dark mode. Text-coloured uses (links, prices) get a
 * shade that reaches 4.5:1 on the page; fills get white or dark ink, whichever reads better.
 */
export function colorTokens(hex) {
  const color = hex.toLowerCase();
  const darkFill = reach(color, DARK_BG, 3, "#ffffff");
  return {
    light: {
      fill: color,
      fill2: mix(color, "#ffffff", 0.3),
      ink: inkOn(color),
      text: reach(color, LIGHT_BG, TEXT_CONTRAST, "#000000"),
    },
    dark: {
      fill: darkFill,
      ink: inkOn(darkFill),
      text: reach(color, DARK_BG, TEXT_CONTRAST, "#ffffff"),
    },
  };
}

/**
 * Readability check for a chosen colour. `problem` = refuse (the colour disappears into the
 * light or dark page); `warnings` = allowed but the admin should know.
 */
export function checkColor(hex, label = "สี") {
  const warnings = [];
  if (!HEX_COLOR.test(hex ?? "")) return { problem: label + "ต้องเป็นรหัสสีแบบ #RRGGBB", warnings };
  const onLight = contrast(hex, LIGHT_BG);
  const onDark = contrast(hex, DARK_BG);
  if (onLight < MIN_FILL_CONTRAST)
    return { problem: label + "อ่อนจนกลืนกับพื้นขาวของหน้าร้าน (โหมดสว่าง) เลือกสีที่เข้มขึ้น", warnings };
  if (onDark < MIN_FILL_CONTRAST)
    return { problem: label + "เข้มจนกลืนกับพื้นดำของหน้าร้าน (โหมดมืด) เลือกสีที่สว่างขึ้น", warnings };
  const tokens = colorTokens(hex);
  for (const [mode, t] of [["สว่าง", tokens.light], ["มืด", tokens.dark]])
    if (contrast(t.fill, t.ink) < TEXT_CONTRAST)
      return { problem: label + "ทำให้ตัวอักษรบนปุ่ม (โหมด" + mode + ") อ่านยาก", warnings };
  if (onLight < SOFT_FILL_CONTRAST)
    warnings.push(label + "ค่อนข้างอ่อนบนพื้นขาว ตัวหนังสือสีนี้จะใช้เฉดที่เข้มขึ้นเพื่อให้อ่านง่าย");
  if (onDark < SOFT_FILL_CONTRAST)
    warnings.push(label + "ค่อนข้างเข้มบนพื้นดำ ในโหมดมืดระบบจะใช้เฉดที่สว่างขึ้น");
  return { problem: "", warnings };
}

function color(value, label, fail) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !HEX_COLOR.test(value.trim()))
    fail(400, label + "ต้องเป็นรหัสสีแบบ #RRGGBB");
  const hex = value.trim().toLowerCase();
  const { problem } = checkColor(hex, label);
  if (problem) fail(400, problem);
  return hex;
}

/* ---------- Validation per part (input → stored value, or fail(400, …)) ---------- */
export const NORMALIZERS = {
  hero(input, fail) {
    if (!isObject(input)) fail(400, "ข้อมูลส่วนหัวไม่ถูกต้อง");
    const button = (value, label, required) => {
      const b = isObject(value) ? value : {};
      const text = textPair(b.label, LIMITS.buttonLabel, "ข้อความ" + label, fail, { required });
      return { label: text, link: text.th ? link(b.link, label, fail) : "" };
    };
    return {
      title: textPair(input.title, LIMITS.heroTitle, "ชื่อร้านตัวใหญ่", fail),
      headline: textPair(input.headline, LIMITS.heroHeadline, "ข้อความหลัก", fail),
      subtext: textPair(input.subtext, LIMITS.heroSubtext, "ข้อความรอง", fail),
      primary: button(input.primary, "ปุ่มหลัก", true),
      secondary: button(input.secondary, "ปุ่มรอง", false),
      // Saved before this button existed: keep the default instead of hiding it.
      guest: has(input, "guest")
        ? button(input.guest, "ปุ่มรองตอนยังไม่เข้าสู่ระบบ", false)
        : JSON.parse(JSON.stringify(DEFAULT_APPEARANCE.hero.guest)),
    };
  },
  marquee(input, fail) {
    return list(input, "ข้อความในแถบเลื่อน", LIMITS.marqueeMax, fail, { min: 1 }).map((item, i) =>
      textPair(item, LIMITS.marqueeItem, "ข้อความแถบเลื่อนที่ " + (i + 1), fail, { required: true }),
    );
  },
  sections(input, fail) {
    list(input, "ลำดับส่วนหน้าแรก", HOME_SECTIONS.length, fail, { min: 1 });
    const seen = new Set();
    const out = input.map((item) => {
      if (!isObject(item) || !HOME_SECTIONS.includes(item.id) || seen.has(item.id))
        fail(400, "ลำดับส่วนหน้าแรกไม่ถูกต้อง");
      seen.add(item.id);
      if (typeof item.visible !== "boolean") fail(400, "สถานะแสดง/ซ่อนไม่ถูกต้อง");
      if (!item.visible && ALWAYS_VISIBLE_SECTIONS.includes(item.id))
        fail(400, SECTION_LABELS[item.id] + "ซ่อนไม่ได้");
      return { id: item.id, visible: item.visible };
    });
    // A section added in a later version (or left out) gets its default, after the ones listed.
    for (const id of HOME_SECTIONS)
      if (!seen.has(id)) out.push({ id, visible: !DEFAULT_HIDDEN_SECTIONS.includes(id) });
    return out;
  },
  colors(input, fail) {
    if (!isObject(input)) fail(400, "ข้อมูลสีไม่ถูกต้อง");
    const accent = input.defaultAccent ?? "blue";
    if (!ACCENTS.includes(accent)) fail(400, "สีธีมเริ่มต้นไม่ถูกต้อง");
    return {
      primary: color(input.primary, "สีหลัก", fail),
      secondary: color(input.secondary, "สีรอง", fail),
      defaultAccent: accent,
    };
  },
  trust(input, fail) {
    if (!isObject(input)) fail(400, "ข้อมูลหน้าเครดิตร้านไม่ถูกต้อง");
    if (input.show !== undefined && typeof input.show !== "boolean") fail(400, "สถานะแสดง/ซ่อนไม่ถูกต้อง");
    return {
      show: input.show === true,
      heading: textPair(input.heading, LIMITS.trustHeading, "หัวข้อ", fail, { required: true }),
      text: textPair(input.text, LIMITS.trustText, "ข้อความ", fail),
      cards: list(input.cards, "การ์ด", LIMITS.cardsMax, fail, { min: 1 }).map((card, i) => {
        if (!isObject(card)) fail(400, "การ์ดที่ " + (i + 1) + " ไม่ถูกต้อง");
        if (!TRUST_ICONS.includes(card.icon)) fail(400, "ไอคอนของการ์ดที่ " + (i + 1) + " ไม่ถูกต้อง");
        return {
          icon: card.icon,
          title: textPair(card.title, LIMITS.cardTitle, "หัวข้อการ์ดที่ " + (i + 1), fail, { required: true }),
          text: textPair(card.text, LIMITS.cardText, "ข้อความการ์ดที่ " + (i + 1), fail),
        };
      }),
    };
  },
  footer(input, fail) {
    if (!isObject(input)) fail(400, "ข้อมูลส่วนท้ายไม่ถูกต้อง");
    return {
      description: textPair(input.description, LIMITS.footerDescription, "คำอธิบายร้าน", fail),
      links: list(input.links ?? [], "เมนูส่วนท้าย", LIMITS.footerLinksMax, fail).map((item, i) => {
        if (!isObject(item)) fail(400, "เมนูที่ " + (i + 1) + " ไม่ถูกต้อง");
        return {
          label: textPair(item.label, LIMITS.linkLabel, "ชื่อเมนูที่ " + (i + 1), fail, { required: true }),
          link: link(item.link, "เมนูที่ " + (i + 1), fail),
        };
      }),
    };
  },
  seo(input, fail) {
    if (!isObject(input)) fail(400, "ข้อมูล SEO ไม่ถูกต้อง");
    return {
      title: textPair(input.title, LIMITS.seoTitle, "ชื่อเว็บ", fail),
      description: textPair(input.description, LIMITS.seoDescription, "คำอธิบายเว็บ", fail),
    };
  },
};

/** Validate the parts present in `input` (unknown keys are ignored, never stored). */
export function normalizeAppearanceParts(input, fail) {
  if (!isObject(input)) fail(400, "ข้อมูลหน้าตาร้านไม่ถูกต้อง");
  const out = {};
  for (const part of APPEARANCE_PARTS) if (has(input, part)) out[part] = NORMALIZERS[part](input[part], fail);
  if (!Object.keys(out).length) fail(400, "ไม่มีข้อมูลที่จะบันทึก");
  return out;
}

/** Version of the stored JSON. Bumped when defaults change in a way saved rows must follow. */
export const APPEARANCE_REV = 2;
/** Hero button labels that were the defaults before rev 2 (replaced by the new defaults). */
const LEGACY_HERO_LABELS = {
  primary: ["เลือกซื้อสินค้า", ["", "Shop now"]],
  secondary: ["ดูรีวิวจากลูกค้า", ["", "See customer reviews"]],
};

/**
 * Bring a row saved by an older version up to APPEARANCE_REV (pure; returns a copy):
 * rev 2 (client storefront round) — the home category block is hidden, and hero buttons that
 * still carried the old default labels get the new ones. Anything the admin typed stays.
 */
export function migrateStoredAppearance(stored) {
  if (!isObject(stored)) return {};
  const out = JSON.parse(JSON.stringify(stored));
  if (Number(out.rev) >= APPEARANCE_REV) return out;
  if (Array.isArray(out.sections))
    out.sections = out.sections.map((item) =>
      isObject(item) && DEFAULT_HIDDEN_SECTIONS.includes(item.id) ? { ...item, visible: false } : item,
    );
  if (isObject(out.hero))
    for (const [key, [th, ens]] of Object.entries(LEGACY_HERO_LABELS)) {
      const button = out.hero[key];
      const label = typeof button?.label === "string" ? { th: button.label, en: "" } : button?.label;
      if (isObject(label) && label.th === th && ens.includes(label.en ?? ""))
        out.hero[key] = { ...button, label: { ...DEFAULT_APPEARANCE.hero[key].label } };
    }
  out.rev = APPEARANCE_REV;
  return out;
}

/**
 * Stored JSON → complete appearance. A missing or damaged part falls back to its default, so a
 * bad row can never blank the storefront.
 */
export function resolveAppearance(stored) {
  const base = defaultAppearance();
  if (!isObject(stored)) return base;
  stored = migrateStoredAppearance(stored);
  const quiet = () => {
    throw new Error("invalid");
  };
  for (const part of APPEARANCE_PARTS) {
    if (!has(stored, part)) continue;
    try {
      base[part] = NORMALIZERS[part](stored[part], quiet);
    } catch {
      /* keep the default for this part */
    }
  }
  return base;
}

/** Automatic hero title: "WELCOME TO " + the shop name (same in Thai and English). */
export const heroTitleFallback = (shopName) => "WELCOME TO " + shopName;

/** Text for the visitor's language: English when chosen and filled in, else Thai. */
export const pick = (value, lang) => (lang === "en" && value?.en ? value.en : (value?.th ?? ""));
