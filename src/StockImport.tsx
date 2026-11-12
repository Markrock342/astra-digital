// Stock import with a per-line check before anything is saved (Sellix
// "serials_remove_duplicates" idea). Table, status tabs and the confirm row follow
// the shadcn/ui data-table pattern (MIT) using the back-office classes.
import { useState, type FormEvent } from "react";
import { ListChecks, LoaderCircle, Plus } from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";

const BATCH = 100;

type Kind = "pair" | "code";
type LineStatus = "ok" | "duplicate_batch" | "existing" | "invalid";
type Entry = { line: number; key: string; loginId?: string; password?: string; code?: string };
type ServerLine = {
  line: number;
  status: LineStatus;
  display: string;
  passwordMasked?: string;
  reason?: string;
  duplicateOf?: number;
};
type PreviewLine = ServerLine & { key: string };
type ImportResult = { imported: number; skipped: number };

const statusText: Record<LineStatus, string> = {
  ok: "พร้อมเพิ่ม",
  duplicate_batch: "ซ้ำในรายการ",
  existing: "มีในระบบแล้ว",
  invalid: "รูปแบบผิด",
};

/** Excel/Sheets paste uses tabs; "id,password", "id:password" and "id password" also work. */
function parseEntries(text: string, kind: Kind): Entry[] {
  const entries: Entry[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const line = index + 1;
    if (kind === "code") {
      entries.push({ line, code: trimmed, key: trimmed });
      return;
    }
    let loginId = trimmed;
    let password = "";
    if (raw.includes("\t")) {
      const [id, ...rest] = raw.split("\t");
      loginId = id.trim();
      password = rest.join("\t").replace(/[\t\r]+$/, "");
    } else {
      const match = trimmed.match(/^([^\t,:\s]+)[\t,:\s]+(.+)$/);
      if (match) {
        loginId = match[1];
        password = match[2].trim();
      }
    }
    entries.push({ line, loginId, password, key: loginId.trim().toLowerCase() });
  });
  return entries;
}

function chunks<T>(items: T[]) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

function body(variantId: string, kind: Kind, chunk: Entry[], extra: Record<string, unknown>) {
  return kind === "pair"
    ? { variantId, items: chunk.map((e) => ({ loginId: e.loginId, password: e.password })), ...extra }
    : { variantId, codes: chunk.map((e) => e.code).join("\n"), ...extra };
}

export function StockImport({
  variantId,
  kind,
  label,
  placeholder,
  onDone,
  onCancel,
}: {
  variantId: string;
  kind: Kind;
  label: string;
  placeholder?: string;
  onDone?: (result: ImportResult) => void;
  onCancel?: () => void;
}) {
  const { toast } = useStore();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);
  const [skip, setSkip] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const entries = parseEntries(text, kind);
  const unit = kind === "pair" ? "บัญชี" : "โค้ด";
  const batches = chunks(entries);

  async function check(e: FormEvent) {
    e.preventDefault();
    if (!entries.length) return;
    setBusy(true);
    setError("");
    try {
      const merged: PreviewLine[] = [];
      for (const [i, chunk] of batches.entries()) {
        if (batches.length > 1) setProgress(`กำลังตรวจชุดที่ ${i + 1}/${batches.length}`);
        const result = await api<{ lines: ServerLine[] }>(
          "/admin/inventory",
          body(variantId, kind, chunk, { dryRun: true }),
        );
        for (const line of result.lines) {
          const entry = chunk[line.line - 1];
          merged.push({
            ...line,
            line: entry.line,
            key: entry.key,
            duplicateOf: line.duplicateOf ? chunk[line.duplicateOf - 1].line : undefined,
          });
        }
      }
      // Each request checks its own 100 lines; repeats across batches are caught here.
      const first = new Map<string, number>();
      for (const line of merged) {
        if (line.status === "invalid") continue;
        const seen = first.get(line.key);
        if (seen === undefined) first.set(line.key, line.line);
        else if (line.status === "ok") {
          line.status = "duplicate_batch";
          line.duplicateOf = seen;
        }
      }
      for (const line of merged)
        if (line.status === "duplicate_batch") line.reason = "ซ้ำกับบรรทัด " + line.duplicateOf;
      setPreview(merged);
      setOnlyProblems(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    let imported = 0;
    let skipped = 0;
    let done = 0;
    try {
      for (const [i, chunk] of batches.entries()) {
        if (batches.length > 1) setProgress(`กำลังเพิ่มชุดที่ ${i + 1}/${batches.length}`);
        const result = await api<ImportResult>(
          "/admin/inventory",
          body(variantId, kind, chunk, skip ? { skipDuplicates: true } : {}),
        );
        imported += result.imported;
        skipped += result.skipped ?? 0;
        done++;
      }
      toast(`นำเข้า ${imported} ${unit}สำเร็จ` + (skipped ? ` · ข้าม ${skipped} รายการที่ซ้ำหรือรูปแบบผิด` : ""));
      setText("");
      setPreview(null);
      onDone?.({ imported, skipped });
    } catch (err) {
      setError(
        (done ? `เพิ่มแล้ว ${imported} ${unit} แล้วหยุดที่ชุดที่ ${done + 1}: ` : "") + (err as Error).message,
      );
      if (done) onDone?.({ imported, skipped });
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  if (preview) {
    const count = (status: LineStatus) => preview.filter((l) => l.status === status).length;
    const ok = count("ok");
    const problems = preview.length - ok;
    const blocked = !skip && problems > 0;
    const shown = onlyProblems ? preview.filter((l) => l.status !== "ok") : preview;
    return (
      <div className="stock-import-preview">
        <div className="stock-import-summary" aria-label="สรุปผลตรวจ">
          {(["ok", "duplicate_batch", "existing", "invalid"] as LineStatus[]).map((status) => (
            <span key={status} className={"import-status import-" + status}>
              {statusText[status]} <strong>{count(status)}</strong>
            </span>
          ))}
        </div>
        <label className="checkbox-label">
          <input type="checkbox" checked={skip} disabled={busy} onChange={(e) => setSkip(e.target.checked)} />
          ข้ามบัญชีซ้ำ
        </label>
        <p className="field-help">
          {skip
            ? "เพิ่มเฉพาะบรรทัดที่ผ่านการตรวจ บรรทัดที่ซ้ำหรือรูปแบบผิดจะถูกข้าม และแจ้งจำนวนหลังเพิ่ม"
            : "ปิดการข้ามอยู่: ถ้ามีบรรทัดที่ซ้ำหรือรูปแบบผิด ระบบจะไม่เพิ่มทั้งชุด"}
        </p>
        <div className="reference-status-tabs" role="group" aria-label="แสดงบรรทัด">
          <button type="button" className={onlyProblems ? "" : "active"} onClick={() => setOnlyProblems(false)}>
            ทั้งหมด {preview.length}
          </button>
          <button type="button" className={onlyProblems ? "active" : ""} onClick={() => setOnlyProblems(true)}>
            มีปัญหา {problems}
          </button>
        </div>
        <div className="table-scroll reference-table admin-list-table stock-import-table">
          <table>
            <thead>
              <tr>
                <th className="num">บรรทัด</th>
                <th>{kind === "pair" ? "ไอดี" : "โค้ด"}</th>
                {kind === "pair" && <th>รหัสผ่าน</th>}
                <th>ผลตรวจ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.line}>
                  <td className="num">{l.line}</td>
                  <td>
                    <code className="stock-import-id">{l.display || "–"}</code>
                  </td>
                  {kind === "pair" && <td>{l.passwordMasked ?? "–"}</td>}
                  <td>
                    <span className={"import-status import-" + l.status}>{statusText[l.status]}</span>
                    {l.status !== "ok" && l.reason && <small>{l.reason}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="reference-empty-text">ไม่มีบรรทัดที่มีปัญหา</p>}
        </div>
        {progress && <p className="admin-callout stock-import-progress">{progress}</p>}
        <ErrorMessage message={error} />
        {blocked && <p className="field-help danger-text">แก้บรรทัดที่มีปัญหา หรือเปิด “ข้ามบัญชีซ้ำ” ก่อนเพิ่ม</p>}
        <div className="form-actions stock-import-actions">
          {onCancel && (
            <button type="button" className="button ghost" disabled={busy} onClick={onCancel}>
              ยกเลิก
            </button>
          )}
          <button type="button" className="button secondary" disabled={busy} onClick={() => setPreview(null)}>
            แก้รายการ
          </button>
          <button type="button" className="button primary" disabled={busy || blocked || !ok} onClick={() => void commit()}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}
            {ok ? `เพิ่ม ${ok} ${unit}` : `ไม่มี${unit}ใหม่ให้เพิ่ม`}
          </button>
        </div>
      </div>
    );
  }

  const missing = kind === "pair" ? entries.filter((e) => !e.password).length : 0;
  return (
    <form onSubmit={check} className="stock-import-form">
      <label className="field">
        {label}
        <textarea
          aria-label={label}
          rows={kind === "pair" ? 5 : 7}
          placeholder={
            placeholder ??
            (kind === "pair"
              ? "user1@mail.com,password1\nuser2@mail.com,password2"
              : "รหัสสินค้าหนึ่งรายการต่อบรรทัด")
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="field-help">
        {kind === "pair"
          ? "วางจาก Excel ได้ (2 คอลัมน์) · คั่นด้วย , หรือ : ก็ได้ · รหัสผ่านเก็บแบบเข้ารหัส ลูกค้าเห็นหลังจ่ายเงินเท่านั้น"
          : "ระบบตรวจโค้ดซ้ำก่อนบันทึก และยังไม่ส่งให้ลูกค้าก่อนยืนยันการชำระเงิน"}
        {entries.length > 0 && ` · พร้อมเติม ${entries.length} ${unit}`}
        {entries.length > BATCH && ` (แบ่งส่ง ${batches.length} ชุด ชุดละ ${BATCH})`}
        {missing > 0 && <strong className="danger-text"> · {missing} บรรทัดไม่มีรหัสผ่าน</strong>}
      </p>
      {progress && <p className="admin-callout stock-import-progress">{progress}</p>}
      <ErrorMessage message={error} />
      <div className="form-actions stock-import-actions">
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            ยกเลิก
          </button>
        )}
        <button className="button primary" disabled={busy || !entries.length}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <ListChecks size={15} />}
          ตรวจ {entries.length || ""} รายการก่อนเติม
        </button>
      </div>
    </form>
  );
}
