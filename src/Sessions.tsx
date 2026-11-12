// "My devices": the signed-in user's own sessions, for both the admin account page
// (ตั้งค่า › บัญชีแอดมิน) and the storefront account page. Card + list rows follow the
// shadcn/ui (MIT, https://github.com/shadcn-ui/ui) Card pattern with the app's own
// classes and tokens; no new visual style.
import { useEffect, useState } from "react";
import { LogOut, Monitor, Smartphone } from "lucide-react";
import { api, relativeTime } from "./api";
import { t } from "./i18n";
import { ErrorMessage, useStore } from "./App";
import "./sessions.css";

type AccountSession = {
  id: string;
  device: string;
  ip: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  current: boolean;
};

const isPhone = (device: string) => /iPhone|iPad|Android/.test(device);

export function SessionsCard({ variant }: { variant: "admin" | "store" }) {
  const { toast, refresh, go } = useStore();
  const [rows, setRows] = useState<AccountSession[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const load = () =>
    api<{ sessions: AccountSession[] }>("/account/sessions")
      .then((r) => setRows(r.sessions))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  async function revoke(row: AccountSession) {
    setBusy(row.id);
    setError("");
    try {
      const result = await api<{ current: boolean }>("/account/sessions/" + row.id, undefined, "DELETE");
      if (result.current) {
        await refresh();
        go(variant === "admin" ? "/login?next=%2Fadmin" : "/login");
        return;
      }
      toast(t("ออกจากระบบ {device} แล้ว", { device: row.device }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function revokeOthers() {
    setBusy("others");
    setError("");
    try {
      const result = await api<{ revoked: number }>("/account/sessions/revoke-others", {});
      setConfirming(false);
      toast(t("ออกจากระบบเครื่องอื่นแล้ว {n} เครื่อง", { n: result.revoked }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const others = rows?.filter((r) => !r.current).length ?? 0;
  return (
    <section
      className={
        variant === "admin"
          ? "reference-admin-card admin-detail-card admin-account-card sessions-card"
          : "panel sessions-card sessions-card-store"
      }
      aria-labelledby={"sessions-title-" + variant}
    >
      <div className="sessions-head">
        <h2 id={"sessions-title-" + variant}>{t("อุปกรณ์ที่เข้าสู่ระบบ")}</h2>
        <p className="muted">
          {t("เครื่องที่บัญชีนี้เข้าสู่ระบบอยู่ ถ้าเห็นเครื่องที่ไม่รู้จัก ให้ออกจากระบบเครื่องนั้นแล้วเปลี่ยนรหัสผ่าน")}
        </p>
      </div>
      <ErrorMessage message={error} />
      {rows === null ? (
        !error && <p className="muted">{t("กำลังโหลด…")}</p>
      ) : (
        <ul className="sessions-list">
          {rows.map((row) => {
            const Icon = isPhone(row.device) ? Smartphone : Monitor;
            return (
              <li key={row.id} className={row.current ? "sessions-row is-current" : "sessions-row"}>
                <span className="sessions-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div className="sessions-info">
                  <strong>
                    {t(row.device)}
                    {row.current && <span className="sessions-current">{t("เครื่องนี้")}</span>}
                  </strong>
                  <small>
                    {row.ip ? t("IP {ip}", { ip: row.ip }) : t("ไม่ทราบ IP")}
                    {" · "}
                    {row.current
                      ? t("ใช้งานอยู่ตอนนี้")
                      : row.lastSeenAt
                        ? t("ใช้งานล่าสุด {time}", { time: relativeTime(row.lastSeenAt) })
                        : t("ไม่ทราบเวลาใช้งานล่าสุด")}
                  </small>
                </div>
                <button
                  type="button"
                  className="button secondary sessions-revoke"
                  disabled={busy !== null}
                  aria-label={t("ออกจากระบบเครื่องนี้") + " · " + row.device + (row.current ? " (" + t("เครื่องนี้") + ")" : "")}
                  onClick={() => void revoke(row)}
                >
                  <LogOut size={15} />
                  {t("ออกจากระบบเครื่องนี้")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows !== null && others > 0 && (
        <div className="sessions-actions">
          {confirming ? (
            <div className="sessions-confirm" role="group" aria-label={t("ยืนยันออกจากระบบเครื่องอื่น")}>
              <p>{t("ออกจากระบบอีก {n} เครื่อง เครื่องนี้ยังเข้าสู่ระบบอยู่", { n: others })}</p>
              <button
                type="button"
                className="button primary"
                disabled={busy !== null}
                onClick={() => void revokeOthers()}
              >
                {t("ยืนยันออกจากระบบ {n} เครื่อง", { n: others })}
              </button>
              <button type="button" className="button secondary" onClick={() => setConfirming(false)}>
                {t("ยกเลิก")}
              </button>
            </div>
          ) : (
            <button type="button" className="button secondary" disabled={busy !== null} onClick={() => setConfirming(true)}>
              {t("ออกจากระบบทุกเครื่องยกเว้นเครื่องนี้")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
