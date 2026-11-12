// "เลือกรูปจากคลัง" — pick a ready-made product cover from public/library.
// Layout follows the shadcn/ui Dialog + Command patterns (MIT): search input on top,
// filter chips, scrollable result grid, footer note.
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { useDialog } from "./dialog";
import { ErrorMessage } from "./App";
import { LIBRARY_CATEGORIES, loadLibrary, searchLibrary, type LibraryCategory, type LibraryItem } from "./image-library";

export const TRADEMARK_NOTE = "โลโก้เป็นเครื่องหมายการค้าของเจ้าของแบรนด์ ใช้เพื่อระบุสินค้าที่ร้านมีสิทธิ์จำหน่าย";

/** Library manifest, loaded the first time `enabled` is true. */
export function useLibrary(enabled: boolean) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || items) return;
    let live = true;
    setError("");
    loadLibrary()
      .then((list) => live && setItems(list))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [enabled, items]);
  return { items, error };
}

export function ImageLibraryDialog({
  open,
  onClose,
  onPick,
  busySlug = "",
  error = "",
  hint,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: LibraryItem) => void;
  busySlug?: string;
  error?: string;
  hint?: string;
}) {
  const { items, error: loadError } = useLibrary(open);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LibraryCategory | "all">("all");
  const search = useRef<HTMLInputElement>(null);
  const close = () => {
    if (!busySlug) onClose();
  };
  useDialog(open, ".image-library-dialog", close);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCategory("all");
    // Command pattern: typing goes straight to the search box.
    requestAnimationFrame(() => search.current?.focus());
  }, [open]);
  if (!open) return null;
  const results = items ? searchLibrary(items, query, category) : [];
  return (
    <div className="reference-modal-backdrop image-library-backdrop" onClick={close}>
      <section
        className="image-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-library-title"
        aria-describedby="image-library-note"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="image-library-head">
          <div>
            <h2 id="image-library-title">คลังรูปสินค้า</h2>
            <p>{hint ?? "เลือกรูปปกสำเร็จรูป ระบบเพิ่มให้เป็นรูปสินค้าทันที"}</p>
          </div>
          <button type="button" className="icon-button" aria-label="ปิด" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <label className="image-library-search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาแบรนด์ เช่น Netflix หรือ เน็ตฟลิกซ์"
            aria-label="ค้นหารูปในคลัง"
            autoComplete="off"
          />
        </label>
        <div className="image-library-chips" role="group" aria-label="หมวดหมู่รูป">
          {LIBRARY_CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.id}
              className={"image-library-chip" + (category === c.id ? " active" : "")}
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="image-library-body">
          <ErrorMessage message={error || loadError} />
          {!items && !loadError && (
            <p className="image-library-empty">
              <LoaderCircle className="spin" size={16} /> กำลังโหลดคลังรูป
            </p>
          )}
          {items && results.length === 0 && (
            <p className="image-library-empty">ไม่พบแบรนด์ “{query}” ลองค้นด้วยชื่ออังกฤษหรือไทย หรืออัปโหลดรูปเอง</p>
          )}
          <ul className="image-library-grid" aria-label="ผลการค้นหา">
            {results.map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  className={"image-library-item" + (busySlug === item.slug ? " busy" : "")}
                  disabled={!!busySlug}
                  onClick={() => onPick(item)}
                >
                  <img src={item.file} alt="" loading="lazy" decoding="async" width={120} height={120} />
                  <span>{item.name}</span>
                  {busySlug === item.slug && (
                    <span className="image-library-busy" aria-live="polite">
                      <LoaderCircle className="spin" size={18} />
                      กำลังเพิ่ม
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <footer className="image-library-note" id="image-library-note">
          {TRADEMARK_NOTE}
        </footer>
      </section>
    </div>
  );
}
