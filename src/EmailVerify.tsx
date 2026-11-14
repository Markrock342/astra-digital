// Email verification on the storefront (server/email-verification.mjs):
// - EmailVerifyNotice: "ยืนยันอีเมลของคุณ" card on the account page and above the checkout /
//   buy / pay buttons while an unverified customer is blocked from ordering. Resend with a
//   cooldown, change the address (password again).
// - VerifyEmailPage: /verify-email?token=… — the link from the email.
// Layout follows shadcn/ui Alert + Card (MIT, https://ui.shadcn.com/docs/components/alert,
// https://ui.shadcn.com/docs/components/card) on the storefront's own theme tokens.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, MailCheck, MailWarning, MailX } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { api } from "./api";
import { BrandLogo } from "./Theme";
import type { User } from "./types";
import "./email-verify.css";

const EN_VERIFY: Record<string, string> = {
  "ยืนยันอีเมลของคุณ": "Verify your email",
  "ยืนยันอีเมล": "Verify email",
  "ยืนยันอีเมลของบัญชีของคุณ": "Verify the email of your account",
  "อีเมล": "Email",
  "ร้านส่งลิงก์ยืนยันไปที่ {email} แล้ว กดลิงก์ในอีเมลเพื่อยืนยัน (ดูในอีเมลขยะด้วย) ยืนยันแล้วจึงสั่งซื้อและชำระเงินได้":
    "We sent a verification link to {email}. Open it to verify (check your spam folder too). You can order and pay once your email is verified.",
  "ยืนยันอีเมล {email} ก่อนสั่งซื้อและชำระเงิน ลิงก์อยู่ในอีเมลที่ร้านส่งให้":
    "Verify {email} before you order or pay. The link is in the email we sent you.",
  "บัญชีนี้ยังไม่มีอีเมล กรุณาเพิ่มอีเมลเพื่อรับลิงก์ยืนยันก่อนสั่งซื้อ":
    "This account has no email yet. Add one to get a verification link before you order.",
  "ส่งลิงก์อีกครั้ง": "Resend link",
  "ส่งอีกครั้งได้ใน {seconds} วินาที": "Resend in {seconds}s",
  "ส่งลิงก์ใหม่แล้ว ลิงก์เดิมใช้ไม่ได้แล้ว": "New link sent. Older links no longer work.",
  "เปลี่ยนอีเมล": "Change email",
  "เพิ่มอีเมล": "Add email",
  "อีเมลใหม่": "New email",
  "รหัสผ่านปัจจุบัน": "Current password",
  "บันทึกและส่งลิงก์": "Save and send link",
  "ยกเลิก": "Cancel",
  "เปลี่ยนอีเมลแล้ว ร้านส่งลิงก์ยืนยันไปที่อีเมลใหม่": "Email changed. We sent a verification link to the new address.",
  "ยืนยันแล้ว? ตรวจสอบอีกครั้ง": "Verified already? Check again",
  "ยังไม่ได้ยืนยัน กรุณากดลิงก์ในอีเมลก่อน": "Not verified yet. Please open the link in the email first.",
  "อีเมลยืนยันแล้ว": "Email verified",
  "ยืนยันอีเมลแล้ว": "Email verified",
  "อีเมลนี้ยืนยันแล้ว": "This email is already verified",
  "สั่งซื้อและชำระเงินได้ตามปกติแล้ว": "You can order and pay as usual now.",
  "กำลังยืนยันอีเมล…": "Verifying your email…",
  "ลิงก์ใช้ไม่ได้": "This link does not work",
  "ไปชำระเงินต่อ": "Continue to checkout",
  "เลือกซื้อสินค้าต่อ": "Continue shopping",
  "ไปหน้าบัญชีของฉัน": "Go to my account",
  "เข้าสู่ระบบเพื่อขอลิงก์ใหม่": "Sign in to get a new link",
  "ขอลิงก์ใหม่ในหน้าบัญชี": "Get a new link on your account page",
  "สมัครสมาชิกสำเร็จ ตรวจอีเมลเพื่อยืนยัน": "Signed up. Check your email to verify.",
  "ร้านจะส่งลิงก์ยืนยันไปที่อีเมลนี้": "We will send a verification link to this address",
  "ต้องเป็นอีเมลที่ใช้งานได้จริง": "Use an email address you can open",
  "กรุณายืนยันอีเมลก่อนสั่งซื้อ": "Please verify your email before ordering",
  "กรุณายืนยันอีเมลก่อนชำระเงิน": "Please verify your email before paying",
  "ลิงก์ยืนยันอีเมลไม่ถูกต้อง กรุณาเปิดลิงก์จากอีเมลอีกครั้ง":
    "This verification link is not valid. Open the link from the email again.",
  "ลิงก์ยืนยันอีเมลหมดอายุแล้ว กรุณาเข้าสู่ระบบแล้วกด “ส่งลิงก์อีกครั้ง”":
    "This verification link has expired. Sign in and press “Resend link”.",
  "ลิงก์นี้ใช้ไม่ได้แล้ว เพราะมีลิงก์ใหม่กว่าส่งไปแทน กรุณาเปิดลิงก์ในอีเมลฉบับล่าสุด":
    "This link was replaced by a newer one. Open the link in the latest email.",
  "กรุณากรอกอีเมลที่ใช้งานได้ ร้านจะส่งลิงก์ยืนยันไปที่อีเมลนี้":
    "Please enter a working email. We will send a verification link to it.",
};
for (const [th, en] of Object.entries(EN_VERIFY)) EN_STRINGS[th] ??= en;

/** True while this customer is blocked from ordering / paying until the email is verified. */
export function needsEmailVerification(user: User | null | undefined) {
  return !!user && user.emailVerified === false && !!user.emailVerification?.required;
}
export function useEmailVerifyNeeded() {
  return needsEmailVerification(useStore().user);
}

/** Seconds left on the resend cooldown, ticking down once a second. */
function useCountdown(initial: number) {
  const [left, setLeft] = useState(initial);
  useEffect(() => setLeft(initial), [initial]);
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [left]);
  return [left, setLeft] as const;
}

/**
 * Nothing unless the customer must verify. `compact`: one line + resend (product page,
 * checkout, pay); the full card (account page) also changes the address.
 */
export function EmailVerifyNotice({ compact = false }: { compact?: boolean }) {
  const { user, refresh, toast } = useStore();
  const info = user?.emailVerification;
  const [left, setLeft] = useCountdown(info?.resendInSeconds ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  if (!user || !needsEmailVerification(user) || !info) return null;
  const email = info.hasEmail ? user.email : "";
  async function resend() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ emailVerification?: { resendInSeconds: number } }>("/verify-email/resend", {});
      setLeft(result.emailVerification?.resendInSeconds ?? 60);
      toast(t("ส่งลิงก์ใหม่แล้ว ลิงก์เดิมใช้ไม่ได้แล้ว"));
    } catch (e) {
      const message = (e as Error).message;
      const wait = /(\d+)\s*วินาที/.exec(message)?.[1];
      if (wait) setLeft(Number(wait));
      else setError(message);
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setError("");
    try {
      const me = await api<{ user: User | null }>("/me");
      if (me.user?.emailVerified) {
        await refresh();
        toast(t("อีเมลยืนยันแล้ว"));
      } else setError("ยังไม่ได้ยืนยัน กรุณากดลิงก์ในอีเมลก่อน");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={"email-verify-card" + (compact ? " compact" : "")}
      role="status"
      aria-labelledby={compact ? undefined : "email-verify-title"}
      id={compact ? undefined : "verify-email"}
    >
      <span className="email-verify-icon" aria-hidden="true">
        <MailWarning size={compact ? 18 : 20} />
      </span>
      <div className="email-verify-body">
        <strong id={compact ? undefined : "email-verify-title"}>{t("ยืนยันอีเมลของคุณ")}</strong>
        <p>
          {!email
            ? t("บัญชีนี้ยังไม่มีอีเมล กรุณาเพิ่มอีเมลเพื่อรับลิงก์ยืนยันก่อนสั่งซื้อ")
            : compact
              ? t("ยืนยันอีเมล {email} ก่อนสั่งซื้อและชำระเงิน ลิงก์อยู่ในอีเมลที่ร้านส่งให้", { email })
              : t(
                  "ร้านส่งลิงก์ยืนยันไปที่ {email} แล้ว กดลิงก์ในอีเมลเพื่อยืนยัน (ดูในอีเมลขยะด้วย) ยืนยันแล้วจึงสั่งซื้อและชำระเงินได้",
                  { email },
                )}
        </p>
        <ErrorMessage message={error} />
        {changing ? (
          <ChangeEmailForm
            hasEmail={!!email}
            onDone={() => {
              setChanging(false);
              setLeft(60);
            }}
            onCancel={() => setChanging(false)}
          />
        ) : (
          <div className="email-verify-actions">
            {email && info.canSend && (
              <button type="button" className="button primary" disabled={busy || left > 0} onClick={resend}>
                {busy ? <LoaderCircle className="spin" size={16} /> : null}
                {left > 0 ? t("ส่งอีกครั้งได้ใน {seconds} วินาที", { seconds: left }) : t("ส่งลิงก์อีกครั้ง")}
              </button>
            )}
            {compact ? (
              <Link to="/account" className="button secondary">
                {email ? t("เปลี่ยนอีเมล") : t("เพิ่มอีเมล")}
              </Link>
            ) : (
              <button type="button" className="button secondary" onClick={() => setChanging(true)}>
                {email ? t("เปลี่ยนอีเมล") : t("เพิ่มอีเมล")}
              </button>
            )}
            {!compact && email && (
              <button type="button" className="text-button email-verify-check" disabled={busy} onClick={check}>
                {t("ยืนยันแล้ว? ตรวจสอบอีกครั้ง")}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ChangeEmailForm({ hasEmail, onDone, onCancel }: { hasEmail: boolean; onDone: () => void; onCancel: () => void }) {
  const { refresh, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/verify-email/change", {
        email: String(form.get("email") ?? ""),
        currentPassword: String(form.get("currentPassword") ?? ""),
      });
      await refresh();
      toast(t("เปลี่ยนอีเมลแล้ว ร้านส่งลิงก์ยืนยันไปที่อีเมลใหม่"));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="email-verify-form" onSubmit={submit}>
      <ErrorMessage message={error} />
      <label className="field">
        {hasEmail ? t("อีเมลใหม่") : t("อีเมล")}
        <input name="email" type="email" autoComplete="email" maxLength={160} required autoFocus />
      </label>
      <label className="field">
        {t("รหัสผ่านปัจจุบัน")}
        <input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required />
      </label>
      <div className="email-verify-actions">
        <button className="button primary" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} /> : null}
          {t("บันทึกและส่งลิงก์")}
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          {t("ยกเลิก")}
        </button>
      </div>
    </form>
  );
}

type VerifyState =
  | { kind: "loading" }
  | { kind: "done"; already: boolean }
  | { kind: "error"; message: string };

/** /verify-email?token=… — the link from the email. Works without being signed in. */
export function VerifyEmailPage() {
  const { user, basket, refresh, go } = useStore();
  // Keep the token in memory and drop it from the address bar / history.
  const [token] = useState(() => new URLSearchParams(location.search).get("token") ?? "");
  const [state, setState] = useState<VerifyState>(() =>
    /^[a-f0-9]{64}$/.test(token)
      ? { kind: "loading" }
      : { kind: "error", message: "ลิงก์ยืนยันอีเมลไม่ถูกต้อง กรุณาเปิดลิงก์จากอีเมลอีกครั้ง" },
  );
  const sent = useRef(false);
  useEffect(() => {
    if (location.search) history.replaceState(history.state, "", "/verify-email");
    if (state.kind !== "loading" || sent.current) return;
    sent.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/verify-email", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Astra-Request": "1" },
          body: JSON.stringify({ token }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setState({ kind: "error", message: data.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่" });
          return;
        }
        setState({ kind: "done", already: !!data.alreadyVerified });
        await refresh();
      } catch {
        setState({ kind: "error", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจว่าระบบกำลังทำงาน" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const heading =
    state.kind === "loading"
      ? t("กำลังยืนยันอีเมล…")
      : state.kind === "done"
        ? state.already
          ? t("อีเมลนี้ยืนยันแล้ว")
          : t("ยืนยันอีเมลแล้ว")
        : t("ลิงก์ใช้ไม่ได้");
  return (
    <main className="reference-auth-main recovery-main verify-email-page">
      <div className="reference-auth-heading">
        <Link to="/" className="reference-auth-brand" aria-label={t("หน้าแรก")}>
          <BrandLogo />
        </Link>
        <h1>{heading}</h1>
      </div>
      <div className="reference-auth-form recovery-done" role="status" data-state={state.kind}>
        <span className={"recovery-icon" + (state.kind === "error" ? " verify-email-error-icon" : "")} aria-hidden="true">
          {state.kind === "loading" ? (
            <LoaderCircle className="spin" size={22} />
          ) : state.kind === "done" ? (
            state.already ? <MailCheck size={22} /> : <CheckCircle2 size={22} />
          ) : (
            <MailX size={22} />
          )}
        </span>
        {state.kind === "done" && <p>{t("สั่งซื้อและชำระเงินได้ตามปกติแล้ว")}</p>}
        {state.kind === "error" && <ErrorMessage message={state.message} />}
        {state.kind === "done" &&
          (basket ? (
            <button type="button" className="button primary full" onClick={() => go("/checkout")}>
              {t("ไปชำระเงินต่อ")}
              <ArrowRight size={17} />
            </button>
          ) : (
            <button type="button" className="button primary full" onClick={() => go("/products")}>
              {t("เลือกซื้อสินค้าต่อ")}
              <ArrowRight size={17} />
            </button>
          ))}
        {state.kind === "error" &&
          (user ? (
            <button type="button" className="button primary full" onClick={() => go("/account")}>
              {t("ขอลิงก์ใหม่ในหน้าบัญชี")}
            </button>
          ) : (
            <button type="button" className="button primary full" onClick={() => go("/login?next=%2Faccount")}>
              {t("เข้าสู่ระบบเพื่อขอลิงก์ใหม่")}
            </button>
          ))}
      </div>
    </main>
  );
}
