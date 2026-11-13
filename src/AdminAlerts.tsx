// Admin › ตั้งค่า › แจ้งเตือนนอกเว็บ and › สำรองข้อมูล.
// Layout reference: shadcn/ui (MIT, github.com/shadcn-ui/ui) — Card, Switch, Checkbox and the
// "Notifications" settings form — on the admin's existing white-card / cool-grey brand pass.
import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  CircleAlert,
  CloudOff,
  DatabaseBackup,
  Download,
  LoaderCircle,
  Send,
} from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api, dateTime } from "./api";
import "./alerts.css";

type Channel = "discord" | "telegram" | "line";
type ChannelView = { enabled: boolean; configured: boolean; masked: Record<string, string> };
type LogRow = {
  id: string;
  created_at: string;
  channel: Channel;
  event: string;
  ok: boolean;
  status: number | null;
  error: string | null;
};
type AlertSettings = {
  channels: Record<Channel, ChannelView>;
  events: Record<string, boolean>;
  origin: string;
  updatedAt: string | null;
  log: LogRow[];
  limits: { perChannel: number; windowMinutes: number; timeoutSeconds: number; dailySummaryHour: number };
};
type TestResult = { ok: boolean; status: number | null; error: string | null };

const CHANNELS: {
  key: Channel;
  name: string;
  help: string;
  fields: { name: string; label: string; placeholder: string }[];
}[] = [
  {
    key: "discord",
    name: "Discord",
    help: "ในห้องที่ต้องการ › ตั้งค่าช่อง › การเชื่อมต่อ › Webhooks › สร้าง Webhook แล้วคัดลอก URL",
    fields: [{ name: "url", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…" }],
  },
  {
    key: "telegram",
    name: "Telegram",
    help: "สร้างบอทกับ @BotFather เพื่อรับ Bot token แล้วเพิ่มบอทเข้ากลุ่ม ใส่ Chat ID ของกลุ่มหรือของคุณ",
    fields: [
      { name: "token", label: "Bot token", placeholder: "123456789:AA…" },
      { name: "chatId", label: "Chat ID", placeholder: "-100… หรือ @ชื่อช่อง" },
    ],
  },
  {
    key: "line",
    name: "LINE",
    help: "ใช้ LINE Messaging API (LINE Notify ปิดบริการแล้ว): ออก Channel access token ใน LINE Developers แล้วใส่ User ID หรือ Group ID ที่บอทอยู่",
    fields: [
      { name: "token", label: "Channel access token", placeholder: "ยาวประมาณ 170 ตัวอักษร" },
      { name: "to", label: "User ID / Group ID", placeholder: "U… หรือ C…" },
    ],
  },
];
const EVENTS: [string, string, string][] = [
  ["order_paid", "ออเดอร์ใหม่ชำระแล้ว", "ทุกออเดอร์พร้อมส่งที่จ่ายสำเร็จ"],
  ["preorder_paid", "พรีออเดอร์ใหม่ (เข้าคิว)", "ลูกค้าจ่ายพรีออเดอร์และได้เลขคิว"],
  ["stock_low", "สต็อกใกล้หมด / หมด", "แจ้งครั้งเดียวเมื่อตัวเลือกสินค้าลดถึงเกณฑ์ หรือหมด"],
  ["chat_message", "ข้อความแชทใหม่จากลูกค้า", "ไม่ส่งเนื้อหาข้อความออกนอกเว็บ"],
  ["chat_assigned", "มอบหมายแชทให้ทีมงาน", "เมื่อมีการมอบหมายแชทให้ใครสักคน"],
  ["refund", "คืนเงิน", "ทุกครั้งที่คืนเงินออเดอร์"],
  ["daily_summary", "สรุปยอดประจำวัน", "ยอดขายและจำนวนรายการชำระของวันนี้ ส่งประมาณ 21:00 น."],
  ["fraud_signal", "สัญญาณผิดปกติ", "ลูกค้าสั่งซื้อถี่ จ่ายไม่สำเร็จบ่อย หรือสมัครหลายบัญชี (แจ้งเท่านั้น ไม่ระงับเอง)"],
];
const EVENT_LABEL: Record<string, string> = {
  ...Object.fromEntries(EVENTS.map(([k, label]) => [k, label])),
  test: "ทดสอบส่ง",
};
const eventLabel = (value: string) =>
  value
    .split("+")
    .map((e) => EVENT_LABEL[e] ?? e)
    .join(" + ");

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="alert-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function AdminAlerts() {
  const { toast } = useStore();
  const [data, setData] = useState<AlertSettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState<Record<Channel, boolean>>({ discord: false, telegram: false, line: false });
  const [events, setEvents] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Channel | null>(null);
  const [results, setResults] = useState<Partial<Record<Channel, TestResult>>>({});
  function apply(next: AlertSettings) {
    setData(next);
    setEnabled({
      discord: next.channels.discord.enabled,
      telegram: next.channels.telegram.enabled,
      line: next.channels.line.enabled,
    });
    setEvents(next.events);
    setValues({});
  }
  const load = () =>
    api<AlertSettings>("/admin/alerts")
      .then(apply)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const dirty =
    !!data &&
    (Object.values(values).some((v) => v.trim()) ||
      CHANNELS.some((c) => enabled[c.key] !== data.channels[c.key].enabled) ||
      EVENTS.some(([k]) => events[k] !== data.events[k]));
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const currentPassword = String(new FormData(form).get("currentPassword") ?? "");
    setBusy(true);
    setError("");
    try {
      const channels: Record<string, Record<string, unknown>> = {};
      for (const c of CHANNELS) {
        channels[c.key] = { enabled: enabled[c.key] };
        for (const f of c.fields) {
          const v = values[c.key + "." + f.name]?.trim();
          if (v) channels[c.key][f.name] = v;
        }
      }
      apply(await api<AlertSettings>("/admin/alerts", { currentPassword, channels, events }));
      form.reset();
      toast("บันทึกการแจ้งเตือนแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test(channel: Channel) {
    setTesting(channel);
    setError("");
    try {
      const result = await api<TestResult>("/admin/alerts/test", { channel });
      setResults((r) => ({ ...r, [channel]: result }));
      // Refresh only the history so unsaved edits in the form stay.
      api<AlertSettings>("/admin/alerts")
        .then((next) => setData((d) => (d ? { ...d, log: next.log } : next)))
        .catch(() => {});
    } catch (err) {
      setResults((r) => ({ ...r, [channel]: { ok: false, status: null, error: (err as Error).message } }));
    } finally {
      setTesting(null);
    }
  }
  return (
    <div className="alerts-page">
      <div className="reference-admin-heading">
        <div>
          <h1>แจ้งเตือนนอกเว็บ</h1>
          <p>ส่งเหตุการณ์สำคัญของร้านไปที่ Discord, Telegram หรือ LINE ของทีม ไม่ต้องเปิดหลังร้านค้างไว้</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      {!data ? (
        <section className="reference-admin-card editor-panel">
          <p className="reference-empty-text">กำลังโหลด…</p>
        </section>
      ) : (
        <form className="alerts-form" onSubmit={save} autoComplete="off">
          <section className="alerts-channels" aria-label="ช่องทางแจ้งเตือน">
            {CHANNELS.map((c) => {
              const view = data.channels[c.key];
              const result = results[c.key];
              return (
                <article className="reference-admin-card alert-channel-card" key={c.key} data-channel={c.key}>
                  <header>
                    <div>
                      <h2>{c.name}</h2>
                      <span className={"alert-badge " + (view.configured ? (view.enabled ? "on" : "off") : "unset")}>
                        {view.configured ? (view.enabled ? "เปิดอยู่" : "ปิดอยู่") : "ยังไม่ได้ตั้งค่า"}
                      </span>
                    </div>
                    <Switch
                      checked={enabled[c.key]}
                      label={"เปิดแจ้งเตือนทาง " + c.name}
                      onChange={(next) => setEnabled((s) => ({ ...s, [c.key]: next }))}
                    />
                  </header>
                  <p className="field-help">{c.help}</p>
                  {c.fields.map((f) => {
                    const id = c.key + "." + f.name;
                    const saved = view.masked[f.name];
                    return (
                      <label className="field" key={id}>
                        {f.label}
                        <input
                          name={id}
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={500}
                          value={values[id] ?? ""}
                          placeholder={saved ? "บันทึกแล้ว " + saved + " · เว้นว่างเพื่อใช้ค่าเดิม" : f.placeholder}
                          onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
                        />
                      </label>
                    );
                  })}
                  <div className="alert-test-row">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!view.configured || testing !== null}
                      title={view.configured ? undefined : "บันทึกข้อมูลก่อนจึงทดสอบส่งได้"}
                      onClick={() => void test(c.key)}
                    >
                      {testing === c.key ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
                      ทดสอบส่ง
                    </button>
                    {result && (
                      <span className={"alert-test-result " + (result.ok ? "ok" : "fail")} role="status">
                        {result.ok ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                        {result.ok
                          ? "ส่งสำเร็จ"
                          : "ส่งไม่สำเร็จ" + (result.status ? " (" + result.status + ")" : "") + (result.error ? ": " + result.error : "")}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
          <section className="reference-admin-card editor-panel alert-events-card">
            <h2>เหตุการณ์ที่จะแจ้ง</h2>
            <p>
              ข้อความสั้นภาษาไทย มีชื่อร้านและลิงก์เข้าหลังร้าน ไม่มีรหัสผ่านหรือข้อมูลบัญชีลูกค้า · ส่งได้ไม่เกิน{" "}
              {data.limits.perChannel} ข้อความต่อช่องทางใน {data.limits.windowMinutes} นาที เกินจากนั้นจะรวบไว้แจ้งในข้อความถัดไป
            </p>
            <ul className="alert-event-list">
              {EVENTS.map(([key, label, hint]) => (
                <li key={key}>
                  <label>
                    <input
                      type="checkbox"
                      name={"event." + key}
                      checked={!!events[key]}
                      onChange={(e) => setEvents((s) => ({ ...s, [key]: e.target.checked }))}
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
          <section className="reference-admin-card editor-panel alert-save-card">
            <label className="field">
              รหัสผ่านของคุณ (ยืนยันก่อนบันทึก)
              <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
            </label>
            <div className="alert-save-actions">
              <button className="button primary" disabled={busy}>
                {busy && <LoaderCircle className="spin" size={15} />}
                บันทึกการตั้งค่า
              </button>
              <small>
                {dirty
                  ? "มีการเปลี่ยนแปลงที่ยังไม่บันทึก"
                  : data.updatedAt
                    ? "บันทึกล่าสุด " + dateTime(data.updatedAt)
                    : "ยังไม่เคยบันทึก"}
              </small>
            </div>
          </section>
        </form>
      )}
      {data && (
        <section className="reference-admin-card alert-log-card">
          <div className="reference-card-heading">
            <h2>ประวัติการส่ง</h2>
            <small>ล่าสุด 50 รายการ</small>
          </div>
          {data.log.length ? (
            <table className="reference-table admin-list-table alert-log-table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ช่องทาง</th>
                  <th>เหตุการณ์</th>
                  <th>ผล</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {data.log.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.created_at)}</td>
                    <td>{CHANNELS.find((c) => c.key === row.channel)?.name ?? row.channel}</td>
                    <td>{eventLabel(row.event)}</td>
                    <td>
                      <span className={"alert-badge " + (row.ok ? "on" : "fail")}>{row.ok ? "สำเร็จ" : "ไม่สำเร็จ"}</span>
                    </td>
                    <td className="alert-log-detail">
                      {row.status ? "HTTP " + row.status : ""}
                      {row.status && row.error ? " · " : ""}
                      {row.error ?? (row.status ? "" : "–")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="reference-empty-text alert-log-empty">ยังไม่มีการส่ง กด “ทดสอบส่ง” เพื่อลองช่องทางที่บันทึกไว้</p>
          )}
        </section>
      )}
    </div>
  );
}

type BackupStatus = {
  r2: boolean;
  last: { ok: boolean; at: string; key?: string; bytes?: number; error?: string } | null;
  retentionDays: number;
  hourBangkok: number;
  snapshotLimitMB: number;
};
const megabytes = (bytes = 0) =>
  bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";

export function AdminBackup() {
  const { toast } = useStore();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<BackupStatus>("/admin/backup")
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);
  const [running, setRunning] = useState(false);
  async function runNow(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const currentPassword = String(new FormData(form).get("currentPassword") ?? "");
    setRunning(true);
    setError("");
    try {
      const next = await api<BackupStatus & { result: BackupStatus["last"] }>("/admin/backup/run", { currentPassword });
      setStatus(next);
      form.reset();
      if (next.result?.ok) toast("สำรองไป R2 แล้ว");
      else setError("สำรองไป R2 ไม่สำเร็จ: " + (next.result?.error ?? ""));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }
  async function download(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const currentPassword = String(new FormData(form).get("currentPassword") ?? "");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/backup/export", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Astra-Request": "1" },
        body: JSON.stringify({ currentPassword }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่");
      }
      const blob = await response.blob();
      const name =
        /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "asiaextra-backup.json.gz";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      form.reset();
      toast("ดาวน์โหลดไฟล์สำรองแล้ว (" + megabytes(blob.size) + ")");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="alerts-page backup-page">
      <div className="reference-admin-heading">
        <div>
          <h1>สำรองข้อมูล</h1>
          <p>เก็บสำเนาข้อมูลทั้งร้านไว้กู้คืนเมื่อเกิดปัญหา</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <section className="reference-admin-card editor-panel backup-card">
        <div className="backup-card-title">
          <DatabaseBackup size={20} />
          <h2>ดาวน์โหลดไฟล์สำรอง</h2>
        </div>
        <p>
          ไฟล์ .json.gz ของทุกตาราง (สินค้า สต็อก ออเดอร์ ลูกค้า การเงิน และประวัติ) พร้อมเวอร์ชันโครงสร้างฐานข้อมูล
          รหัสบัญชีในสต็อกและคีย์ต่าง ๆ ยังเข้ารหัสเหมือนในระบบ เปิดอ่านได้ด้วยคีย์ของร้านเท่านั้น
          ไม่รวมเซสชันที่ล็อกอินอยู่ · ทุกครั้งที่ดาวน์โหลดจะบันทึกในประวัติการทำงาน
        </p>
        <form className="alert-inline-form" onSubmit={download}>
          <label className="field">
            รหัสผ่านของคุณ
            <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
            ดาวน์โหลดไฟล์สำรอง
          </button>
        </form>
        <p className="field-help">
          เก็บไฟล์ไว้ในที่ปลอดภัย ไฟล์มีข้อมูลลูกค้า · ส่วนข้อมูลหลักต้องไม่เกิน {status?.snapshotLimitMB ?? 64} MB
          (รูปสินค้าไม่นับ) · กู้คืนด้วย <code>scripts/restore-backup.mjs</code>
        </p>
      </section>
      <section className="reference-admin-card editor-panel backup-card" data-r2={status?.r2 ? "on" : "off"}>
        <div className="backup-card-title">
          {status?.r2 ? <CheckCircle2 size={20} /> : <CloudOff size={20} />}
          <h2>สำรองอัตโนมัติทุกวัน</h2>
        </div>
        {!status ? (
          <p className="reference-empty-text">กำลังโหลด…</p>
        ) : status.r2 ? (
          <>
            <p>
              สำรองไปที่ Cloudflare R2 วันละครั้งหลัง {String(status.hourBangkok).padStart(2, "0")}:00 น. และเก็บไว้{" "}
              {status.retentionDays} วัน
            </p>
            <div className="settings-row">
              <span>สำรองล่าสุด</span>
              {status.last ? (
                <span className={"alert-badge " + (status.last.ok ? "on" : "fail")}>
                  {status.last.ok ? "สำเร็จ" : "ไม่สำเร็จ"} · {dateTime(status.last.at.slice(0, 19).replace("T", " "))}
                </span>
              ) : (
                <span className="alert-badge unset">ยังไม่เคยสำรอง</span>
              )}
            </div>
            {status.last?.ok && (
              <div className="settings-row">
                <span>ขนาดไฟล์</span>
                <strong>{megabytes(status.last.bytes)}</strong>
              </div>
            )}
            {status.last && !status.last.ok && <p className="field-help">{status.last.error}</p>}
            <form className="alert-inline-form backup-run-form" onSubmit={runNow}>
              <label className="field">
                รหัสผ่านของคุณ
                <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
              </label>
              <button className="button secondary" disabled={running}>
                {running ? <LoaderCircle className="spin" size={15} /> : <DatabaseBackup size={15} />}
                สำรองไป R2 ตอนนี้
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="backup-unset">
              <strong>ยังไม่ได้ตั้งค่าที่เก็บสำรอง (R2)</strong>
            </p>
            <ol className="backup-steps">
              <li>สร้าง bucket: <code>npx wrangler r2 bucket create asiax-backups</code></li>
              <li>เปิดบล็อก <code>BACKUPS</code> ใน <code>wrangler.jsonc</code> (มีตัวอย่างใส่คอมเมนต์ไว้แล้ว)</li>
              <li>deploy ใหม่ ระบบจะสำรองวันละครั้งหลัง 04:00 น. และเก็บไว้ 14 วัน</li>
            </ol>
            <p className="field-help">ระหว่างนี้ใช้ปุ่ม “ดาวน์โหลดไฟล์สำรอง” ด้านบนได้ตามปกติ</p>
          </>
        )}
      </section>
    </div>
  );
}
