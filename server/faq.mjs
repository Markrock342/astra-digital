// Editable FAQ (ตั้งค่า › คำถามที่พบบ่อย): pure helpers shared by the server (validation on
// save) and the React storefront/admin (defaults, scope filtering, search, JSON-LD).
// Stored as shop settings `faq: { items: [...] }` (runtime_flags 'shop-settings'), the same
// way as the legal pages. Answers are plain text: parseBlocks() turns them into paragraph
// and bullet blocks that the UI renders as text nodes, so nothing typed can become HTML.
import { blocksToText, normalizeText, parseBlocks } from "./text-blocks.mjs";

export { parseBlocks };

/** all = every product page + /faq; preorder = every preorder product page (+ /faq); products = chosen products only. */
export const FAQ_SCOPES = ["all", "preorder", "products"];
export const FAQ_SCOPE_LABELS = {
  all: "ทุกสินค้า",
  preorder: "สินค้าพรีออเดอร์ทุกชิ้น",
  products: "เฉพาะสินค้าที่เลือก",
};
export const MAX_FAQ_ITEMS = 60;
export const MAX_FAQ_QUESTION = 200;
export const MAX_FAQ_ANSWER = 5000;
export const MAX_FAQ_PRODUCTS = 100;
export const MAX_FAQ_CHARS = 80000;
const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const lines = (...rows) => rows.join("\n");

/** Formal Thai defaults that describe how the shop actually works. */
export const DEFAULT_FAQ = [
  {
    id: "delivery-time",
    scope: "all",
    question: "ได้รับสินค้าเมื่อไหร่",
    answer: lines(
      "สินค้าพร้อมส่งจะได้รับทันทีหลังชำระเงินสำเร็จ ระบบจะแสดง ID และรหัสผ่านในหน้าคำสั่งซื้อ และท่านสามารถเปิดดูซ้ำได้ตลอดเวลาที่เมนูประวัติการซื้อ",
      "",
      "สินค้าที่ระบุว่าเป็นพรีออเดอร์จะได้รับตามลำดับคิว โปรดดูรายละเอียดในหัวข้อสินค้าพรีออเดอร์",
    ),
  },
  {
    id: "preorder-queue",
    scope: "preorder",
    question: "สินค้าพรีออเดอร์ได้รับเมื่อไหร่",
    answer: lines(
      "เมื่อชำระเงินแล้ว ท่านจะได้รับเลขคิวทันที ร้านจะจัดส่งสินค้าตามลำดับคิว และแจ้งเตือนผ่านกระดิ่งแจ้งเตือนบนเว็บไซต์เมื่อจัดส่งแล้ว",
      "",
      "- ดูเลขคิวได้ที่หน้ารายละเอียดคำสั่งซื้อในประวัติการซื้อ",
      "- เมื่อจัดส่งแล้ว ID และรหัสผ่านจะแสดงในหน้าคำสั่งซื้อเดียวกัน",
    ),
  },
  {
    id: "warranty",
    scope: "all",
    question: "สินค้ามีการรับประกันอย่างไร",
    answer: lines(
      "ระยะเวลารับประกันขึ้นอยู่กับตัวเลือกสินค้าที่ท่านซื้อ โดยแสดงไว้ที่ตัวเลือกในหน้าสินค้า และวันสิ้นสุดการรับประกันจะแสดงในหน้าคำสั่งซื้อหลังได้รับสินค้า",
      "",
      "หากบัญชีใช้งานไม่ได้ภายในระยะเวลารับประกันโดยมิใช่ความผิดของผู้ซื้อ:",
      "- เปิดคำสั่งซื้อนั้นจากเมนูประวัติการซื้อ",
      "- กดปุ่ม \"แจ้งปัญหาบัญชีนี้\" แล้วเลือกอาการที่พบ",
      "- ร้านจะตรวจสอบและเปลี่ยนบัญชีใหม่ให้ บัญชีใหม่จะแสดงในหน้าคำสั่งซื้อเดิม",
    ),
  },
  {
    id: "account-problem",
    scope: "all",
    question: "มีปัญหากับบัญชีที่ได้รับ ทำอย่างไร",
    answer:
      "กดปุ่ม \"แจ้งปัญหาบัญชีนี้\" ในหน้าคำสั่งซื้อ ระบบจะเปิดแชทกับร้านพร้อมแนบเลขคำสั่งซื้อให้โดยอัตโนมัติ หรือกดปุ่มแชทมุมขวาล่างแล้วแจ้งเลขคำสั่งซื้อและรายละเอียดปัญหา กรุณาอย่าส่งรหัสผ่านของบัญชีอื่นที่ไม่เกี่ยวข้อง",
  },
  {
    id: "no-password-change",
    scope: "all",
    question: "เปลี่ยนรหัสผ่านหรือข้อมูลของบัญชีที่ได้รับได้หรือไม่",
    answer: lines(
      "กรุณาอย่าเปลี่ยนรหัสผ่าน อีเมล แพ็กเกจ หรือข้อมูลใด ๆ ของบัญชีที่ได้รับ เว้นแต่หน้าสินค้าระบุว่าทำได้",
      "",
      "- การเปลี่ยนแปลงข้อมูลบัญชีอาจทำให้บัญชีใช้งานไม่ได้ และทำให้สิ้นสุดสิทธิ์การรับประกัน",
      "- กรุณาใช้งานไม่เกินจำนวนอุปกรณ์หรือผู้ใช้ที่ระบุไว้ในตัวเลือกสินค้า",
    ),
  },
  {
    id: "refund",
    scope: "all",
    question: "ขอคืนเงินได้หรือไม่",
    answer:
      "การคืนเงินเป็นไปตามเงื่อนไขในหัวข้อการคืนเงินของหน้าข้อกำหนดการใช้บริการ หากสินค้าใช้งานไม่ได้และร้านไม่สามารถส่งสินค้าทดแทนให้ได้ กรุณาติดต่อร้านผ่านแชทพร้อมเลขคำสั่งซื้อ",
  },
  {
    id: "unpaid-order",
    scope: "all",
    question: "สั่งซื้อแล้วแต่ยังไม่ได้ชำระเงิน ต้องทำอย่างไร",
    answer:
      "คำสั่งซื้อที่ยังไม่ชำระเงินจะถูกยกเลิกอัตโนมัติเมื่อเกินเวลาที่กำหนดในหน้าชำระเงิน โดยไม่มีการตัดเงิน หากคำสั่งซื้อถูกยกเลิกแล้ว ท่านสามารถสั่งซื้อใหม่ได้ตามปกติ",
  },
  {
    id: "buy-again",
    scope: "all",
    question: "ต้องการต่ออายุหรือซื้อสินค้าเดิมอีกครั้ง ทำอย่างไร",
    answer:
      "เปิดเมนูประวัติการซื้อ แล้วกดปุ่ม \"ซื้อซ้ำ\" ที่คำสั่งซื้อเดิม ระบบจะเลือกสินค้า ตัวเลือก และจำนวนเดิมให้ แล้วพาไปยังหน้าตรวจสอบคำสั่งซื้อ หากสินค้าหมด ระบบจะพาไปยังหน้าสินค้าแทน",
  },
  {
    id: "contact",
    scope: "all",
    question: "ติดต่อร้านได้ทางไหน",
    answer:
      "กดปุ่มแชทมุมขวาล่างของหน้าเว็บไซต์ (ต้องเข้าสู่ระบบ) ร้านจะตอบกลับโดยเร็วที่สุด หรือดูช่องทางติดต่ออื่นได้ที่หน้าติดต่อร้าน",
  },
];

/** English for the built-in items, used only while an item still has the default Thai text. */
export const DEFAULT_FAQ_EN = {
  "delivery-time": {
    question: "When do I receive my item?",
    answer: lines(
      "Ready-stock items arrive right after payment. The ID and password show on the order page, and you can open them again anytime from your purchase history.",
      "",
      "Items marked as pre-order are delivered in queue order. See the pre-order question for details.",
    ),
  },
  "preorder-queue": {
    question: "When do I get a pre-order item?",
    answer: lines(
      "You get a queue number as soon as you pay. The shop delivers in queue order and notifies you through the bell on the website once it's sent.",
      "",
      "- Your queue number is on the order details page in your purchase history",
      "- Once delivered, the ID and password appear on the same order page",
    ),
  },
  warranty: {
    question: "How does the warranty work?",
    answer: lines(
      "The warranty period depends on the option you bought. It is shown on the option on the product page, and the end date is shown on your order page after delivery.",
      "",
      "If the account stops working within the warranty period through no fault of yours:",
      "- Open the order from your purchase history",
      "- Tap \"Report a problem with this account\" and choose what happened",
      "- The shop checks it and replaces the account; the new one appears on the same order page",
    ),
  },
  "account-problem": {
    question: "What if the account I received doesn't work?",
    answer:
      "Tap \"Report a problem with this account\" on the order page. A chat with the shop opens with your order number attached. You can also use the chat button at the bottom right and include your order number. Please don't send passwords for unrelated accounts.",
  },
  "no-password-change": {
    question: "Can I change the password or details of the account I received?",
    answer: lines(
      "Please don't change the password, email, plan or any details of the account you received unless the product page says you may.",
      "",
      "- Changing account details can stop the account from working and ends the warranty",
      "- Please stay within the number of devices or users stated for the option",
    ),
  },
  refund: {
    question: "Can I get a refund?",
    answer:
      "Refunds follow the refund section of the Terms of Service. If an item doesn't work and the shop cannot replace it, contact the shop by chat with your order number.",
  },
  "unpaid-order": {
    question: "I placed an order but haven't paid yet. What now?",
    answer:
      "Unpaid orders are cancelled automatically once the time shown on the payment page runs out, and nothing is charged. After that you can simply order again.",
  },
  "buy-again": {
    question: "How do I renew or buy the same item again?",
    answer:
      "Open your purchase history and tap \"Buy again\" on the earlier order. The same product, option and quantity are picked for you and you go straight to checkout. If it's out of stock, you're taken to the product page instead.",
  },
  contact: {
    question: "How can I contact the shop?",
    answer:
      "Use the chat button at the bottom right of the website (sign-in required) and the shop will reply as soon as possible, or see other channels on the Contact store page.",
  },
};

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const defaultsById = new Map(DEFAULT_FAQ.map((d) => [d.id, d]));

/**
 * Validate the `faq` settings object sent by the admin form: `{ items: [...] }`.
 * `fail(status, message)` must throw. `productExists(id)` (optional) rejects unknown products.
 * Returns a clean object (unknown keys dropped).
 */
export function normalizeFaq(input, fail, { productExists } = {}) {
  if (!isObject(input) || !Array.isArray(input.items)) fail(400, "ข้อมูลคำถามที่พบบ่อยไม่ถูกต้อง");
  if (input.items.length > MAX_FAQ_ITEMS) fail(400, `คำถามได้สูงสุด ${MAX_FAQ_ITEMS} ข้อ`);
  const seen = new Set();
  const items = input.items.map((raw, index) => {
    const n = index + 1;
    if (!isObject(raw) || typeof raw.id !== "string" || !ITEM_ID.test(raw.id))
      fail(400, `รหัสคำถามข้อ ${n} ไม่ถูกต้อง`);
    if (seen.has(raw.id)) fail(400, "คำถามซ้ำกัน");
    seen.add(raw.id);
    if (typeof raw.question !== "string" || typeof raw.answer !== "string")
      fail(400, `คำถามข้อ ${n} ต้องมีทั้งคำถามและคำตอบ`);
    const question = normalizeText(raw.question).replace(/\s+/g, " ").trim();
    const answer = normalizeText(raw.answer).replace(/\s+$/, "").replace(/^\n+/, "");
    if (!question || !answer.trim()) fail(400, `คำถามข้อ ${n} ต้องมีทั้งคำถามและคำตอบ`);
    if (question.length > MAX_FAQ_QUESTION) fail(400, `คำถามข้อ ${n} ยาวเกินไป`);
    if (answer.length > MAX_FAQ_ANSWER) fail(400, `คำตอบข้อ ${n} ยาวเกินไป`);
    const scope = raw.scope ?? "all";
    if (!FAQ_SCOPES.includes(scope)) fail(400, `ขอบเขตของคำถามข้อ ${n} ไม่ถูกต้อง`);
    const item = { id: raw.id, question, answer, scope };
    if (scope === "products") {
      if (!Array.isArray(raw.productIds) || !raw.productIds.length)
        fail(400, `คำถามข้อ ${n}: กรุณาเลือกสินค้าอย่างน้อย 1 รายการ`);
      if (raw.productIds.length > MAX_FAQ_PRODUCTS) fail(400, `คำถามข้อ ${n}: เลือกสินค้ามากเกินไป`);
      const ids = [];
      for (const id of raw.productIds) {
        if (typeof id !== "string" || !id || id.length > 80 || /[\u0000-\u001f]/.test(id))
          fail(400, `คำถามข้อ ${n}: สินค้าไม่ถูกต้อง`);
        if (productExists && !productExists(id)) fail(400, `คำถามข้อ ${n}: ไม่พบสินค้าที่เลือก`);
        if (!ids.includes(id)) ids.push(id);
      }
      item.productIds = ids;
    }
    if (raw.hidden !== undefined && typeof raw.hidden !== "boolean")
      fail(400, `สถานะซ่อนของคำถามข้อ ${n} ไม่ถูกต้อง`);
    if (raw.hidden) item.hidden = true;
    return item;
  });
  const out = { items };
  if (JSON.stringify(out).length > MAX_FAQ_CHARS) fail(400, "คำถามที่พบบ่อยยาวเกินไป");
  return out;
}

/** Items as configured (built-in defaults until the owner saves the form). */
export function faqItems(faq) {
  const stored = Array.isArray(faq?.items) ? faq.items : DEFAULT_FAQ;
  return stored.map((i) => ({
    id: i.id,
    question: i.question,
    answer: i.answer,
    scope: FAQ_SCOPES.includes(i.scope) ? i.scope : "all",
    productIds: i.scope === "products" && Array.isArray(i.productIds) ? [...i.productIds] : [],
    hidden: !!i.hidden,
  }));
}

/** True while an item still has the built-in text. */
export function isDefaultText(item) {
  const d = defaultsById.get(item.id);
  return !!d && d.question === item.question && d.answer === item.answer;
}

/** English text for untouched built-in items; anything the owner wrote stays as written. */
export function localizeFaqItem(item, lang = "th") {
  if (lang !== "en") return item;
  const d = defaultsById.get(item.id);
  const en = DEFAULT_FAQ_EN[item.id];
  if (!d || !en) return item;
  return {
    ...item,
    question: item.question === d.question ? en.question : item.question,
    answer: item.answer === d.answer ? en.answer : item.answer,
  };
}

/** Visible items for one product page: that product's (and preorder) items first, then the general ones. */
export function faqForProduct(faq, product) {
  const visible = faqItems(faq).filter((i) => !i.hidden);
  const preorder = !!product?.preorder;
  const specific = visible.filter(
    (i) =>
      (i.scope === "products" && i.productIds.includes(product?.id)) ||
      (i.scope === "preorder" && preorder),
  );
  return [...specific, ...visible.filter((i) => i.scope === "all")];
}

/** Visible items for the /faq page: general items, then the preorder ones (no product-only items). */
export function faqForPage(faq) {
  const visible = faqItems(faq).filter((i) => !i.hidden);
  return {
    general: visible.filter((i) => i.scope === "all"),
    preorder: visible.filter((i) => i.scope === "preorder"),
  };
}

const fold = (value) =>
  normalizeText(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Every word of the query must appear in the question or the answer (case-insensitive). */
export function searchFaq(items, query) {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return items;
  return items.filter((i) => {
    const hay = fold(i.question + " " + i.answer);
    return words.every((w) => hay.includes(w));
  });
}

/** schema.org FAQPage data for <script type="application/ld+json"> (data, never executed). */
export function faqJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: blocksToText(parseBlocks(i.answer)) },
    })),
  };
}

/** JSON for an inline data block: "<" escaped so the text can never close the element. */
export const jsonLdText = (data) =>
  JSON.stringify(data).replace(/</g, "\\u003c");
