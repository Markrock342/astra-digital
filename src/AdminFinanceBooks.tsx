// การเงิน › ปิดยอดรายวัน / กระทบยอด / ถอนเงิน (server/finance-close.mjs, server/finance-recon.mjs).
// Layout follows the shadcn/ui (MIT, https://github.com/shadcn-ui/ui) "Tasks" data table,
// Card, Tabs, Dialog and Sheet examples, on the admin brand pass (white cards, cool-grey
// background, one brand blue, soft elevation) already used by the other finance pages.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileUp,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Lock,
  Plus,
  Unlink,
  X,
} from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { TestMoneyBanner } from "./AdminDashboard";
import { api, dateTime, money, uploadImage } from "./api";
import { useDialog } from "./dialog";
import { useLive } from "./live";
import "./finance-books.css";

const bangkokToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dayText = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const thaiMonth = (month: string) =>
  new Date(month + "-01T00:00:00Z").toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
const signedMoney = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
/** Baht text → satang (max two decimals), null when it cannot be read. */
const toSatang = (text: string) => {
  const clean = text.replace(/[,\s฿]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};
const requestKey = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "");
const query = (params: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const text = p.toString();
  return text ? "?" + text : "";
};

/** Modal in the shadcn/ui Dialog pattern; children are the form fields. */
function FormDialog({
  title,
  lead,
  submit,
  danger,
  onClose,
  onSubmit,
  children,
  password = true,
}: {
  title: string;
  lead?: ReactNode;
  submit: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>;
  children?: ReactNode;
  password?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDialog(true, ".finance-dialog", () => !busy && onClose());
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(new FormData(e.currentTarget));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="reference-modal-backdrop" onClick={() => !busy && onClose()}>
      <section
        className="reference-import-modal finance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finance-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reference-card-heading">
          <h2 id="finance-dialog-title">{title}</h2>
          <button type="button" className="icon-button" aria-label="ปิด" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={send}>
          {lead && <div className="finance-dialog-lead">{lead}</div>}
          {children}
          {password && (
            <label className="field">
              รหัสผ่านของคุณ (ยืนยัน)
              <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
            </label>
          )}
          <ErrorMessage message={error} />
          <div className="form-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              ยกเลิก
            </button>
            <button className={"button " + (danger ? "danger" : "primary")} disabled={busy}>
              {busy && <LoaderCircle className="spin" size={16} />}
              {submit}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "positive" | "negative" | "warning" }) {
  return (
    <div className={"reference-admin-card" + (tone === "warning" ? " finance-stat-warning" : "")}>
      <small>{label}</small>
      <strong className={tone === "positive" ? "positive" : tone === "negative" ? "finance-negative" : ""}>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

// ================================================================ ปิดยอดรายวัน

type DayRow = {
  day: string;
  status: "OPEN" | "CLOSED" | "CHANGED";
  opening: number;
  paymentsIn: number;
  topupsIn: number;
  refundsOut: number;
  refundsToCredit: number;
  feesOut: number;
  withdrawalsOut: number;
  moneyIn: number;
  moneyOut: number;
  net: number;
  closing: number;
  carried: number;
  creditOpening: number;
  creditIn: number;
  creditOut: number;
  creditClosing: number;
  diff: number;
  live: (Omit<DayRow, "live"> & { net: number }) | null;
  closable: boolean;
  active: boolean;
  closedAt: string | null;
  closedBy: string | null;
  note: string | null;
  adjustments: { delta: number; note: string; at: string; by: string | null }[];
};
type DaySummary = {
  mode: string;
  today: string;
  from: string;
  to: string;
  firstClosed: string | null;
  lastClosed: string | null;
  nextToClose: string | null;
  changedDays: string[];
  openDays: number;
  moneyIn: number;
  moneyOut: number;
};
const dayStatusText = { OPEN: "ยังไม่ปิด", CLOSED: "ปิดแล้ว", CHANGED: "ยอดเปลี่ยนหลังปิด" };

function DayStatus({ row, today }: { row: DayRow; today: string }) {
  if (row.status === "OPEN" && row.day === today) return <span className="status finance-status-today">วันนี้</span>;
  return <span className={"status finance-status-" + row.status.toLowerCase()}>{dayStatusText[row.status]}</span>;
}

function DayLines({ lines, title }: { lines: Pick<DayRow, "paymentsIn" | "topupsIn" | "refundsOut" | "refundsToCredit" | "feesOut" | "withdrawalsOut" | "moneyIn" | "moneyOut">; title?: string }) {
  return (
    <dl className="finance-lines">
      {title && <dt className="finance-lines-title">{title}</dt>}
      <div>
        <dt>รับชำระ</dt>
        <dd className="positive">+{money(lines.paymentsIn)}</dd>
      </div>
      <div>
        <dt>เติมเครดิต</dt>
        <dd className="positive">+{money(lines.topupsIn)}</dd>
      </div>
      <div>
        <dt>
          คืนเงิน
          {lines.refundsToCredit > 0 && <small>เข้าเครดิต {money(lines.refundsToCredit)}</small>}
        </dt>
        <dd>−{money(lines.refundsOut)}</dd>
      </div>
      <div>
        <dt>ค่าธรรมเนียม</dt>
        <dd>−{money(lines.feesOut)}</dd>
      </div>
      <div>
        <dt>ถอนเงิน</dt>
        <dd>−{money(lines.withdrawalsOut)}</dd>
      </div>
      <div className="finance-lines-total">
        <dt>เงินเข้า − เงินออก</dt>
        <dd>{signedMoney(lines.moneyIn - lines.moneyOut)}</dd>
      </div>
    </dl>
  );
}

function DaySheet({
  row,
  summary,
  onClose,
  onDone,
}: {
  row: DayRow;
  summary: DaySummary;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [dialog, setDialog] = useState<"close" | "adjust" | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && !dialog && onClose();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose, dialog]);
  const batchFrom = summary.nextToClose && summary.nextToClose < row.day ? summary.nextToClose : null;
  const batchDays = batchFrom ? Math.round((Date.parse(row.day) - Date.parse(batchFrom)) / 86400000) + 1 : 1;
  return (
    <div className="txn-sheet-layer">
      <button className="txn-sheet-backdrop" aria-label="ปิดรายละเอียด" tabIndex={-1} onClick={onClose} />
      <aside className="txn-sheet finance-day-sheet" role="dialog" aria-modal="true" aria-label={"ยอดวันที่ " + dayText(row.day)}>
        <header>
          <div>
            <small>ปิดยอดรายวัน</small>
            <h2>{dayText(row.day)}</h2>
          </div>
          <button ref={closeRef} className="icon-button" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="txn-sheet-body">
          <div className="txn-sheet-amount">
            <strong>{money(row.closing)}</strong>
            <DayStatus row={row} today={summary.today} />
          </div>
          {row.status === "CHANGED" && row.live && (
            <div className="admin-callout warning finance-changed" role="alert">
              <strong>
                <AlertTriangle size={15} /> ยอดเปลี่ยนหลังปิด {signedMoney(row.diff)}
              </strong>
              <span>มีรายการของวันนี้เพิ่มหรือเปลี่ยนหลังกดปิดยอด ยอดที่ปิดไว้ไม่ถูกแก้ ให้กด “บันทึกปรับปรุง” เพื่อลงยอดต่าง</span>
            </div>
          )}
          <dl className="finance-lines">
            <div>
              <dt>ยอดยกมา</dt>
              <dd>{money(row.opening)}</dd>
            </div>
          </dl>
          <DayLines lines={row} title={row.status === "OPEN" ? "รายการของวัน" : "ยอดตอนปิด"} />
          {row.status === "CHANGED" && row.live && <DayLines lines={row.live} title="ยอดตอนนี้" />}
          <dl className="finance-lines">
            {row.carried !== 0 && (
              <div>
                <dt>
                  ปรับปรุงจากวันก่อน
                  <small>บันทึกหลังวันนี้ปิดแล้ว</small>
                </dt>
                <dd>{signedMoney(row.carried)}</dd>
              </div>
            )}
            <div className="finance-lines-total">
              <dt>คงเหลือ</dt>
              <dd>{money(row.closing)}</dd>
            </div>
          </dl>
          <h3>เครดิตลูกค้า (หนี้สิน แยกจากเงินร้าน)</h3>
          <dl className="finance-lines">
            <div>
              <dt>ยกมา</dt>
              <dd>{money(row.creditOpening)}</dd>
            </div>
            <div>
              <dt>เข้า (เติม คืนเข้าเครดิต เพิ่มโดยแอดมิน)</dt>
              <dd>+{money(row.creditIn)}</dd>
            </div>
            <div>
              <dt>ออก (ซื้อของ หักโดยแอดมิน)</dt>
              <dd>−{money(row.creditOut)}</dd>
            </div>
            <div className="finance-lines-total">
              <dt>เครดิตคงค้าง</dt>
              <dd>{money(row.creditClosing)}</dd>
            </div>
          </dl>
          {row.closedAt && (
            <>
              <h3>ประวัติ</h3>
              <ol className="admin-timeline">
                <li>
                  <strong>
                    ปิดยอด{row.note ? " · " + row.note : ""}
                  </strong>
                  <time>
                    {row.closedBy ? row.closedBy + " · " : ""}
                    {dateTime(row.closedAt)}
                  </time>
                </li>
                {row.adjustments.map((a, i) => (
                  <li key={i}>
                    <strong>
                      บันทึกปรับปรุง {signedMoney(a.delta)} · {a.note}
                    </strong>
                    <time>
                      {a.by ? a.by + " · " : ""}
                      {dateTime(a.at)}
                    </time>
                  </li>
                ))}
              </ol>
            </>
          )}
          <div className="finance-sheet-actions">
            {row.closable && (
              <button className="button primary" onClick={() => setDialog("close")}>
                <Lock size={15} />
                {batchFrom ? `ปิดยอดถึงวันนี้ (${batchDays} วัน)` : "ปิดยอด"}
              </button>
            )}
            {row.status === "OPEN" && !row.closable && row.day < summary.today && summary.lastClosed && row.day < summary.lastClosed && (
              <p className="field-help">วันนี้อยู่ก่อนวันแรกที่ปิดยอด ({dayText(summary.firstClosed ?? summary.lastClosed)}) จึงไม่ต้องปิด</p>
            )}
            {row.day === summary.today && <p className="field-help">ปิดยอดได้เมื่อจบวันแล้ว</p>}
            {row.status === "CHANGED" && (
              <button className="button primary" onClick={() => setDialog("adjust")}>
                บันทึกปรับปรุง {signedMoney(row.diff)}
              </button>
            )}
          </div>
        </div>
      </aside>
      {dialog === "close" && (
        <FormDialog
          title={"ปิดยอดวันที่ " + dayText(row.day)}
          lead={
            <>
              <p>
                {batchFrom
                  ? `จะปิดตั้งแต่ ${dayText(batchFrom)} ถึง ${dayText(row.day)} รวม ${batchDays} วัน ตามลำดับ`
                  : "บันทึกยอดของวันนี้ไว้ถาวร แก้หรือลบไม่ได้"}
              </p>
              <p>
                คงเหลือ <strong>{money(row.closing)}</strong> · เงินเข้า {money(row.moneyIn)} · เงินออก {money(row.moneyOut)}
              </p>
            </>
          }
          submit="ยืนยันปิดยอด"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            await api("/admin/finance/days/close", {
              day: row.day,
              note: String(form.get("note") ?? ""),
              currentPassword: String(form.get("currentPassword") ?? ""),
            });
            setDialog(null);
            onDone("ปิดยอดวันที่ " + dayText(row.day) + " แล้ว");
          }}
        >
          <label className="field">
            หมายเหตุ (ไม่บังคับ)
            <input name="note" maxLength={300} placeholder="เช่น ตรวจกับ statement แล้ว" />
          </label>
        </FormDialog>
      )}
      {dialog === "adjust" && (
        <FormDialog
          title={"บันทึกปรับปรุง " + dayText(row.day)}
          lead={
            <p>
              ยอดของวันนี้ต่างจากตอนปิด <strong>{signedMoney(row.diff)}</strong> ระบบจะเพิ่มรายการปรับปรุงใหม่
              ยอดที่ปิดไว้ยังอยู่ และยอดยกมาของวันถัดไปจะรวมยอดต่างนี้
            </p>
          }
          submit="บันทึกปรับปรุง"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            await api("/admin/finance/days/adjust", {
              day: row.day,
              note: String(form.get("note") ?? ""),
              currentPassword: String(form.get("currentPassword") ?? ""),
            });
            setDialog(null);
            onDone("บันทึกปรับปรุงแล้ว");
          }}
        >
          <label className="field">
            เหตุผล
            <input name="note" required minLength={3} maxLength={300} placeholder="เช่น คืนเงินลูกค้าย้อนหลัง" />
          </label>
        </FormDialog>
      )}
    </div>
  );
}

export function AdminDailyClose() {
  const { toast } = useStore();
  const [range, setRange] = useState(30);
  const [data, setData] = useState<{ days: DayRow[]; summary: DaySummary } | null>(null);
  const [error, setError] = useState("");
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [tick, setTick] = useState(0);
  useLive(["orders", "customers"], () => setTick((n) => n + 1));
  const today = bangkokToday();
  const from = addDays(today, -(range - 1));
  useEffect(() => {
    api<{ days: DayRow[]; summary: DaySummary }>("/admin/finance/days" + query({ from, to: today }))
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [from, today, tick]);
  const summary = data?.summary;
  const open = data?.days.find((d) => d.day === openDay) ?? null;
  // Empty, unclosed days add nothing to check; they are hidden unless asked for.
  const shown = data?.days.filter((d) => showEmpty || d.active || d.status !== "OPEN" || d.day === today) ?? [];
  const hidden = (data?.days.length ?? 0) - shown.length;
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>ปิดยอดรายวัน</h1>
          <p>ยอดยกมา + เงินเข้า − เงินออก = คงเหลือ ของแต่ละวัน (เวลาไทย) ตรวจแล้วกดปิดยอด ยอดที่ปิดแก้ไม่ได้</p>
        </div>
        <a className="button secondary" href={"/api/admin/finance/days" + query({ from, to: today, format: "csv" })}>
          <Download size={15} />
          ดาวน์โหลด CSV
        </a>
      </div>
      <TestMoneyBanner />
      {summary && summary.changedDays.length > 0 && (
        <div className="admin-callout warning finance-changed" role="alert">
          <strong>
            <AlertTriangle size={15} /> ยอดเปลี่ยนหลังปิด {summary.changedDays.length} วัน
          </strong>
          <span>
            {summary.changedDays.map(dayText).join(", ")} — เปิดวันนั้นแล้วกด “บันทึกปรับปรุง”
          </span>
        </div>
      )}
      <div className="admin-stat-row finance-stats">
        <Stat
          label="ปิดยอดล่าสุด"
          value={summary ? (summary.lastClosed ? dayText(summary.lastClosed) : "ยังไม่เคยปิด") : "–"}
          hint={summary?.nextToClose ? "วันถัดไปที่ต้องปิด " + dayText(summary.nextToClose) : "ปิดได้ถึงเมื่อวาน"}
        />
        <Stat
          label="วันที่ยังไม่ปิด"
          value={summary ? summary.openDays + " วัน" : "–"}
          hint="นับเฉพาะวันที่มีรายการ"
          tone={summary && summary.openDays > 0 ? "warning" : undefined}
        />
        <Stat label={"เงินเข้า " + range + " วัน"} value={summary ? money(summary.moneyIn) : "–"} tone="positive" hint="รับชำระ เติมเครดิต" />
        <Stat label={"เงินออก " + range + " วัน"} value={summary ? money(summary.moneyOut) : "–"} hint="คืนเงิน ค่าธรรมเนียม ถอน" />
      </div>
      <div className="finance-toolbar">
        <div className="reference-status-tabs" role="group" aria-label="ช่วงเวลา">
          {[7, 30, 90].map((n) => (
            <button key={n} className={range === n ? "active" : ""} onClick={() => setRange(n)}>
              {n} วัน
            </button>
          ))}
        </div>
        <label className="finance-check">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          แสดงวันที่ไม่มีรายการ{!showEmpty && hidden > 0 ? ` (${hidden} วัน)` : ""}
        </label>
      </div>
      <ErrorMessage message={error} />
      <div className="table-scroll reference-table admin-list-table finance-day-table">
        <table>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>สถานะ</th>
              <th className="num">ยกมา</th>
              <th className="num">เงินเข้า</th>
              <th className="num">เงินออก</th>
              <th className="num">คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={row.day}
                className={"admin-row-link" + (openDay === row.day ? " is-open" : "") + (row.status === "CHANGED" ? " finance-row-changed" : "")}
                tabIndex={0}
                aria-label={"ดูยอดวันที่ " + dayText(row.day)}
                onClick={() => setOpenDay(row.day)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenDay(row.day);
                  }
                }}
              >
                <td className="nowrap">{dayText(row.day)}</td>
                <td>
                  <DayStatus row={row} today={today} />
                  {row.status === "CHANGED" && <small className="finance-diff">ต่าง {signedMoney(row.diff)}</small>}
                </td>
                <td className="num">{money(row.opening)}</td>
                <td className="num positive">{row.moneyIn ? "+" + money(row.moneyIn) : money(0)}</td>
                <td className="num">{row.moneyOut ? "−" + money(row.moneyOut) : money(0)}</td>
                <td className="num">
                  <strong>{money(row.closing)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
      </div>
      <p className="field-help finance-footnote">
        คืนเงินนับเป็นเงินออกทั้งคืนเข้าเครดิตและโอนคืน (ตรงกับยอดขายสุทธิในแดชบอร์ด) · เครดิตลูกค้าแสดงแยกเป็นหนี้สินในรายละเอียดของแต่ละวัน
      </p>
      {open && summary && (
        <DaySheet
          row={open}
          summary={summary}
          onClose={() => setOpenDay(null)}
          onDone={(message) => {
            toast(message);
            setTick((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

// ================================================================ ถอนเงิน

type Withdrawal = {
  id: string;
  day: string;
  amount: number;
  bank: string;
  account: string;
  reference: string | null;
  hasProof: boolean;
  note: string | null;
  actor: string | null;
  createdAt: string;
  reversed: { id: string; reason: string; at: string; by: string | null } | null;
};
type WithdrawalSummary = {
  mode: string;
  withdrawn: number;
  reversed: number;
  net: number;
  count: number;
  byMonth: { month: string; net: number; count: number }[];
  firstClosed: string | null;
  today: string;
};
const BANKS = ["กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย", "กรุงศรีอยุธยา", "ทหารไทยธนชาต", "ออมสิน", "พร้อมเพย์"];

function periodRange(period: string): { from?: string; to?: string } {
  const today = bangkokToday();
  if (period === "month") return { from: today.slice(0, 8) + "01", to: today };
  if (period === "last-month") {
    const end = addDays(today.slice(0, 8) + "01", -1);
    return { from: end.slice(0, 8) + "01", to: end };
  }
  if (period === "30") return { from: addDays(today, -29), to: today };
  return {};
}

export function AdminWithdrawals() {
  const { toast } = useStore();
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState<{ withdrawals: Withdrawal[]; summary: WithdrawalSummary } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState<Withdrawal | null>(null);
  const range = periodRange(period);
  const params = query({ from: range.from, to: range.to });
  useEffect(() => {
    api<{ withdrawals: Withdrawal[]; summary: WithdrawalSummary }>("/admin/finance/withdrawals" + params)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [params, tick]);
  const summary = data?.summary;
  const periodLabel = { month: "เดือนนี้", "last-month": "เดือนก่อน", "30": "30 วัน", all: "ทั้งหมด" }[period];
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>ถอนเงิน</h1>
          <p>บันทึกเงินที่ร้านโอนออกไปบัญชีธนาคาร ยอดนี้นับเป็นเงินออกในปิดยอดรายวัน บันทึกแล้วแก้ไม่ได้ ถ้าผิดให้กดยกเลิกพร้อมเหตุผล</p>
        </div>
        <div className="finance-heading-actions">
          <a className="button secondary" href={"/api/admin/finance/withdrawals" + query({ from: range.from, to: range.to, format: "csv" })}>
            <Download size={15} />
            CSV
          </a>
          <button className="button primary" onClick={() => setAdding(true)}>
            <Plus size={15} />
            บันทึกการถอน
          </button>
        </div>
      </div>
      <TestMoneyBanner />
      <div className="reference-status-tabs" role="group" aria-label="ช่วงเวลา">
        {(
          [
            ["month", "เดือนนี้"],
            ["last-month", "เดือนก่อน"],
            ["30", "30 วัน"],
            ["all", "ทั้งหมด"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={period === key ? "active" : ""} onClick={() => setPeriod(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="admin-stat-row finance-stats">
        <Stat label={"ถอนสุทธิ " + periodLabel} value={summary ? money(summary.net) : "–"} hint={summary ? summary.count + " รายการ" : undefined} />
        <Stat label="ยอดที่ยกเลิก" value={summary ? money(summary.reversed) : "–"} hint="ยกเลิกแล้วไม่นับเป็นเงินออก" />
        <div className="reference-admin-card finance-months">
          <small>รายเดือน (สุทธิ)</small>
          {summary?.byMonth.length ? (
            <ul>
              {summary.byMonth.slice(0, 4).map((m) => (
                <li key={m.month}>
                  <span>{thaiMonth(m.month)}</span>
                  <strong>{money(m.net)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <strong>–</strong>
          )}
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>วันที่ถอน</th>
              <th>ปลายทาง</th>
              <th>อ้างอิง</th>
              <th>ผู้บันทึก</th>
              <th>สถานะ</th>
              <th className="num">ยอด</th>
              <th aria-label="จัดการ"></th>
            </tr>
          </thead>
          <tbody>
            {data?.withdrawals.map((w) => (
              <tr key={w.id} className={w.reversed ? "finance-row-reversed" : ""}>
                <td className="nowrap">{dayText(w.day)}</td>
                <td>
                  {w.bank}
                  <small>{w.account}</small>
                </td>
                <td>
                  {w.reference ?? "–"}
                  {w.note && <small>{w.note}</small>}
                </td>
                <td>
                  {w.actor ?? "–"}
                  <small>{dateTime(w.createdAt)}</small>
                </td>
                <td>
                  {w.reversed ? (
                    <>
                      <span className="status finance-status-reversed">ยกเลิกแล้ว</span>
                      <small>{w.reversed.reason}</small>
                    </>
                  ) : (
                    <span className="status finance-status-closed">ถอนแล้ว</span>
                  )}
                </td>
                <td className="num">
                  <strong>{money(w.amount)}</strong>
                </td>
                <td className="finance-row-actions">
                  {w.hasProof && (
                    <a className="button ghost" href={"/api/admin/finance/withdrawals/" + w.id + "/proof"} target="_blank" rel="noreferrer">
                      <ImageIcon size={14} />
                      หลักฐาน
                    </a>
                  )}
                  {!w.reversed && (
                    <button className="button ghost" onClick={() => setReversing(w)}>
                      ยกเลิก
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
        {data?.withdrawals.length === 0 && <p className="reference-empty-text">ยังไม่มีการถอนเงินในช่วงนี้</p>}
      </div>
      {adding && summary && (
        <WithdrawalForm
          summary={summary}
          onClose={() => setAdding(false)}
          onDone={(closed) => {
            setAdding(false);
            toast(closed ? "บันทึกแล้ว วันนั้นปิดยอดไปแล้ว จะขึ้นว่ายอดเปลี่ยนหลังปิด" : "บันทึกการถอนแล้ว");
            setTick((n) => n + 1);
          }}
        />
      )}
      {reversing && (
        <FormDialog
          title="ยกเลิกรายการถอน"
          danger
          lead={
            <p>
              {dayText(reversing.day)} · {reversing.bank} {reversing.account} · <strong>{money(reversing.amount)}</strong>
              <br />
              ระบบจะเพิ่มรายการยกเลิก (ไม่ลบของเดิม) ยอดเงินออกของวันนั้นจะลดลง
            </p>
          }
          submit="ยืนยันยกเลิก"
          onClose={() => setReversing(null)}
          onSubmit={async (form) => {
            const result = await api<{ closedDay: boolean }>("/admin/finance/withdrawals/" + reversing.id + "/reverse", {
              reason: String(form.get("reason") ?? ""),
              currentPassword: String(form.get("currentPassword") ?? ""),
            });
            setReversing(null);
            toast(result.closedDay ? "ยกเลิกแล้ว วันนั้นปิดยอดไปแล้ว จะขึ้นว่ายอดเปลี่ยนหลังปิด" : "ยกเลิกรายการถอนแล้ว");
            setTick((n) => n + 1);
          }}
        >
          <label className="field">
            เหตุผลที่ยกเลิก
            <input name="reason" required minLength={3} maxLength={300} placeholder="เช่น บันทึกซ้ำ" />
          </label>
        </FormDialog>
      )}
    </>
  );
}

function WithdrawalForm({ summary, onClose, onDone }: { summary: WithdrawalSummary; onClose: () => void; onDone: (closedDay: boolean) => void }) {
  const key = useMemo(requestKey, []);
  const [proof, setProof] = useState<File | null>(null);
  return (
    <FormDialog
      title="บันทึกการถอนเงิน"
      lead={<p>เงินที่ร้านโอนออกไปบัญชีธนาคารของร้านหรือเจ้าของ เก็บเลขบัญชีเฉพาะ 4 ตัวท้าย</p>}
      submit="บันทึก"
      onClose={onClose}
      onSubmit={async (form) => {
        const amount = toSatang(String(form.get("amount") ?? ""));
        if (!amount) throw new Error("กรุณากรอกยอดถอนเป็นตัวเลข เช่น 1500 หรือ 1500.50");
        let proofKey: string | undefined;
        if (proof) {
          if (proof.size > 2 * 1024 * 1024) throw new Error("ไฟล์หลักฐานใหญ่เกิน 2 MB");
          proofKey = (await uploadImage<{ proofKey: string }>("/admin/finance/withdrawals/proof", proof, proof.type)).proofKey;
        }
        const result = await api<{ closedDay: boolean }>("/admin/finance/withdrawals", {
          amount,
          day: String(form.get("day") ?? ""),
          bank: String(form.get("bank") ?? ""),
          account: String(form.get("account") ?? ""),
          reference: String(form.get("reference") ?? ""),
          note: String(form.get("note") ?? ""),
          proofKey,
          requestKey: key,
          currentPassword: String(form.get("currentPassword") ?? ""),
        });
        onDone(result.closedDay);
      }}
    >
      <div className="finance-form-grid">
        <label className="field">
          ยอดถอน (บาท)
          <input name="amount" inputMode="decimal" required placeholder="0.00" autoComplete="off" />
        </label>
        <label className="field">
          วันที่ถอน
          <input name="day" type="date" required defaultValue={summary.today} max={summary.today} min={summary.firstClosed ?? undefined} />
        </label>
        <label className="field">
          ธนาคารปลายทาง
          <input name="bank" required minLength={2} maxLength={60} list="finance-banks" placeholder="เช่น กสิกรไทย" />
          <datalist id="finance-banks">
            {BANKS.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label className="field">
          เลขบัญชีปลายทาง
          <input name="account" required inputMode="numeric" maxLength={30} placeholder="เก็บแค่ 4 ตัวท้าย" autoComplete="off" />
        </label>
        <label className="field">
          เลขอ้างอิงการโอน (ไม่บังคับ)
          <input name="reference" maxLength={80} autoComplete="off" />
        </label>
        <label className="field">
          หลักฐาน (รูป ไม่บังคับ)
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <label className="field">
        หมายเหตุ (ไม่บังคับ)
        <input name="note" maxLength={300} />
      </label>
    </FormDialog>
  );
}

// ================================================================ กระทบยอด

type ReconStatus = "MATCHED" | "MISMATCH" | "STATEMENT_ONLY" | "SYSTEM_ONLY";
type ReconCounts = Record<ReconStatus, { count: number; amount: number }>;
type ReconRun = {
  id: string;
  filename: string;
  createdAt: string;
  createdBy: string | null;
  dayFrom: string;
  dayTo: string;
  windowMinutes: number;
  rowCount: number;
  skipped: number;
  invalid: number;
  invalidSamples: { line: number; error: string }[];
  completed: { at: string; by: string | null; note: string | null } | null;
  counts: ReconCounts;
};
type ReconPayment = { id: string; amount: number; at: string; provider: string; reference: string | null; orderId: string | null; customer: string | null };
type ReconRow = {
  id: string;
  line: number;
  at: string;
  hasTime: boolean;
  amount: number;
  fee: number;
  reference: string | null;
  status: ReconStatus;
  method: string | null;
  note: string | null;
  matchedBy: string | null;
  flag: string | null;
  payment: ReconPayment | null;
  diff: number | null;
};
type ReconDetail = {
  run: ReconRun;
  rows: ReconRow[];
  total: number;
  offset: number;
  systemOnly: ReconPayment[];
  history: { action: string; line: number | null; paymentId: string | null; note: string | null; by: string | null; at: string }[];
};
const reconText: Record<ReconStatus, string> = {
  MATCHED: "ตรงกัน",
  MISMATCH: "ยอดไม่ตรง",
  STATEMENT_ONLY: "เงินเข้าแต่ไม่มีในระบบ",
  SYSTEM_ONLY: "มีในระบบแต่ไม่มีในรายงาน",
};
const methodText: Record<string, string> = { REFERENCE: "เลขอ้างอิง", AMOUNT_TIME: "ยอด + เวลา", MANUAL: "จับคู่เอง" };
const shortId = (id: string) => "#" + id.slice(0, 8).toUpperCase();
const statementTime = (row: { at: string; hasTime: boolean }) =>
  row.hasTime ? dateTime(row.at) : dayText(new Date(Date.parse(row.at.replace(" ", "T") + "Z") + 7 * 3600000).toISOString().slice(0, 10));

function ReconStats({ counts, active, onPick }: { counts: ReconCounts; active?: string; onPick?: (s: ReconStatus) => void }) {
  return (
    <div className="admin-stat-row finance-stats recon-stats">
      {(Object.keys(reconText) as ReconStatus[]).map((s) => (
        <button
          key={s}
          type="button"
          className={"reference-admin-card recon-stat recon-stat-" + s.toLowerCase() + (active === s ? " is-active" : "")}
          onClick={() => onPick?.(s)}
          aria-pressed={active === s}
        >
          <small>{reconText[s]}</small>
          <strong>{counts[s].count.toLocaleString("th-TH")}</strong>
          <small>{money(counts[s].amount)}</small>
        </button>
      ))}
    </div>
  );
}

type Preview = { headers: string[]; sample: string[][]; rowCount: number; guess: Record<string, number | null> };

function ReconUpload({ onCreated }: { onCreated: (id: string) => void }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dateOrder, setDateOrder] = useState("DMY");
  const [windowMinutes, setWindowMinutes] = useState("30");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function choose(f: File | undefined) {
    setError("");
    setPreview(null);
    setFile(null);
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError("ไฟล์ใหญ่เกิน 2 MB กรุณาแบ่งไฟล์ตามช่วงวัน");
      return;
    }
    setBusy(true);
    try {
      const text = await f.text();
      const p = await api<Preview>("/admin/finance/reconciliations/preview", { csv: text });
      setFile({ name: f.name, text });
      setPreview(p);
      setMapping(Object.fromEntries(Object.entries(p.guess).map(([k, v]) => [k, v == null ? "" : String(v)])));
    } catch (e) {
      setError((e as Error).message);
      if (input.current) input.current.value = "";
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<ReconDetail>("/admin/finance/reconciliations", {
        filename: file.name,
        csv: file.text,
        mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v === "" ? null : Number(v)])),
        dateOrder,
        windowMinutes: Number(windowMinutes),
      });
      setFile(null);
      setPreview(null);
      if (input.current) input.current.value = "";
      onCreated(result.run.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const columnSelect = (key: string, label: string, required = false) => (
    <label className="field">
      {label}
      <select aria-label={label} value={mapping[key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}>
        <option value="">{required ? "เลือกคอลัมน์" : "ไม่มี"}</option>
        {preview?.headers.map((h, i) => (
          <option key={i} value={String(i)}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="reference-admin-card recon-upload">
      <div className="reference-card-heading">
        <h2>เริ่มกระทบยอดใหม่</h2>
      </div>
      <p className="field-help">
        ไฟล์ CSV จากผู้ให้บริการรับชำระเงินหรือ statement ธนาคาร ไม่เกิน 2 MB / 10,000 แถว แถวเงินออก (ยอดติดลบหรือว่าง) ระบบข้ามให้
      </p>
      <label className="recon-file">
        <FileUp size={18} />
        <span>{busy && !preview ? "กำลังอ่านไฟล์…" : file ? file.name : "เลือกไฟล์ CSV"}</span>
        <input ref={input} type="file" accept=".csv,text/csv" aria-label="ไฟล์ CSV" onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      {preview && (
        <>
          <p className="field-help">
            พบ {preview.rowCount.toLocaleString("th-TH")} แถว เลือกว่าคอลัมน์ไหนคืออะไร (ระบบเดาให้จากหัวตาราง)
          </p>
          <div className="recon-mapping">
            {columnSelect("date", "วันที่", true)}
            {columnSelect("time", "เวลา (ถ้าแยกคอลัมน์)")}
            {columnSelect("amount", "ยอดเงินเข้า", true)}
            {columnSelect("fee", "ค่าธรรมเนียม")}
            {columnSelect("reference", "เลขอ้างอิง")}
            <label className="field">
              รูปแบบวันที่
              <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value)}>
                <option value="DMY">วัน/เดือน/ปี</option>
                <option value="MDY">เดือน/วัน/ปี</option>
              </select>
            </label>
            <label className="field">
              เวลาห่างกันได้ไม่เกิน
              <select value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)}>
                <option value="10">10 นาที</option>
                <option value="30">30 นาที</option>
                <option value="60">1 ชั่วโมง</option>
                <option value="180">3 ชั่วโมง</option>
                <option value="1440">1 วัน</option>
              </select>
            </label>
          </div>
          <div className="table-scroll reference-table recon-preview">
            <table>
              <thead>
                <tr>
                  {preview.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={busy || mapping.date === "" || mapping.amount === ""} onClick={start}>
              {busy && <LoaderCircle className="spin" size={16} />}
              เริ่มกระทบยอด
            </button>
          </div>
        </>
      )}
      <ErrorMessage message={error} />
    </section>
  );
}

function MatchDialog({ row, candidates, runId, onClose, onDone }: { row: ReconRow; candidates: ReconPayment[]; runId: string; onClose: () => void; onDone: () => void }) {
  const rowMs = Date.parse(row.at.replace(" ", "T") + "Z");
  const sorted = [...candidates]
    .sort(
      (a, b) =>
        Math.abs(a.amount - row.amount) - Math.abs(b.amount - row.amount) ||
        Math.abs(Date.parse(a.at.replace(" ", "T") + "Z") - rowMs) - Math.abs(Date.parse(b.at.replace(" ", "T") + "Z") - rowMs),
    )
    .slice(0, 30);
  return (
    <FormDialog
      title={"จับคู่แถวที่ " + row.line}
      password={false}
      lead={
        <p>
          {statementTime(row)} · <strong>{money(row.amount)}</strong>
          {row.reference ? " · " + row.reference : ""}
        </p>
      }
      submit="จับคู่"
      onClose={onClose}
      onSubmit={async (form) => {
        const typed = String(form.get("typed") ?? "").trim();
        const picked = String(form.get("payment") ?? "");
        const paymentId = typed || picked;
        if (!paymentId) throw new Error("กรุณาเลือกรายการชำระ");
        await api("/admin/finance/reconciliations/" + runId + "/match", { rowId: row.id, paymentId, note: String(form.get("note") ?? "") });
        onDone();
      }}
    >
      <fieldset className="recon-candidates">
        <legend>รายการชำระในระบบที่ยังไม่มีคู่</legend>
        {sorted.length ? (
          sorted.map((p) => (
            <label key={p.id} className="recon-candidate">
              <input type="radio" name="payment" value={p.id} />
              <span>
                <strong>{money(p.amount)}</strong>
                <small>
                  {dateTime(p.at)} · {p.orderId ? "ออเดอร์ " + shortId(p.orderId) : shortId(p.id)}
                  {p.customer ? " · " + p.customer : ""}
                </small>
              </span>
              {p.amount === row.amount && <span className="status finance-status-closed">ยอดตรง</span>}
            </label>
          ))
        ) : (
          <p className="field-help">ไม่มีรายการที่ยังไม่มีคู่ในช่วงวันของไฟล์</p>
        )}
      </fieldset>
      <label className="field">
        หรือพิมพ์เลขรายการชำระ / เลขออเดอร์
        <input name="typed" maxLength={200} autoComplete="off" />
      </label>
      <label className="field">
        หมายเหตุ (บังคับ)
        <input name="note" required minLength={3} maxLength={300} placeholder="เช่น ลูกค้าแจ้งสลิปในแชท" />
      </label>
    </FormDialog>
  );
}

function ReconRunView({ id, onBack }: { id: string; onBack: () => void }) {
  const { toast } = useStore();
  const [status, setStatus] = useState<ReconStatus | "">("");
  const [detail, setDetail] = useState<ReconDetail | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [matching, setMatching] = useState<ReconRow | null>(null);
  const [unmatching, setUnmatching] = useState<ReconRow | null>(null);
  const [completing, setCompleting] = useState(false);
  const [extra, setExtra] = useState<ReconRow[]>([]);
  useEffect(() => {
    setExtra([]);
    api<ReconDetail>("/admin/finance/reconciliations/" + id + query({ status }))
      .then((d) => {
        setDetail(d);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [id, status, tick]);
  const run = detail?.run;
  const rows = detail ? [...detail.rows, ...extra] : [];
  const done = () => setTick((n) => n + 1);
  async function more() {
    if (!detail) return;
    const next = await api<ReconDetail>("/admin/finance/reconciliations/" + id + query({ status, offset: String(rows.length) }));
    setExtra((x) => [...x, ...next.rows]);
  }
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <button className="button ghost recon-back" onClick={onBack}>
            <ArrowLeft size={15} />
            รอบกระทบยอดทั้งหมด
          </button>
          <h1>{run?.filename ?? "กำลังโหลด…"}</h1>
          {run && (
            <p>
              {dayText(run.dayFrom)}
              {run.dayTo !== run.dayFrom ? " – " + dayText(run.dayTo) : ""} · {run.rowCount.toLocaleString("th-TH")} แถวเงินเข้า
              {run.skipped ? ` · ข้าม ${run.skipped} แถว (เงินออก/ว่าง)` : ""}
              {run.invalid ? ` · อ่านไม่ได้ ${run.invalid} แถว` : ""} · เวลาห่างได้ {run.windowMinutes >= 1440 ? "1 วัน" : run.windowMinutes + " นาที"}
            </p>
          )}
        </div>
        <div className="finance-heading-actions">
          <a className="button secondary" href={"/api/admin/finance/reconciliations/" + id + "?format=csv"}>
            <Download size={15} />
            CSV
          </a>
          {run && !run.completed && (
            <button className="button primary" onClick={() => setCompleting(true)}>
              <CheckCircle2 size={15} />
              ตรวจเสร็จ
            </button>
          )}
        </div>
      </div>
      <ErrorMessage message={error} />
      {run?.completed && (
        <p className="admin-callout recon-done" role="status">
          ตรวจเสร็จแล้ว {run.completed.by ? "โดย " + run.completed.by + " " : ""}
          {dateTime(run.completed.at)}
          {run.completed.note ? " · " + run.completed.note : ""} — แก้การจับคู่ไม่ได้แล้ว
        </p>
      )}
      {run && run.invalidSamples.length > 0 && (
        <p className="admin-callout warning">
          แถวที่อ่านไม่ได้: {run.invalidSamples.slice(0, 5).map((s) => "แถว " + s.line + " " + s.error).join(", ")}
          {run.invalid > 5 ? " …" : ""}
        </p>
      )}
      {run && <ReconStats counts={run.counts} active={status} onPick={(s) => setStatus((cur) => (cur === s ? "" : s))} />}
      <div className="reference-status-tabs" role="group" aria-label="สถานะ">
        <button className={status === "" ? "active" : ""} onClick={() => setStatus("")}>
          ทุกแถวในไฟล์
        </button>
        {(Object.keys(reconText) as ReconStatus[]).map((s) => (
          <button key={s} className={status === s ? "active" : ""} onClick={() => setStatus(s)}>
            {reconText[s]}
          </button>
        ))}
      </div>
      {status === "SYSTEM_ONLY" ? (
        <div className="table-scroll reference-table admin-list-table">
          <table>
            <thead>
              <tr>
                <th>เวลาชำระ</th>
                <th>ออเดอร์</th>
                <th>ลูกค้า</th>
                <th>อ้างอิงผู้ให้บริการ</th>
                <th className="num">ยอด</th>
              </tr>
            </thead>
            <tbody>
              {detail?.systemOnly.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{dateTime(p.at)}</td>
                  <td>{p.orderId ? shortId(p.orderId) : "–"}</td>
                  <td>{p.customer ?? "–"}</td>
                  <td className="recon-ref">{p.reference ?? "–"}</td>
                  <td className="num">
                    <strong>{money(p.amount)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail?.systemOnly.length === 0 && <p className="reference-empty-text">ทุกรายการชำระในช่วงนี้มีในรายงานแล้ว</p>}
        </div>
      ) : (
        <div className="table-scroll reference-table admin-list-table recon-table">
          <table>
            <thead>
              <tr>
                <th>แถว</th>
                <th>เวลาในไฟล์</th>
                <th>อ้างอิงในไฟล์</th>
                <th>สถานะ</th>
                <th>รายการในระบบ</th>
                <th className="num">ยอด</th>
                <th aria-label="จัดการ"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.line}</td>
                  <td className="nowrap">{statementTime(r)}</td>
                  <td className="recon-ref">{r.reference ?? "–"}</td>
                  <td>
                    <span className={"status recon-status-" + r.status.toLowerCase()}>{reconText[r.status]}</span>
                    {r.method && <small>{methodText[r.method] ?? r.method}</small>}
                    {r.flag && <small className="recon-flag">{r.flag}</small>}
                    {r.note && <small>หมายเหตุ: {r.note}</small>}
                  </td>
                  <td>
                    {r.payment ? (
                      <>
                        {r.payment.orderId ? "ออเดอร์ " + shortId(r.payment.orderId) : shortId(r.payment.id)}
                        <small>
                          {dateTime(r.payment.at)} · {money(r.payment.amount)}
                        </small>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="num">
                    <strong>{money(r.amount)}</strong>
                    {r.fee > 0 && <small>ค่าธรรมเนียม {money(r.fee)}</small>}
                    {r.diff != null && r.diff !== 0 && <small className="finance-diff">ต่าง {signedMoney(r.diff)}</small>}
                  </td>
                  <td className="finance-row-actions">
                    {!run?.completed &&
                      (r.status === "STATEMENT_ONLY" ? (
                        <button className="button ghost" onClick={() => setMatching(r)}>
                          <Link2 size={14} />
                          จับคู่
                        </button>
                      ) : (
                        <button className="button ghost" onClick={() => setUnmatching(r)}>
                          <Unlink size={14} />
                          ยกเลิกคู่
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail && rows.length === 0 && <p className="reference-empty-text">ไม่มีแถวในสถานะนี้</p>}
          {!detail && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
        </div>
      )}
      {detail && status !== "SYSTEM_ONLY" && rows.length < detail.total && (
        <div className="admin-list-footer">
          <span>
            แสดง {rows.length} จาก {detail.total} แถว
          </span>
          <button className="button secondary" onClick={more}>
            โหลดเพิ่ม
          </button>
        </div>
      )}
      {detail && detail.history.length > 0 && (
        <section className="reference-admin-card recon-history">
          <h2>ประวัติการแก้ไข</h2>
          <ol className="admin-timeline">
            {detail.history.map((h, i) => (
              <li key={i}>
                <strong>
                  {h.action === "MATCH" ? "จับคู่" : h.action === "UNMATCH" ? "ยกเลิกคู่" : "ตรวจเสร็จ"}
                  {h.line ? " แถว " + h.line : ""}
                  {h.note ? " · " + h.note : ""}
                </strong>
                <time>
                  {h.by ? h.by + " · " : ""}
                  {dateTime(h.at)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      )}
      {matching && detail && (
        <MatchDialog
          row={matching}
          candidates={detail.systemOnly}
          runId={id}
          onClose={() => setMatching(null)}
          onDone={() => {
            setMatching(null);
            toast("จับคู่แล้ว");
            done();
          }}
        />
      )}
      {unmatching && (
        <FormDialog
          title={"ยกเลิกคู่แถวที่ " + unmatching.line}
          password={false}
          lead={<p>แถวนี้จะกลับไปเป็น “เงินเข้าแต่ไม่มีในระบบ” และรายการชำระจะกลับไปไม่มีคู่ ไม่มีการแก้ออเดอร์หรือการชำระ</p>}
          submit="ยกเลิกคู่"
          danger
          onClose={() => setUnmatching(null)}
          onSubmit={async (form) => {
            await api("/admin/finance/reconciliations/" + id + "/unmatch", { rowId: unmatching.id, note: String(form.get("note") ?? "") });
            setUnmatching(null);
            toast("ยกเลิกคู่แล้ว");
            done();
          }}
        >
          <label className="field">
            เหตุผล (บังคับ)
            <input name="note" required minLength={3} maxLength={300} />
          </label>
        </FormDialog>
      )}
      {completing && run && (
        <FormDialog
          title="ตรวจรอบนี้เสร็จแล้ว"
          password={false}
          lead={
            <p>
              ตรงกัน {run.counts.MATCHED.count} · ยอดไม่ตรง {run.counts.MISMATCH.count} · เงินเข้าแต่ไม่มีในระบบ {run.counts.STATEMENT_ONLY.count} · มีในระบบแต่ไม่มีในรายงาน{" "}
              {run.counts.SYSTEM_ONLY.count} — ปิดรอบแล้วแก้การจับคู่ไม่ได้
            </p>
          }
          submit="ยืนยันตรวจเสร็จ"
          onClose={() => setCompleting(false)}
          onSubmit={async (form) => {
            await api("/admin/finance/reconciliations/" + id + "/complete", { note: String(form.get("note") ?? "") });
            setCompleting(false);
            toast("บันทึกว่าตรวจเสร็จแล้ว");
            done();
          }}
        >
          <label className="field">
            หมายเหตุ (ไม่บังคับ)
            <input name="note" maxLength={300} />
          </label>
        </FormDialog>
      )}
    </>
  );
}

export function AdminReconcile() {
  const [runs, setRuns] = useState<ReconRun[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api<{ runs: ReconRun[] }>("/admin/finance/reconciliations")
      .then((d) => {
        setRuns(d.runs);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [tick, openId]);
  if (openId) return <ReconRunView id={openId} onBack={() => setOpenId(null)} />;
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>กระทบยอด</h1>
          <p>เทียบไฟล์จากผู้ให้บริการรับชำระหรือ statement ธนาคารกับรายการชำระในระบบ ระบบไม่แก้ออเดอร์หรือการชำระให้เอง</p>
        </div>
      </div>
      <TestMoneyBanner />
      <ReconUpload
        onCreated={(id) => {
          setTick((n) => n + 1);
          setOpenId(id);
        }}
      />
      <ErrorMessage message={error} />
      <div className="table-scroll reference-table admin-list-table">
        <table>
          <thead>
            <tr>
              <th>ไฟล์</th>
              <th>ช่วงวัน</th>
              <th className="num">ตรงกัน</th>
              <th className="num">ยอดไม่ตรง</th>
              <th className="num">เงินเข้าไม่มีในระบบ</th>
              <th className="num">ไม่มีในรายงาน</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {runs?.map((r) => (
              <tr
                key={r.id}
                className="admin-row-link"
                tabIndex={0}
                aria-label={"เปิดรอบ " + r.filename}
                onClick={() => setOpenId(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId(r.id);
                  }
                }}
              >
                <td>
                  {r.filename}
                  <small>
                    {r.createdBy ?? "–"} · {dateTime(r.createdAt)}
                  </small>
                </td>
                <td className="nowrap">
                  {dayText(r.dayFrom)}
                  {r.dayTo !== r.dayFrom && <small>ถึง {dayText(r.dayTo)}</small>}
                </td>
                <td className="num">{r.counts.MATCHED.count}</td>
                <td className="num">{r.counts.MISMATCH.count}</td>
                <td className="num">{r.counts.STATEMENT_ONLY.count}</td>
                <td className="num">{r.counts.SYSTEM_ONLY.count}</td>
                <td>
                  {r.completed ? (
                    <span className="status finance-status-closed">ตรวจเสร็จ</span>
                  ) : (
                    <span className="status finance-status-open">กำลังตรวจ</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs?.length === 0 && <p className="reference-empty-text">ยังไม่เคยกระทบยอด</p>}
        {!runs && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
      </div>
    </>
  );
}
