// Admin › ตั้งค่า: email + Turnstile status, which env vars to set, last 20 emails.
// Read-only; never shows a secret (the server does not send any).
import { useEffect, useState } from "react";
import { MailCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { ErrorMessage } from "./App";
import { api, dateTime } from "./api";
import "./email-turnstile.css";

type EmailRow = {
  id: string;
  created_at: string;
  kind: string;
  recipient: string;
  ok: number | null;
  provider: string | null;
  provider_id: string | null;
  error: string | null;
};
type Integrations = {
  email: { enabled: boolean; provider: string | null; from: string | null };
  turnstile: { enabled: boolean; siteKey: string | null };
  publicBaseUrl: string | null;
  log: EmailRow[];
};
const kindText: Record<string, string> = {
  password_reset: "ลิงก์ตั้งรหัสผ่านใหม่",
  order_confirmed: "ยืนยันคำสั่งซื้อ",
  preorder_ready: "พรีออเดอร์พร้อมแล้ว",
  template_test: "ทดสอบข้อความอีเมล",
};
const providerText: Record<string, string> = {
  cloudflare: "Cloudflare Email Sending",
  resend: "Resend",
  test: "ทดสอบ",
};

function State({ on }: { on: boolean }) {
  return (
    <span className={"status " + (on ? "txn-status-succeeded" : "txn-status-pending")}>
      {on ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้งค่า"}
    </span>
  );
}

export function AdminIntegrations() {
  const [data, setData] = useState<Integrations | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      setData(await api<Integrations>("/admin/integrations"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="reference-admin-card editor-panel integrations-card" aria-labelledby="integrations-title">
      <div className="integrations-head">
        <div>
          <h2 id="integrations-title">อีเมลและกันบอท</h2>
          <p>แต่ละส่วนเปิดเองเมื่อตั้งค่าใน Cloudflare แล้ว ส่วนที่ยังไม่ได้ตั้งค่า ร้านทำงานเหมือนเดิมทุกอย่าง</p>
        </div>
        <button type="button" className="button secondary" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={15} className={busy ? "spin" : ""} />
          รีเฟรช
        </button>
      </div>
      <ErrorMessage message={error} />
      <div className="integrations-grid">
        <div className="integration-item">
          <div className="integration-title">
            <MailCheck size={18} aria-hidden="true" />
            <strong>ส่งอีเมล</strong>
            {data && <State on={data.email.enabled} />}
          </div>
          <p>
            ลืมรหัสผ่านด้วยตัวเอง อีเมลยืนยันคำสั่งซื้อ และแจ้งพรีออเดอร์พร้อมแล้ว (ส่งเฉพาะลูกค้าที่มีอีเมลจริง
            ไม่ส่งรหัสสินค้าทางอีเมล)
          </p>
          {data?.email.enabled ? (
            <dl className="integration-facts">
              <dt>ผู้ให้บริการ</dt>
              <dd>{providerText[data.email.provider ?? ""] ?? data.email.provider}</dd>
              <dt>ผู้ส่ง</dt>
              <dd>{data.email.from}</dd>
              <dt>ลิงก์ในอีเมล</dt>
              <dd>{data.publicBaseUrl ?? "ใช้โดเมนที่ลูกค้าเปิดอยู่"}</dd>
            </dl>
          ) : (
            <ul className="integration-env">
              <li>
                <code>EMAIL_FROM</code> ที่อยู่ผู้ส่ง บนโดเมนที่ยืนยันแล้ว (vars)
              </li>
              <li>
                ผู้ส่งแบบ Cloudflare: binding <code>send_email</code> ชื่อ <code>EMAIL</code> ใน wrangler.jsonc
              </li>
              <li>
                หรือ Resend: <code>RESEND_API_KEY</code> (secret)
              </li>
              <li>
                แนะนำ: <code>PUBLIC_BASE_URL</code> เช่น https://ร้านของคุณ (vars)
              </li>
            </ul>
          )}
        </div>
        <div className="integration-item">
          <div className="integration-title">
            <ShieldCheck size={18} aria-hidden="true" />
            <strong>กันบอท (Turnstile)</strong>
            {data && <State on={data.turnstile.enabled} />}
          </div>
          <p>ตรวจว่าไม่ใช่บอทที่หน้าสมัครสมาชิก เข้าสู่ระบบ และลืมรหัสผ่าน</p>
          {data?.turnstile.enabled ? (
            <dl className="integration-facts">
              <dt>Site key</dt>
              <dd>
                <code>{data.turnstile.siteKey}</code>
              </dd>
            </dl>
          ) : (
            <ul className="integration-env">
              <li>
                <code>TURNSTILE_SITE_KEY</code> (vars)
              </li>
              <li>
                <code>TURNSTILE_SECRET</code> (secret)
              </li>
            </ul>
          )}
        </div>
      </div>
      <h3 className="integrations-log-title">อีเมลล่าสุด 20 ฉบับ</h3>
      <div className="table-scroll reference-table integrations-log">
        <table>
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ประเภท</th>
              <th>ผู้รับ</th>
              <th>ผล</th>
            </tr>
          </thead>
          <tbody>
            {data?.log.map((row) => (
              <tr key={row.id}>
                <td className="nowrap">{dateTime(row.created_at)}</td>
                <td>{kindText[row.kind] ?? row.kind}</td>
                <td>{row.recipient}</td>
                <td>
                  <span
                    className={
                      "status " +
                      (row.ok === 1 ? "txn-status-succeeded" : row.ok === 0 ? "txn-status-failed" : "txn-status-pending")
                    }
                  >
                    {row.ok === 1 ? "ส่งแล้ว" : row.ok === 0 ? "ส่งไม่สำเร็จ" : "กำลังส่ง"}
                  </span>
                  <small>{row.ok === 0 ? row.error : row.provider_id}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.log.length === 0 && <p className="reference-empty-text">ยังไม่มีอีเมลที่ส่ง</p>}
        {!data && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
      </div>
    </section>
  );
}
