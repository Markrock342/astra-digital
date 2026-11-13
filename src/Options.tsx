// Option groups on the product page (server/option-groups.mjs): one selector per group (chips
// for up to 6 values, a searchable list for more), combinations that are not sold are greyed and
// struck through, and "ตัวเลือกและราคาทั้งหมด" lists every option low → high. Patterns follow
// shadcn/ui (MIT, https://ui.shadcn.com): ToggleGroup chips, Command (searchable select), Table.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, RotateCcw, Search } from "lucide-react";
import { money } from "./api";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { WasPrice } from "./Pricing";
import type { OptionGroup, Product, Variant } from "./types";
import "./options.css";

const EN_OPTIONS: Record<string, string> = {
  "ล้าง": "Clear",
  "เลือก{name}": "Choose {name}",
  "ค้นหา": "Search",
  "ไม่พบตัวเลือก": "No matching option",
  "ตัวเลือกและราคาทั้งหมด": "All options and prices",
  "ดูทั้งหมด ({n})": "Show all ({n})",
  "ย่อ": "Show less",
  "หมด": "Sold out",
  "ไม่มีขาย": "Not available",
  "เริ่มต้น {price}": "From {price}",
  "เลือกให้ครบทุกตัวเลือก": "Choose every option",
};
for (const [th, en] of Object.entries(EN_OPTIONS)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

export type Selection = Record<string, string>;

/** The variant that names exactly this selection (every group picked), if any. */
export function matchVariant(product: Product, selection: Selection): Variant | undefined {
  const groups = product.optionGroups ?? [];
  if (!groups.length || groups.some((g) => !selection[g.id])) return undefined;
  return product.variants.find((v) => groups.every((g) => v.options?.[g.id] === selection[g.id]));
}

/** Variants still possible with this (partial) selection. */
export function candidates(product: Product, selection: Selection) {
  const groups = product.optionGroups ?? [];
  return product.variants.filter((v) => groups.every((g) => !selection[g.id] || v.options?.[g.id] === selection[g.id]));
}

type ValueState = "on" | "out" | "none";
function valueState(product: Product, groups: OptionGroup[], selection: Selection, groupId: string, valueId: string): ValueState {
  const rows = product.variants.filter(
    (v) =>
      v.options?.[groupId] === valueId &&
      groups.every((h) => h.id === groupId || !selection[h.id] || v.options?.[h.id] === selection[h.id]),
  );
  if (!rows.length) return "none";
  return rows.some((v) => v.available) ? "on" : "out";
}

function GroupCombobox({
  group,
  selected,
  stateOf,
  onPick,
}: {
  group: OptionGroup;
  selected?: string;
  stateOf: (valueId: string) => ValueState;
  onPick: (valueId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const shown = group.values.filter((v) => v.label.toLowerCase().includes(q.trim().toLowerCase()));
  const current = group.values.find((v) => v.id === selected);
  return (
    <div className="option-combobox" ref={box}>
      <button
        type="button"
        className={"option-combobox-trigger" + (current ? " is-set" : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <span>{current ? current.label : t("เลือก{name}", { name: group.name })}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="option-combobox-pop" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <label className="option-combobox-search">
            <Search size={15} />
            <input autoFocus value={q} placeholder={t("ค้นหา")} aria-label={t("ค้นหา") + " " + group.name} onChange={(e) => setQ(e.target.value)} />
          </label>
          <ul role="listbox" id={listId} aria-label={group.name}>
            {shown.map((v) => {
              const state = stateOf(v.id);
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={v.id === selected}
                    disabled={state === "none"}
                    className={"option-combobox-item state-" + state}
                    onClick={() => {
                      onPick(v.id);
                      setOpen(false);
                      setQ("");
                    }}
                  >
                    <span>{v.label}</span>
                    {state === "out" && <small>{t("หมด")}</small>}
                    {state === "none" && <small>{t("ไม่มีขาย")}</small>}
                    {v.id === selected && <Check size={15} />}
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="option-combobox-empty">{t("ไม่พบตัวเลือก")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One selector per group; picking again clears that group. */
export function OptionPicker({
  product,
  selection,
  onChange,
}: {
  product: Product;
  selection: Selection;
  onChange: (next: Selection) => void;
}) {
  const groups = product.optionGroups ?? [];
  const pick = (groupId: string, valueId: string) => {
    const next = { ...selection };
    if (next[groupId] === valueId) delete next[groupId];
    else next[groupId] = valueId;
    onChange(next);
  };
  const any = groups.some((g) => selection[g.id]);
  return (
    <div className="option-picker">
      {groups.map((g) => {
        const stateOf = (valueId: string) => valueState(product, groups, selection, g.id, valueId);
        const chosen = g.values.find((v) => v.id === selection[g.id]);
        return (
          <fieldset className="option-group" key={g.id}>
            <legend>
              {g.name}
              {chosen && <span className="option-group-chosen">{chosen.label}</span>}
            </legend>
            {g.values.length > 6 ? (
              <GroupCombobox group={g} selected={selection[g.id]} stateOf={stateOf} onPick={(id) => pick(g.id, id)} />
            ) : (
              <div className="option-chips" role="group" aria-label={g.name}>
                {g.values.map((v) => {
                  const state = stateOf(v.id);
                  return (
                    <button
                      type="button"
                      key={v.id}
                      className={"option-chip state-" + state + (selection[g.id] === v.id ? " selected" : "")}
                      aria-pressed={selection[g.id] === v.id}
                      disabled={state === "none"}
                      title={state === "none" ? t("ไม่มีขาย") : state === "out" ? t("หมด") : undefined}
                      onClick={() => pick(g.id, v.id)}
                    >
                      {v.label}
                      {state === "out" && <small>{t("หมด")}</small>}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
        );
      })}
      {any && (
        <button type="button" className="text-button option-clear" onClick={() => onChange({})}>
          <RotateCcw size={14} />
          {t("ล้าง")}
        </button>
      )}
    </div>
  );
}

/** "เริ่มต้น ฿x" while the selection is not complete. */
export function FromPrice({ product, selection }: { product: Product; selection: Selection }) {
  const rows = candidates(product, selection);
  if (!rows.length) return null;
  const min = Math.min(...rows.map((v) => v.price));
  return (
    <div className="price-display reference-price">
      <span className="price-now">{t("เริ่มต้น {price}", { price: money(min) })}</span>
    </div>
  );
}

const SHOW = 8;
/** Every option, cheapest first; a row click selects it. */
export function AllOptionsList({
  product,
  selectedId,
  onSelect,
}: {
  product: Product;
  selectedId?: string;
  onSelect: (variant: Variant) => void;
}) {
  const [all, setAll] = useState(false);
  const rows = useMemo(
    () => [...product.variants].sort((a, b) => a.price - b.price || a.label.localeCompare(b.label)),
    [product.variants],
  );
  if (rows.length < 2) return null;
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <section className="all-options" aria-label={t("ตัวเลือกและราคาทั้งหมด")}>
      <h2>{t("ตัวเลือกและราคาทั้งหมด")}</h2>
      <ul>
        {shown.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              className={"all-options-row" + (v.id === selectedId ? " selected" : "") + (v.available ? "" : " is-out")}
              aria-pressed={v.id === selectedId}
              onClick={() => onSelect(v)}
            >
              <span className="all-options-label">{v.label}</span>
              <span className="all-options-price">
                {!product.preorder && v.stockStatus === "out" && <small>{t("หมด")}</small>}
                <WasPrice variant={v} />
                <strong>{money(v.price)}</strong>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > SHOW && (
        <button type="button" className="button secondary all-options-more" onClick={() => setAll(!all)}>
          {all ? t("ย่อ") : t("ดูทั้งหมด ({n})", { n: rows.length })}
        </button>
      )}
    </section>
  );
}
