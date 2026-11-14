/**
 * เกี่ยวกับเรา (/about) — one admin-editable page (ADMIN only, every change audited).
 *
 * Stored as JSON in runtime_flags 'about-page' (no table), like ตั้งค่า › หน้าตาร้าน:
 *   { heading, body, highlights, showContact, coverKey?, updatedAt }
 * Until the admin saves, the page shows defaultAbout(<shop name>) from content-rules.mjs.
 *
 *   publicAbout()                    → /api/about (no file key, no who/when)
 *   adminAbout(user)                 → content + defaults + limits + icon set
 *   saveAbout(user, content)         → validate + replace                      ABOUT_SAVE
 *   resetAbout(user)                 → back to the defaults (cover removed)    ABOUT_RESET
 *   setAboutCover / removeAboutCover → optional cover image                   ABOUT_COVER_*
 * The contact block reuses the shop contact settings (ตั้งค่า › ร้าน), nothing is copied here.
 */
import { assertAllowedImage } from "./file-store.mjs";
import { ABOUT_ICONS, ABOUT_LIMITS, defaultAbout } from "./content-rules.mjs";

export const ABOUT_KEY = "about-page";
const validKey = (key) => typeof key === "string" && /^[0-9a-f-]{8,64}$/i.test(key);
const fileUrl = (key) => (validKey(key) ? "/api/files/" + key : null);

/** Validate a full About content object (throws through fail). */
export function normalizeAbout(input, fail) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "ข้อมูลหน้าเกี่ยวกับเราไม่ถูกต้อง");
  const L = ABOUT_LIMITS;
  const line = (value, label, max, required) => {
    if (value !== undefined && value !== null && typeof value !== "string") fail(400, label + "ไม่ถูกต้อง");
    const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!text && required) fail(400, "กรุณาใส่" + label);
    if (text.length > max) fail(400, label + "ยาวเกิน " + max + " ตัวอักษร");
    return text;
  };
  const block = (value, label, max, required) => {
    if (value !== undefined && value !== null && typeof value !== "string") fail(400, label + "ไม่ถูกต้อง");
    const text = String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text && required) fail(400, "กรุณาใส่" + label);
    if (text.length > max) fail(400, label + "ยาวเกิน " + max + " ตัวอักษร");
    return text;
  };
  const pair = (value, label, read) => {
    if (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value)))
      fail(400, label + "ไม่ถูกต้อง");
    return { th: read(value?.th, label, true), en: read(value?.en, label + " (EN)", false) };
  };
  const heading = pair(input.heading, "หัวข้อ", (v, label, req) => line(v, label, L.heading, req));
  const body = pair(input.body, "เนื้อหา", (v, label, req) => block(v, label, L.body, req));
  const list = input.highlights ?? [];
  if (!Array.isArray(list)) fail(400, "จุดเด่นไม่ถูกต้อง");
  if (list.length > L.highlights) fail(400, "จุดเด่นได้สูงสุด " + L.highlights + " ข้อ");
  const highlights = list.map((item, i) => {
    if (!item || typeof item !== "object") fail(400, "จุดเด่นข้อ " + (i + 1) + " ไม่ถูกต้อง");
    if (!ABOUT_ICONS.includes(item.icon)) fail(400, "ไอคอนของจุดเด่นข้อ " + (i + 1) + " ไม่ถูกต้อง");
    return {
      icon: item.icon,
      title: pair(item.title, "หัวข้อจุดเด่นข้อ " + (i + 1), (v, label, req) => line(v, label, L.highlightTitle, req)),
      text: pair(item.text, "รายละเอียดจุดเด่นข้อ " + (i + 1), (v, label) => block(v, label, L.highlightText, false)),
    };
  });
  if (input.showContact !== undefined && typeof input.showContact !== "boolean") fail(400, "ตัวเลือกช่องทางติดต่อไม่ถูกต้อง");
  return { heading, body, highlights, showContact: input.showContact !== false };
}

export function createAboutApis({ requireAdmin, one, run, fail, randomUUID, fileStore, shopName }) {
  function readStored() {
    const row = one("SELECT value FROM runtime_flags WHERE key=?", ABOUT_KEY);
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
      ABOUT_KEY,
      JSON.stringify(stored),
    );
  }
  const audit = (user, action, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      action,
      "about",
      detail ? JSON.stringify(detail) : null,
    );
  const defaults = () => defaultAbout(shopName());

  /** Saved content (validated again on read, so a bad stored value falls back to defaults). */
  function current(stored = readStored()) {
    let content = defaults();
    if (stored.content) {
      try {
        content = normalizeAbout(stored.content, (status, message) => {
          throw new Error(message);
        });
      } catch {
        content = defaults();
      }
    }
    return { ...content, coverUrl: fileUrl(stored.coverKey) };
  }

  function publicAbout() {
    return { about: current() };
  }

  function adminAbout(user) {
    requireAdmin(user);
    const stored = readStored();
    return {
      about: current(stored),
      defaults: defaults(),
      limits: ABOUT_LIMITS,
      icons: ABOUT_ICONS,
      customized: !!stored.content || validKey(stored.coverKey),
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null,
    };
  }

  function saveAbout(user, input = {}) {
    requireAdmin(user);
    const content = normalizeAbout(input, fail);
    // Thai rewritten but the English still the built-in default text → that English no longer
    // matches; drop it so English visitors see the new Thai instead of the old default.
    const base = defaults();
    const stale = (pair, original) => {
      if (original && pair.th !== original.th && pair.en === original.en) pair.en = "";
    };
    stale(content.heading, base.heading);
    stale(content.body, base.body);
    content.highlights.forEach((item, i) => {
      stale(item.title, base.highlights[i]?.title);
      stale(item.text, base.highlights[i]?.text);
    });
    const stored = readStored();
    const before = current(stored);
    const changed = ["heading", "body", "highlights", "showContact"].filter(
      (part) => JSON.stringify(before[part]) !== JSON.stringify(content[part]),
    );
    if (changed.length || !stored.content) {
      stored.content = content;
      stored.updatedAt = new Date().toISOString();
      writeStored(stored);
      audit(user, "ABOUT_SAVE", { parts: changed });
    }
    return { ...adminAbout(user), changed };
  }

  async function deleteFile(key) {
    if (!validKey(key)) return;
    try {
      await fileStore.delete(key);
    } catch (error) {
      console.error("Failed to delete about cover", key, error.message);
    }
  }

  async function resetAbout(user) {
    requireAdmin(user);
    const stored = readStored();
    const cover = stored.coverKey ?? null;
    writeStored({ updatedAt: new Date().toISOString() });
    audit(user, "ABOUT_RESET", { coverRemoved: !!cover });
    if (cover) await deleteFile(cover);
    return adminAbout(user);
  }

  async function setAboutCover(user, { bytes, contentType } = {}) {
    requireAdmin(user);
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const key = randomUUID();
    await fileStore.put(key, bytes, mime);
    let previous = null;
    try {
      const stored = readStored();
      previous = stored.coverKey ?? null;
      stored.coverKey = key;
      stored.updatedAt = new Date().toISOString();
      writeStored(stored);
      audit(user, "ABOUT_COVER_SET", { replaced: !!previous });
    } catch (error) {
      await deleteFile(key);
      throw error;
    }
    if (previous && previous !== key) await deleteFile(previous);
    return adminAbout(user);
  }

  async function removeAboutCover(user) {
    requireAdmin(user);
    const stored = readStored();
    const previous = stored.coverKey ?? null;
    if (previous) {
      delete stored.coverKey;
      stored.updatedAt = new Date().toISOString();
      writeStored(stored);
      audit(user, "ABOUT_COVER_REMOVE");
      await deleteFile(previous);
    }
    return adminAbout(user);
  }

  return { publicAbout, adminAbout, saveAbout, resetAbout, setAboutCover, removeAboutCover };
}
