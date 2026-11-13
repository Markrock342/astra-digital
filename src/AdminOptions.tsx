// Back office for option groups (server/option-groups.mjs): groups + values as chips (drag to
// reorder), then the combination grid (price, warranty, on/off, stock, promo) with a bulk-edit
// bar. Based on shadcn/ui (MIT, https://ui.shadcn.com): Card, Badge chips, Table, Switch, Select.
import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Layers, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";
import { useLive } from "./live";
import type { OptionGroup } from "./types";
import "./options.css";

export type GridVariant = {
  id: string;
  label: string;
  price: number;
  active: boolean;
  warranty_days?: number;
  stock: number;
  stockStatus: "out" | "low" | "in";
  waiting?: number;
};
type OptionsData = { productId: string; groups: OptionGroup[]; options: Record<string, Record<string, string>> };

export function useOptionGroups(productId: string) {
  const [data, setData] = useState<OptionsData | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api<OptionsData>("/admin/products/" + encodeURIComponent(productId) + "/options")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  useLive(["catalog"], () => void load());
  return { data, error, load, setData };
}

/** Flat list → groups: the current options become the values of one group. */
export function EnableOptionGroups({ productId, onDone }: { productId: string; onDone: () => void }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="option-enable">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("/admin/products/" + encodeURIComponent(productId) + "/options/enable", {});
            toast("เปิดกลุ่มตัวเลือกแล้ว ตัวเลือกเดิมอยู่ครบ");
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <LoaderCircle className="spin" size={15} /> : <Layers size={15} />}
        แบ่งเป็นกลุ่มตัวเลือก
      </button>
      <ErrorMessage message={error} />
    </div>
  );
}

type DraftGroup = { id?: string; name: string; values: { id?: string; label: string }[] };

function ValueChips({ group, onChange }: { group: DraftGroup; onChange: (values: DraftGroup["values"]) => void }) {
  const [adding, setAdding] = useState("");
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const add = () => {
    const label = adding.trim();
    if (!label || group.values.some((v) => v.label.toLowerCase() === label.toLowerCase())) return;
    onChange([...group.values, { label }]);
    setAdding("");
  };
  const drop = (e: DragEvent, to: number) => {
    e.preventDefault();
    if (drag === null || drag === to) return;
    const next = [...group.values];
    const [moved] = next.splice(drag, 1);
    next.splice(to, 0, moved);
    onChange(next);
    setDrag(null);
    setOver(null);
  };
  return (
    <div className="option-value-chips">
      {group.values.map((v, i) => (
        <span
          key={(v.id ?? "new") + i}
          className={"option-value-chip" + (drag === i ? " is-dragging" : "") + (over === i ? " is-over" : "")}
          draggable
          onDragStart={() => setDrag(i)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => drop(e, i)}
          onDragEnd={() => {
            setDrag(null);
            setOver(null);
          }}
        >
          <input
            aria-label={"ค่า " + (i + 1) + " ของ " + group.name}
            value={v.label}
            maxLength={40}
            size={Math.max(4, v.label.length)}
            onChange={(e) => onChange(group.values.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <button type="button" aria-label={"ลบ " + v.label} onClick={() => onChange(group.values.filter((_, j) => j !== i))}>
            <X size={13} />
          </button>
        </span>
      ))}
      <input
        className="option-value-add"
        aria-label={"เพิ่มค่าใน " + group.name}
        placeholder="+ เพิ่มค่า (Enter)"
        maxLength={40}
        value={adding}
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/** Groups + values editor (collapsed to chips until "แก้กลุ่ม"). */
export function OptionGroupsEditor({
  productId,
  groups,
  onSaved,
}: {
  productId: string;
  groups: OptionGroup[];
  onSaved: () => void;
}) {
  const { toast } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftGroup[]>(groups);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!editing) setDraft(groups);
  }, [groups, editing]);
  const combos = draft.reduce((n, g) => n * Math.max(1, g.values.filter((v) => v.label.trim()).length), 1);
  const setGroup = (i: number, patch: Partial<DraftGroup>) => setDraft((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const move = (i: number, by: number) =>
    setDraft((list) => {
      const next = [...list];
      const [g] = next.splice(i, 1);
      next.splice(i + by, 0, g);
      return next;
    });
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ created: number }>("/admin/products/" + encodeURIComponent(productId) + "/options", {
        groups: draft.map((g) => ({
          id: g.id,
          name: g.name.trim(),
          values: g.values.filter((v) => v.label.trim()).map((v) => ({ id: v.id, label: v.label.trim() })),
        })),
      }, "PATCH");
      toast(result.created ? "บันทึกแล้ว · เพิ่ม " + result.created + " แบบ (ปิดไว้ ตั้งราคาแล้วเปิดขาย)" : "บันทึกกลุ่มแล้ว");
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function turnOff() {
    if (!confirm("เลิกใช้กลุ่ม? ตัวเลือกทั้งหมดยังอยู่เป็นรายการธรรมดา")) return;
    try {
      await api("/admin/products/" + encodeURIComponent(productId) + "/options/disable", {});
      toast("กลับเป็นรายการตัวเลือกธรรมดาแล้ว");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!editing)
    return (
      <div className="option-editor">
        <div className="option-editor-groups">
          {groups.map((g) => (
            <div key={g.id} className="option-editor-summary">
              <strong>{g.name}</strong>{" "}
              <span className="option-value-chips">
                {g.values.map((v) => (
                  <span className="admin-chip" key={v.id}>
                    {v.label}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="option-editor-actions">
          <button type="button" className="button secondary" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            แก้กลุ่ม
          </button>
          <button type="button" className="button ghost" onClick={() => void turnOff()}>
            เลิกใช้กลุ่ม
          </button>
        </div>
        <ErrorMessage message={error} />
      </div>
    );
  return (
    <div className="option-editor">
      <div className="option-editor-groups">
        {draft.map((g, i) => (
          <div className="option-group-card" key={g.id ?? "new-" + i}>
            <div className="option-group-card-head">
              <input
                aria-label={"ชื่อกลุ่มที่ " + (i + 1)}
                placeholder="ชื่อกลุ่ม เช่น ระยะเวลา"
                maxLength={40}
                value={g.name}
                onChange={(e) => setGroup(i, { name: e.target.value })}
              />
              <button type="button" className="icon-button" aria-label="เลื่อนขึ้น" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="เลื่อนลง"
                disabled={i === draft.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={"ลบกลุ่ม " + g.name}
                disabled={draft.length === 1}
                onClick={() => setDraft((list) => list.filter((_, j) => j !== i))}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <ValueChips group={g} onChange={(values) => setGroup(i, { values })} />
          </div>
        ))}
      </div>
      <div className="option-editor-actions">
        {draft.length < 4 ? (
          <button type="button" className="button ghost" onClick={() => setDraft((list) => [...list, { name: "", values: [] }])}>
            <Plus size={15} />
            เพิ่มกลุ่ม
          </button>
        ) : (
          <span />
        )}
        <small>{combos} แบบ</small>
        <span className="admin-action-row">
          <button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || draft.some((g) => !g.name.trim() || !g.values.some((v) => v.label.trim())) || combos > 200}
            onClick={() => void save()}
          >
            {busy && <LoaderCircle className="spin" size={15} />}
            บันทึกกลุ่ม
          </button>
        </span>
      </div>
      <ErrorMessage message={error} />
    </div>
  );
}

type BulkField = "price" | "warranty_days" | "on" | "off";

/** Combination grid: one row per variant (combination). */
export function OptionGrid({
  productId,
  groups,
  options,
  variants,
  manual,
  pricingChips,
  renderStock,
  renderPricing,
  waitingBadge,
  onChanged,
}: {
  productId: string;
  groups: OptionGroup[];
  options: Record<string, Record<string, string>>;
  variants: GridVariant[];
  manual: boolean;
  pricingChips: (v: GridVariant) => ReactNode;
  renderStock: (v: GridVariant) => ReactNode;
  renderPricing: (v: GridVariant, close: () => void) => ReactNode;
  waitingBadge: (v: GridVariant) => ReactNode;
  onChanged: () => void;
}) {
  const { toast } = useStore();
  const [open, setOpen] = useState<{ id: string; what: "stock" | "pricing" } | null>(null);
  const [filter, setFilter] = useState("");
  const [field, setField] = useState<BulkField>("price");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const valueLabel = (gid: string, vid?: string) => groups.find((g) => g.id === gid)?.values.find((v) => v.id === vid)?.label ?? "–";
  // Grid order = combination order (server sort_order); only variants that name a combination.
  const rows = variants.filter((v) => options[v.id]);
  const matches = (v: GridVariant) => {
    if (!filter) return true;
    const [gid, vid] = filter.split(":");
    return options[v.id]?.[gid] === vid;
  };
  const target = rows.filter(matches);
  async function patch(v: GridVariant, body: Record<string, unknown>) {
    setError("");
    try {
      await api("/admin/variants/" + v.id, body, "PATCH");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function bulk() {
    const body: Record<string, unknown> = { variantIds: target.map((v) => v.id) };
    if (field === "price") body.price = Math.round(Number(value) * 100);
    if (field === "warranty_days") body.warranty_days = Math.max(0, Math.min(365, Math.round(Number(value) || 0)));
    if (field === "on") body.active = true;
    if (field === "off") body.active = false;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ changed: number }>("/admin/products/" + encodeURIComponent(productId) + "/variants/bulk", body, "PATCH");
      toast("แก้แล้ว " + r.changed + " แถว");
      setValue("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const needsValue = field === "price" || field === "warranty_days";
  return (
    <div className="option-grid-wrap">
      <div className="option-bulk" role="group" aria-label="แก้หลายแถว">
        <select aria-label="แถวที่จะแก้" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">ทุกแถว</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.values.map((v) => (
                <option key={v.id} value={g.id + ":" + v.id}>
                  {v.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select aria-label="ช่องที่จะแก้" value={field} onChange={(e) => setField(e.target.value as BulkField)}>
          <option value="price">ราคา</option>
          <option value="warranty_days">ประกัน (วัน)</option>
          <option value="on">เปิดขาย</option>
          <option value="off">ปิดขาย</option>
        </select>
        {needsValue && (
          <input
            aria-label={field === "price" ? "ราคา (บาท)" : "วันรับประกัน"}
            type="number"
            inputMode="decimal"
            min={field === "price" ? 1 : 0}
            step={field === "price" ? "0.01" : "1"}
            placeholder={field === "price" ? "บาท" : "วัน"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <button
          type="button"
          className="button primary"
          disabled={busy || !target.length || (needsValue && value === "")}
          onClick={() => void bulk()}
        >
          ใช้กับ {target.length} แถว
        </button>
      </div>
      <ErrorMessage message={error} />
      <div className="table-scroll">
        <table className="option-grid">
          <thead>
            <tr>
              {groups.map((g) => (
                <th key={g.id}>{g.name}</th>
              ))}
              <th>ราคา (บาท)</th>
              <th>ประกัน</th>
              <th>เปิดขาย</th>
              <th>{manual ? "" : "สต็อก"}</th>
              <th aria-label="ราคาโปร" />
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <GridRow
                key={v.id}
                v={v}
                cells={groups.map((g) => valueLabel(g.id, options[v.id]?.[g.id]))}
                dim={!matches(v)}
                manual={manual}
                open={open?.id === v.id ? open.what : null}
                onOpen={(what) => setOpen(open?.id === v.id && open.what === what ? null : { id: v.id, what })}
                onPatch={(body) => void patch(v, body)}
                pricingChips={pricingChips(v)}
                waitingBadge={waitingBadge(v)}
                detail={
                  open?.id === v.id
                    ? open.what === "stock"
                      ? renderStock(v)
                      : renderPricing(v, () => setOpen(null))
                    : null
                }
                colSpan={groups.length + 5}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GridRow({
  v,
  cells,
  dim,
  manual,
  open,
  onOpen,
  onPatch,
  pricingChips,
  waitingBadge,
  detail,
  colSpan,
}: {
  v: GridVariant;
  cells: string[];
  dim: boolean;
  manual: boolean;
  open: "stock" | "pricing" | null;
  onOpen: (what: "stock" | "pricing") => void;
  onPatch: (body: Record<string, unknown>) => void;
  pricingChips: ReactNode;
  waitingBadge: ReactNode;
  detail: ReactNode;
  colSpan: number;
}) {
  const [price, setPrice] = useState(String(v.price / 100));
  const [days, setDays] = useState(String(v.warranty_days ?? 0));
  useEffect(() => setPrice(String(v.price / 100)), [v.price]);
  useEffect(() => setDays(String(v.warranty_days ?? 0)), [v.warranty_days]);
  const savePrice = () => {
    const satang = Math.round(Number(price) * 100);
    if (satang >= 100 && satang !== v.price) onPatch({ price: satang });
    else setPrice(String(v.price / 100));
  };
  const saveDays = () => {
    const n = Math.max(0, Math.min(365, Math.round(Number(days) || 0)));
    if (n !== (v.warranty_days ?? 0)) onPatch({ warranty_days: n });
    else setDays(String(v.warranty_days ?? 0));
  };
  return (
    <>
      <tr className={(v.active ? "" : "is-off") + (dim ? " is-dim" : "")}>
        {cells.map((c, i) => (
          <td key={i}>{c}</td>
        ))}
        <td>
          <input
            type="number"
            aria-label={"ราคา " + v.label}
            min="1"
            step="0.01"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={savePrice}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          />
          {pricingChips}
        </td>
        <td>
          <input
            type="number"
            className="days"
            aria-label={"วันรับประกัน " + v.label}
            min="0"
            max="365"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={saveDays}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          />
        </td>
        <td className="option-grid-toggle">
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={"เปิดขาย " + v.label}
              checked={v.active}
              onChange={(e) => onPatch({ active: e.target.checked })}
            />
            <span />
          </label>
        </td>
        <td className="option-grid-stock">
          {manual ? (
            <span className="muted">ร้านทำให้</span>
          ) : (
            <button
              type="button"
              className={"stock-link stock-" + v.stockStatus}
              aria-expanded={open === "stock"}
              onClick={() => onOpen("stock")}
            >
              {v.stock}
            </button>
          )}
          {waitingBadge}
        </td>
        <td>
          <button type="button" className="button ghost" aria-expanded={open === "pricing"} onClick={() => onOpen("pricing")}>
            โปร
          </button>
        </td>
      </tr>
      {detail && (
        <tr className="option-grid-detail">
          <td colSpan={colSpan}>{detail}</td>
        </tr>
      )}
    </>
  );
}
