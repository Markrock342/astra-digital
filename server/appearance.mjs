/**
 * ตั้งค่า › หน้าตาร้าน — storefront appearance (ADMIN only, every change audited).
 *
 * Stored as JSON in runtime_flags 'storefront-appearance' (no new table): the parts the admin
 * changed + the file keys of an uploaded OG image / favicon. Rules, limits and defaults live in
 * appearance-rules.mjs (shared with the React app).
 *
 *   adminAppearance(user)                  → full settings + defaults + limits (for the editor)
 *   saveAppearance(user, { part: value })  → validate + replace those parts      APPEARANCE_SAVE
 *   resetAppearance(user, { part })        → one part (or "all") back to default APPEARANCE_RESET
 *   setAppearanceImage(user, kind, upload) → OG image / favicon (JPEG/PNG/WebP)  APPEARANCE_OG_SET …
 *   removeAppearanceImage(user, kind)      → back to /brand/og.png, favicon-64   APPEARANCE_OG_REMOVE …
 *   publicAppearance()                     → what /api/overview exposes (no file keys, no who/when)
 *
 * The footer credit ("Theme By limitcode studio") is not part of this data at all.
 */
import { assertAllowedImage } from "./file-store.mjs";
import {
  APPEARANCE_PARTS,
  DEFAULT_APPEARANCE,
  LIMITS,
  normalizeAppearanceParts,
  resolveAppearance,
} from "./appearance-rules.mjs";

export const APPEARANCE_KEY = "storefront-appearance";
export const APPEARANCE_IMAGES = {
  og: { field: "ogImageKey", set: "APPEARANCE_OG_SET", remove: "APPEARANCE_OG_REMOVE" },
  favicon: { field: "faviconKey", set: "APPEARANCE_FAVICON_SET", remove: "APPEARANCE_FAVICON_REMOVE" },
};
const fileUrl = (key) => (key ? "/api/files/" + key : null);
const validKey = (key) => typeof key === "string" && /^[0-9a-f-]{8,64}$/i.test(key);

export function createAppearanceApis({ requireAdmin, one, run, fail, randomUUID, fileStore }) {
  function readStored() {
    const row = one("SELECT value FROM runtime_flags WHERE key=?", APPEARANCE_KEY);
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  function writeStored(stored) {
    run(
      "INSERT INTO runtime_flags(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      APPEARANCE_KEY,
      JSON.stringify(stored),
    );
  }
  const audit = (user, action, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      action,
      "appearance",
      detail ? JSON.stringify(detail) : null,
    );

  /** Complete appearance (defaults filled in) + public image URLs. */
  function current(stored = readStored()) {
    const appearance = resolveAppearance(stored);
    appearance.seo.ogImageUrl = validKey(stored.ogImageKey) ? fileUrl(stored.ogImageKey) : null;
    appearance.seo.faviconUrl = validKey(stored.faviconKey) ? fileUrl(stored.faviconKey) : null;
    return appearance;
  }
  /** Parts that differ from the defaults (shown as "แก้แล้ว" in the editor). */
  function customized(appearance) {
    const parts = APPEARANCE_PARTS.filter(
      (part) =>
        part !== "seo" && JSON.stringify(appearance[part]) !== JSON.stringify(DEFAULT_APPEARANCE[part]),
    );
    const seo = appearance.seo;
    if (
      JSON.stringify({ title: seo.title, description: seo.description }) !==
        JSON.stringify(DEFAULT_APPEARANCE.seo) ||
      seo.ogImageUrl ||
      seo.faviconUrl
    )
      parts.push("seo");
    return parts;
  }

  /** /api/overview: only what the storefront renders. */
  function publicAppearance() {
    return current();
  }

  function adminAppearance(user) {
    requireAdmin(user);
    const stored = readStored();
    const appearance = current(stored);
    return {
      appearance,
      defaults: DEFAULT_APPEARANCE,
      limits: LIMITS,
      customized: customized(appearance),
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null,
    };
  }

  function saveAppearance(user, input = {}) {
    requireAdmin(user);
    const parts = normalizeAppearanceParts(input, fail);
    const stored = readStored();
    const before = resolveAppearance(stored);
    const changed = Object.keys(parts).filter(
      (part) => JSON.stringify(before[part]) !== JSON.stringify(parts[part]),
    );
    if (changed.length) {
      for (const part of changed) stored[part] = parts[part];
      stored.updatedAt = new Date().toISOString();
      writeStored(stored);
      audit(user, "APPEARANCE_SAVE", { parts: changed });
    }
    return { ...adminAppearance(user), changed };
  }

  async function resetAppearance(user, input = {}) {
    requireAdmin(user);
    const part = input.part;
    if (part !== "all" && !APPEARANCE_PARTS.includes(part)) fail(400, "ไม่รู้จักส่วนที่จะคืนค่า");
    const stored = readStored();
    const parts = part === "all" ? APPEARANCE_PARTS : [part];
    const removed = [];
    for (const name of parts) delete stored[name];
    // SEO reset also drops the uploaded OG image / favicon (back to the built-in files).
    if (parts.includes("seo"))
      for (const { field } of Object.values(APPEARANCE_IMAGES))
        if (stored[field]) {
          removed.push(stored[field]);
          delete stored[field];
        }
    stored.updatedAt = new Date().toISOString();
    writeStored(stored);
    audit(user, "APPEARANCE_RESET", { part });
    for (const key of removed) await deleteFile(key);
    return adminAppearance(user);
  }

  async function deleteFile(key) {
    if (!validKey(key)) return;
    try {
      await fileStore.delete(key);
    } catch (error) {
      console.error("Failed to delete appearance image", key, error.message);
    }
  }

  async function setAppearanceImage(user, kind, { bytes, contentType } = {}) {
    requireAdmin(user);
    const spec = APPEARANCE_IMAGES[kind];
    if (!spec) fail(404, "ไม่พบหน้าที่ร้องขอ");
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const key = randomUUID();
    await fileStore.put(key, bytes, mime);
    let previous = null;
    try {
      const stored = readStored();
      previous = stored[spec.field] ?? null;
      stored[spec.field] = key;
      stored.updatedAt = new Date().toISOString();
      writeStored(stored);
      audit(user, spec.set, { replaced: !!previous });
    } catch (error) {
      await deleteFile(key);
      throw error;
    }
    if (previous && previous !== key) await deleteFile(previous);
    return adminAppearance(user);
  }

  async function removeAppearanceImage(user, kind) {
    requireAdmin(user);
    const spec = APPEARANCE_IMAGES[kind];
    if (!spec) fail(404, "ไม่พบหน้าที่ร้องขอ");
    const stored = readStored();
    const previous = stored[spec.field] ?? null;
    if (previous) {
      delete stored[spec.field];
      stored.updatedAt = new Date().toISOString();
      writeStored(stored);
      audit(user, spec.remove);
      await deleteFile(previous);
    }
    return adminAppearance(user);
  }

  return {
    publicAppearance,
    adminAppearance,
    saveAppearance,
    resetAppearance,
    setAppearanceImage,
    removeAppearanceImage,
  };
}
