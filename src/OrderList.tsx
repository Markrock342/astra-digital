// Customer purchase history (/orders): search box, status filter sheet, compact rows,
// pages of 20 and a bulk copy mode for delivered ID / password / code / link.
// Layout follows shadcn/ui Input + Sheet + Pagination + Checkbox (MIT, https://ui.shadcn.com);
// the order list API already returns delivered items to their owner, so search and copy
// run in the browser.
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  History,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Art, Empty, ErrorMessage, Link, RequireLogin, Status, shownStatus, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { useLive } from "./live";
import { hasReceipt, ReceiptLink } from "./OrderExtras";
import { RebuyActions } from "./Rebuy";
import { BottomSheet } from "./Sheet";
import { ManualOrderNote } from "./ManualOrderNote";
import type { Order, Product } from "./types";
import "./order-list.css";

const EN: Record<string, string> = {
  "ค้นหาคำสั่งซื้อ": "Search orders",
  "เลขคำสั่งซื้อ ชื่อสินค้า อีเมล รหัสผ่าน หรือโค้ด": "Order no., product, email, password or code",
  "ล้างคำค้น": "Clear search",
  "สถานะ": "Status",
  "ทุกสถานะ": "All statuses",
  "กำลังดำเนินการ": "In progress",
  "จัดส่งไม่สำเร็จ": "Delivery failed",
  "ยกเลิก/คืนเงิน": "Cancelled / refunded",
  "คัดลอกข้อมูล": "Copy details",
  "หน้า {page} จาก {pages} · ทั้งหมด {count} รายการ": "Page {page} of {pages} · {count} orders",
  "หน้าก่อน": "Previous page",
  "หน้าถัดไป": "Next page",
  "เลือก {n} รายการ": "{n} selected",
  "เลือกทั้งหน้า": "Select this page",
  "ยกเลิกทั้งหน้า": "Clear this page",
  "คัดลอก": "Copy",
  "ปิดโหมดคัดลอก": "Exit copy mode",
  "คัดลอก {n} บรรทัดแล้ว": "Copied {n} lines",
  "คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง": "Couldn't copy automatically. Please select and copy the text.",
  "เลือกคำสั่งซื้อที่ส่งสำเร็จเพื่อคัดลอก": "Pick delivered orders to copy",
  "ไม่พบคำสั่งซื้อที่ตรงกับการค้นหา": "No orders match your search",
  "ลองค้นด้วยคำอื่น หรือเปลี่ยนสถานะ": "Try another word or status",
  "เลือก": "Select",
  "+ อีก {n} รายการ": "+ {n} more",
};
for (const [th, en] of Object.entries(EN)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

const PAGE_SIZE = 20;
type Group = "all" | "processing" | "delivered" | "failed" | "cancelled";
const GROUPS: [Group, string][] = [
  ["all", "ทุกสถานะ"],
  ["processing", "กำลังดำเนินการ"],
  ["delivered", "จัดส่งสำเร็จ"],
  ["failed", "จัดส่งไม่สำเร็จ"],
  ["cancelled", "ยกเลิก/คืนเงิน"],
];
/** Customer-facing status group of an order (anything unpaid / queued / waiting = in progress). */
export function statusGroup(o: Order): Exclude<Group, "all"> {
  const s = shownStatus(o);
  if (s === "DELIVERED") return "delivered";
  if (s === "FAILED") return "failed";
  if (["CANCELLED", "EXPIRED", "LAPSED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(s)) return "cancelled";
  return "processing";
}
/** Delivered items as copy lines: "ID | password" (+ profile / PIN), codes and links one per line. */
export function copyLines(o: Order): string[] {
  const lines: string[] = [];
  for (const c of o.credentials ?? []) {
    const parts = [c.loginId, c.password];
    if (c.profile) parts.push(t("โปรไฟล์") + " " + c.profile);
    if (c.pin) parts.push("PIN " + c.pin);
    lines.push(parts.join(" | "));
  }
  for (const code of o.codes ?? []) lines.push(code);
  for (const link of o.links ?? []) lines.push(link);
  return lines;
}
type Entry = Order & { href?: string; lines?: Order[] };
type PageData = { orders: Entry[]; total: number; page: number; pages: number };
/** Row name in the visitor's language ("+ อีก n รายการ" for several lines bought together). */
const entryName = (o: Entry) =>
  o.lines && o.lines.length > 1 ? o.lines[0].name + " " + t("+ อีก {n} รายการ", { n: o.lines.length - 1 }) : o.name;
function coverFor(products: Product[], variantId?: string) {
  if (!variantId) return null;
  const p = products.find((x) => x.variants?.some((v) => v.id === variantId));
  return p?.images?.[0]?.url ?? p?.imageUrl ?? null;
}

export function HistoryPage() {
  const { user, products, toast } = useStore();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [sheet, setSheet] = useState(false);
  const [page, setPage] = useState(0);
  const [copyMode, setCopyMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [data, setData] = useState<PageData | null>(null);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);
  useEffect(() => setPage(0), [debounced, group]);
  // Server pages, search and status (server/orders-list.mjs); a stale answer is dropped.
  const want = `/orders?page=${page + 1}&limit=${PAGE_SIZE}&status=${group}` + (debounced ? "&q=" + encodeURIComponent(debounced) : "");
  const wantRef = useRef(want);
  wantRef.current = want;
  const loadOrders = () => {
    if (!user) return;
    const path = want;
    api<PageData>(path)
      .then((r) => {
        if (wantRef.current !== path) return;
        setData(r);
        setError("");
      })
      .catch((e) => setError(e.message));
  };
  useEffect(loadOrders, [user?.id, want]);
  useLive(["orders"], loadOrders);
  const orders = data?.orders ?? null;
  const filtering = !!debounced || group !== "all";
  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;
  const shown = orders ?? [];
  const copyable = shown.filter((o) => copyLines(o).length);
  const allPicked = copyable.length > 0 && copyable.every((o) => picked.has(o.id));
  const groupLabel = t(GROUPS.find(([g]) => g === group)![1]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function exitCopy() {
    setCopyMode(false);
    setPicked(new Set());
  }
  async function copyPicked() {
    const ids = [...picked];
    if (!ids.length) return;
    // The server sends the lines (picks may span pages). Safari only lets a page write the
    // clipboard inside the tap, so hand it a promise via ClipboardItem when it exists.
    const fetchText = api<{ lines: string[] }>("/orders/copy", { ids }).then((r) => r.lines);
    try {
      let count = 0;
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const text = fetchText.then((lines) => {
          count = lines.length;
          return new Blob([lines.join("\n")], { type: "text/plain" });
        });
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
      } else {
        const lines = await fetchText;
        count = lines.length;
        await navigator.clipboard.writeText(lines.join("\n"));
      }
      toast(t("คัดลอก {n} บรรทัดแล้ว", { n: count }));
    } catch (e) {
      const message = (e as Error).message;
      toast(message && !/clipboard|document|permission|NotAllowed/i.test(message) ? message : t("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง"));
    }
  }

  return (
    <main className={"container page-main reference-history-page" + (copyMode ? " is-copying" : "")}>
      <div className="page-heading">
        <span className="eyebrow">{t("คำสั่งซื้อของฉัน")}</span>
        <h1>{t("ประวัติการซื้อ")}</h1>
        <p>{t("ติดตามคำสั่งซื้อและเปิดดูโค้ดสินค้าของคุณ")}</p>
      </div>
      {!user ? (
        <RequireLogin />
      ) : (
        <>
          <div className="order-tools">
            <label className="search-field order-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">{t("ค้นหาคำสั่งซื้อ")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("เลขคำสั่งซื้อ ชื่อสินค้า อีเมล รหัสผ่าน หรือโค้ด")}
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button type="button" className="icon-button order-search-clear" aria-label={t("ล้างคำค้น")} onClick={() => setQuery("")}>
                  <X size={16} />
                </button>
              )}
            </label>
            <div className="order-tool-row">
              <button
                type="button"
                className={"filter-button" + (group !== "all" ? " is-active" : "")}
                aria-haspopup="dialog"
                aria-expanded={sheet}
                aria-label={t("สถานะ") + ": " + groupLabel}
                onClick={() => setSheet(true)}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                <span>{groupLabel}</span>
              </button>
              <button
                type="button"
                className={"filter-button order-copy-toggle" + (copyMode ? " is-active" : "")}
                aria-pressed={copyMode}
                onClick={() => (copyMode ? exitCopy() : setCopyMode(true))}
              >
                <ClipboardCopy size={16} aria-hidden="true" />
                <span>{t("คัดลอกข้อมูล")}</span>
              </button>
            </div>
          </div>
          <BottomSheet id="order-status-sheet" open={sheet} onClose={() => setSheet(false)} title={t("สถานะ")}>
            <div role="radiogroup" aria-label={t("สถานะ")} className="sort-options">
              {GROUPS.map(([g, label]) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={group === g}
                  className="sort-option"
                  onClick={() => {
                    setGroup(g);
                    setSheet(false);
                  }}
                >
                  <span>{t(label)}</span>
                  <span className="sort-check" aria-hidden="true">
                    {group === g && <Check size={16} strokeWidth={3} />}
                  </span>
                </button>
              ))}
            </div>
          </BottomSheet>
          <ErrorMessage message={error} />
          {!orders && !error ? (
            <div className="loading-row">
              <LoaderCircle className="spin" />
              {t("กำลังโหลดคำสั่งซื้อ")}
            </div>
          ) : shown.length ? (
            <section className="order-list-panel" aria-label={t("ประวัติการซื้อ")}>
              <nav className="order-pager" aria-label={t("ประวัติการซื้อ")}>
                <button type="button" className="order-pager-step" aria-label={t("หน้าก่อน")} disabled={page === 0} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={18} />
                </button>
                <span aria-live="polite">
                  {t("หน้า {page} จาก {pages} · ทั้งหมด {count} รายการ", {
                    page: page + 1,
                    pages,
                    count: total.toLocaleString(),
                  })}
                </span>
                <button type="button" className="order-pager-step" aria-label={t("หน้าถัดไป")} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  <ChevronRight size={18} />
                </button>
              </nav>
              <div className="orders-list">
                {shown.map((o) => {
                  const can = copyLines(o).length > 0;
                  const on = picked.has(o.id);
                  const actions = !copyMode && !o.lines && (hasReceipt(o) || o.status === "DELIVERED");
                  const row = (
                    <>
                          <span className="history-art">
                            <Art type={o.art} name={o.name} image={coverFor(products, o.variant_id)} small />
                          </span>
                          <span className="history-main">
                            <strong className="history-name">{entryName(o)}</strong>
                            <span className="history-option">
                              {o.label} · × {o.quantity}
                            </span>
                            <span className="history-meta">
                              #{o.id.slice(0, 8).toUpperCase()} · {dateTime(o.created_at)}
                            </span>
                            {o.createdByAdmin && <ManualOrderNote method={o.paymentMethodLabel} />}
                          </span>
                          <span className="history-side">
                            <strong>{money(o.total)}</strong>
                            <Status status={shownStatus(o)} />
                          </span>
                    </>
                  );
                  return (
                    <div className={"history-item" + (copyMode && !can ? " is-muted" : "")} key={o.id}>
                      <div className="history-row">
                        {copyMode ? (
                          <button
                            type="button"
                            className="history-card"
                            aria-pressed={on}
                            disabled={!can}
                            onClick={() => toggle(o.id)}
                          >
                            <span className="order-pick" aria-hidden="true">
                              {on && <Check size={14} strokeWidth={3} />}
                            </span>
                            {row}
                          </button>
                        ) : (
                          <Link to={o.href ?? "/orders/" + o.id} className="history-card">
                            {row}
                          </Link>
                        )}
                      </div>
                      {actions && (
                        <div className="history-item-actions">
                          <RebuyActions order={o} />
                          {hasReceipt(o) && (
                            <ReceiptLink id={o.id}>
                              {t("ใบเสร็จ")} #{o.id.slice(0, 8).toUpperCase()}
                            </ReceiptLink>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            !error && (
              <Empty
                icon={<History />}
                heading={filtering ? t("ไม่พบคำสั่งซื้อที่ตรงกับการค้นหา") : t("ยังไม่มีคำสั่งซื้อในรายการนี้")}
                description={
                  filtering ? t("ลองค้นด้วยคำอื่น หรือเปลี่ยนสถานะ") : t("เมื่อคุณเลือกซื้อสินค้า คำสั่งซื้อจะปรากฏที่นี่")
                }
                action={
                  filtering ? undefined : (
                    <Link to="/products" className="button primary">
                      {t("เลือกดูสินค้า")}
                      <ArrowRight size={16} />
                    </Link>
                  )
                }
              />
            )
          )}
          {copyMode && (
            <div className="order-copy-bar" role="region" aria-label={t("คัดลอกข้อมูล")}>
              <span className="order-copy-count">
                {picked.size ? t("เลือก {n} รายการ", { n: picked.size }) : t("เลือกคำสั่งซื้อที่ส่งสำเร็จเพื่อคัดลอก")}
              </span>
              <button
                type="button"
                className="button ghost"
                disabled={!copyable.length}
                onClick={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    for (const o of copyable) {
                      if (allPicked) next.delete(o.id);
                      else next.add(o.id);
                    }
                    return next;
                  })
                }
              >
                {allPicked ? t("ยกเลิกทั้งหน้า") : t("เลือกทั้งหน้า")}
              </button>
              <button type="button" className="button primary" disabled={!picked.size} onClick={() => void copyPicked()}>
                <ClipboardCopy size={16} aria-hidden="true" />
                {t("คัดลอก")}
              </button>
              <button type="button" className="button ghost order-copy-close" aria-label={t("ปิดโหมดคัดลอก")} onClick={exitCopy}>
                <X size={18} />
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
