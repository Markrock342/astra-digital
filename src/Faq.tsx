// FAQ on the storefront: the product page section and the /faq page with search.
// Layout follows the shadcn/ui Accordion + Input pattern (MIT, github.com/shadcn-ui/ui),
// styled with the storefront theme tokens. Answers come from server/faq.mjs as plain-text
// blocks and are rendered as React text nodes only, so nothing an admin types becomes HTML.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleHelp, MessageCircle, Search, X } from "lucide-react";
import { api } from "./api";
import { Empty, Link } from "./App";
import { getLang, t } from "./i18n";
import { useLive } from "./live";
import {
  faqForPage,
  faqForProduct,
  faqJsonLd,
  jsonLdText,
  localizeFaqItem,
  parseBlocks,
  searchFaq,
  type FaqSettings,
} from "../server/faq.mjs";
import "./faq.css";

type FaqState = { faq: FaqSettings | null } | null;
let cached: Promise<FaqSettings | null> | null = null;

/** Drop the cached FAQ (after the admin saved it). */
export function invalidateFaq() {
  cached = null;
}

/** The saved FAQ (null → built-in defaults); refetched when the shop settings change. */
export function useFaq() {
  const [state, setState] = useState<FaqState>(null);
  const load = (fresh = false) => {
    if (fresh || !cached)
      cached = api<{ faq: FaqSettings | null }>("/faq").then(
        (r) => r.faq,
        (e) => {
          cached = null;
          throw e;
        },
      );
    cached.then(
      (faq) => setState({ faq }),
      // Offline or API error: show the built-in answers rather than nothing.
      () => setState((s) => s ?? { faq: null }),
    );
  };
  useEffect(() => load(), []);
  useLive(["catalog"], () => load(true));
  return state;
}

/** Plain text → paragraphs and bullet lists (text nodes only). */
export function FaqAnswer({ text }: { text: string }) {
  return (
    <div className="faq-answer">
      {parseBlocks(text).map((block, i) =>
        block.type === "ul" ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{block.text}</p>
        ),
      )}
    </div>
  );
}

type QA = { id: string; question: string; answer: string };

export function FaqAccordion({ items, open = false }: { items: QA[]; open?: boolean }) {
  return (
    <>
      {items.map((item) => (
        <details key={item.id + (open ? ":open" : "")} open={open || undefined} data-faq-id={item.id}>
          <summary>
            <span>{item.question}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <FaqAnswer text={item.answer} />
        </details>
      ))}
    </>
  );
}

/** Product page section: that product's (and preorder) items, then the general ones. */
export function ProductFaq({ product }: { product: { id: string; preorder?: number | boolean } }) {
  const state = useFaq();
  const lang = getLang();
  const items = useMemo(
    () => (state ? faqForProduct(state.faq, product).map((i) => localizeFaqItem(i, lang)) : []),
    [state, product.id, product.preorder, lang],
  );
  if (!items.length) return null;
  return (
    <section className="reference-faq product-faq" aria-labelledby="product-faq-title">
      <h2 id="product-faq-title">{t("คำถามที่พบบ่อย")}</h2>
      <FaqAccordion items={items} />
      <Link to="/faq" className="faq-more">
        {t("ดูคำถามทั้งหมด")}
      </Link>
    </section>
  );
}

const queryFromUrl = () => {
  try {
    return new URLSearchParams(location.search).get("q") ?? "";
  } catch {
    return "";
  }
};

/** Storefront /faq: search over every general question, preorder questions in their own group. */
export function FaqPage() {
  const state = useFaq();
  const lang = getLang();
  const [query, setQuery] = useState(queryFromUrl);
  // Keep ?q= in the address so a search can be shared; replaceState keeps history clean.
  useEffect(() => {
    const url = new URL(location.href);
    if (query.trim()) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    if (url.href !== location.href) history.replaceState(history.state, "", url);
  }, [query]);
  const groups = useMemo(() => {
    if (!state) return null;
    const page = faqForPage(state.faq);
    const localize = (list: QA[]) => list.map((i) => localizeFaqItem(i, lang));
    return { general: localize(page.general), preorder: localize(page.preorder) };
  }, [state, lang]);
  const general = groups ? searchFaq(groups.general, query) : [];
  const preorder = groups ? searchFaq(groups.preorder, query) : [];
  const searching = !!query.trim();
  const total = general.length + preorder.length;
  const jsonLd = useMemo(
    () => (groups ? jsonLdText(faqJsonLd([...groups.general, ...groups.preorder])) : ""),
    [groups],
  );
  return (
    <main className="container page-main narrow-main reference-info-page faq-page">
      <div className="page-heading">
        <span className="eyebrow">{t("ช่วยเหลือ")}</span>
        <h1>{t("คำถามที่พบบ่อย")}</h1>
        <p>{t("คำตอบเรื่องการรับสินค้า การรับประกัน และการติดต่อร้าน")}</p>
      </div>
      {/* FAQPage structured data: a JSON data block, never executed (allowed by script-src 'self'). */}
      {jsonLd && <script type="application/ld+json">{jsonLd}</script>}
      <div className="faq-search">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label={t("ค้นหาคำถาม")}
            placeholder={t("ค้นหาคำถาม เช่น รับประกัน")}
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="icon-button" aria-label={t("ล้างการค้นหา")} onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </label>
        {groups && searching && (
          <p className="faq-count" role="status">
            {t("พบ {n} คำถาม", { n: total })}
          </p>
        )}
      </div>
      {!groups ? (
        <div className="faq-skeleton" aria-busy="true" aria-label={t("กำลังโหลด")}>
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton-block skeleton-line" key={i} />
          ))}
        </div>
      ) : total ? (
        <>
          {general.length > 0 && (
            <section className="reference-faq faq-group" aria-label={t("คำถามทั่วไป")}>
              <FaqAccordion items={general} open={searching} />
            </section>
          )}
          {preorder.length > 0 && (
            <section className="reference-faq faq-group" aria-labelledby="faq-preorder">
              <h2 id="faq-preorder">{t("สินค้าพรีออเดอร์")}</h2>
              <FaqAccordion items={preorder} open={searching} />
            </section>
          )}
        </>
      ) : (
        <Empty
          icon={<CircleHelp />}
          heading={searching ? t("ไม่พบคำถามที่ตรงกับคำค้น") : t("ยังไม่มีคำถามที่พบบ่อย")}
          description={t("ลองใช้คำอื่น หรือสอบถามร้านผ่านแชทได้เลย")}
          action={
            searching ? (
              <button className="button secondary" onClick={() => setQuery("")}>
                {t("ล้างการค้นหา")}
              </button>
            ) : undefined
          }
        />
      )}
      <aside className="faq-contact">
        <MessageCircle size={20} aria-hidden="true" />
        <div>
          <strong>{t("ไม่พบคำตอบที่ต้องการ?")}</strong>
          <p>{t("กดปุ่มแชทมุมขวาล่างเพื่อสอบถามร้าน หรืออ่านเงื่อนไขทั้งหมดในข้อกำหนดการใช้บริการ")}</p>
          <div className="faq-contact-links">
            <Link to="/support">{t("ติดต่อเรา")}</Link>
            <Link to="/terms">{t("ข้อกำหนดการใช้บริการ")}</Link>
          </div>
        </div>
      </aside>
    </main>
  );
}
