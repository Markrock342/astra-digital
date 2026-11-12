// Admin › ตั้งค่า › คำถามที่พบบ่อย. Same card + form pattern as the legal pages form
// (shadcn/ui card, form and accordion patterns, MIT): add, edit, reorder, hide and delete
// questions, choose where each one shows, and see the storefront result in a live preview.
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import { ErrorMessage, useStore } from "./App";
import { useUnsavedChangesGuard } from "./navigation";
import { FaqAccordion, invalidateFaq } from "./Faq";
import {
  DEFAULT_FAQ,
  FAQ_SCOPE_LABELS,
  FAQ_SCOPES,
  MAX_FAQ_ANSWER,
  MAX_FAQ_ITEMS,
  MAX_FAQ_QUESTION,
  faqForPage,
  faqForProduct,
  faqItems,
  type FaqItem,
  type FaqScope,
  type FaqSettings,
} from "../server/faq.mjs";
import "./faq.css";

type Draft = FaqItem & { key: string };
type ProductOption = { id: string; name: string; active?: number | boolean; preorder?: number | boolean };
let seq = 0;
const draftKey = () => "f" + ++seq;
const newId = () => "q-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const draftsFrom = (faq: FaqSettings | null) => faqItems(faq).map((i) => ({ ...i, key: draftKey() }));
/** What POST /api/admin/settings receives as `faq`. */
function payload(drafts: Draft[]): FaqSettings {
  return {
    items: drafts.map((d) => ({
      id: d.id,
      question: d.question,
      answer: d.answer,
      scope: d.scope,
      ...(d.scope === "products" ? { productIds: d.productIds } : {}),
      ...(d.hidden ? { hidden: true } : {}),
    })),
  };
}

export function FaqSettingsPanel({ products }: { products: ProductOption[] }) {
  const { toast } = useStore();
  const [saved, setSaved] = useState<FaqSettings | null | undefined>(undefined);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewOf, setPreviewOf] = useState("page");
  const load = async () => {
    try {
      const { faq } = await api<{ faq: FaqSettings | null }>("/faq");
      setSaved(faq);
      setDrafts(draftsFrom(faq));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const savedSignature = useMemo(
    () => (saved === undefined ? "" : JSON.stringify(payload(draftsFrom(saved)))),
    [saved],
  );
  const current = drafts ? payload(drafts) : null;
  const dirty = !!current && JSON.stringify(current) !== savedSignature;
  const markClean = useUnsavedChangesGuard(dirty);
  const previewProduct = products.find((p) => p.id === previewOf);
  const preview = useMemo(() => {
    if (!current) return null;
    if (previewProduct) return { product: faqForProduct(current, previewProduct) };
    return faqForPage(current);
  }, [JSON.stringify(current), previewProduct?.id]);

  if (!drafts || !current || !preview)
    return (
      <div className="legal-admin-loading">
        {loadError ? (
          <ErrorMessage message={loadError} />
        ) : (
          <>
            <LoaderCircle className="spin" size={18} />
            กำลังโหลดคำถามที่พบบ่อย
          </>
        )}
      </div>
    );

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (index: number, by: number) => {
    const next = [...drafts];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setDrafts(next);
  };
  const removedDefaults = DEFAULT_FAQ.filter((d) => !drafts.some((x) => x.id === d.id));
  async function save() {
    setError("");
    const blank = drafts!.findIndex((d) => !d.question.trim() || !d.answer.trim());
    if (blank >= 0) return setError(`คำถามข้อ ${blank + 1} ต้องมีทั้งคำถามและคำตอบ`);
    const noProduct = drafts!.findIndex((d) => d.scope === "products" && !d.productIds.length);
    if (noProduct >= 0) return setError(`คำถามข้อ ${noProduct + 1}: กรุณาเลือกสินค้าอย่างน้อย 1 รายการ`);
    setBusy(true);
    try {
      await api("/admin/settings", { faq: current });
      invalidateFaq();
      markClean();
      toast("บันทึกคำถามที่พบบ่อยแล้ว");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const previewCount =
    "product" in preview ? preview.product.length : preview.general.length + preview.preorder.length;

  return (
    <div className="legal-admin faq-admin">
      <div className="reference-admin-heading">
        <div>
          <h1>คำถามที่พบบ่อย</h1>
          <p>
            คำถามที่เลือก “ทุกสินค้า” แสดงในหน้าสินค้าทุกชิ้นและหน้า /faq ส่วนคำถามเฉพาะสินค้าแสดงเฉพาะหน้าสินค้านั้น
            ข้อความแสดงตามที่พิมพ์ ขึ้นบรรทัดว่างเพื่อขึ้นย่อหน้าใหม่ และขึ้นต้นบรรทัดด้วย - เพื่อทำเป็นข้อ ๆ
          </p>
        </div>
      </div>
      <div className="legal-admin-grid">
        <div className="legal-admin-form">
          <section className="reference-admin-card editor-panel">
            <div className="legal-doc-heading">
              <div>
                <h2>คำถามและคำตอบ</h2>
                <p>
                  {drafts.length} ข้อ · ซ่อนอยู่ {drafts.filter((d) => d.hidden).length} ข้อ · สูงสุด {MAX_FAQ_ITEMS} ข้อ
                </p>
              </div>
            </div>
            <ol className="legal-section-list">
              {drafts.map((d, i) => {
                const n = i + 1;
                const original = DEFAULT_FAQ.find((x) => x.id === d.id);
                const modified =
                  !!original && (original.question !== d.question || original.answer !== d.answer);
                return (
                  <li className={"legal-section-card faq-item-card" + (d.hidden ? " is-hidden" : "")} key={d.key}>
                    <div className="legal-section-head">
                      <span className="legal-section-index">{n}</span>
                      <input
                        aria-label={`คำถามที่ ${n}`}
                        value={d.question}
                        maxLength={MAX_FAQ_QUESTION}
                        placeholder="พิมพ์คำถาม"
                        onChange={(e) => update(d.key, { question: e.target.value })}
                      />
                      {d.hidden && <span className="legal-badge faq-badge-hidden">ซ่อนอยู่</span>}
                      {original ? modified && <span className="legal-badge">แก้ไขแล้ว</span> : <span className="legal-badge custom">เพิ่มเอง</span>}
                    </div>
                    <textarea
                      aria-label={`คำตอบของคำถามที่ ${n}`}
                      value={d.answer}
                      maxLength={MAX_FAQ_ANSWER}
                      placeholder="พิมพ์คำตอบ"
                      onChange={(e) => update(d.key, { answer: e.target.value })}
                    />
                    <div className="faq-scope-row">
                      <label className="faq-scope">
                        <span>แสดงที่</span>
                        <select
                          aria-label={`แสดงคำถามที่ ${n} ที่`}
                          value={d.scope}
                          onChange={(e) => update(d.key, { scope: e.target.value as FaqScope })}
                        >
                          {FAQ_SCOPES.map((s) => (
                            <option key={s} value={s}>
                              {FAQ_SCOPE_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="faq-hide-toggle">
                        <input
                          type="checkbox"
                          checked={d.hidden}
                          onChange={(e) => update(d.key, { hidden: e.target.checked })}
                        />
                        ซ่อนจากหน้าร้าน
                      </label>
                    </div>
                    {d.scope === "products" && (
                      <ProductPicker
                        label={`เลือกสินค้าสำหรับคำถามที่ ${n}`}
                        products={products}
                        value={d.productIds}
                        onChange={(productIds) => update(d.key, { productIds })}
                      />
                    )}
                    <div className="legal-section-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`เลื่อนคำถามที่ ${n} ขึ้น`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`เลื่อนคำถามที่ ${n} ลง`}
                        disabled={i === drafts.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                      {modified && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => update(d.key, { question: original!.question, answer: original!.answer })}
                        >
                          <RotateCcw size={14} />
                          คืนค่าเริ่มต้น
                        </button>
                      )}
                      <button
                        type="button"
                        className="button secondary small legal-remove"
                        aria-label={`ลบคำถามที่ ${n}`}
                        onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
                      >
                        <Trash2 size={14} />
                        ลบ
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="legal-add-row">
              <button
                type="button"
                className="button secondary"
                disabled={drafts.length >= MAX_FAQ_ITEMS}
                onClick={() =>
                  setDrafts([
                    ...drafts,
                    { key: draftKey(), id: newId(), question: "", answer: "", scope: "all", productIds: [], hidden: false },
                  ])
                }
              >
                <Plus size={16} />
                เพิ่มคำถาม
              </button>
              {removedDefaults.length > 0 && (
                <label className="legal-restore">
                  <span>นำคำถามมาตรฐานกลับมา</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const d = DEFAULT_FAQ.find((x) => x.id === e.target.value);
                      if (!d) return;
                      setDrafts([
                        ...drafts,
                        { ...d, productIds: [], hidden: false, key: draftKey() },
                      ]);
                    }}
                  >
                    <option value="">เลือกคำถาม…</option>
                    {removedDefaults.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.question}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>
          <ErrorMessage message={error} />
          <div className={"editor-save-bar legal-save-bar" + (dirty ? " is-dirty" : "")}>
            <span className={dirty ? "unsaved-dot" : ""}>{dirty ? "มีการแก้ไขที่ยังไม่บันทึก" : "ตรงกับหน้าร้าน"}</span>
            <button
              type="button"
              className="button secondary"
              disabled={!dirty || busy}
              onClick={() => {
                setDrafts(draftsFrom(saved ?? null));
                setError("");
              }}
            >
              ยกเลิก
            </button>
            <button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}>
              {busy && <LoaderCircle className="spin" size={16} />}
              บันทึกคำถามที่พบบ่อย
            </button>
          </div>
        </div>

        <aside className="legal-preview faq-preview" aria-label="ตัวอย่างหน้าร้าน">
          <div className="legal-preview-bar">
            <strong>ตัวอย่าง</strong>
            <label className="faq-preview-select">
              <select aria-label="ดูตัวอย่างของหน้า" value={previewOf} onChange={(e) => setPreviewOf(e.target.value)}>
                <option value="page">หน้าคำถามที่พบบ่อย (/faq)</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    หน้าสินค้า: {p.name}
                  </option>
                ))}
              </select>
            </label>
            <a
              href={previewProduct ? "/products/" + encodeURIComponent(previewProduct.id) : "/faq"}
              target="_blank"
              rel="noreferrer"
              className="legal-open"
            >
              เปิดหน้าจริง
              <ExternalLink size={13} />
            </a>
          </div>
          <div className="legal-preview-body faq-preview-body">
            <p className="legal-preview-date">
              {previewCount ? `แสดง ${previewCount} คำถาม` : "หน้านี้ไม่มีคำถามที่แสดง"}
            </p>
            {"product" in preview ? (
              <div className="reference-faq">
                <FaqAccordion items={preview.product} />
              </div>
            ) : (
              <>
                <div className="reference-faq">
                  <FaqAccordion items={preview.general} />
                </div>
                {preview.preorder.length > 0 && (
                  <div className="reference-faq">
                    <h3 className="faq-preview-group">สินค้าพรีออเดอร์</h3>
                    <FaqAccordion items={preview.preorder} />
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ProductPicker({
  label,
  products,
  value,
  onChange,
}: {
  label: string;
  products: ProductOption[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [term, setTerm] = useState("");
  const shown = products.filter((p) => p.name.toLowerCase().includes(term.trim().toLowerCase()));
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter((x) => x !== id));
  return (
    <fieldset className="faq-product-picker">
      <legend>
        {label}
        <small>เลือกแล้ว {value.length} รายการ</small>
      </legend>
      {products.length > 6 && (
        <label className="faq-picker-search">
          <Search size={14} aria-hidden="true" />
          <input aria-label={label + " (ค้นหา)"} placeholder="ค้นหาสินค้า" value={term} onChange={(e) => setTerm(e.target.value)} />
        </label>
      )}
      <div className="faq-picker-list">
        {shown.map((p) => (
          <label key={p.id} className="faq-picker-option">
            <input type="checkbox" checked={value.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
            <span>{p.name}</span>
            {!!p.preorder && <small>พรีออเดอร์</small>}
            {!p.active && <small className="is-off">ปิดขาย</small>}
          </label>
        ))}
        {!shown.length && <p className="faq-picker-empty">ไม่พบสินค้า</p>}
      </div>
    </fieldset>
  );
}
