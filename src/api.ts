import { locale, t } from "./i18n";
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method?: "PATCH" | "DELETE",
): Promise<T> {
  const write = body !== undefined || method !== undefined;
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    headers: write
      ? { "Content-Type": "application/json", "X-Astra-Request": "1" }
      : {},
    method: method ?? (body === undefined ? "GET" : "POST"),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({
      error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจว่าระบบกำลังทำงาน",
    }));
  if (!response.ok)
    throw new Error(data.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
  return data as T;
}
/** POST raw image bytes. The server checks the type and a 2MB cap itself. */
export async function uploadImage<T = unknown>(
  path: string,
  file: Blob,
  contentType: string,
): Promise<T> {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    method: "POST",
    headers: { "Content-Type": contentType, "X-Astra-Request": "1" },
    body: file,
  });
  const data = await response
    .json()
    .catch(() => ({
      error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจว่าระบบกำลังทำงาน",
    }));
  if (!response.ok)
    throw new Error(data.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่");
  return data as T;
}
export const money = (value: number) =>
  new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: "THB",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(value / 100);
export const dateTime = (value: string) =>
  new Date(value.replace(" ", "T") + "Z").toLocaleString(locale(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
export function relativeTime(value: string) {
  const seconds = Math.max(
    0,
    (Date.now() - new Date(value.replace(" ", "T") + "Z").getTime()) / 1000,
  );
  return seconds < 60
    ? t("เมื่อสักครู่")
    : seconds < 3600
      ? t("{n} นาทีที่ผ่านมา", { n: Math.floor(seconds / 60) })
      : seconds < 86400
        ? t("{n} ชั่วโมงที่ผ่านมา", { n: Math.floor(seconds / 3600) })
        : t("{n} วันที่ผ่านมา", { n: Math.floor(seconds / 86400) });
}
