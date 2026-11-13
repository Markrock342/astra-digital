// ข้อความสำเร็จรูป (canned replies) for the team chat inbox. API: server/canned-replies.mjs.
// Picker follows the shadcn/ui Command / Combobox pattern (MIT): search, a listbox,
// arrow keys + Enter, Esc closes. Inserting only fills the composer; it never sends.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, LoaderCircle, MessageSquareText, Pencil, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";
import "./canned-replies.css";

export type CannedReply = {
  id: string;
  title: string;
  body: string;
  sort_order: number;
  /** Filled for the open thread (placeholders replaced). */
  text?: string;
  /** Placeholders that had no value for this thread; left as typed. */
  missing?: string[];
};

export const CANNED_PLACEHOLDERS = ["{ชื่อลูกค้า}", "{เลขออเดอร์}"] as const;
const LIMIT = 50;
const BODY_MAX = 1000;
const TITLE_MAX = 60;

/** Thai-friendly contains match on title + body (case-insensitive for Latin text). */
export function matchCanned(list: CannedReply[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((r) => (r.title + "\n" + r.body).toLowerCase().includes(q));
}

/** Loads the replies with placeholders filled for `threadId` each time `open` turns on. */
export function useCannedReplies(threadId: string | null, open: boolean) {
  const [replies, setReplies] = useState<CannedReply[] | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open || !threadId) return;
    let live = true;
    setError("");
    api<{ replies: CannedReply[] }>("/admin/canned-replies?thread=" + encodeURIComponent(threadId))
      .then((r) => live && setReplies(r.replies))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [open, threadId, tick]);
  return { replies, error, reload: () => setTick((n) => n + 1) };
}

/**
 * The listbox above the composer. In "slash" mode the textarea keeps focus and drives
 * the search (keys come from `useCannedKeys`); in "button" mode it has its own search box.
 */
export function CannedReplyPicker({
  mode,
  query,
  onQuery,
  replies,
  error,
  active,
  onActive,
  onPick,
  onClose,
  onManage,
}: {
  mode: "slash" | "button";
  query: string;
  onQuery: (q: string) => void;
  replies: CannedReply[] | null;
  error: string;
  active: number;
  onActive: (i: number) => void;
  onPick: (reply: CannedReply) => void;
  onClose: () => void;
  onManage?: () => void;
}) {
  const shown = useMemo(() => matchCanned(replies ?? [], query), [replies, query]);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode === "button") searchRef.current?.focus();
  }, [mode]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div className="canned-picker" role="dialog" aria-label="ข้อความสำเร็จรูป">
      <div className="canned-picker-head">
        {mode === "button" ? (
          <label className="canned-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              aria-label="ค้นข้อความสำเร็จรูป"
              placeholder="ค้นชื่อหรือข้อความ…"
              value={query}
              role="combobox"
              aria-expanded="true"
              aria-controls="canned-picker-list"
              aria-activedescendant={shown[active] ? "canned-option-" + shown[active].id : undefined}
              onChange={(e) => {
                onQuery(e.target.value);
                onActive(0);
              }}
              onKeyDown={(e) => {
                if (pickerKey(e, shown, active, onActive, onPick, onClose)) e.preventDefault();
              }}
            />
          </label>
        ) : (
          <span className="canned-picker-title">
            <MessageSquareText size={15} aria-hidden="true" />
            ข้อความสำเร็จรูป{query ? ` · “${query}”` : ""}
          </span>
        )}
        <button type="button" className="icon-button" aria-label="ปิดข้อความสำเร็จรูป" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <ErrorMessage message={error} />
      {!replies && !error ? (
        <p className="canned-picker-empty">
          <LoaderCircle className="spin" size={15} /> กำลังโหลด…
        </p>
      ) : replies && !shown.length ? (
        <p className="canned-picker-empty">
          {replies.length ? "ไม่พบข้อความที่ตรงกับคำค้น" : "ยังไม่มีข้อความสำเร็จรูป"}
        </p>
      ) : (
        <ul className="canned-picker-list" id="canned-picker-list" role="listbox" aria-label="เลือกข้อความ" ref={listRef}>
          {shown.map((r, i) => (
            <li
              key={r.id}
              id={"canned-option-" + r.id}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
              onMouseEnter={() => onActive(i)}
              // mousedown keeps focus in the composer (slash mode).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(r)}
            >
              <strong>{r.title}</strong>
              <span>{r.text ?? r.body}</span>
              {!!r.missing?.length && <small>ยังไม่มีข้อมูล {r.missing.join(" ")} แก้ก่อนส่ง</small>}
            </li>
          ))}
        </ul>
      )}
      <div className="canned-picker-foot">
        <span>↑↓ เลือก · Enter ใส่ข้อความ · Esc ปิด</span>
        {onManage && (
          <button type="button" className="button ghost" onClick={onManage}>
            <Settings2 size={14} />
            จัดการ
          </button>
        )}
      </div>
    </div>
  );
}

/** Shared keyboard handling for the picker. Returns true when the key was used. */
export function pickerKey(
  e: KeyboardEvent,
  shown: CannedReply[],
  active: number,
  onActive: (i: number) => void,
  onPick: (r: CannedReply) => void,
  onClose: () => void,
) {
  if (e.nativeEvent.isComposing) return false;
  if (e.key === "ArrowDown") {
    onActive(shown.length ? (active + 1) % shown.length : 0);
    return true;
  }
  if (e.key === "ArrowUp") {
    onActive(shown.length ? (active - 1 + shown.length) % shown.length : 0);
    return true;
  }
  if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
    if (!shown[active]) return e.key === "Enter";
    onPick(shown[active]);
    return true;
  }
  if (e.key === "Escape") {
    onClose();
    return true;
  }
  return false;
}

type Draft = { id: string | null; title: string; body: string };

/** ADMIN: add, edit, delete and order the saved replies. */
export function CannedReplyManager({ onClose }: { onClose: () => void }) {
  const { toast } = useStore();
  const [list, setList] = useState<CannedReply[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  async function load() {
    try {
      setList((await api<{ replies: CannedReply[] }>("/admin/canned-replies")).replies);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    await run(async () => {
      const body = { title: draft.title, body: draft.body };
      if (draft.id) await api("/admin/canned-replies/" + draft.id, body, "PATCH");
      else await api("/admin/canned-replies", body);
      toast(draft.id ? "บันทึกข้อความแล้ว" : "เพิ่มข้อความแล้ว");
      setDraft(null);
      await load();
    });
  }
  async function remove(id: string) {
    await run(async () => {
      await api("/admin/canned-replies/" + id, undefined, "DELETE");
      toast("ลบข้อความแล้ว");
      setDeleting(null);
      await load();
    });
  }
  async function move(index: number, by: -1 | 1) {
    if (!list) return;
    const next = [...list];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    setList(next);
    await run(async () => {
      setList((await api<{ replies: CannedReply[] }>("/admin/canned-replies/reorder", { ids: next.map((r) => r.id) })).replies);
    });
  }
  function insertToken(token: string) {
    if (!draft) return;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? draft.body.length;
    const body = draft.body.slice(0, start) + token + draft.body.slice(end);
    setDraft({ ...draft, body });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  const full = (list?.length ?? 0) >= LIMIT;
  return (
    <div className="reference-modal-backdrop" onClick={() => !busy && onClose()}>
      <section
        className="reference-import-modal canned-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canned-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reference-card-heading">
          <div>
            <h2 id="canned-manager-title">ข้อความสำเร็จรูป</h2>
            <p className="canned-manager-lead">
              ทีมงานกดเลือกใส่ในช่องตอบแชทได้ หรือพิมพ์ / ที่ต้นข้อความ · {list?.length ?? 0}/{LIMIT} ข้อความ
            </p>
          </div>
          <button className="icon-button" aria-label="ปิด" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="canned-manager-body">
          <ErrorMessage message={error} />
          {draft ? (
            <form className="canned-manager-form" onSubmit={save}>
              <label className="field">
                ชื่อข้อความ (ทีมงานเห็นคนเดียว)
                <input
                  value={draft.title}
                  maxLength={TITLE_MAX}
                  required
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>
              <label className="field">
                ข้อความที่ส่งให้ลูกค้า
                <textarea
                  ref={bodyRef}
                  value={draft.body}
                  maxLength={BODY_MAX}
                  required
                  rows={6}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
                <small className="canned-counter">
                  {draft.body.length.toLocaleString("th-TH")}/{BODY_MAX.toLocaleString("th-TH")}
                </small>
              </label>
              <div className="canned-tokens" role="group" aria-label="แทรกข้อมูลอัตโนมัติ">
                <span>แทรกข้อมูลอัตโนมัติ:</span>
                {CANNED_PLACEHOLDERS.map((token) => (
                  <button key={token} type="button" className="admin-chip" onClick={() => insertToken(token)}>
                    {token}
                  </button>
                ))}
              </div>
              <div className="form-actions">
                <button type="button" className="button secondary" disabled={busy} onClick={() => setDraft(null)}>
                  ยกเลิก
                </button>
                <button className="button primary" disabled={busy || !draft.title.trim() || !draft.body.trim()}>
                  {busy && <LoaderCircle className="spin" size={15} />}
                  {draft.id ? "บันทึก" : "เพิ่มข้อความ"}
                </button>
              </div>
            </form>
          ) : (
            <>
              {!list ? (
                <p className="reference-empty-text">กำลังโหลด…</p>
              ) : !list.length ? (
                <p className="reference-empty-text">ยังไม่มีข้อความสำเร็จรูป</p>
              ) : (
                <ol className="canned-manager-list" aria-label="รายการข้อความสำเร็จรูป">
                  {list.map((r, i) => (
                    <li key={r.id}>
                      <div className="canned-manager-text">
                        <strong>{r.title}</strong>
                        <span>{r.body}</span>
                      </div>
                      {deleting === r.id ? (
                        <span className="canned-manager-actions" role="group" aria-label={"ยืนยันลบ " + r.title}>
                          <button type="button" className="button danger" disabled={busy} onClick={() => void remove(r.id)}>
                            ลบเลย
                          </button>
                          <button type="button" className="button secondary" disabled={busy} onClick={() => setDeleting(null)}>
                            ไม่ลบ
                          </button>
                        </span>
                      ) : (
                        <span className="canned-manager-actions">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={"เลื่อนขึ้น " + r.title}
                            disabled={busy || i === 0}
                            onClick={() => void move(i, -1)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={"เลื่อนลง " + r.title}
                            disabled={busy || i === list.length - 1}
                            onClick={() => void move(i, 1)}
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={"แก้ไข " + r.title}
                            disabled={busy}
                            onClick={() => setDraft({ id: r.id, title: r.title, body: r.body })}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={"ลบ " + r.title}
                            disabled={busy}
                            onClick={() => setDeleting(r.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !list || full}
                  onClick={() => setDraft({ id: null, title: "", body: "" })}
                >
                  <Plus size={15} />
                  {full ? `ครบ ${LIMIT} ข้อความแล้ว` : "เพิ่มข้อความ"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
