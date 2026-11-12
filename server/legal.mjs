// Legal pages (terms + privacy): pure helpers shared by the server (validation on save)
// and the React storefront/admin (defaults, templating, rendering to plain-text blocks).
// No HTML is ever produced here: bodies become { type: "p" | "ul" } blocks of text and the
// UI renders them as text nodes, so anything an admin types is shown literally.
import {
  DEFAULT_FIELD_VALUES,
  DEFAULT_PRIVACY,
  DEFAULT_TERMS,
} from "./legal-text.mjs";

export { DEFAULT_FIELD_VALUES, DEFAULT_PRIVACY, DEFAULT_TERMS };

export const LEGAL_DOCS = {
  terms: { title: "ข้อกำหนดการใช้บริการ", path: "/terms", defaults: DEFAULT_TERMS },
  privacy: { title: "นโยบายความเป็นส่วนตัว", path: "/privacy", defaults: DEFAULT_PRIVACY },
};
export const LEGAL_KINDS = ["terms", "privacy"];

/** Structured fields. `fallback` = shop setting used while the field is empty. */
export const LEGAL_FIELDS = [
  { key: "entityName", label: "ชื่อผู้ประกอบการหรือนิติบุคคล", max: 200, fallback: "shopName" },
  { key: "address", label: "ที่อยู่ที่จดทะเบียน", max: 500, multiline: true },
  { key: "taxId", label: "เลขประจำตัวผู้เสียภาษี", max: 20, optional: true },
  { key: "email", label: "อีเมลติดต่อ", max: 200, fallback: "email" },
  { key: "phone", label: "โทรศัพท์", max: 50, fallback: "phone" },
  { key: "line", label: "LINE", max: 100, fallback: "line" },
  { key: "dpo", label: "ผู้ประสานงานด้านข้อมูลส่วนบุคคล", max: 300 },
  { key: "refundPolicy", label: "ระยะเวลาและเงื่อนไขการคืนเงิน", max: 3000, multiline: true },
  { key: "warrantyPolicy", label: "สรุปนโยบายการรับประกัน", max: 3000, multiline: true },
  { key: "governingLaw", label: "กฎหมายที่ใช้บังคับ", max: 200 },
  { key: "effectiveDate", label: "วันที่มีผลบังคับใช้", max: 10 },
];
/** Extra placeholders that are not editable fields. */
export const EXTRA_PLACEHOLDERS = [
  { key: "shopName", label: "ชื่อร้าน" },
  { key: "website", label: "ที่อยู่เว็บไซต์" },
];

export const MAX_SECTIONS = 40;
export const MAX_SECTION_TITLE = 200;
export const MAX_SECTION_BODY = 10000;
export const MAX_LEGAL_CHARS = 150000;
/** The old single "policy" text becomes this extra terms section until the owner saves the new form. */
export const POLICY_SECTION_ID = "shop-policy";
const POLICY_SECTION_TITLE = "ข้อกำหนดเพิ่มเติมของร้าน";
const SECTION_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;
const BULLET = /^\s*[-•*]\s+/;

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const defaultsById = (kind) =>
  new Map(LEGAL_DOCS[kind].defaults.map((s) => [s.id, s]));

function validDate(value) {
  const m = DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
}
const normalizeText = (value) =>
  String(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

/**
 * Validate the `legal` settings object sent by the admin form.
 * `fail(status, message)` must throw. Returns a clean object (unknown keys dropped).
 */
export function normalizeLegal(input, fail) {
  if (!isObject(input)) fail(400, "ข้อมูลข้อกำหนดและนโยบายไม่ถูกต้อง");
  const out = {};
  for (const field of LEGAL_FIELDS) {
    const raw = input[field.key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") fail(400, field.label + "ไม่ถูกต้อง");
    const value = normalizeText(raw).trim();
    if (value.length > field.max) fail(400, field.label + "ยาวเกินไป");
    if (field.key === "effectiveDate" && value && !validDate(value))
      fail(400, "วันที่มีผลบังคับใช้ไม่ถูกต้อง");
    if (field.key === "taxId" && value && !/^[0-9][0-9 -]*$/.test(value))
      fail(400, "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง");
    if (field.key === "email" && value && !/^[^\s@]+@[^\s@]+$/.test(value))
      fail(400, "อีเมลติดต่อไม่ถูกต้อง");
    out[field.key] = value;
  }
  for (const kind of LEGAL_KINDS) {
    const raw = input[kind];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) fail(400, "รายการหัวข้อไม่ถูกต้อง");
    if (raw.length > MAX_SECTIONS) fail(400, "หัวข้อมากเกินไป");
    const defaults = defaultsById(kind);
    const seen = new Set();
    out[kind] = raw.map((section) => {
      if (!isObject(section) || typeof section.id !== "string" || !SECTION_ID.test(section.id))
        fail(400, "รหัสหัวข้อไม่ถูกต้อง");
      if (seen.has(section.id)) fail(400, "หัวข้อซ้ำกัน");
      seen.add(section.id);
      const clean = { id: section.id };
      for (const [key, max, label] of [
        ["title", MAX_SECTION_TITLE, "ชื่อหัวข้อ"],
        ["body", MAX_SECTION_BODY, "เนื้อหาหัวข้อ"],
      ]) {
        if (section[key] === undefined || section[key] === null) continue;
        if (typeof section[key] !== "string") fail(400, label + "ไม่ถูกต้อง");
        let value = normalizeText(section[key]);
        value = key === "title" ? value.replace(/\s+/g, " ").trim() : value.replace(/\s+$/, "").replace(/^\n+/, "");
        if (!value) fail(400, label + "ต้องไม่ว่าง");
        if (value.length > max) fail(400, label + "ยาวเกินไป");
        clean[key] = value;
      }
      if (!defaults.has(section.id) && (!clean.title || !clean.body))
        fail(400, "หัวข้อที่เพิ่มเองต้องมีทั้งชื่อหัวข้อและเนื้อหา");
      return clean;
    });
  }
  if (JSON.stringify(out).length > MAX_LEGAL_CHARS)
    fail(400, "ข้อกำหนดและนโยบายยาวเกินไป");
  return out;
}

/** Field value as the owner set it, or the built-in default when never set. */
export function fieldValue(legal, key) {
  const value = legal?.[key];
  if (typeof value === "string") return value;
  return DEFAULT_FIELD_VALUES[key] ?? "";
}

/** Every placeholder value (fields → shop fallbacks) and the required fields still empty. */
export function legalValues(legal, shop = {}, { website = "" } = {}) {
  const values = {
    shopName: String(shop?.shopName && shop.shopName !== "ร้านค้า" ? shop.shopName : "ASIA EXTRA"),
    website: String(website ?? ""),
  };
  const missing = [];
  for (const field of LEGAL_FIELDS) {
    let value = fieldValue(legal, field.key).trim();
    if (!value && field.fallback)
      value =
        field.fallback === "shopName"
          ? values.shopName
          : String(shop?.[field.fallback] ?? "").trim();
    values[field.key] = field.key === "effectiveDate" ? formatThaiDate(value) : value;
    if (!value && !field.optional) missing.push(field);
  }
  return { values, missing };
}

/** The sections of one document as currently configured (defaults when never saved). */
export function legalSections(kind, legal, policy = "") {
  const defaults = LEGAL_DOCS[kind].defaults;
  const byId = defaultsById(kind);
  const stored = legal?.[kind];
  if (Array.isArray(stored)) {
    return stored
      .map((s) => {
        const d = byId.get(s.id);
        if (d)
          return {
            id: s.id,
            title: s.title ?? d.title,
            body: s.body ?? d.body,
            custom: false,
          };
        if (s.title && s.body) return { id: s.id, title: s.title, body: s.body, custom: true };
        return null;
      })
      .filter(Boolean);
  }
  const sections = defaults.map((d) => ({ ...d, custom: false }));
  const text = typeof policy === "string" ? policy.trim() : "";
  if (kind === "terms" && text) {
    const at = sections.findIndex((s) => s.id === "changes");
    sections.splice(at < 0 ? sections.length : at, 0, {
      id: POLICY_SECTION_ID,
      title: POLICY_SECTION_TITLE,
      body: text.slice(0, MAX_SECTION_BODY),
      custom: true,
    });
  }
  return sections;
}

/** Sections → what gets saved: default sections keep only the parts that differ. */
export function storedSections(kind, sections) {
  const byId = defaultsById(kind);
  return sections.map((s) => {
    const d = byId.get(s.id);
    if (!d) return { id: s.id, title: s.title, body: s.body };
    const out = { id: s.id };
    if (s.title !== d.title) out.title = s.title;
    if (s.body !== d.body) out.body = s.body;
    return out;
  });
}

/**
 * Fill {{placeholders}}. A line that uses a placeholder whose value is empty is left out,
 * so "- เลขประจำตัวผู้เสียภาษี: {{taxId}}" disappears when there is no tax ID.
 * Unknown placeholders stay as typed.
 */
export function fillTemplate(text, values) {
  const out = [];
  for (const line of normalizeText(text ?? "").split("\n")) {
    const whole = /^\s*\{\{\s*[A-Za-z]+\s*\}\}\s*$/.test(line);
    let drop = false;
    const filled = line.replace(PLACEHOLDER, (match, key) => {
      if (!Object.hasOwn(values, key)) return match;
      const value = String(values[key] ?? "").trim();
      if (!value) drop = true;
      // A value used inside a sentence stays on that line; on its own line it may be a block.
      return whole ? value : value.replace(/\s*\n\s*/g, " ");
    });
    if (!drop) out.push(filled);
  }
  return out.join("\n");
}

/** Plain text → blocks: blank line = new paragraph, "- " / "• " / "* " = bullet. */
export function parseBlocks(text) {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of normalizeText(text ?? "").split("\n")) {
    if (!line.trim()) {
      flush();
      list = null;
      continue;
    }
    if (BULLET.test(line)) {
      flush();
      const item = line.replace(BULLET, "").trim();
      if (!item) continue;
      if (!list) {
        list = { type: "ul", items: [] };
        blocks.push(list);
      }
      list.items.push(item);
      continue;
    }
    list = null;
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
/** "2026-11-13" → "13 พฤศจิกายน 2569" (Buddhist year). Anything else → "". */
export function formatThaiDate(iso) {
  if (!iso || !validDate(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}

/**
 * Everything a page needs to show one document.
 * shop = public shop settings (shopName/email/phone/line/policy); website = host name.
 */
export function renderLegalDocument(kind, legal, shop = {}, { website = "", sections } = {}) {
  const { values, missing } = legalValues(legal, shop, { website });
  const list = sections ?? legalSections(kind, legal, shop?.policy);
  const rendered = [];
  for (const section of list) {
    const blocks = parseBlocks(fillTemplate(section.body, values));
    if (!blocks.length) continue;
    const title = section.title.replace(PLACEHOLDER, (match, key) =>
      Object.hasOwn(values, key) ? String(values[key] ?? "").trim() : match,
    );
    rendered.push({ id: section.id, number: rendered.length + 1, title, blocks });
  }
  return {
    kind,
    title: LEGAL_DOCS[kind].title,
    effectiveDate: values.effectiveDate,
    sections: rendered,
    missing: missing.map(({ key, label }) => ({ key, label })),
  };
}
