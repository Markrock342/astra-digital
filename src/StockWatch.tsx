// "แจ้งเตือนเมื่อสินค้าเข้า" on the storefront: the button that replaces buy on an
// out-of-stock (ready-stock) option, and the "สินค้าที่รอแจ้งเตือน" list on the account page.
// The server sends one in-site notice (and an email when email is on) when the option comes
// back, then the request ends (server/stock-watch.mjs). Stock counts are never shown.
import { useCallback, useEffect, useState } from "react";
import { BellOff, BellRing, Check, LoaderCircle, PackageSearch } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime } from "./api";
import { t } from "./i18n";
import "./restock-reviews.css";

export type StockWatch = {
  variantId: string;
  productId: string;
  product: string;
  label: string;
  created_at: string;
  /** Back in stock (the notice may still be on its way). */
  available: boolean;
};

/** Signed-in customer's waiting list; null while loading or signed out. */
export function useStockWatches() {
  const { user } = useStore();
  const [watches, setWatches] = useState<StockWatch[] | null>(null);
  const load = useCallback(async () => {
    if (!user) return setWatches(null);
    try {
      setWatches((await api<{ watches: StockWatch[] }>("/stock-watch")).watches);
    } catch {
      setWatches([]);
    }
  }, [user?.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return { watches, setWatches, reload: load };
}

/** Product page, out-of-stock ready option: ask to be told when it is back. */
export function StockWatchButton({ variantId, productId }: { variantId: string; productId: string }) {
  const { user, go, toast } = useStore();
  const { watches, setWatches } = useStockWatches();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const watching = !!watches?.some((w) => w.variantId === variantId);
  useEffect(() => setError(""), [variantId]);
  async function subscribe() {
    if (!user) {
      go(
        "/login?next=" +
          encodeURIComponent("/products/" + encodeURIComponent(productId) + "?variant=" + encodeURIComponent(variantId)),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/stock-watch", { variantId });
      setWatches((await api<{ watches: StockWatch[] }>("/stock-watch")).watches);
      toast(t("เราจะแจ้งเตือนเมื่อมีของ"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await api("/stock-watch/" + encodeURIComponent(variantId), undefined, "DELETE");
      setWatches((list) => (list ?? []).filter((w) => w.variantId !== variantId));
      toast(t("ยกเลิกการแจ้งเตือนแล้ว"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stock-watch" data-testid="stock-watch">
      {watching ? (
        <div className="stock-watch-on" role="status">
          <span className="stock-watch-icon" aria-hidden="true">
            <Check size={16} />
          </span>
          <span>
            <strong>{t("เราจะแจ้งเตือนเมื่อมีของ")}</strong>
            <small>{t("แจ้งครั้งเดียวทางกระดิ่งแจ้งเตือน (และอีเมล ถ้าร้านเปิดใช้) ไม่ได้จองสินค้าไว้ให้")}</small>
          </span>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void cancel()}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <BellOff size={15} />}
            {t("ยกเลิก")}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="button primary stock-watch-subscribe"
            disabled={busy || (!!user && watches === null)}
            onClick={() => void subscribe()}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : <BellRing size={17} />}
            {t("แจ้งเตือนเมื่อมีของ")}
          </button>
          <p className="stock-watch-help">
            {user
              ? t("ตัวเลือกนี้หมดชั่วคราว กดเพื่อรับแจ้งเตือนครั้งเดียวเมื่อกลับมามีของ")
              : t("ตัวเลือกนี้หมดชั่วคราว เข้าสู่ระบบเพื่อรับแจ้งเตือนเมื่อกลับมามีของ")}
          </p>
        </>
      )}
      <ErrorMessage message={error} />
    </div>
  );
}

/** Account page: "สินค้าที่รอแจ้งเตือน" with cancel. */
export function StockWatchList() {
  const { toast } = useStore();
  const { watches, setWatches } = useStockWatches();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function cancel(w: StockWatch) {
    setBusy(w.variantId);
    setError("");
    try {
      await api("/stock-watch/" + encodeURIComponent(w.variantId), undefined, "DELETE");
      setWatches((list) => (list ?? []).filter((x) => x.variantId !== w.variantId));
      toast(t("ยกเลิกการแจ้งเตือนแล้ว"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel stock-watch-list" aria-labelledby="stock-watch-heading">
      <h2 id="stock-watch-heading">{t("สินค้าที่รอแจ้งเตือน")}</h2>
      <p className="muted">{t("เราแจ้งเตือนครั้งเดียวเมื่อสินค้ากลับมามีของ หากพลาด กดรอใหม่ได้ที่หน้าสินค้า")}</p>
      <ErrorMessage message={error} />
      {watches === null ? (
        <div className="loading-row">
          <LoaderCircle className="spin" size={16} />
          {t("กำลังโหลด")}
        </div>
      ) : watches.length === 0 ? (
        <p className="stock-watch-empty">
          <PackageSearch size={18} />
          {t("ยังไม่มีสินค้าที่รอแจ้งเตือน")}
        </p>
      ) : (
        <ul>
          {watches.map((w) => (
            <li key={w.variantId}>
              <Link to={"/products/" + encodeURIComponent(w.productId) + "?variant=" + encodeURIComponent(w.variantId)}>
                <strong>{w.product}</strong>
                <small>
                  {w.label} · {t("กดรอเมื่อ")} {dateTime(w.created_at)}
                </small>
              </Link>
              {w.available && <span className="stock-watch-back">{t("มีของแล้ว")}</span>}
              <button
                type="button"
                className="button secondary"
                aria-label={t("ยกเลิกการแจ้งเตือน") + " " + w.product + " " + w.label}
                disabled={busy === w.variantId}
                onClick={() => void cancel(w)}
              >
                {busy === w.variantId ? <LoaderCircle className="spin" size={15} /> : <BellOff size={15} />}
                {t("ยกเลิก")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
