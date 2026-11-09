export async function api<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Astra-Request": "1" },
    method: body === undefined ? "GET" : "POST",
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
export const money = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(value / 100);
export const dateTime = (value: string) =>
  new Date(value.replace(" ", "T") + "Z").toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export function relativeTime(value: string) {
  const seconds = Math.max(
    0,
    (Date.now() - new Date(value.replace(" ", "T") + "Z").getTime()) / 1000,
  );
  return seconds < 60
    ? "เมื่อสักครู่"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} นาทีที่ผ่านมา`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)} ชั่วโมงที่ผ่านมา`
        : `${Math.floor(seconds / 86400)} วันที่ผ่านมา`;
}
