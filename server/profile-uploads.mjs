/** Admin FR W5 UP-2 — profile avatar + shop logo. */

import { randomUUID } from "node:crypto";
import { assertAllowedImage } from "./file-store.mjs";

export function createProfileUploadApis({
  requireUser,
  requireAdmin,
  one,
  run,
  fail,
  audit,
  fileStore,
  /** Raw shop-settings object (may include logoKey); caller persists via writeShopSettings. */
  readShopSettings,
  writeShopSettings,
}) {
  function fileUrl(key) {
    return "/api/files/" + key;
  }

  async function deleteFileBestEffort(key) {
    if (!key) return;
    try {
      await fileStore.delete(key);
    } catch (error) {
      console.error("Failed to delete upload file", key, error.message);
    }
  }

  async function setAvatar(user, { bytes, contentType }) {
    requireUser(user);
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const key = randomUUID();
    const previous = user.avatar_key ?? null;
    await fileStore.put(key, bytes, mime);
    try {
      run("UPDATE users SET avatar_key=? WHERE id=?", key, user.id);
      audit(user, "AVATAR_SET", user.id);
    } catch (error) {
      await deleteFileBestEffort(key);
      throw error;
    }
    user.avatar_key = key;
    if (previous && previous !== key) await deleteFileBestEffort(previous);
    return { avatarUrl: fileUrl(key) };
  }

  async function removeAvatar(user) {
    requireUser(user);
    const previous = user.avatar_key ?? null;
    run("UPDATE users SET avatar_key=NULL WHERE id=?", user.id);
    user.avatar_key = null;
    audit(user, "AVATAR_REMOVE", user.id);
    await deleteFileBestEffort(previous);
    return { avatarUrl: null };
  }

  async function setLogo(user, { bytes, contentType }) {
    requireAdmin(user);
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const key = randomUUID();
    const current = { ...readShopSettings() };
    const previous = typeof current.logoKey === "string" ? current.logoKey : null;
    delete current.logoUrl;
    await fileStore.put(key, bytes, mime);
    try {
      current.logoKey = key;
      writeShopSettings(current);
      audit(user, "LOGO_SET", key);
    } catch (error) {
      await deleteFileBestEffort(key);
      throw error;
    }
    if (previous && previous !== key) await deleteFileBestEffort(previous);
    return { logoUrl: fileUrl(key) };
  }

  async function removeLogo(user) {
    requireAdmin(user);
    const current = { ...readShopSettings() };
    const previous = typeof current.logoKey === "string" ? current.logoKey : null;
    delete current.logoKey;
    delete current.logoUrl;
    writeShopSettings(current);
    audit(user, "LOGO_REMOVE", previous);
    await deleteFileBestEffort(previous);
    return { logoUrl: null };
  }

  return { setAvatar, removeAvatar, setLogo, removeLogo, fileUrl };
}
