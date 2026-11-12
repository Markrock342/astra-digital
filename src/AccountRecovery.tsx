// Self-service password reset (request + reset page) and the Turnstile box used on
// login, register and forgot-password. Everything here renders only when the server
// says email / Turnstile are configured (/api/health); otherwise the old UI stays.
// Layout follows the shadcn/ui "Login" + "Forgot password" blocks (MIT,
// https://github.com/shadcn-ui/ui) on the storefront's own theme tokens.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LoaderCircle, MailCheck } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { api } from "./api";
import { BrandLogo } from "./Theme";
import { authConfig, loadTurnstile, type AuthConfig } from "./turnstile";
import "./email-turnstile.css";

// English storefront strings for this file (kept here so i18n-en.ts stays untouched;
// existing keys are never overwritten).
const EN_EXTRA: Record<string, string> = {
  "ลืมรหัสผ่าน?": "Forgot password?",
  "ลืมรหัสผ่าน": "Forgot password",
  "กรอกอีเมลที่ใช้สมัคร ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ ลิงก์ใช้ได้ 30 นาที":
    "Enter the email you signed up with. We will send a reset link that works for 30 minutes.",
  "อีเมลที่ใช้สมัคร": "Email you signed up with",
  "ส่งลิงก์ตั้งรหัสผ่านใหม่": "Send reset link",
  "ตรวจอีเมลของคุณ": "Check your email",
  "กลับไปหน้าเข้าสู่ระบบ": "Back to sign in",
  "บัญชีที่สมัครโดยไม่ใส่อีเมล ติดต่อร้านเพื่อขอรหัสผ่านชั่วคราว":
    "Signed up without an email? Contact the shop for a temporary password.",
  "ตั้งรหัสผ่านใหม่": "Set a new password",
  "รหัสผ่านใหม่": "New password",
  "ยืนยันรหัสผ่านใหม่": "Confirm new password",
  "บันทึกรหัสผ่านใหม่": "Save new password",
  "ตั้งรหัสผ่านใหม่แล้ว": "Password updated",
  "ทุกอุปกรณ์ถูกออกจากระบบแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย":
    "All devices were signed out. Sign in with your new password.",
  "ลิงก์นี้ไม่สมบูรณ์ กรุณาเปิดลิงก์จากอีเมลอีกครั้ง หรือขอลิงก์ใหม่":
    "This link is incomplete. Open the link from the email again or request a new one.",
  "ขอลิงก์ใหม่": "Request a new link",
  "กำลังโหลดระบบตรวจสอบ…": "Loading the security check…",
  "โหลดระบบตรวจสอบไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่": "The security check did not load. Refresh and try again.",
  "กรุณารอระบบตรวจสอบว่าไม่ใช่บอทสักครู่ แล้วลองอีกครั้ง": "Please wait for the security check, then try again.",
  "ระบบตั้งรหัสผ่านใหม่ทางอีเมลยังไม่เปิดใช้งาน": "Email password reset is not available",
  "กรุณาติดต่อร้านผ่านช่องทางในหน้า": "Please contact the shop through",
};
for (const [th, en] of Object.entries(EN_EXTRA)) EN_STRINGS[th] ??= en;

/** Public auth config, fetched once per page load. null while loading. */
export function useAuthConfig(): AuthConfig | null {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  useEffect(() => {
    let live = true;
    void authConfig().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}

/**
 * Turnstile box. Reports the token through onToken ("" when it expires or errors).
 * Bump `resetKey` after every submit: a token is single-use.
 */
export function TurnstileBox({
  siteKey,
  onToken,
  resetKey = 0,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  resetKey?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [verified, setVerified] = useState(false);
  const report = useRef((token: string) => {});
  report.current = (token: string) => {
    setVerified(!!token);
    onToken(token);
  };
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !box.current) return;
        widget.current = turnstile.render(box.current, {
          sitekey: siteKey,
          theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
          language: document.documentElement.lang === "en" ? "en" : "th",
          size: "flexible",
          callback: (token: string) => report.current(token),
          "expired-callback": () => report.current(""),
          "error-callback": () => report.current(""),
        });
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);
  useEffect(() => {
    if (resetKey && widget.current) {
      report.current("");
      window.turnstile?.reset(widget.current);
    }
  }, [resetKey]);
  return (
    <div className="turnstile-box" data-state={state} data-verified={verified ? "true" : "false"}>
      <div ref={box} className="turnstile-slot" />
      {state === "loading" && (
        <small className="turnstile-note">
          <LoaderCircle className="spin" size={14} /> {t("กำลังโหลดระบบตรวจสอบ…")}
        </small>
      )}
      {state === "error" && (
        <small className="turnstile-note error" role="alert">
          {t("โหลดระบบตรวจสอบไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่")}
        </small>
      )}
    </div>
  );
}
export const TURNSTILE_WAIT = "กรุณารอระบบตรวจสอบว่าไม่ใช่บอทสักครู่ แล้วลองอีกครั้ง";

/** "ลืมรหัสผ่าน?" request form, shown in place of the login form. */
export function ForgotPassword({ siteKey, onBack }: { siteKey: string | null; onBack: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (siteKey && !token) return setError(TURNSTILE_WAIT);
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/password/forgot", {
        email,
        ...(siteKey ? { turnstileToken: token } : {}),
      });
      setSent(result.message);
    } catch (err) {
      setError((err as Error).message);
      if (siteKey) setResetKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="reference-auth-main recovery-main">
      <div className="reference-auth-heading">
        <Link to="/" className="reference-auth-brand" aria-label={t("หน้าแรก")}>
          <BrandLogo />
        </Link>
        <h1>{sent ? t("ตรวจอีเมลของคุณ") : t("ลืมรหัสผ่าน")}</h1>
        {!sent && <p>{t("กรอกอีเมลที่ใช้สมัคร ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ ลิงก์ใช้ได้ 30 นาที")}</p>}
      </div>
      {sent ? (
        <div className="reference-auth-form recovery-done" role="status">
          <span className="recovery-icon" aria-hidden="true">
            <MailCheck size={22} />
          </span>
          <p>{t(sent)}</p>
          <button type="button" className="button primary full" onClick={onBack}>
            {t("กลับไปหน้าเข้าสู่ระบบ")}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="reference-auth-form">
          <ErrorMessage message={error} />
          <label className="field">
            {t("อีเมลที่ใช้สมัคร")}
            <input name="email" type="email" autoComplete="email" maxLength={160} required autoFocus />
          </label>
          {siteKey && <TurnstileBox siteKey={siteKey} onToken={setToken} resetKey={resetKey} />}
          <button className="button primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : t("ส่งลิงก์ตั้งรหัสผ่านใหม่")}
          </button>
        </form>
      )}
      <p className="reference-auth-help">
        {!sent && (
          <>
            {t("บัญชีที่สมัครโดยไม่ใส่อีเมล ติดต่อร้านเพื่อขอรหัสผ่านชั่วคราว")}{" "}
            <Link to="/support">{t("ติดต่อเรา")}</Link>
            <br />
          </>
        )}
        <button type="button" className="text-button recovery-back" onClick={onBack}>
          <ArrowLeft size={14} />
          {t("กลับไปหน้าเข้าสู่ระบบ")}
        </button>
      </p>
    </main>
  );
}

/** /reset-password?token=… — the link from the email. */
export function ResetPasswordPage() {
  const { go } = useStore();
  const config = useAuthConfig();
  // Keep the token in memory and drop it from the address bar / history.
  const [token] = useState(() => new URLSearchParams(location.search).get("token") ?? "");
  useEffect(() => {
    if (location.search) history.replaceState(history.state, "", "/reset-password");
  }, []);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const validToken = /^[a-f0-9]{64}$/.test(token);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    setError("");
    if (newPassword !== confirmPassword) return setError("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
    setBusy(true);
    try {
      await api("/password/reset", { token, newPassword, confirmPassword });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const heading = done ? t("ตั้งรหัสผ่านใหม่แล้ว") : t("ตั้งรหัสผ่านใหม่");
  return (
    <main className="reference-auth-main recovery-main">
      <div className="reference-auth-heading">
        <Link to="/" className="reference-auth-brand" aria-label={t("หน้าแรก")}>
          <BrandLogo />
        </Link>
        <h1>{heading}</h1>
      </div>
      {done ? (
        <div className="reference-auth-form recovery-done" role="status">
          <span className="recovery-icon" aria-hidden="true">
            <CheckCircle2 size={22} />
          </span>
          <p>{t("ทุกอุปกรณ์ถูกออกจากระบบแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย")}</p>
          <button type="button" className="button primary full" onClick={() => go("/login")}>
            {t("เข้าสู่ระบบ")}
          </button>
        </div>
      ) : config && !config.email ? (
        <div className="reference-auth-form recovery-done">
          <p>
            {t("ระบบตั้งรหัสผ่านใหม่ทางอีเมลยังไม่เปิดใช้งาน")} · {t("กรุณาติดต่อร้านผ่านช่องทางในหน้า")}{" "}
            <Link to="/support">{t("ติดต่อเรา")}</Link>
          </p>
        </div>
      ) : !validToken ? (
        <div className="reference-auth-form recovery-done">
          <ErrorMessage message="ลิงก์นี้ไม่สมบูรณ์ กรุณาเปิดลิงก์จากอีเมลอีกครั้ง หรือขอลิงก์ใหม่" />
          <button type="button" className="button primary full" onClick={() => go("/login?forgot=1")}>
            {t("ขอลิงก์ใหม่")}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="reference-auth-form">
          <ErrorMessage message={error} />
          <label className="field">
            {t("รหัสผ่านใหม่")}
            <div className="password-field">
              <input
                name="newPassword"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                aria-describedby="reset-password-rule"
                minLength={10}
                maxLength={128}
                required
                autoFocus
              />
              <button
                type="button"
                className="icon-button"
                aria-label={show ? t("ซ่อนรหัสผ่าน") : t("แสดงรหัสผ่าน")}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <small id="reset-password-rule" className="field-hint">
            {t("อย่างน้อย 10 ตัวอักษร")}
          </small>
          <label className="field">
            {t("ยืนยันรหัสผ่านใหม่")}
            <input
              name="confirmPassword"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              required
            />
          </label>
          <button className="button primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : t("บันทึกรหัสผ่านใหม่")}
          </button>
        </form>
      )}
      {!done && (
        <p className="reference-auth-help">
          <Link to="/login" className="recovery-back">
            <ArrowLeft size={14} />
            {t("กลับไปหน้าเข้าสู่ระบบ")}
          </Link>
        </p>
      )}
    </main>
  );
}
