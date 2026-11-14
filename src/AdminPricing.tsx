// Back office for pricing rules (server/pricing.mjs): compare-at + scheduled sale, purchase
// limit per product / option, customer tags and per-option tag prices. Layout reuses the
// existing admin cards / fields (shadcn/ui-style, MIT). ADMIN edits; STAFF reads.
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Tag, X } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api, money } from "./api";
import { useLive } from "./live";
import "./pricing.css";

export type TagColor = "gray" | "red" | "orange" | "green" | "blue" | "purple";
export type CustomerTag = { tag: string; color: TagColor };
export type VariantPricing = {
  compareAt: number | null;
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  saleStartsAtLocal: string | null;
  saleEndsAtLocal: string | null;
  saleStatus: "none" | "scheduled" | "active" | "ended";
  maxPerCustomer: number | null;
  tagPrices: { tag: string; price: number; color: TagColor }[];
};
export type ProductPricing = {
  productId: string;
  maxPerCustomer: number | null;
  variants: Record<string, VariantPricing>;
  tags: CustomerTag[];
};

const COLOR_TEXT: Record<TagColor, string> = {
  gray: "เทา",
  red: "แดง",
  orange: "ส้ม",
  green: "เขียว",
  blue: "น้ำเงิน",
  purple: "ม่วง",
};
const SALE_TEXT: Record<VariantPricing["saleStatus"], string> = {
  none: "",
  scheduled: "ตั้งเวลาไว้",
  active: "กำลังลดราคา",
  ended: "โปรจบแล้ว",
};
const baht = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text === "" ? null : Math.round(Number(text) * 100);
};

/** Pricing of every option of one product (reloads on catalog changes). */
export function useProductPricing(productId: string) {
  const [data, setData] = useState<ProductPricing | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api<ProductPricing>("/admin/products/" + productId + "/pricing")
      .then((r) => {
        setData(r);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  useLive(["catalog", "customers"], () => void load());
  return { data, error, load };
}

/** Small chips on an option row: sale / compare-at / limit / tag prices. */
export function PricingChips({ row }: { row?: VariantPricing }) {
  if (!row) return null;
  const chips: [string, string][] = [];
  if (row.salePrice != null && row.saleStatus !== "ended")
    chips.push(["sale", (row.saleStatus === "scheduled" ? "ตั้งโปร " : "โปร ") + money(row.salePrice)]);
  if (row.compareAt != null) chips.push(["", "ก่อนลด " + money(row.compareAt)]);
  if (row.maxPerCustomer != null) chips.push(["", "จำกัด " + row.maxPerCustomer + "/บัญชี"]);
  if (row.tagPrices.length) chips.push(["", "ราคาแท็ก " + row.tagPrices.length]);
  if (!chips.length) return null;
  return (
    <span className="variant-pricing-chips">
      {chips.map(([kind, text]) => (
        <span key={text} className={"pricing-chip" + (kind ? " pricing-chip-" + kind : "")}>
          {text}
        </span>
      ))}
    </span>
  );
}

/** Product-wide limit (all options together). */
export function ProductLimitForm({
  productId,
  pricing,
  onSaved,
}: {
  productId: string;
  pricing: ProductPricing | null;
  onSaved: () => void;
}) {
  const { user, toast } = useStore();
  const admin = user?.role === "ADMIN";
  const [error, setError] = useState("");
  if (!pricing) return null;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get("maxPerCustomer") ?? "").trim();
    try {
      await api("/admin/products/" + productId + "/limit", { maxPerCustomer: raw === "" ? null : Number(raw) }, "PATCH");
      toast("บันทึกจำนวนจำกัดแล้ว");
      setError("");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form className="product-limit-form" onSubmit={save} key={String(pricing.maxPerCustomer)}>
      <label className="field">
        จำกัดต่อบัญชี (ทุกตัวเลือกรวมกัน)
        <input
          name="maxPerCustomer"
          type="number"
          min="1"
          max="1000"
          step="1"
          inputMode="numeric"
          placeholder="ไม่จำกัด"
          defaultValue={pricing.maxPerCustomer ?? ""}
          disabled={!admin}
        />
      </label>
      {admin && <button className="button secondary">ตั้งจำนวนจำกัด</button>}
      <ErrorMessage message={error} />
    </form>
  );
}

type TagPriceDraft = { key: number; tag: string; price: string };
let draftKey = 0;

/** Editor under one option: compare-at, sale + window, limit, tag prices. */
export function VariantPricingPanel({
  variantId,
  regularPrice,
  row,
  tags,
  onSaved,
  onClose,
}: {
  variantId: string;
  regularPrice: number;
  row: VariantPricing;
  tags: CustomerTag[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const { user, toast } = useStore();
  const admin = user?.role === "ADMIN";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tagRows, setTagRows] = useState<TagPriceDraft[]>(() =>
    row.tagPrices.map((t) => ({ key: ++draftKey, tag: t.tag, price: String(t.price / 100) })),
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const limit = String(data.get("maxPerCustomer") ?? "").trim();
    setBusy(true);
    try {
      await api(
        "/admin/variants/" + variantId + "/pricing",
        {
          compareAt: baht(data.get("compareAt")),
          salePrice: baht(data.get("salePrice")),
          saleStartsAt: String(data.get("saleStartsAt") ?? "") || null,
          saleEndsAt: String(data.get("saleEndsAt") ?? "") || null,
          maxPerCustomer: limit === "" ? null : Number(limit),
          tagPrices: tagRows
            .filter((r) => r.tag.trim() !== "" || r.price.trim() !== "")
            .map((r) => ({ tag: r.tag, price: baht(r.price) })),
        },
        "PATCH",
      );
      toast("บันทึกราคาแล้ว");
      setError("");
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const listId = "tag-options-" + variantId;
  return (
    <form className="variant-pricing" onSubmit={save} aria-label="ราคาโปรและจำกัดจำนวน">
      <div>
        <h3>ราคาโปร ราคาก่อนลด และจำกัดจำนวน</h3>
        <p className="field-help">
          ราคาปกติ {money(regularPrice)} · ลูกค้าจ่ายราคาที่ถูกที่สุดระหว่างราคาปกติ ราคาโปร (ช่วงเวลาที่ตั้ง) และราคาตามแท็กของลูกค้า
          · โค้ดส่วนลดลดต่อจากราคานั้น
        </p>
        {row.saleStatus !== "none" && (
          <span className={"pricing-status pricing-status-" + row.saleStatus}>
            สถานะโปร: <b>{SALE_TEXT[row.saleStatus]}</b>
          </span>
        )}
      </div>
      <fieldset disabled={!admin || busy} className="pricing-grid">
        <label className="field">
          ราคาก่อนลด (บาท)
          <input
            name="compareAt"
            type="number"
            min="1"
            step="0.01"
            placeholder="ไม่แสดง"
            defaultValue={row.compareAt != null ? row.compareAt / 100 : ""}
          />
          <small>ขีดฆ่าไว้ข้างราคา ต้องมากกว่าราคาขาย</small>
        </label>
        <label className="field">
          ราคาโปร (บาท)
          <input
            name="salePrice"
            type="number"
            min="1"
            step="0.01"
            placeholder="ไม่มีโปร"
            defaultValue={row.salePrice != null ? row.salePrice / 100 : ""}
          />
          <small>ต้องต่ำกว่าราคาปกติ</small>
        </label>
        <label className="field">
          เริ่มโปร (เวลาไทย)
          <input name="saleStartsAt" type="datetime-local" defaultValue={row.saleStartsAtLocal ?? ""} />
          <small>เว้นว่าง = เริ่มทันที</small>
        </label>
        <label className="field">
          จบโปร (เวลาไทย)
          <input name="saleEndsAt" type="datetime-local" defaultValue={row.saleEndsAtLocal ?? ""} />
          <small>เว้นว่าง = ไม่มีวันจบ</small>
        </label>
        <label className="field">
          จำกัดต่อบัญชี (ชิ้น)
          <input
            name="maxPerCustomer"
            type="number"
            min="1"
            max="1000"
            step="1"
            inputMode="numeric"
            placeholder="ไม่จำกัด"
            defaultValue={row.maxPerCustomer ?? ""}
          />
          <small>นับออเดอร์ที่รอจ่าย จ่ายแล้ว และพรีออเดอร์</small>
        </label>
      </fieldset>
      <div className="tag-price-list">
        <h3>ราคาตามแท็กลูกค้า</h3>
        <p className="field-help">เช่น แท็ก ตัวแทน จ่าย 80 บาท · เห็นเฉพาะลูกค้าที่มีแท็กนั้นตอนเข้าสู่ระบบ</p>
        <datalist id={listId}>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag} />
          ))}
        </datalist>
        {tagRows.map((r) => (
          <div className="tag-price-row" key={r.key}>
            <input
              aria-label="แท็ก"
              list={listId}
              maxLength={24}
              placeholder="แท็ก เช่น ตัวแทน"
              value={r.tag}
              disabled={!admin || busy}
              onChange={(e) => setTagRows((rows) => rows.map((x) => (x.key === r.key ? { ...x, tag: e.target.value } : x)))}
            />
            <input
              aria-label={"ราคาแท็ก " + (r.tag || "ใหม่") + " (บาท)"}
              type="number"
              min="1"
              step="0.01"
              placeholder="ราคา (บาท)"
              value={r.price}
              disabled={!admin || busy}
              onChange={(e) => setTagRows((rows) => rows.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)))}
            />
            {admin && (
              <button
                type="button"
                className="icon-button"
                aria-label={"ลบราคาแท็ก " + r.tag}
                onClick={() => setTagRows((rows) => rows.filter((x) => x.key !== r.key))}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        {admin && (
          <div>
            <button
              type="button"
              className="button ghost"
              onClick={() => setTagRows((rows) => [...rows, { key: ++draftKey, tag: "", price: "" }])}
            >
              <Plus size={15} />
              เพิ่มราคาแท็ก
            </button>
          </div>
        )}
      </div>
      <ErrorMessage message={error} />
      <div className="admin-action-row">
        {admin && (
          <button className="button primary" disabled={busy}>
            บันทึกราคา
          </button>
        )}
        <button type="button" className="button ghost" onClick={onClose}>
          {admin ? "ยกเลิก" : "ปิด"}
        </button>
      </div>
      {!admin && <p className="field-help">เฉพาะแอดมินแก้ราคาและจำนวนจำกัดได้</p>}
    </form>
  );
}

// ---------------------------------------------------------------- customer tags

/** Every tag (for filters and suggestions). */
export function useCustomerTags() {
  const [tags, setTags] = useState<(CustomerTag & { customers: number })[]>([]);
  const load = () =>
    api<{ tags: (CustomerTag & { customers: number })[] }>("/admin/customer-tags")
      .then((r) => setTags(r.tags))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  useLive(["customers"], () => void load());
  return { tags, load };
}

export function CustomerTagChips({
  tags,
  onRemove,
}: {
  tags?: CustomerTag[];
  onRemove?: (tag: string) => void;
}) {
  if (!tags?.length) return null;
  return (
    <span className="customer-tag-list">
      {tags.map((t) => (
        <span key={t.tag} className={"customer-tag customer-tag-" + t.color}>
          {t.tag}
          {onRemove && (
            <button type="button" aria-label={"เอาแท็ก " + t.tag + " ออก"} onClick={() => onRemove(t.tag)}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

/** Customer detail card: tags (ADMIN adds / removes, STAFF reads). */
export function CustomerTagsCard({
  customerId,
  tags,
  onChanged,
  embedded = false,
}: {
  customerId: string;
  tags: CustomerTag[];
  /** Inside the "ข้อมูลลูกค้า" card (one card instead of two). */
  embedded?: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const { user, toast } = useStore();
  const admin = user?.role === "ADMIN";
  const known = useCustomerTags();
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<TagColor>("gray");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(next: string[], message: string) {
    setBusy(true);
    setError("");
    try {
      await api("/admin/customers/" + customerId + "/tags", { tags: next }, "PATCH");
      toast(message);
      await onChanged();
      void known.load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const tag = draft.trim();
    if (!tag) return;
    const exists = known.tags.some((t) => t.tag.toLowerCase() === tag.toLowerCase());
    if (!exists) {
      try {
        await api("/admin/customer-tags", { tag, color });
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    setDraft("");
    await save([...tags.map((t) => t.tag), tag], "เพิ่มแท็กแล้ว");
  }
  const isNew = draft.trim() !== "" && !known.tags.some((t) => t.tag.toLowerCase() === draft.trim().toLowerCase());
  return (
    <section
      className={
        embedded ? "customer-tags-card customer-tags-embedded" : "reference-admin-card admin-detail-card customer-tags-card"
      }
      aria-labelledby={"customer-tags-" + customerId}
    >
      {embedded ? (
        <h3 id={"customer-tags-" + customerId}>
          <Tag size={15} className="customer-tags-icon" />
          แท็กลูกค้า
          <small className="muted">ใช้กับราคาตามแท็ก เช่น VIP / ตัวแทน</small>
        </h3>
      ) : (
        <>
          <h2 id={"customer-tags-" + customerId}>
            <Tag size={16} className="customer-tags-icon" />
            แท็กลูกค้า
          </h2>
          <p className="field-help customer-tags-help">
            ใช้จัดกลุ่มลูกค้า เช่น VIP หรือ ตัวแทน · ถ้าตัวเลือกสินค้ามีราคาตามแท็ก ลูกค้าคนนี้จะเห็นและจ่ายราคานั้น
          </p>
        </>
      )}
      {tags.length ? (
        <CustomerTagChips
          tags={tags}
          onRemove={admin && !busy ? (tag) => void save(tags.map((t) => t.tag).filter((x) => x !== tag), "เอาแท็กออกแล้ว") : undefined}
        />
      ) : (
        <p className="muted customer-tags-empty">
          ยังไม่มีแท็ก
        </p>
      )}
      {admin ? (
        <form className="customer-tag-form" onSubmit={add}>
          <input
            aria-label="แท็กใหม่"
            list={"customer-tag-options-" + customerId}
            maxLength={24}
            placeholder="พิมพ์แท็ก เช่น ตัวแทน"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <datalist id={"customer-tag-options-" + customerId}>
            {known.tags
              .filter((t) => !tags.some((x) => x.tag === t.tag))
              .map((t) => (
                <option key={t.tag} value={t.tag} />
              ))}
          </datalist>
          {isNew && (
            <select aria-label="สีแท็กใหม่" value={color} onChange={(e) => setColor(e.target.value as TagColor)}>
              {(Object.keys(COLOR_TEXT) as TagColor[]).map((c) => (
                <option key={c} value={c}>
                  สี{COLOR_TEXT[c]}
                </option>
              ))}
            </select>
          )}
          <button className="button secondary" disabled={busy || !draft.trim()}>
            <Plus size={15} />
            เพิ่มแท็ก
          </button>
        </form>
      ) : (
        <p className="field-help">เฉพาะแอดมินเพิ่มหรือเอาแท็กออกได้</p>
      )}
      <ErrorMessage message={error} />
    </section>
  );
}
