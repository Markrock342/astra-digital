/**
 * ข่าวสารและกิจกรรม — news / event posts (table from ensureNewsAbout in ensure-admin-fr.mjs).
 *
 * Admin (ADMIN only, every change audited as NEWS_*):
 *   create / edit (title, summary, body TH + optional EN, event dates, link button, pinned,
 *   publish switch + optional Bangkok publish-at) · delete · upload / remove the cover image
 *   (JPEG/PNG/WebP, same 2 MB cap and magic-byte check as banners). A post is created first
 *   (JSON), then its cover goes to /api/admin/news/<id>/cover, like banner images.
 *
 * Public (/api/news, /api/news/<id>): published and publish-at reached, pinned first, then
 * newest first. A draft or scheduled post is a 404 for visitors. Covers are public files.
 * Files: a replaced / removed cover and the cover of a deleted post leave the file store.
 */
import { assertAllowedImage } from "./file-store.mjs";
import { bannerTimeInput, normalizeBannerLink } from "./banners.mjs";
import { NEWS_LIMITS, bangkokDate, eventState, richTextPlain } from "./content-rules.mjs";

const BKK_MS = 7 * 3600000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const msOf = (sql) => Date.parse(sql.replace(" ", "T") + "Z");
const bangkokLocal = (sql) => (sql ? new Date(msOf(sql) + BKK_MS).toISOString().slice(0, 16) : null);
const fileUrl = (key) => (key ? "/api/files/" + key : null);
const DATE_SQL = "COALESCE(publish_at,published_at,created_at)";
const ORDER = ` ORDER BY pinned DESC, ${DATE_SQL} DESC, created_at DESC, id DESC`;
const TEXT_FIELDS = ["title", "title_en", "summary", "summary_en", "body", "body_en", "link_label", "link_label_en"];

/** draft (switch off) · scheduled (on, publish-at in the future) · live. */
export function newsStatus(row, nowSql) {
  if (!row.published) return "draft";
  if (row.publish_at && row.publish_at > nowSql) return "scheduled";
  return "live";
}

/** Calendar date "YYYY-MM-DD" (Bangkok) or null. */
export function newsDateInput(value, label, fail) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(400, label + "ไม่ถูกต้อง");
  const ms = Date.parse(text + "T00:00:00Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== text) fail(400, label + "ไม่ถูกต้อง");
  return text;
}

export function createNewsApis({ requireAdmin, one, all, run, tx, fail, randomUUID, fileStore, clock }) {
  const now = () => sqlTime(clock());
  const today = () => bangkokDate(clock());
  const audit = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      action,
      entity,
      detail ? JSON.stringify(detail) : null,
    );
  const postId = (value) => {
    const id = typeof value === "string" ? value.trim() : "";
    if (!/^[0-9a-f-]{8,64}$/i.test(id)) fail(404, "ไม่พบข่าว");
    return id;
  };
  const load = (id) => {
    const row = one("SELECT * FROM news_posts WHERE id=?", id);
    if (!row) fail(404, "ไม่พบข่าว");
    return row;
  };

  /** Single-line text (titles, labels): whitespace collapsed. "" → null unless required. */
  function line(value, label, max, required) {
    if (value !== undefined && value !== null && typeof value !== "string") fail(400, label + "ไม่ถูกต้อง");
    const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) {
      if (required) fail(400, "กรุณาใส่" + label);
      return null;
    }
    if (text.length > max) fail(400, label + "ยาวเกิน " + max + " ตัวอักษร");
    return text;
  }
  /** Multi-line text (summary, body): line breaks kept, other control characters dropped. */
  function block(value, label, max) {
    if (value !== undefined && value !== null && typeof value !== "string") fail(400, label + "ไม่ถูกต้อง");
    const text = String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) return null;
    if (text.length > max) fail(400, label + "ยาวเกิน " + max + " ตัวอักษร");
    return text;
  }
  const flag = (value, label) => {
    if (typeof value !== "boolean") fail(400, label + "ไม่ถูกต้อง");
    return value ? 1 : 0;
  };

  /** Validated column values; `current` = the row being edited (fields not sent keep theirs). */
  function parse(input, current) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "ข้อมูลไม่ถูกต้อง");
    const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
    const pick = (key, column, read) => (has(key) || !current ? read(input[key]) : (current[column] ?? null));
    const L = NEWS_LIMITS;
    const values = {
      title: pick("title", "title", (v) => line(v, "หัวข้อข่าว", L.title, true)),
      title_en: pick("titleEn", "title_en", (v) => line(v, "หัวข้อภาษาอังกฤษ", L.title, false)),
      summary: pick("summary", "summary", (v) => block(v, "สรุปสั้น", L.summary)),
      summary_en: pick("summaryEn", "summary_en", (v) => block(v, "สรุปภาษาอังกฤษ", L.summary)),
      body: pick("body", "body", (v) => block(v, "เนื้อหา", L.body)),
      body_en: pick("bodyEn", "body_en", (v) => block(v, "เนื้อหาภาษาอังกฤษ", L.body)),
      event_starts: pick("eventStarts", "event_starts", (v) => newsDateInput(v, "วันเริ่มกิจกรรม", fail)),
      event_ends: pick("eventEnds", "event_ends", (v) => newsDateInput(v, "วันจบกิจกรรม", fail)),
      link_url: pick("link", "link_url", (v) => normalizeBannerLink(v, fail)),
      link_label: pick("linkLabel", "link_label", (v) => line(v, "ข้อความปุ่ม", L.linkLabel, false)),
      link_label_en: pick("linkLabelEn", "link_label_en", (v) => line(v, "ข้อความปุ่มภาษาอังกฤษ", L.linkLabel, false)),
      pinned: pick("pinned", "pinned", (v) => (v === undefined ? 0 : flag(v, "ปักหมุด"))),
      published: pick("published", "published", (v) => (v === undefined ? 0 : flag(v, "สถานะเผยแพร่"))),
      publish_at: pick("publishAt", "publish_at", (v) => bannerTimeInput(v, "เวลาเผยแพร่", false, fail)),
    };
    if (values.event_ends && !values.event_starts) fail(400, "กรุณาใส่วันเริ่มกิจกรรม");
    if (values.event_starts && values.event_ends && values.event_ends < values.event_starts)
      fail(400, "วันจบกิจกรรมต้องไม่ก่อนวันเริ่ม");
    if (!values.link_url) {
      values.link_label = null;
      values.link_label_en = null;
    }
    return values;
  }

  function adminShape(row, nowSql = now()) {
    return {
      ...publicShape(row, true),
      published: !!row.published,
      publishAt: row.publish_at ?? null,
      publishAtLocal: bangkokLocal(row.publish_at),
      publishedAt: row.published_at ?? null,
      status: newsStatus(row, nowSql),
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? null,
    };
  }
  function publicShape(row, withBody) {
    const post = {
      id: row.id,
      title: row.title,
      titleEn: row.title_en ?? null,
      summary: row.summary ?? null,
      summaryEn: row.summary_en ?? null,
      coverUrl: fileUrl(row.cover_key),
      eventStarts: row.event_starts ?? null,
      eventEnds: row.event_ends ?? null,
      eventState: eventState(row.event_starts, row.event_ends, today()),
      pinned: !!row.pinned,
      date: row.publish_at ?? row.published_at ?? row.created_at,
      link: row.link_url ?? null,
      linkLabel: row.link_label ?? null,
      linkLabelEn: row.link_label_en ?? null,
    };
    if (withBody) {
      post.body = row.body ?? null;
      post.bodyEn = row.body_en ?? null;
    } else if (!post.summary && row.body) {
      // Card text when no summary was written: the start of the body.
      const plain = richTextPlain(row.body);
      post.summary = plain.length > 160 ? plain.slice(0, 159) + "…" : plain;
      if (!post.summaryEn && row.body_en) {
        const en = richTextPlain(row.body_en);
        post.summaryEn = en.length > 160 ? en.slice(0, 159) + "…" : en;
      }
    }
    return post;
  }

  const VISIBLE = "published=1 AND (publish_at IS NULL OR publish_at<=?)";

  /** Storefront list: what visitors can read right now. */
  function publicNews() {
    const rows = all(
      `SELECT * FROM news_posts WHERE ${VISIBLE}` + ORDER + " LIMIT " + NEWS_LIMITS.publicList,
      now(),
    );
    return { posts: rows.map((row) => publicShape(row, false)) };
  }

  /** Storefront detail; a draft / scheduled / unknown post is "not found". */
  function publicNewsPost(rawId) {
    const id = postId(rawId);
    const row = one(`SELECT * FROM news_posts WHERE id=? AND ${VISIBLE}`, id, now());
    if (!row) fail(404, "ไม่พบข่าว");
    return { post: publicShape(row, true) };
  }

  function adminNews(user) {
    requireAdmin(user);
    const at = now();
    return {
      posts: all("SELECT * FROM news_posts" + ORDER).map((row) => adminShape(row, at)),
      limits: NEWS_LIMITS,
    };
  }

  function adminCreateNews(user, input = {}) {
    requireAdmin(user);
    const values = parse(input, null);
    return tx(() => {
      if (one("SELECT COUNT(*) AS n FROM news_posts").n >= NEWS_LIMITS.maxPosts)
        fail(409, "มีข่าวได้สูงสุด " + NEWS_LIMITS.maxPosts + " รายการ ลบข่าวเก่าก่อนเพิ่มใหม่");
      const id = randomUUID();
      const at = now();
      run(
        `INSERT INTO news_posts(id,title,title_en,summary,summary_en,body,body_en,event_starts,event_ends,
           link_url,link_label,link_label_en,pinned,published,publish_at,published_at,created_by,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        values.title,
        values.title_en,
        values.summary,
        values.summary_en,
        values.body,
        values.body_en,
        values.event_starts,
        values.event_ends,
        values.link_url,
        values.link_label,
        values.link_label_en,
        values.pinned,
        values.published,
        values.publish_at,
        values.published ? at : null,
        user.id,
        at,
      );
      audit(user, "NEWS_CREATE", id, {
        title: values.title,
        published: !!values.published,
        publishAt: values.publish_at,
        pinned: !!values.pinned,
      });
      return { post: adminShape(load(id)) };
    });
  }

  function adminUpdateNews(user, rawId, input = {}) {
    requireAdmin(user);
    const id = postId(rawId);
    return tx(() => {
      const before = load(id);
      const values = parse(input, before);
      const changed = {};
      for (const [key, value] of Object.entries(values)) {
        if ((before[key] ?? null) === value) continue;
        // Long texts: only the field name goes to the audit trail, not the text.
        changed[key] = TEXT_FIELDS.includes(key) && key !== "title"
          ? true
          : key === "pinned" || key === "published"
            ? { from: !!before[key], to: !!value }
            : { from: before[key] ?? null, to: value };
      }
      if (Object.keys(changed).length) {
        const publishedAt = values.published && !before.published_at ? now() : (before.published_at ?? null);
        run(
          `UPDATE news_posts SET title=?,title_en=?,summary=?,summary_en=?,body=?,body_en=?,event_starts=?,
             event_ends=?,link_url=?,link_label=?,link_label_en=?,pinned=?,published=?,publish_at=?,
             published_at=?,updated_at=? WHERE id=?`,
          values.title,
          values.title_en,
          values.summary,
          values.summary_en,
          values.body,
          values.body_en,
          values.event_starts,
          values.event_ends,
          values.link_url,
          values.link_label,
          values.link_label_en,
          values.pinned,
          values.published,
          values.publish_at,
          publishedAt,
          now(),
          id,
        );
        const action =
          changed.published && !before.published ? "NEWS_PUBLISH" : changed.published ? "NEWS_UNPUBLISH" : "NEWS_UPDATE";
        audit(user, action, id, { title: values.title, changed });
      }
      return { post: adminShape(load(id)), changed: Object.keys(changed) };
    });
  }

  async function deleteFile(key) {
    if (!key) return false;
    // Cover keys are never shared, but keep a file another post still points at.
    if (one("SELECT 1 AS n FROM news_posts WHERE cover_key=? LIMIT 1", key)) return false;
    try {
      await fileStore.delete(key);
      return true;
    } catch (error) {
      console.error("Failed to delete news cover", key, error.message);
      return false;
    }
  }

  async function adminSetNewsCover(user, rawId, { bytes, contentType } = {}) {
    requireAdmin(user);
    const id = postId(rawId);
    load(id);
    if (!bytes || bytes.byteLength === 0) fail(415, "ชนิดไฟล์ไม่ถูกต้อง");
    const mime = assertAllowedImage(contentType, bytes, fail);
    const key = randomUUID();
    await fileStore.put(key, bytes, mime);
    let previous = null;
    try {
      tx(() => {
        previous = load(id).cover_key ?? null;
        run("UPDATE news_posts SET cover_key=?,updated_at=? WHERE id=?", key, now(), id);
        audit(user, "NEWS_COVER_SET", id, { replaced: !!previous });
      });
    } catch (error) {
      try {
        await fileStore.delete(key);
      } catch {
        /* best-effort rollback of the orphan file */
      }
      throw error;
    }
    if (previous && previous !== key) await deleteFile(previous);
    return { post: adminShape(load(id)) };
  }

  async function adminRemoveNewsCover(user, rawId) {
    requireAdmin(user);
    const id = postId(rawId);
    let previous = null;
    tx(() => {
      previous = load(id).cover_key ?? null;
      if (!previous) return;
      run("UPDATE news_posts SET cover_key=NULL,updated_at=? WHERE id=?", now(), id);
      audit(user, "NEWS_COVER_REMOVE", id);
    });
    await deleteFile(previous);
    return { post: adminShape(load(id)) };
  }

  async function adminDeleteNews(user, rawId) {
    requireAdmin(user);
    const id = postId(rawId);
    let row = null;
    tx(() => {
      row = load(id);
      run("DELETE FROM news_posts WHERE id=?", id);
      audit(user, "NEWS_DELETE", id, { title: row.title });
    });
    const removed = row.cover_key ? await deleteFile(row.cover_key) : false;
    return { id, deleted: true, filesRemoved: removed ? 1 : 0 };
  }

  return {
    publicNews,
    publicNewsPost,
    adminNews,
    adminCreateNews,
    adminUpdateNews,
    adminSetNewsCover,
    adminRemoveNewsCover,
    adminDeleteNews,
  };
}
