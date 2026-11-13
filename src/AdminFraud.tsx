// Admin › ลูกค้า › สัญญาณผิดปกติ: list of flagged accounts / networks, review with a note,
// suspend (the normal customer status change), temporary email / domain blocks and the
// rule thresholds. The system only flags; nothing here runs on its own.
// Layout reference: shadcn/ui (MIT, github.com/shadcn-ui/ui) — Tabs, Card, Badge, Switch and
// form inputs — on the admin's existing white-card / cool-grey brand pass (alerts.css).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Ban, CheckCircle2, LoaderCircle, ShieldAlert, ShieldBan, Undo2 } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime } from "./api";
import "./alerts.css";
import "./fraud-templates.css";

type Rule = {
  key: string;
  label: string;
  help: string;
  unit: string;
  max: number;
  enabled: boolean;
  threshold: number;
  windowHours: number;
  defaults: { enabled: boolean; threshold: number; windowHours: number };
};
type Signal = {
  id: string;
  rule: string;
  label: string;
  unit: string;
  value: number;
  threshold: number;
  windowHours: number;
  hits: number;
  status: "OPEN" | "REVIEWED";
  createdAt: string;
  lastAt: string;
  ipMasked: string | null;
  customer: { id: string; name: string | null; email: string | null; status: string; role: string | null } | null;
  accounts: string[];
  reviewedAt: string | null;
  reviewedBy: string | null;
  note: string | null;
};
type Block = {
  id: string;
  kind: "EMAIL" | "DOMAIN";
  value: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string;
  active: boolean;
};
type FraudData = {
  signals: Signal[];
  counts: { open: number; reviewed: number };
  settings: { rules: Rule[]; updatedAt: string | null; maxWindowHours: number };
  blocks: Block[];
  blockMaxHours: number;
};
type Filter = "open" | "reviewed" | "all";

const FILTERS: [Filter, string][] = [
  ["open", "รอตรวจสอบ"],
  ["reviewed", "ตรวจแล้ว"],
  ["all", "ทั้งหมด"],
];
const DURATIONS: [number, string][] = [
  [1, "1 ชั่วโมง"],
  [24, "1 วัน"],
  [168, "7 วัน"],
  [720, "30 วัน"],
  [2160, "90 วัน"],
];
const windowText = (hours: number) => (hours % 24 === 0 ? hours / 24 + " วัน" : hours + " ชั่วโมง");
const valueText = (s: Signal, n: number) =>
  s.rule === "paid_amount" ? n.toLocaleString("th-TH") + " บาท" : n.toLocaleString("th-TH") + " " + s.unit;
const statusText: Record<string, string> = { ACTIVE: "ปกติ", SUSPENDED: "ระงับแล้ว", BANNED: "แบนแล้ว" };

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="alert-switch" onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function SignalCard({
  signal,
  busy,
  onReview,
  onSuspend,
  onBlock,
}: {
  signal: Signal;
  busy: boolean;
  onReview: (note: string) => Promise<boolean>;
  onSuspend: (reason: string) => Promise<boolean>;
  onBlock: (email: string) => void;
}) {
  const [mode, setMode] = useState<"" | "review" | "suspend">("");
  const [text, setText] = useState("");
  const c = signal.customer;
  const canSuspend = !!c && c.role === "CUSTOMER" && c.status === "ACTIVE";
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = mode === "review" ? await onReview(text.trim()) : await onSuspend(text.trim());
    if (ok) {
      setMode("");
      setText("");
    }
  }
  return (
    <article className="reference-admin-card fraud-signal-card" data-status={signal.status.toLowerCase()} data-rule={signal.rule}>
      <header>
        <span className="fraud-rule">
          <ShieldAlert size={16} aria-hidden="true" />
          <strong>{signal.label}</strong>
        </span>
        <span className={"alert-badge " + (signal.status === "OPEN" ? "fail" : "on")}>
          {signal.status === "OPEN" ? "รอตรวจสอบ" : "ตรวจแล้ว"}
        </span>
      </header>
      <p className="fraud-value">
        <strong>{valueText(signal, signal.value)}</strong> ใน {windowText(signal.windowHours)}
        <small> · เกณฑ์ {valueText(signal, signal.threshold)}</small>
      </p>
      <dl className="fraud-meta">
        {c && (
          <div>
            <dt>ลูกค้า</dt>
            <dd>
              <Link to={"/admin/customers/" + c.id}>{c.name || "ลูกค้า"}</Link>
              {c.email && <small>{c.email}</small>}
              {c.status !== "ACTIVE" && <span className="alert-badge off">{statusText[c.status] ?? c.status}</span>}
            </dd>
          </div>
        )}
        {signal.ipMasked && (
          <div>
            <dt>เครือข่าย</dt>
            <dd>
              <code>{signal.ipMasked}</code>
              {signal.accounts.length > 1 && (
                <small className="fraud-accounts">
                  บัญชีที่สมัคร:{" "}
                  {signal.accounts.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ", "}
                      <Link to={"/admin/customers/" + id}>{id.slice(0, 8).toUpperCase()}</Link>
                    </span>
                  ))}
                </small>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt>เวลา</dt>
          <dd>
            {dateTime(signal.createdAt)}
            {signal.hits > 1 && <small>เกิดซ้ำ {signal.hits} ครั้ง · ล่าสุด {dateTime(signal.lastAt)}</small>}
          </dd>
        </div>
        {signal.status === "REVIEWED" && (
          <div>
            <dt>ตรวจโดย</dt>
            <dd>
              {signal.reviewedBy ?? "แอดมิน"}
              {signal.reviewedAt && <small>{dateTime(signal.reviewedAt)}</small>}
              {signal.note && <q className="fraud-note">{signal.note}</q>}
            </dd>
          </div>
        )}
      </dl>
      {signal.status === "OPEN" && !mode && (
        <div className="admin-action-row fraud-actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => setMode("review")}>
            <CheckCircle2 size={15} />
            ตรวจแล้ว
          </button>
          {canSuspend && (
            <button type="button" className="button secondary" disabled={busy} onClick={() => setMode("suspend")}>
              <ShieldBan size={15} />
              ระงับบัญชี
            </button>
          )}
          {c?.email && c.role === "CUSTOMER" && (
            <button type="button" className="button ghost" disabled={busy} onClick={() => onBlock(c.email ?? "")}>
              <Ban size={15} />
              บล็อกอีเมลชั่วคราว
            </button>
          )}
        </div>
      )}
      {mode && (
        <form className="admin-reason-form fraud-inline-form" onSubmit={submit}>
          <label className="field">
            {mode === "review" ? "บันทึก (ไม่บังคับ)" : "เหตุผลที่ระงับ (ลูกค้าไม่เห็น)"}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              minLength={mode === "suspend" ? 3 : undefined}
              required={mode === "suspend"}
              autoFocus
            />
          </label>
          {mode === "suspend" && <p className="field-help">ลูกค้าจะออกจากระบบทุกอุปกรณ์ และสั่งซื้อไม่ได้จนกว่าจะเปิดใช้บัญชีอีกครั้ง</p>}
          <div className="admin-action-row">
            <button type="button" className="button secondary" onClick={() => setMode("")}>
              ยกเลิก
            </button>
            <button className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={15} />}
              {mode === "review" ? "ยืนยันว่าตรวจแล้ว" : "ยืนยันระงับ"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

export function AdminFraud() {
  const { toast } = useStore();
  const [filter, setFilter] = useState<Filter>("open");
  const [data, setData] = useState<FraudData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [blockKind, setBlockKind] = useState<"EMAIL" | "DOMAIN">("EMAIL");
  const [blockValue, setBlockValue] = useState("");
  const [blockHours, setBlockHours] = useState(24);
  const [blockReason, setBlockReason] = useState("");
  const blockRef = useRef<HTMLInputElement>(null);
  async function load(next = filter) {
    try {
      const result = await api<FraudData>("/admin/fraud?status=" + next);
      setData(result);
      setRules(result.settings.rules);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load(filter);
  }, [filter]);
  async function run<T>(fn: () => Promise<T>, done: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      toast(done);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const review = (s: Signal) => (note: string) =>
    run(() => api("/admin/fraud/signals/" + s.id + "/review", { note }), "บันทึกว่าตรวจแล้ว");
  const suspend = (s: Signal) => (reason: string) =>
    run(
      () => api("/admin/customers/" + s.customer?.id + "/status", { status: "SUSPENDED", reason }),
      "ระงับบัญชีแล้ว",
    );
  function prefillBlock(email: string) {
    setBlockKind("EMAIL");
    setBlockValue(email);
    blockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    blockRef.current?.focus({ preventScroll: true });
  }
  async function addBlock(e: FormEvent) {
    e.preventDefault();
    const ok = await run(
      () => api("/admin/fraud/blocks", { kind: blockKind, value: blockValue, hours: blockHours, reason: blockReason }),
      "บล็อกแล้ว",
    );
    if (ok) {
      setBlockValue("");
      setBlockReason("");
    }
  }
  const lift = (b: Block) => run(() => api("/admin/fraud/blocks/" + b.id, undefined, "DELETE"), "ยกเลิกบล็อกแล้ว");
  const rulesDirty = !!data && JSON.stringify(rules) !== JSON.stringify(data.settings.rules);
  async function saveRules(e: FormEvent) {
    e.preventDefault();
    await run(
      () =>
        api("/admin/fraud/settings", {
          rules: Object.fromEntries(
            rules.map((r) => [r.key, { enabled: r.enabled, threshold: Number(r.threshold), windowHours: Number(r.windowHours) }]),
          ),
        }),
      "บันทึกเกณฑ์แล้ว",
    );
  }
  const setRule = (key: string, patch: Partial<Rule>) =>
    setRules((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const counts = { open: data?.counts.open ?? 0, reviewed: data?.counts.reviewed ?? 0 };
  const tabCount: Record<Filter, number> = { open: counts.open, reviewed: counts.reviewed, all: counts.open + counts.reviewed };

  return (
    <div className="alerts-page fraud-page">
      <div className="reference-admin-heading">
        <div>
          <h1>สัญญาณผิดปกติ</h1>
          <p>ระบบแจ้งเมื่อพบพฤติกรรมที่ควรตรวจสอบ เช่น สั่งซื้อถี่ หรือจ่ายเงินไม่สำเร็จบ่อย · ระบบไม่ระงับบัญชีให้อัตโนมัติ</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="reference-status-tabs order-status-tabs" role="tablist" aria-label="สถานะสัญญาณ">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="tab-count">{tabCount[key].toLocaleString("th-TH")}</span>
          </button>
        ))}
      </div>
      {!data ? (
        <section className="reference-admin-card editor-panel">
          <p className="reference-empty-text">กำลังโหลด…</p>
        </section>
      ) : data.signals.length ? (
        <section className="fraud-signal-list" aria-label="รายการสัญญาณ">
          {data.signals.map((s) => (
            <SignalCard
              key={s.id}
              signal={s}
              busy={busy}
              onReview={review(s)}
              onSuspend={suspend(s)}
              onBlock={prefillBlock}
            />
          ))}
        </section>
      ) : (
        <section className="reference-admin-card editor-panel fraud-empty">
          <CheckCircle2 size={20} aria-hidden="true" />
          <p>{filter === "open" ? "ไม่มีสัญญาณที่รอตรวจสอบ" : "ยังไม่มีรายการ"}</p>
        </section>
      )}

      <section className="reference-admin-card editor-panel fraud-block-card">
        <h2>บล็อกอีเมลชั่วคราว</h2>
        <p className="field-help">
          ห้ามสมัครและเข้าสู่ระบบด้วยอีเมลหรือโดเมนนี้จนหมดเวลา · อุปกรณ์ที่ล็อกอินอยู่แล้วยังใช้ได้ ถ้าต้องการหยุดบัญชีทันทีให้กด “ระงับบัญชี”
        </p>
        <form className="fraud-block-form" onSubmit={addBlock}>
          <div className="segmented-control" role="group" aria-label="บล็อกแบบ">
            {(
              [
                ["EMAIL", "อีเมล"],
                ["DOMAIN", "ทั้งโดเมน"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={blockKind === key ? "active" : ""}
                aria-pressed={blockKind === key}
                onClick={() => setBlockKind(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="field">
            {blockKind === "EMAIL" ? "อีเมล" : "โดเมน"}
            <input
              ref={blockRef}
              value={blockValue}
              onChange={(e) => setBlockValue(e.target.value)}
              placeholder={blockKind === "EMAIL" ? "name@example.com" : "example.com"}
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              maxLength={160}
              required
            />
          </label>
          <label className="field">
            ระยะเวลา
            <select value={blockHours} onChange={(e) => setBlockHours(Number(e.target.value))}>
              {DURATIONS.map(([h, label]) => (
                <option key={h} value={h}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field fraud-block-reason">
            เหตุผล (ไม่บังคับ)
            <input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} maxLength={300} />
          </label>
          <button className="button primary" disabled={busy}>
            <Ban size={15} />
            บล็อก
          </button>
        </form>
        {data && data.blocks.length > 0 && (
          <ul className="fraud-block-list" aria-label="รายการที่บล็อกอยู่">
            {data.blocks.map((b) => (
              <li key={b.id}>
                <span>
                  <strong>{b.value}</strong>
                  <small>
                    {b.kind === "DOMAIN" ? "ทั้งโดเมน" : "อีเมล"} · ถึง {dateTime(b.expiresAt)}
                    {b.reason ? " · " + b.reason : ""}
                  </small>
                </span>
                <button type="button" className="button ghost" disabled={busy} onClick={() => void lift(b)}>
                  <Undo2 size={15} />
                  ยกเลิกบล็อก
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="reference-admin-card editor-panel fraud-rules-card" onSubmit={saveRules}>
        <h2>เกณฑ์การแจ้งเตือน</h2>
        <p className="field-help">แจ้งเมื่อถึงเกณฑ์ภายในช่วงเวลาที่ตั้ง · แจ้งครั้งเดียวต่อบัญชีต่อช่วงเวลา และส่งไปที่แจ้งเตือนนอกเว็บด้วยถ้าเปิดไว้</p>
        <ul className="fraud-rule-list">
          {rules.map((r) => (
            <li key={r.key} data-rule={r.key}>
              <div className="fraud-rule-head">
                <span>
                  <strong>{r.label}</strong>
                  <small>{r.help}</small>
                </span>
                <Switch checked={r.enabled} label={"เปิดกฎ " + r.label} onChange={(next) => setRule(r.key, { enabled: next })} />
              </div>
              <div className="fraud-rule-inputs">
                <label className="field">
                  ตั้งแต่ ({r.unit})
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={r.max}
                    step={1}
                    value={r.threshold}
                    disabled={!r.enabled}
                    onChange={(e) => setRule(r.key, { threshold: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  ภายใน (ชั่วโมง)
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={data?.settings.maxWindowHours ?? 720}
                    step={1}
                    value={r.windowHours}
                    disabled={!r.enabled}
                    onChange={(e) => setRule(r.key, { windowHours: Number(e.target.value) })}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
        <div className="alert-save-actions">
          <button className="button primary" disabled={busy || !rulesDirty}>
            {busy && <LoaderCircle className="spin" size={15} />}
            บันทึกเกณฑ์
          </button>
          <small>
            {rulesDirty
              ? "มีการเปลี่ยนแปลงที่ยังไม่บันทึก"
              : data?.settings.updatedAt
                ? "บันทึกล่าสุด " + dateTime(data.settings.updatedAt)
                : "ใช้ค่าเริ่มต้น"}
          </small>
        </div>
      </form>
    </div>
  );
}
