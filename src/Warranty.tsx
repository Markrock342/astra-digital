// Warranty end date snapshotted on the order at delivery (orders/reservations.warranty_until).
import { ShieldCheck, ShieldOff } from "lucide-react";
import { locale, t } from "./i18n";

const parse = (value: string) => new Date(value.replace(" ", "T") + "Z");

export function warrantyDate(value: string) {
  return parse(value).toLocaleDateString(locale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });
}

/** "รับประกันถึง <date>" while covered, "หมดประกันแล้ว" after; nothing when the order had no warranty. */
export function WarrantyStatus({ until, now = Date.now() }: { until?: string | null; now?: number }) {
  if (!until) return null;
  const date = warrantyDate(until);
  const expired = parse(until).getTime() < now;
  return (
    <p className={"warranty-status " + (expired ? "is-expired" : "is-active")} title={date}>
      {expired ? <ShieldOff size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
      <span>{expired ? t("หมดประกันแล้ว") + " · " + date : t("รับประกันถึง {date}", { date })}</span>
    </p>
  );
}

/** Storefront option label: "รับประกัน N วัน" when the option has a warranty. */
export function WarrantyDays({ days }: { days?: number | null }) {
  if (!days || days <= 0) return null;
  return <span className="warranty-days">{t("รับประกัน {n} วัน", { n: days })}</span>;
}
