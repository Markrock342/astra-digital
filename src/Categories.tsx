// Storefront category pieces: chips on /products and the home page category row.
// Chips follow the shadcn/ui Toggle Group / Badge pattern (MIT) on the storefront theme
// tokens (--surface, --border, --accent…), so all 4 accents × light/dark work unchanged.
import { useEffect, useState, type MouseEvent } from "react";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { Link, useStore } from "./App";
import { getLang, t } from "./i18n";
import { NAVIGATE_EVENT } from "./navigation";
import type { PublicCategory } from "./types";
import "./categories.css";

/** EN storefront uses name_en when the shop filled it in. */
export const categoryName = (c: Pick<PublicCategory, "name" | "name_en">) =>
  getLang() === "en" && c.name_en ? c.name_en : c.name;

export const categoryUrl = (id: string) => "/products?category=" + encodeURIComponent(id);

/** ?category=<id> from the address bar (follows in-app navigation and back/forward). */
export function useCategoryParam() {
  const read = () => new URLSearchParams(location.search).get("category") ?? "";
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = () => setValue(read());
    addEventListener(NAVIGATE_EVENT, sync);
    addEventListener("popstate", sync);
    return () => {
      removeEventListener(NAVIGATE_EVENT, sync);
      removeEventListener("popstate", sync);
    };
  }, []);
  return value;
}

/** Image URL of a category icon: an admin upload ("upload-<file key>") or a library logo. */
export const categoryIconSrc = (icon: string) =>
  icon.startsWith("upload-") ? "/api/files/" + icon.slice("upload-".length) : "/library/" + icon + ".webp";

/** The category's picture (uploaded or from the library), otherwise a neutral grid icon. */
export function CategoryIcon({ icon, size = 20 }: { icon: string | null; size?: number }) {
  return (
    <span
      className={"category-icon" + (icon?.startsWith("upload-") ? " category-icon-upload" : "")}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {icon ? (
        <img src={categoryIconSrc(icon)} alt="" width={size} height={size} loading="lazy" decoding="async" />
      ) : (
        <LayoutGrid size={Math.round(size * 0.62)} />
      )}
    </span>
  );
}

/** "ทั้งหมด" + one chip per visible category; real links, so the URL is shareable. */
export function CategoryChips({
  categories,
  selected,
  total,
}: {
  categories: PublicCategory[];
  selected: string;
  total: number;
}) {
  const { go } = useStore();
  if (!categories.length) return null;
  const open = (to: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(to, { keepScroll: true });
  };
  return (
    <nav className="storefront-category-chips" aria-label={t("หมวดหมู่สินค้า")}>
      <a
        href="/products"
        className={"storefront-category-chip" + (selected ? "" : " selected")}
        aria-current={selected ? undefined : "page"}
        onClick={open("/products")}
      >
        <span className="category-icon category-icon-all" aria-hidden="true">
          <LayoutGrid size={13} />
        </span>
        {t("ทั้งหมด")}
        <span className="chip-count">{total}</span>
      </a>
      {categories.map((c) => (
        <a
          key={c.id}
          href={categoryUrl(c.id)}
          className={"storefront-category-chip" + (selected === c.id ? " selected" : "")}
          aria-current={selected === c.id ? "page" : undefined}
          data-category={c.id}
          onClick={open(categoryUrl(c.id))}
        >
          <CategoryIcon icon={c.icon} />
          {categoryName(c)}
          <span className="chip-count">{c.count}</span>
        </a>
      ))}
    </nav>
  );
}

/** Home page: category cards linking to the filtered product list. */
export function HomeCategoryRow() {
  const { overview } = useStore();
  const categories = overview?.categories ?? [];
  if (!categories.length) return null;
  return (
    <section className="home-categories" aria-labelledby="home-categories-title">
      <div className="home-categories-head">
        <h2 id="home-categories-title">{t("เลือกตามหมวดหมู่")}</h2>
        <Link to="/products" className="home-categories-all">
          {t("ดูสินค้าทั้งหมด")}
          <ArrowRight size={15} />
        </Link>
      </div>
      <ul className="home-category-grid">
        {categories.map((c) => (
          <li key={c.id}>
            <Link to={categoryUrl(c.id)} className="home-category-card" data-category={c.id}>
              <CategoryIcon icon={c.icon} size={44} />
              <span className="home-category-text">
                <strong>{categoryName(c)}</strong>
                <small>
                  {c.count} {t("รายการ")}
                </small>
              </span>
              <ArrowRight className="home-category-arrow" size={16} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
