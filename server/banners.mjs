/**
 * Promo banners on the storefront home (table from ensureBanners in ensure-admin-fr.mjs).
 *
 * Admin (ADMIN only, every change audited as BANNER_*):
 *   create / edit (alt text, link, Bangkok start/end, active) · reorder · delete ·
 *   upload the main image (JPEG/PNG/WebP, same 2 MB cap and magic-byte check as product
 *   images) and an optional mobile image.
 * A banner is created first (JSON), then its image goes to /api/admin/banners/<id>/image,
 * the same way product images follow the product. A banner without a main image is never
 * shown on the storefront.
 *
 * Public (`publicBanners`, part of /api/overview): active, has an image, inside its
 * start/end window, in admin order. Image files are public (/api/files/<key>).
 *
 * Files: a replaced or deleted image is removed from the file store once no banner,
 * product image or avatar uses that key any more (best effort, after the row change).
 */

import { assertAllowedImage } from "./file-store.mjs";

export const MAX_BANNERS = 8;
export const BANNER_ALT_MAX = 160;
export const BANNER_LINK_MAX = 500;
const BKK_MS = 7 * 3600000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const msOf = (sql) => Date.parse(sql.replace(" ", "T") + "Z");
/** UTC "YYYY-MM-DD HH:MM:SS" → Bangkok wall time "YYYY-MM-DDTHH:MM" (form value). */
const bangkokLocal = (sql) => (sql ? new Date(msOf(sql) + BKK_MS).toISOString().slice(0, 16) : null);
const fileUrl = (key) => (key ? "/api/files/" + key : null);

/**
 * Banner link: an in-shop path ("/products/x", "/products?category=y") or an https URL.
 * Returns the normalised link, null for "no link", or throws through fail().
 * Never accepts javascript:, data:, http:, protocol-relative "//host" or back-slash tricks.
 */
export function normalizeBannerLink(value, fail) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(400, "ลิงก์ไม่ถูกต้อง");
  const text = value.trim();
  if (!text) return null;
  if (text.length > BANNER_LINK_MAX) fail(400, "ลิงก์ยาวเกิน " + BANNER_LINK_MAX + " ตัวอักษร");
  // Control characters / whitespace inside a link are never legitimate here.
  if (/[\s\u0000-\u001f\u007f\\]/.test(text)) fail(400, "ลิงก์มีอักขระที่ใช้ไม่ได้");
  if (text.startsWith("/")) {
    if (text.startsWith("//")) fail(400, "ลิงก์ในร้านต้องขึ้นต้นด้วย / ตามด้วยหน้าในร้าน เช่น /products");
    if (!/^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/?#\u0080-\uffff]*$/.test(text))
      fail(400, "ลิงก์ในร้านมีอักขระที่ใช้ไม่ได้");
    let parsed;
    try {
      parsed = new URL(text, "https://shop.invalid");
    } catch {
      fail(400, "ลิงก์ไม่ถูกต้อง");
    }
    if (parsed.origin !== "https://shop.invalid") fail(400, "ลิงก์ไม่ถูกต้อง");
    if (/^\/api(?:\/|$)/i.test(parsed.pathname)) fail(400, "ลิงก์ไปหน้าระบบไม่ได้ ใช้หน้าในร้าน เช่น /products");
    return text;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    fail(400, "ลิงก์ต้องเป็นหน้าในร้าน (ขึ้นต้นด้วย /) หรือเว็บที่ขึ้นต้นด้วย https://");
  }
  if (url.protocol !== "https:")
    fail(400, "ลิงก์ต้องเป็นหน้าในร้าน (ขึ้นต้นด้วย /) หรือเว็บที่ขึ้นต้นด้วย https://");
  if (url.username || url.password || !url.hostname || !url.hostname.includes("."))
    fail(400, "ลิงก์เว็บไม่ถูกต้อง");
  return url.href;
}

/** Bangkok wall time from the form ("YYYY-MM-DDTHH:MM[:SS]" or a date) → UTC SQL, or null. */
export function bannerTimeInput(value, label, endOfDay, fail) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  let ms;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text))
    ms = Date.parse(text + (endOfDay ? "T23:59:59" : "T00:00:00") + "+07:00");
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text))
    ms = Date.parse(text + (text.length === 16 ? ":00" : "") + "+07:00");
  if (!Number.isFinite(ms)) fail(400, label + "ไม่ถูกต้อง");
  return sqlTime(ms);
}

/** live · scheduled · ended · off (switched off) · draft (no image yet). */
export function bannerStatus(row, nowSql) {
  if (!row.image_key) return "draft";
  if (!row.active) return "off";
  if (row.starts_at && nowSql < row.starts_at) return "scheduled";
  if (row.ends_at && nowSql >= row.ends_at) return "ended";
  return "live";
}

export function createBannerApis({ requireAdmin, one, all, run, tx, fail, randomUUID, fileStore, clock }) {
  const now = () => sqlTime(clock());
  const audit = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      action,
      entity,
      detail ? JSON.stringify(detail) : null,
    );
  const ordered = " ORDER BY sort_order ASC, created_at ASC, id ASC";
  const bannerId = (value) => {
    const id = typeof value === "string" ? value.trim() : "";
    if (!/^[0-9a-f-]{8,64}$/i.test(id)) fail(404, "ไม่พบแบนเนอร์");
    return id;
  };
  const load = (id) => {
    const row = one("SELECT * FROM banners WHERE id=?", id);
    if (!row) fail(404, "ไม่พบแบนเนอร์");
    return row;
  };
  const altText = (value) => {
    if (typeof value !== "string") fail(400, "กรุณาใส่ข้อความอธิบายรูป (alt)");
    const text = value.trim().replace(/\s+/g, " ");
    if (!text) fail(400, "กรุณาใส่ข้อความอธิบายรูป (alt)");
    if (text.length > BANNER_ALT_MAX) fail(400, "ข้อความอธิบายรูปยาวเกิน " + BANNER_ALT_MAX + " ตัวอักษร");
    return text;
  };
  const shape = (row, nowSql = now()) => ({
    id: row.id,
    alt: row.alt,
    link: row.link ?? null,
    imageUrl: fileUrl(row.image_key),
    mobileImageUrl: fileUrl(row.mobile_image_key),
    active: !!row.active,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    startsAtLocal: bangkokLocal(row.starts_at),
    endsAtLocal: bangkokLocal(row.ends_at),
    sortOrder: row.sort_order,
    status: bannerStatus(row, nowSql),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  });
  const list = () => {
    const at = now();
    return all("SELECT * FROM banners" + ordered).map((row) => shape(row, at));
  };

  /** Storefront: what the home carousel shows right now. */
  function publicBanners() {
    const at = now();
    return all(
      `SELECT id,alt,link,image_key,mobile_image_key FROM banners
       WHERE active=1 AND image_key IS NOT NULL
         AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)` + ordered,
      at,
      at,
    ).map((row) => ({
      id: row.id,
      alt: row.alt,
      link: row.link ?? null,
      imageUrl: fileUrl(row.image_key),
      mobileImageUrl: fileUrl(row.mobile_image_key),
    }));
  }

  function adminBanners(user) {
    requireAdmin(user);
    return { banners: list(), max: MAX_BANNERS };
  }

  /** Validated values; `current` = the row being edited (fields not sent keep their value). */
  function parse(input, current) {
    const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
    const alt = has("alt") || !current ? altText(input.alt) : current.alt;
    const link = has("link") ? normalizeBannerLink(input.link, fail) : (current?.link ?? null);
    const startsAt = has("startsAt")
      ? bannerTimeInput(input.startsAt, "เวลาเริ่ม", false, fail)
      : (current?.starts_at ?? null);
    const endsAt = has("endsAt")
      ? bannerTimeInput(input.endsAt, "เวลาสิ้นสุด", true, fail)
      : (current?.ends_at ?? null);
    if (startsAt && endsAt && endsAt <= startsAt) fail(400, "เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
    let active = current ? current.active : 1;
    if (has("active")) {
      if (typeof input.active !== "boolean") fail(400, "สถานะเปิด/ปิดไม่ถูกต้อง");
      active = input.active ? 1 : 0;
    }
    return { alt, link, starts_at: startsAt, ends_at: endsAt, active };
  }

  function adminCreateBanner(user, input = {}) {
    requireAdmin(user);
    const values = parse(input, null);
    return tx(() => {
      if (one("SELECT COUNT(*) AS n FROM banners").n >= MAX_BANNERS)
        fail(409, "มีแบนเนอร์ได้สูงสุด " + MAX_BANNERS + " รายการ ลบอันเก่าก่อนเพิ่มใหม่");
      const id = randomUUID();
      const last = one("SELECT COALESCE(MAX(sort_order),0) AS n FROM banners").n;
      run(
        "INSERT INTO banners(id,alt,link,starts_at,ends_at,active,sort_order,created_by) VALUES(?,?,?,?,?,?,?,?)",
        id,
        values.alt,
        values.link,
        values.starts_at,
        values.ends_at,
        values.active,
        last + 10,
        user.id,
      );
      audit(user, "BANNER_CREATE", id, {
        alt: values.alt,
        link: values.link,
        startsAt: values.starts_at,
        endsAt: values.ends_at,
        active: !!values.active,
      });
      return { banner: shape(load(id)) };
    });
  }

  function adminUpdateBanner(user, rawId, input = {}) {
    requireAdmin(user);
    const id = bannerId(rawId);
    return tx(() => {
      const before = load(id);
      const values = parse(input, before);
      const changed = {};
      for (const [key, value] of Object.entries(values)) {
        if ((before[key] ?? null) === value) continue;
        changed[key] =
          key === "active" ? { from: !!before.active, to: !!value } : { from: before[key] ?? null, to: value };
      }
      if (Object.keys(changed).length) {
        run(
          "UPDATE banners SET alt=?,link=?,starts_at=?,ends_at=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          values.alt,
          values.link,
          values.starts_at,
          values.ends_at,
          values.active,
          id,
        );
        audit(user, "BANNER_UPDATE", id, { changed });
      }
      return { banner: shape(load(id)), changed: Object.keys(changed) };
    });
  }

  /** Full order of ids (the up/down buttons send the list after the swap). */
  function adminReorderBanners(user, input = {}) {
    requireAdmin(user);
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > MAX_BANNERS)
      fail(400, "ลำดับแบนเนอร์ไม่ถูกต้อง");
    const ids = input.ids.map((value) => bannerId(value));
    if (new Set(ids).size !== ids.length) fail(400, "ลำดับแบนเนอร์ซ้ำกัน");
    return tx(() => {
      const current = all("SELECT id FROM banners" + ordered).map((r) => r.id);
      if (current.length !== ids.length || !ids.every((x) => current.includes(x)))
        fail(409, "รายการแบนเนอร์เปลี่ยนไปแล้ว กรุณาโหลดใหม่");
      const changed = ids.some((x, i) => current[i] !== x);
      if (changed) {
        ids.forEach((x, i) => run("UPDATE banners SET sort_order=? WHERE id=?", (i + 1) * 10, x));
        audit(user, "BANNER_REORDER", "order", { changed: { order: { from: current, to: ids } } });
      }
      return { banners: list(), changed };
    });
  }

  /** True while any banner, product image or avatar still points at this file key. */
  function fileInUse(key) {
    if (!key) return false;
    if (one("SELECT 1 AS n FROM banners WHERE image_key=? OR mobile_image_key=? LIMIT 1", key, key)) return true;
    if (one("SELECT 1 AS n FROM product_images WHERE file_key=? LIMIT 1", key)) return true;
    if (one("SELECT 1 AS n FROM users WHERE avatar_key=? LIMIT 1", key)) return true;
    return false;
  }
  async function deleteFileIfUnused(key) {
    if (!key || fileInUse(key)) return false;
    try {
      await fileStore.delete(key);
      return true;
    } catch (error) {
      console.error("Failed to delete banner image file", key, error.message);
      return false;
    }
  }

  /** kind "main" (required for the storefront) or "mobile" (optional, small screens). */
  async function adminSetBannerImage(user, rawId, { bytes, contentType } = {}, kind = "main") {
    requireAdmin(user);
    const id = bannerId(rawId);
    load(id);
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const column = kind === "mobile" ? "mobile_image_key" : "image_key";
    const key = randomUUID();
    await fileStore.put(key, bytes, mime);
    let previous = null;
    try {
      tx(() => {
        const row = load(id);
        previous = row[column] ?? null;
        run(`UPDATE banners SET ${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, key, id);
        audit(user, kind === "mobile" ? "BANNER_MOBILE_IMAGE_SET" : "BANNER_IMAGE_SET", id, {
          replaced: !!previous,
        });
      });
    } catch (error) {
      try {
        await fileStore.delete(key);
      } catch {
        /* best-effort rollback of the orphan file */
      }
      throw error;
    }
    if (previous && previous !== key) await deleteFileIfUnused(previous);
    return { banner: shape(load(id)) };
  }

  /** Only the mobile image can be removed; the main image can only be replaced. */
  async function adminRemoveBannerMobileImage(user, rawId) {
    requireAdmin(user);
    const id = bannerId(rawId);
    let previous = null;
    tx(() => {
      const row = load(id);
      previous = row.mobile_image_key ?? null;
      if (!previous) return;
      run("UPDATE banners SET mobile_image_key=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?", id);
      audit(user, "BANNER_MOBILE_IMAGE_REMOVE", id);
    });
    await deleteFileIfUnused(previous);
    return { banner: shape(load(id)) };
  }

  async function adminDeleteBanner(user, rawId) {
    requireAdmin(user);
    const id = bannerId(rawId);
    let row = null;
    tx(() => {
      row = load(id);
      run("DELETE FROM banners WHERE id=?", id);
      audit(user, "BANNER_DELETE", id, { alt: row.alt });
    });
    const removed = [];
    for (const key of [row.image_key, row.mobile_image_key])
      if (key && (await deleteFileIfUnused(key))) removed.push(key);
    return { id, deleted: true, filesRemoved: removed.length };
  }

  return {
    publicBanners,
    adminBanners,
    adminCreateBanner,
    adminUpdateBanner,
    adminReorderBanners,
    adminSetBannerImage,
    adminRemoveBannerMobileImage,
    adminDeleteBanner,
    fileInUse,
  };
}
