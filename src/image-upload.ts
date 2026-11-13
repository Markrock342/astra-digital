// Client side of the uploads contract (docs/prompts/ADMIN-FR-WORK5-uploads.md):
// resize + re-encode to webp in the browser (drops EXIF/GPS), then send the bytes as the body.

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function checkSource(file: File) {
  if (!ACCEPTED.includes(file.type)) return "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP";
  if (file.size > MAX_SOURCE_BYTES) return "ไฟล์ใหญ่เกิน 15MB";
  return "";
}

/** Longest side ≤ maxSide, webp; steps quality down until it fits the 2MB server limit. */
export async function toWebp(file: File, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.86, 0.76, 0.64, 0.5]) {
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/webp", quality));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error("ย่อรูปให้เล็กกว่า 2MB ไม่ได้ ลองรูปที่เล็กลง");
}

/**
 * Like toWebp, for files that other apps read: link-preview images (JPEG, which every chat app
 * and social site shows) and favicons (PNG, which every browser shows).
 */
export async function toImage(file: File, maxSide: number, type: "image/jpeg" | "image/png"): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.88, 0.78, 0.66, 0.5]) {
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error("ย่อรูปให้เล็กกว่า 2MB ไม่ได้ ลองรูปที่เล็กลง");
}

/** POST raw image bytes (not JSON) to an upload endpoint. */
export async function uploadImage<T>(path: string, blob: Blob): Promise<T> {
  const response = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": blob.type || "image/webp", "X-Astra-Request": "1" },
    body: blob,
  });
  const data = await response.json().catch(() => ({ error: "อัปโหลดไม่สำเร็จ" }));
  if (!response.ok) throw new Error(data.error ?? "อัปโหลดไม่สำเร็จ");
  return data as T;
}
