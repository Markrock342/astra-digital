import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import { Art } from "./App";
import { t } from "./i18n";
import type { Product } from "./types";

/** Native scroll-snap supports touch swipes; the modal keeps focus inside and restores it. */
export function ProductGallery({ product }: { product: Product }) {
  const uploaded = product.images ?? [];
  const sources = uploaded.length ? uploaded.map((i) => i.url) : product.imageUrl ? [product.imageUrl]
    : ["stream", "cinema"].includes(product.art)
      ? Array.from({ length: product.art === "stream" ? 3 : 2 }, (_, i) =>
          "/products/" + (product.art === "stream" ? "disney" : "monomax") + (i ? "-" + i : "") + ".webp")
      : [null];
  const [current, setCurrent] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const slider = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const index = Math.min(current, sources.length - 1);
  const art = (i: number) => sources[i] ? <img src={sources[i]!} alt={product.name} draggable={false} />
    : <Art type={product.art} name={product.name} />;
  function select(i: number) {
    setCurrent(i);
    slider.current?.scrollTo({ left: i * slider.current.clientWidth, behavior: "instant" });
  }
  useEffect(() => {
    if (!zoomed || !dialog.current) return;
    const el = dialog.current;
    const opener = trigger.current ?? slider.current?.querySelectorAll<HTMLButtonElement>(".gallery-slide")[index] ?? null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el.showModal();
    return () => {
      if (el.open) el.close();
      document.body.style.overflow = previousOverflow;
      opener?.focus({ preventScroll: true });
    };
  }, [zoomed]);
  return (
    <div className="reference-gallery">
      <div className="product-gallery-slider" ref={slider} aria-label={t("รูปสินค้า")}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientWidth) setCurrent(Math.round(el.scrollLeft / el.clientWidth));
        }}>
        {sources.map((src, i) => (
          <button key={src ?? i} type="button" className="reference-main-image gallery-slide"
            aria-label={t("ขยายรูปสินค้า {n}", { n: i + 1 })}
            onClick={(e) => { trigger.current = e.currentTarget; setCurrent(i); setZoomed(true); }}>
            {art(i)}
            <span className="gallery-zoom-hint" aria-hidden="true"><ZoomIn size={18} /></span>
          </button>
        ))}
      </div>
      {sources.length > 1 && (
        <div className="reference-thumbnails">
          {sources.map((src, i) => (
            <button key={src ?? i} type="button" className={index === i ? "selected" : ""}
              aria-label={t("รูปสินค้า ") + (i + 1)} aria-pressed={index === i} onClick={() => select(i)}>
              {art(i)}
            </button>
          ))}
        </div>
      )}
      <dialog ref={dialog} className="product-image-viewer" aria-label={t("รูปสินค้าขยาย")}
        onCancel={() => setZoomed(false)} onClose={() => setZoomed(false)}
        onClick={(e) => { if (e.target === e.currentTarget) setZoomed(false); }}>
        <div className="product-image-viewer-content">
          <button type="button" autoFocus className="viewer-close" aria-label={t("ปิดรูปขยาย")}
            onClick={() => setZoomed(false)}><X size={24} /></button>
          <div className="viewer-art">{art(index)}</div>
          {sources.length > 1 && <div className="viewer-controls">
            <button type="button" aria-label={t("รูปก่อนหน้า")} onClick={() => select((index + sources.length - 1) % sources.length)}><ChevronLeft /></button>
            <span>{index + 1} / {sources.length}</span>
            <button type="button" aria-label={t("รูปถัดไป")} onClick={() => select((index + 1) % sources.length)}><ChevronRight /></button>
          </div>}
        </div>
      </dialog>
    </div>
  );
}
