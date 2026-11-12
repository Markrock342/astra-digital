// /admin/categories — สินค้า › หมวดหมู่ (ADMIN only).
// Layout follows the shadcn/ui "Tasks" data table (MIT) with row actions, and the shadcn/ui
// Dialog + form pattern for create / edit / delete; icons come from the image library
// dialog (ImageLibrary.tsx). Admin pass: white cards on cool grey, --brand.
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Eye,
  EyeOff,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api } from "./api";
import { useDialog } from "./dialog";
import { useLive } from "./live";
import { ImageLibraryDialog } from "./ImageLibrary";
import { CategoryIcon } from "./Categories";
import type { AdminCategory } from "./types";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** "VPN & Cloud" → "vpn-cloud"; Thai-only names give "" (the admin types the slug). */
export const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

type Draft = { id: string; name_th: string; name_en: string; icon: string | null; hidden: boolean };
const emptyDraft: Draft = { id: "", name_th: "", name_en: "", icon: null, hidden: false };

export function AdminCategories() {
  const { toast } = useStore();
  const [rows, setRows] = useState<AdminCategory[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<AdminCategory | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  async function load() {
    try {
      const data = await api<{ categories: AdminCategory[] }>("/admin/categories");
      setRows(data.categories);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useLive(["catalog"], () => void load());

  async function move(index: number, by: -1 | 1) {
    if (!rows) return;
    const next = [...rows];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy("order");
    setError("");
    setRows(next); // feels instant; the server answer replaces it
    try {
      const data = await api<{ categories: AdminCategory[] }>("/admin/categories/reorder", {
        ids: next.map((c) => c.id),
      });
      setRows(data.categories);
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy("");
    }
  }
  async function toggleHidden(c: AdminCategory) {
    setBusy("hide:" + c.id);
    setError("");
    try {
      await api("/admin/categories/" + encodeURIComponent(c.id), { hidden: !c.hidden }, "PATCH");
      toast(c.hidden ? "แสดงหมวด " + c.name + " บนหน้าร้านแล้ว" : "ซ่อนหมวด " + c.name + " แล้ว");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const total = rows?.length ?? 0;
  return (
    <section className="category-admin" aria-labelledby="category-admin-title">
      <div className="reference-admin-heading">
        <div>
          <h1 id="category-admin-title">หมวดหมู่</h1>
          <p>จัดกลุ่มสินค้าให้ลูกค้าเลือกง่าย หมวดที่ซ่อนหรือยังไม่มีสินค้าเปิดขายจะไม่แสดงบนหน้าร้าน</p>
        </div>
        <button type="button" className="button primary" onClick={() => setEditing("new")}>
          <Plus size={16} />
          เพิ่มหมวด
        </button>
      </div>
      <ErrorMessage message={error} />
      <div className="table-scroll reference-table admin-list-table category-table">
        <table>
          <thead>
            <tr>
              <th className="category-order-col">ลำดับ</th>
              <th>หมวด</th>
              <th className="num">สินค้า</th>
              <th>หน้าร้าน</th>
              <th className="category-actions-col">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((c, i) => (
              <tr key={c.id} data-category={c.id} className={c.hidden ? "is-hidden" : ""}>
                <td className="category-order-col">
                  <span className="category-order">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={"เลื่อน " + c.name + " ขึ้น"}
                      disabled={!!busy || i === 0}
                      onClick={() => void move(i, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={"เลื่อน " + c.name + " ลง"}
                      disabled={!!busy || i === total - 1}
                      onClick={() => void move(i, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                  </span>
                </td>
                <td>
                  <div className="category-cell">
                    <CategoryIcon icon={c.icon} size={36} />
                    <div>
                      <strong>{c.name}</strong>
                      <small>
                        {c.name_en ? c.name_en + " · " : ""}
                        <code>{c.id}</code>
                      </small>
                    </div>
                  </div>
                </td>
                <td className="num">
                  <span className="category-count">
                    <strong>{c.count}</strong>
                    {c.count > 0 && <small>ขายอยู่ {c.active}</small>}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      "category-visibility " +
                      (c.hidden ? "hidden" : c.active > 0 ? "shown" : "empty")
                    }
                  >
                    {c.hidden ? "ซ่อนอยู่" : c.active > 0 ? "แสดงอยู่" : "ยังไม่แสดง (ไม่มีสินค้าเปิดขาย)"}
                  </span>
                </td>
                <td className="category-actions-col">
                  <span className="category-row-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!!busy}
                      onClick={() => void toggleHidden(c)}
                    >
                      {busy === "hide:" + c.id ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : c.hidden ? (
                        <Eye size={14} />
                      ) : (
                        <EyeOff size={14} />
                      )}
                      {c.hidden ? "แสดง" : "ซ่อน"}
                    </button>
                    <button type="button" className="button secondary" onClick={() => setEditing(c)}>
                      <Pencil size={14} />
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="button secondary danger-text"
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2 size={14} />
                      ลบ
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows === null && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
        {rows?.length === 0 && <p className="reference-empty-text">ยังไม่มีหมวดหมู่ กด “เพิ่มหมวด” เพื่อเริ่ม</p>}
      </div>
      <p className="category-admin-note">
        ย้ายสินค้าหลายชิ้นเข้าหมวดได้ที่ <Link to="/admin/products">สินค้าทั้งหมด</Link> › เลือกสินค้า › ย้ายหมวด…
      </p>
      {editing && (
        <CategoryEditor
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            toast(message);
            await load();
          }}
        />
      )}
      {deleting && (
        <CategoryDelete
          category={deleting}
          others={(rows ?? []).filter((c) => c.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDone={async (message) => {
            setDeleting(null);
            toast(message);
            await load();
          }}
        />
      )}
    </section>
  );
}

function CategoryEditor({
  category,
  onClose,
  onSaved,
}: {
  category: AdminCategory | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(
    category
      ? {
          id: category.id,
          name_th: category.name_th,
          name_en: category.name_en ?? "",
          icon: category.icon,
          hidden: category.hidden,
        }
      : emptyDraft,
  );
  // New category: the slug follows the English name until the admin edits it.
  const slugTouched = useRef(!!category);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy && !picking) onClose();
  };
  useDialog(!picking, ".category-dialog", close);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const slugChanged = !!category && draft.id !== category.id;
  const slugValid = SLUG.test(draft.id) && draft.id.length <= 40;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!slugValid) {
      setError("รหัสหมวดใช้ได้เฉพาะ a-z 0-9 และขีด (-)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (category) {
        const patch: Record<string, unknown> = {};
        if (draft.name_th.trim() !== category.name_th) patch.name_th = draft.name_th;
        if (draft.name_en.trim() !== (category.name_en ?? "")) patch.name_en = draft.name_en;
        if (draft.icon !== category.icon) patch.icon = draft.icon;
        if (draft.hidden !== category.hidden) patch.hidden = draft.hidden;
        if (slugChanged) patch.id = draft.id;
        if (!Object.keys(patch).length) return onClose();
        const result = await api<{ moved: number }>(
          "/admin/categories/" + encodeURIComponent(category.id),
          patch,
          "PATCH",
        );
        await onSaved(
          "บันทึกหมวดแล้ว" + (slugChanged && result.moved ? ` · ย้ายสินค้า ${result.moved} ชิ้นตามรหัสใหม่` : ""),
        );
      } else {
        await api("/admin/categories", {
          id: draft.id,
          name_th: draft.name_th,
          name_en: draft.name_en,
          icon: draft.icon,
          hidden: draft.hidden,
        });
        await onSaved("เพิ่มหมวด " + draft.name_th.trim() + " แล้ว");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="reference-modal-backdrop" onClick={close} hidden={picking}>
        <section
          className="reference-import-modal category-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-dialog-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="reference-card-heading">
            <h2 id="category-dialog-title">{category ? "แก้ไขหมวด" : "เพิ่มหมวด"}</h2>
            <button type="button" className="icon-button" aria-label="ปิด" onClick={close}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={submit}>
            <ErrorMessage message={error} />
            <div className="category-icon-field">
              <CategoryIcon icon={draft.icon} size={56} />
              <div>
                <span className="category-field-label">ไอคอน</span>
                <span className="category-icon-actions">
                  <button type="button" className="button secondary" onClick={() => setPicking(true)}>
                    <ImagePlus size={15} />
                    {draft.icon ? "เปลี่ยนรูป" : "เลือกจากคลังรูป"}
                  </button>
                  {draft.icon && (
                    <button type="button" className="button ghost" onClick={() => set({ icon: null })}>
                      เอาไอคอนออก
                    </button>
                  )}
                </span>
              </div>
            </div>
            <label className="field">
              ชื่อหมวด (ไทย)
              <input
                name="name_th"
                required
                maxLength={40}
                value={draft.name_th}
                onChange={(e) => set({ name_th: e.target.value })}
                placeholder="เช่น ดูหนัง/ซีรีส์"
              />
            </label>
            <label className="field">
              ชื่อหมวด (อังกฤษ) <span className="muted">ไม่บังคับ</span>
              <input
                name="name_en"
                maxLength={40}
                value={draft.name_en}
                onChange={(e) => {
                  const name_en = e.target.value;
                  set(slugTouched.current ? { name_en } : { name_en, id: slugify(name_en) });
                }}
                placeholder="เช่น Movies & series"
              />
              <small className="field-help">แสดงเมื่อลูกค้าเปลี่ยนหน้าร้านเป็นภาษาอังกฤษ</small>
            </label>
            <label className="field">
              รหัสในลิงก์ (slug)
              <input
                name="id"
                required
                maxLength={40}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={draft.id}
                onChange={(e) => {
                  slugTouched.current = true;
                  set({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") });
                }}
                placeholder="เช่น movies"
                spellCheck={false}
                autoCapitalize="off"
              />
              <small className="field-help">
                ลิงก์หน้าร้าน: /products?category={draft.id || "…"} · ใช้ a-z 0-9 และขีด (-)
              </small>
              {slugChanged && category && category.count > 0 && (
                <small className="field-help category-slug-warning" role="note">
                  สินค้า {category.count} ชิ้นจะย้ายไปรหัสใหม่พร้อมกัน ลิงก์เดิม /products?category={category.id}{" "}
                  จะแสดงสินค้าทั้งหมดแทน
                </small>
              )}
            </label>
            <label className="checkbox-label category-hidden-field">
              <input type="checkbox" checked={draft.hidden} onChange={(e) => set({ hidden: e.target.checked })} />
              ซ่อนจากหน้าร้าน <span className="muted">(สินค้าในหมวดยังขายได้ตามปกติ)</span>
            </label>
            <div className="form-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={close}>
                ยกเลิก
              </button>
              <button type="submit" className="button primary" disabled={busy}>
                {busy && <LoaderCircle className="spin" size={15} />}
                {category ? "บันทึก" : "เพิ่มหมวด"}
              </button>
            </div>
          </form>
        </section>
      </div>
      <ImageLibraryDialog
        open={picking}
        onClose={() => setPicking(false)}
        hint="เลือกรูปเป็นไอคอนหมวด แสดงบนชิปหมวดและแถวหมวดหน้าแรก"
        onPick={(item) => {
          set({ icon: item.slug });
          setPicking(false);
        }}
      />
    </>
  );
}

function CategoryDelete({
  category,
  others,
  onClose,
  onDone,
}: {
  category: AdminCategory;
  others: AdminCategory[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy) onClose();
  };
  useDialog(true, ".category-delete-dialog", close);
  const used = category.count;
  async function run() {
    setBusy(true);
    setError("");
    try {
      const query = used ? "?moveTo=" + encodeURIComponent(target) : "";
      const result = await api<{ moved: number }>(
        "/admin/categories/" + encodeURIComponent(category.id) + query,
        undefined,
        "DELETE",
      );
      const to = others.find((c) => c.id === target)?.name ?? target;
      await onDone(
        result.moved
          ? `ย้ายสินค้า ${result.moved} ชิ้นไปหมวด ${to} แล้วลบหมวด ${category.name}`
          : "ลบหมวด " + category.name + " แล้ว",
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="reference-modal-backdrop" onClick={close}>
      <section
        className="reference-import-modal category-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="category-delete-title"
        aria-describedby="category-delete-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reference-card-heading">
          <h2 id="category-delete-title">ลบหมวด {category.name}</h2>
          <button type="button" className="icon-button" aria-label="ปิด" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="category-delete-body">
          <ErrorMessage message={error} />
          {used ? (
            <>
              <p id="category-delete-text">
                หมวดนี้มีสินค้า {used} ชิ้น ต้องย้ายไปหมวดอื่นก่อนลบ ระบบจะย้ายและลบในขั้นตอนเดียว
              </p>
              <label className="field">
                ย้ายสินค้า {used} ชิ้นไปหมวด…
                <select value={target} onChange={(e) => setTarget(e.target.value)} required>
                  <option value="">เลือกหมวดปลายทาง</option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.hidden ? " (ซ่อนอยู่)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p id="category-delete-text">หมวดนี้ไม่มีสินค้า ลบแล้วกู้คืนไม่ได้ แต่สร้างใหม่ได้ทุกเมื่อ</p>
          )}
          <div className="form-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={close}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy || (used > 0 && !target)}
              onClick={() => void run()}
            >
              {busy ? <LoaderCircle className="spin" size={15} /> : used ? <ArrowRightLeft size={15} /> : <Trash2 size={15} />}
              {used ? "ย้ายสินค้าและลบหมวด" : "ลบหมวด"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
