/**
 * Delivery type per product (วิธีส่งมอบ). Schema: ensureDeliveryOptions (ensure-admin-fr.mjs).
 *
 *   account  บัญชีส่วนตัว       ID + password, one stock row per sale (existing behaviour)
 *   shared   บัญชีแชร์          one account sells N seats: one stock row per seat (unit_kind
 *                               'seat', same group_id), each with an optional profile + PIN
 *   code     โค้ด / คีย์         single code (existing behaviour)
 *   invite   ลิงก์เชิญ           one link with a use limit: one row per use (unit_kind 'invite')
 *   manual   ร้านทำให้หลังสั่ง    no stock; the customer fills fields at checkout, the paid order
 *                               waits in the fulfilment queue until staff send the result
 *
 * NULL (never set) keeps the old behaviour: each unit is ID + password or a code. Because one
 * seat / one link use is one inventory row, stock counts, preorder holds, FEFO, warranty
 * replacement, low-stock and stock-watch work unchanged.
 */

export const DELIVERY_TYPES = ["account", "shared", "code", "invite", "manual"];
const FIELD_TYPES = ["text", "email"];
const MAX_FIELDS = 5;
const MAX_SEATS = 50;
const MAX_USES = 1000;
const MAX_LINES = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_RE = /^https?:\/\/[^\s]{3,1000}$/i;
const COST_RE = /^\d+(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const sqlNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** "1234abcd" → "12***" (same rule as admin lists). */
function mask(value) {
  const s = String(value ?? "");
  if (!s) return "";
  if (s.length <= 2) return "*".repeat(s.length);
  return s.slice(0, 2) + "***";
}
/** Invite link: host + "/…" + last 2 characters, enough to tell links apart. */
export function maskLink(value) {
  const s = String(value ?? "");
  try {
    const url = new URL(s);
    return url.host + "/…" + s.slice(-2);
  } catch {
    return mask(s);
  }
}

function costSatang(text) {
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** Trailing ",cost" and/or ",YYYY-MM-DD" (both optional) after `keep` leading columns. */
function tail(parts, keep) {
  let head = parts.map((p) => p.trim());
  let expiresAt = null;
  let cost = null;
  if (head.length > keep && DATE_RE.test(head[head.length - 1])) {
    expiresAt = head.pop() + " 23:59:59";
  }
  if (head.length > keep && COST_RE.test(head[head.length - 1])) {
    cost = costSatang(head.pop());
    if (cost > 100000000) return { head, error: "ต้นทุนเกินกำหนด" };
  }
  return { head, cost, expiresAt };
}

/**
 * Seat spec: a count ("5") or profiles separated by | with an optional :PIN
 * ("จอ1:1234|จอ2:5678|จอ3"). Returns [{label, pin}] or { error }.
 */
export function parseSeatSpec(raw) {
  const text = String(raw ?? "").trim();
  if (/^\d{1,3}$/.test(text)) {
    const n = Number(text);
    if (n < 1 || n > MAX_SEATS) return { error: "จำนวนที่นั่ง 1–" + MAX_SEATS };
    return { seats: Array.from({ length: n }, () => ({ label: null, pin: null })) };
  }
  const parts = text.split("|").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { error: "ไม่มีจำนวนที่นั่ง" };
  if (parts.length > MAX_SEATS) return { error: "จำนวนที่นั่ง 1–" + MAX_SEATS };
  const seats = [];
  for (const part of parts) {
    const at = part.lastIndexOf(":");
    const label = (at > 0 ? part.slice(0, at) : part).trim();
    const pin = at > 0 ? part.slice(at + 1).trim() : "";
    if (!label || label.length > 40) return { error: "ชื่อโปรไฟล์ 1–40 ตัวอักษร" };
    if (pin.length > 20) return { error: "PIN ยาวเกินกำหนด" };
    seats.push({ label, pin: pin || null });
  }
  return { seats };
}

/** Lines "id,password,seats[,cost][,YYYY-MM-DD]" (tabs work too). */
export function parseSharedLines(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter((l) => l.raw);
  return lines.map(({ raw, line }) => {
    const parts = (raw.includes("\t") ? raw.split("\t") : raw.split(",")).map((p) => p.trim());
    // Optional trailing date, then an optional cost only when the column before it is a
    // valid seat spec ("id,pa,ss,5": 5 is the seats, not a cost).
    const t = { head: parts, cost: null, expiresAt: null };
    if (t.head.length > 3 && DATE_RE.test(t.head[t.head.length - 1]))
      t.expiresAt = t.head.pop() + " 23:59:59";
    if (
      t.head.length > 3 &&
      COST_RE.test(t.head[t.head.length - 1]) &&
      /^\d{1,3}$|[|:]/.test(t.head[t.head.length - 2]) &&
      !parseSeatSpec(t.head[t.head.length - 2]).error
    ) {
      t.cost = costSatang(t.head.pop());
      if (t.cost > 100000000) t.error = "ต้นทุนเกินกำหนด";
    }
    const base = { line, kind: "seat", raw, loginId: "", password: "", seats: [], cost: null, expiresAt: null };
    if (t.error) return { ...base, error: t.error };
    if (t.head.length < 3) return { ...base, error: "ต้องเป็น ไอดี,รหัสผ่าน,ที่นั่ง" };
    const loginId = t.head[0];
    const spec = parseSeatSpec(t.head[t.head.length - 1]);
    const password = t.head.slice(1, -1).join(raw.includes("\t") ? "\t" : ",");
    if (!loginId) return { ...base, error: "ไม่มีไอดี" };
    if (loginId.length > 160) return { ...base, error: "ไอดียาวเกิน 160 ตัวอักษร" };
    if (!password) return { ...base, loginId, error: "ไม่มีรหัสผ่าน" };
    if (password.length > 500) return { ...base, loginId, error: "รหัสผ่านยาวเกินกำหนด" };
    if (spec.error) return { ...base, loginId, error: spec.error };
    return { ...base, loginId, password, seats: spec.seats, cost: t.cost, expiresAt: t.expiresAt };
  });
}

/** Lines "https://link[,uses][,cost][,YYYY-MM-DD]"; uses defaults to 1. */
export function parseInviteLines(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter((l) => l.raw);
  return lines.map(({ raw, line }) => {
    const parts = raw.split(/[,\t]/);
    const link = parts[0].trim();
    const base = { line, kind: "invite", raw, link, uses: 1, cost: null, expiresAt: null };
    if (!LINK_RE.test(link)) return { ...base, error: "ต้องเป็นลิงก์ https://" };
    let rest = parts.slice(1).map((p) => p.trim()).filter((p) => p !== "");
    let uses = 1;
    if (rest.length && /^\d{1,4}$/.test(rest[0])) {
      // First number after the link is the use limit.
      uses = Number(rest[0]);
      rest = rest.slice(1);
    }
    if (uses < 1 || uses > MAX_USES) return { ...base, error: "จำนวนครั้งที่ใช้ได้ 1–" + MAX_USES };
    const t = tail(["x", ...rest], 1);
    if (t.error) return { ...base, error: t.error };
    if (t.head.length > 1) return { ...base, error: "รูปแบบไม่ถูกต้อง" };
    return { ...base, uses, cost: t.cost, expiresAt: t.expiresAt };
  });
}

/** Admin-defined checkout fields for a 'manual' product. */
export function normalizeDeliveryFields(raw, fail) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail(400, "ช่องกรอกไม่ถูกต้อง");
  if (raw.length > MAX_FIELDS) fail(400, "ช่องกรอกได้ไม่เกิน " + MAX_FIELDS + " ช่อง");
  const used = new Set();
  return raw.map((f, i) => {
    if (!f || typeof f !== "object") fail(400, "ช่องกรอกไม่ถูกต้อง");
    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (label.length < 1 || label.length > 60) fail(400, "ชื่อช่องกรอก 1–60 ตัวอักษร");
    const type = FIELD_TYPES.includes(f.type) ? f.type : "text";
    let id = typeof f.id === "string" && /^[a-z0-9-]{1,20}$/.test(f.id) ? f.id : "f" + (i + 1);
    while (used.has(id)) id = id + "x";
    used.add(id);
    return { id, label, type, required: f.required !== false };
  });
}

export function createDeliveryApis({
  one,
  all,
  run,
  tx,
  fail,
  clean,
  integer,
  encrypt,
  decrypt,
  requireAdmin,
  requireStaff,
  randomUUID,
  inventoryFingerprint,
  inventoryLoginKey,
  backfillLoginKeys,
  notify,
  notifyStaffRoles,
  maybeNotifyStockExpiry,
  callPreorders,
  clock,
}) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      JSON.stringify(detail ?? {}),
    );
  const parseFields = (text) => {
    try {
      const list = JSON.parse(text ?? "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };

  /** Stored type, or null (old behaviour). */
  const typeOfProduct = (productId) =>
    one("SELECT delivery_type FROM products WHERE id=?", productId)?.delivery_type ?? null;
  const typeOfVariant = (variantId) =>
    one(
      "SELECT p.delivery_type FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?",
      variantId,
    )?.delivery_type ?? null;
  const isManualVariant = (variantId) => typeOfVariant(variantId) === "manual";

  /** What the admin card shows for a product that never picked a type. */
  function effectiveType(productId) {
    const stored = typeOfProduct(productId);
    if (stored) return stored;
    const row = one(
      `SELECT SUM(CASE WHEN i.legacy_single_secret=1 THEN 1 ELSE 0 END) AS codes,
              SUM(CASE WHEN i.legacy_single_secret=0 THEN 1 ELSE 0 END) AS pairs
       FROM inventory i JOIN variants v ON v.id=i.variant_id WHERE v.product_id=?`,
      productId,
    );
    return Number(row?.codes ?? 0) > 0 && !Number(row?.pairs ?? 0) ? "code" : "account";
  }

  /** Storefront fields of one product row. */
  function publicDelivery(productRow) {
    const type = productRow.delivery_type ?? null;
    return {
      deliveryType: type ?? "account",
      checkoutFields:
        type === "manual"
          ? parseFields(productRow.delivery_fields).map(({ id, label, type: t, required }) => ({
              id,
              label,
              type: t,
              required,
            }))
          : [],
    };
  }

  function adminDelivery(user, productIdRaw) {
    requireStaff(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    const p = one("SELECT id,preorder,delivery_type,delivery_fields FROM products WHERE id=?", productId);
    if (!p) fail(404, "ไม่พบสินค้า");
    const free = one(
      `SELECT COUNT(*) AS n FROM inventory i JOIN variants v ON v.id=i.variant_id
       WHERE v.product_id=? AND i.order_id IS NULL AND i.reservation_id IS NULL AND COALESCE(i.defective,0)=0`,
      productId,
    ).n;
    return {
      productId,
      type: effectiveType(productId),
      stored: p.delivery_type ?? null,
      fields: parseFields(p.delivery_fields),
      preorder: !!p.preorder,
      freeStock: free,
      waiting: one(
        "SELECT COUNT(*) AS n FROM order_fulfilment WHERE product_id=? AND state='waiting'",
        productId,
      ).n,
    };
  }

  function adminSetDelivery(user, productIdRaw, input = {}) {
    requireAdmin(user);
    const productId = clean(productIdRaw, 1, 80, "สินค้า");
    const type = DELIVERY_TYPES.includes(input.type) ? input.type : null;
    if (!type) fail(400, "วิธีส่งมอบไม่ถูกต้อง");
    const fields = type === "manual" ? normalizeDeliveryFields(input.fields ?? [], fail) : [];
    return tx(() => {
      const p = one("SELECT id,preorder,delivery_type FROM products WHERE id=?", productId);
      if (!p) fail(404, "ไม่พบสินค้า");
      if (type === "manual" && p.preorder)
        fail(409, "สินค้าพรีออเดอร์ใช้แบบร้านทำให้ไม่ได้ เปลี่ยนเป็นพร้อมส่งก่อน");
      if (type === "manual") {
        const free = one(
          `SELECT COUNT(*) AS n FROM inventory i JOIN variants v ON v.id=i.variant_id
           WHERE v.product_id=? AND i.order_id IS NULL AND i.reservation_id IS NULL AND COALESCE(i.defective,0)=0`,
          productId,
        ).n;
        if (free > 0) fail(409, "ยังมีสต็อก " + free + " รายการ ลบหรือย้ายก่อนเปลี่ยนเป็นร้านทำให้");
      }
      if (p.delivery_type === "manual" && type !== "manual") {
        const waiting = one(
          "SELECT COUNT(*) AS n FROM order_fulfilment WHERE product_id=? AND state='waiting'",
          productId,
        ).n;
        if (waiting > 0) fail(409, "ยังมีออเดอร์รอส่งมอบ " + waiting + " รายการ");
      }
      run(
        "UPDATE products SET delivery_type=?, delivery_fields=? WHERE id=?",
        type,
        type === "manual" ? JSON.stringify(fields) : null,
        productId,
      );
      auditDetail(user, "SET_DELIVERY_TYPE", productId, { from: p.delivery_type ?? null, to: type, fields: fields.length });
      return adminDelivery(user, productId);
    });
  }

  // ------------------------------------------------------------------ checkout inputs

  /** Validated customer answers for a manual product, or null for other types. */
  function checkoutInputs(variantId, raw) {
    const p = one(
      "SELECT p.id,p.delivery_type,p.delivery_fields FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?",
      variantId,
    );
    if (!p || p.delivery_type !== "manual") return null;
    const fields = parseFields(p.delivery_fields);
    const given = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const answers = [];
    for (const f of fields) {
      const value = typeof given[f.id] === "string" ? given[f.id].trim() : "";
      if (!value) {
        if (f.required) fail(400, "กรุณากรอก " + f.label);
        continue;
      }
      if (value.length > 200) fail(400, f.label + " ยาวเกินกำหนด");
      if (f.type === "email" && !EMAIL_RE.test(value)) fail(400, f.label + " ต้องเป็นอีเมล");
      answers.push({ id: f.id, label: f.label, value });
    }
    return { productId: p.id, answers };
  }
  /** Inside createOrder's transaction. */
  function recordInputs(orderId, inputs) {
    if (!inputs) return;
    run(
      "INSERT OR IGNORE INTO order_fulfilment(order_id,product_id,inputs_enc,state,created_at) VALUES(?,?,?,'input',?)",
      orderId,
      inputs.productId,
      encrypt(JSON.stringify(inputs.answers)),
      sqlNow(),
    );
  }
  const readInputs = (row) => {
    if (!row?.inputs_enc) return [];
    try {
      return JSON.parse(decrypt(row.inputs_enc));
    } catch {
      return [];
    }
  };
  const readMessage = (row) => {
    if (!row?.message_enc) return "";
    try {
      return decrypt(row.message_enc);
    } catch {
      return "";
    }
  };

  /** Paid order of a manual product → waiting in the queue (inside pay's transaction). */
  function markWaiting(order) {
    const productId = one("SELECT product_id FROM variants WHERE id=?", order.variant_id)?.product_id;
    run(
      "INSERT OR IGNORE INTO order_fulfilment(order_id,product_id,inputs_enc,state,created_at) VALUES(?,?,NULL,'waiting',?)",
      order.id,
      productId,
      sqlNow(),
    );
    run("UPDATE order_fulfilment SET state='waiting' WHERE order_id=? AND state='input'", order.id);
  }

  /** Customer order page: what they typed, and the shop's message once sent (owner only). */
  function orderFulfilment(orderId, ownerView) {
    const row = one("SELECT * FROM order_fulfilment WHERE order_id=?", orderId);
    if (!row) return null;
    return {
      state: row.state === "done" ? "done" : row.state === "waiting" ? "waiting" : "input",
      inputs: ownerView ? readInputs(row) : [],
      message: ownerView && row.state === "done" ? readMessage(row) : "",
      deliveredAt: row.delivered_at ?? null,
    };
  }
  /** Admin order detail: inputs (needed to do the work) + whether a message was sent. */
  function adminOrderFulfilment(orderId) {
    const row = one("SELECT * FROM order_fulfilment WHERE order_id=?", orderId);
    if (!row) return null;
    return {
      state: row.state,
      inputs: readInputs(row),
      hasMessage: !!row.message_enc,
      deliveredAt: row.delivered_at ?? null,
      deliveredBy: row.delivered_by ?? null,
    };
  }
  /** Reveal (audited by the caller): the message the shop sent. */
  const revealMessage = (orderId) =>
    readMessage(one("SELECT message_enc FROM order_fulfilment WHERE order_id=?", orderId));

  function fulfilmentQueue(user) {
    requireStaff(user);
    return {
      rows: all(
        `SELECT f.order_id AS id,f.state,f.inputs_enc,f.created_at,f.delivered_at,
                o.quantity,o.total,o.created_at AS ordered_at,o.status,
                u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product,v.label
         FROM order_fulfilment f
         JOIN orders o ON o.id=f.order_id
         JOIN users u ON u.id=o.user_id
         JOIN variants v ON v.id=o.variant_id
         JOIN products p ON p.id=v.product_id
         WHERE o.status='DELIVERED' AND (f.state='waiting'
           OR (f.state='done' AND f.delivered_at >= datetime('now','-30 days')))
         ORDER BY CASE WHEN f.state='waiting' THEN 0 ELSE 1 END, o.created_at ASC
         LIMIT 500`,
      ).map(({ inputs_enc, ...r }) => ({ ...r, inputs: readInputs({ inputs_enc }) })),
    };
  }

  function fulfilOrder(user, orderIdRaw, input = {}) {
    requireStaff(user);
    const orderId = clean(orderIdRaw, 1, 80, "คำสั่งซื้อ");
    const message = clean(input.message, 1, 2000, "ข้อความส่งมอบ");
    return tx(() => {
      const row = one(
        "SELECT f.*,o.user_id,o.status,o.variant_id FROM order_fulfilment f JOIN orders o ON o.id=f.order_id WHERE f.order_id=?",
        orderId,
      );
      if (!row) fail(404, "ไม่พบออเดอร์ที่รอส่งมอบ");
      if (row.status !== "DELIVERED") fail(409, "ออเดอร์นี้ยังไม่ได้ชำระเงิน");
      const now = sqlNow();
      const resend = row.state === "done";
      run(
        "UPDATE order_fulfilment SET state='done', message_enc=?, delivered_at=?, delivered_by=? WHERE order_id=?",
        encrypt(message),
        resend ? row.delivered_at : now,
        user.id,
        orderId,
      );
      // Warranty runs from the moment the shop delivers.
      if (!resend)
        run(
          `UPDATE orders SET warranty_until=CASE WHEN COALESCE(warranty_days,0)>0
             THEN datetime(?,'+'||warranty_days||' days') END WHERE id=?`,
          now,
          orderId,
        );
      notify(
        row.user_id,
        "order",
        resend ? "ร้านอัปเดตข้อมูลส่งมอบ" : "ร้านส่งมอบแล้ว",
        "คำสั่งซื้อ " + orderId.slice(0, 8) + " · กดดูรายละเอียด",
        "/orders/" + orderId,
      );
      // Never the message itself in the audit log.
      auditDetail(user, resend ? "FULFIL_UPDATE" : "FULFIL_ORDER", orderId, { length: message.length });
      return { id: orderId, state: "done", deliveredAt: resend ? row.delivered_at : now };
    });
  }

  // ------------------------------------------------------------------ shared seats / invite links

  const insertUnit = ({ variantId, loginId, password, legacy, kind, groupId, seatNo, label, pin, cost, expiresAt, loginKey }) => {
    run(
      `INSERT INTO inventory(
         id, variant_id, fingerprint, login_id_enc, password_enc, legacy_single_secret, login_key,
         cost, expires_at, unit_kind, group_id, seat_no, seat_label, seat_pin_enc
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      randomUUID(),
      variantId,
      // One fingerprint per seat / use (the column is UNIQUE); duplicates are caught by login_key.
      inventoryFingerprint("\u0000" + kind + ":" + groupId + ":" + seatNo, ""),
      encrypt(loginId),
      encrypt(password),
      legacy ? 1 : 0,
      loginKey,
      cost,
      expiresAt,
      kind,
      groupId,
      seatNo,
      label ?? null,
      pin ? encrypt(pin) : null,
    );
  };

  /** importCodes for a shared / invite product (same dry run + skip duplicates contract). */
  function importGrouped(user, variantId, type, input) {
    const text = type === "shared" ? input.seats : input.links;
    if (typeof text !== "string" || !text.trim() || text.length > 60000)
      fail(400, type === "shared" ? "รายการบัญชีแชร์ไม่ถูกต้อง" : "รายการลิงก์ไม่ถูกต้อง");
    const entries = type === "shared" ? parseSharedLines(text) : parseInviteLines(text);
    if (entries.length < 1 || entries.length > MAX_LINES) fail(400, "ได้ 1–" + MAX_LINES + " บรรทัดต่อครั้ง");
    const dryRun = input.dryRun === true;
    const skipDuplicates = input.skipDuplicates === true;
    const classify = () => {
      backfillLoginKeys();
      const seen = new Map();
      return entries.map((e) => {
        const secret = type === "shared" ? e.loginId : e.link;
        const base = {
          line: e.line,
          kind: type === "shared" ? "seat" : "invite",
          display: e.error ? mask(e.raw) : type === "shared" ? e.loginId.slice(0, 120) : maskLink(e.link),
          ...(type === "shared" && !e.error ? { passwordMasked: "••••••••", seats: e.seats.length } : {}),
          ...(type === "invite" && !e.error ? { uses: e.uses } : {}),
        };
        if (e.error) return { ...base, status: "invalid", reason: e.error };
        const loginKey = inventoryLoginKey(type === "shared" ? false : "link", secret);
        if (seen.has(loginKey))
          return { ...base, status: "duplicate_batch", duplicateOf: seen.get(loginKey), reason: "ซ้ำกับบรรทัด " + seen.get(loginKey) };
        seen.set(loginKey, e.line);
        const existing = one("SELECT variant_id FROM inventory WHERE login_key=? LIMIT 1", loginKey);
        if (existing)
          return {
            ...base,
            status: "existing",
            reason: existing.variant_id === variantId ? "มีในสต็อกตัวเลือกนี้แล้ว" : "มีในระบบแล้ว",
          };
        return { ...base, status: "ok", entry: e, loginKey };
      });
    };
    const summarize = (lines) => ({
      total: lines.length,
      ok: lines.filter((l) => l.status === "ok").length,
      duplicateInBatch: lines.filter((l) => l.status === "duplicate_batch").length,
      existing: lines.filter((l) => l.status === "existing").length,
      invalid: lines.filter((l) => l.status === "invalid").length,
    });
    const publicLines = (lines) => lines.map(({ entry, loginKey, ...l }) => l);
    if (dryRun) {
      const lines = tx(classify);
      return { dryRun: true, variantId, lines: publicLines(lines), counts: summarize(lines) };
    }
    return tx(() => {
      const lines = classify();
      const counts = summarize(lines);
      if (!skipDuplicates) {
        const bad = lines.find((l) => l.status !== "ok");
        if (bad) fail(bad.status === "invalid" ? 400 : 409, "บรรทัด " + bad.line + ": " + bad.reason);
      }
      let units = 0;
      const ok = lines.filter((l) => l.status === "ok");
      for (const { entry: e, loginKey } of ok) {
        const groupId = randomUUID();
        if (type === "shared") {
          const perSeat = e.cost == null ? null : Math.round(e.cost / e.seats.length);
          e.seats.forEach((s, i) => {
            insertUnit({
              variantId,
              loginId: e.loginId,
              password: e.password,
              legacy: false,
              kind: "seat",
              groupId,
              seatNo: i + 1,
              label: s.label,
              pin: s.pin,
              cost: perSeat,
              expiresAt: e.expiresAt,
              loginKey,
            });
            units++;
          });
        } else {
          const perUse = e.cost == null ? null : Math.round(e.cost / e.uses);
          for (let i = 0; i < e.uses; i++) {
            insertUnit({
              variantId,
              loginId: e.link,
              password: "",
              legacy: true,
              kind: "invite",
              groupId,
              seatNo: i + 1,
              cost: perUse,
              expiresAt: e.expiresAt,
              loginKey,
            });
            units++;
          }
        }
      }
      const result = {
        imported: ok.length,
        units,
        skipped: counts.total - ok.length,
        skippedDuplicates: counts.duplicateInBatch + counts.existing,
        skippedInvalid: counts.invalid,
      };
      auditDetail(user, "IMPORT_CODES", variantId, { type, total: counts.total, imported: ok.length, units, skipDuplicates });
      maybeNotifyStockExpiry(variantId);
      const called = units ? callPreorders(variantId) : [];
      return { ...result, lines: publicLines(lines), counts, preorderCalled: called.length };
    });
  }

  const groupRows = (groupId) =>
    all(
      `SELECT * FROM inventory WHERE group_id=? ORDER BY seat_no ASC, rowid ASC`,
      groupId,
    );
  const unitStatus = (r) =>
    r.defective ? "defective" : r.order_id || r.reservation_id ? "sold" : "available";

  /** ADMIN / STAFF: one shared account (or invite link) with its seats. Values masked. */
  function adminSeatGroup(user, groupIdRaw) {
    requireStaff(user);
    const groupId = clean(groupIdRaw, 1, 80, "บัญชีแชร์");
    const rows = groupRows(groupId);
    if (!rows.length) fail(404, "ไม่พบบัญชีแชร์");
    const first = rows[0];
    let shown = "";
    try {
      shown = decrypt(first.login_id_enc);
    } catch {
      shown = "";
    }
    return {
      groupId,
      kind: first.unit_kind,
      variantId: first.variant_id,
      loginIdMasked: first.unit_kind === "invite" ? maskLink(shown) : mask(shown),
      seats: rows.map((r) => ({
        id: r.id,
        seatNo: r.seat_no,
        label: r.seat_label ?? null,
        hasPin: !!r.seat_pin_enc,
        status: unitStatus(r),
        order_id: r.order_id ?? null,
        reservation_id: r.reservation_id ?? null,
      })),
    };
  }

  /** Raise / lower the number of seats (uses). Only free seats can be removed. */
  function adminSetSeatCount(user, groupIdRaw, input = {}) {
    requireAdmin(user);
    const groupId = clean(groupIdRaw, 1, 80, "บัญชีแชร์");
    return tx(() => {
      const rows = groupRows(groupId);
      if (!rows.length) fail(404, "ไม่พบบัญชีแชร์");
      const kind = rows[0].unit_kind;
      const max = kind === "invite" ? MAX_USES : MAX_SEATS;
      const target = integer(input.seats, 1, max, kind === "invite" ? "จำนวนครั้ง" : "จำนวนที่นั่ง");
      const live = rows.filter((r) => !r.defective);
      let added = 0;
      let removed = 0;
      if (target > live.length) {
        const template = rows[0];
        let nextNo = Math.max(...rows.map((r) => r.seat_no ?? 0)) + 1;
        for (let i = live.length; i < target; i++) {
          run(
            `INSERT INTO inventory(
               id, variant_id, fingerprint, login_id_enc, password_enc, legacy_single_secret, login_key,
               cost, expires_at, unit_kind, group_id, seat_no
             ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
            randomUUID(),
            template.variant_id,
            inventoryFingerprint("\u0000" + kind + ":" + groupId + ":" + nextNo, ""),
            template.login_id_enc,
            template.password_enc,
            template.legacy_single_secret,
            template.login_key,
            template.cost,
            template.expires_at,
            kind,
            groupId,
            nextNo,
          );
          nextNo++;
          added++;
        }
      } else if (target < live.length) {
        const free = live.filter((r) => unitStatus(r) === "available").sort((a, b) => (b.seat_no ?? 0) - (a.seat_no ?? 0));
        const need = live.length - target;
        if (free.length < need)
          fail(409, "ลดได้เหลืออย่างน้อย " + (live.length - free.length) + " (ที่นั่งที่ขายแล้วลดไม่ได้)");
        for (const r of free.slice(0, need)) {
          const gone = run(
            "DELETE FROM inventory WHERE id=? AND order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0",
            r.id,
          );
          if (!gone.changes) fail(409, "ที่นั่งเปลี่ยนสถานะระหว่างทำรายการ ลองใหม่");
          removed++;
        }
      }
      auditDetail(user, "SEAT_COUNT", groupId, { from: live.length, to: target, added, removed });
      if (added) callPreorders(rows[0].variant_id);
      return { ...adminSeatGroup(user, groupId), added, removed };
    });
  }

  /** Profile name / PIN of one seat. A sold seat's holder is told the details changed. */
  function adminUpdateSeat(user, inventoryIdRaw, input = {}) {
    requireAdmin(user);
    const inventoryId = clean(inventoryIdRaw, 1, 80, "ที่นั่ง");
    return tx(() => {
      const row = one("SELECT * FROM inventory WHERE id=?", inventoryId);
      if (!row || row.unit_kind !== "seat") fail(404, "ไม่พบที่นั่ง");
      if (row.defective) fail(409, "ที่นั่งนี้ถูกแจ้งเสียแล้ว");
      const changed = [];
      if (input.label !== undefined) {
        const label = input.label == null ? "" : String(input.label).trim();
        if (label.length > 40) fail(400, "ชื่อโปรไฟล์ไม่เกิน 40 ตัวอักษร");
        if ((label || null) !== (row.seat_label ?? null)) {
          run("UPDATE inventory SET seat_label=? WHERE id=?", label || null, inventoryId);
          changed.push("label");
        }
      }
      if (input.pin !== undefined) {
        const pin = input.pin == null ? "" : String(input.pin).trim();
        if (pin.length > 20) fail(400, "PIN ยาวเกินกำหนด");
        run("UPDATE inventory SET seat_pin_enc=? WHERE id=?", pin ? encrypt(pin) : null, inventoryId);
        changed.push("pin");
      }
      const holder = row.order_id
        ? one("SELECT user_id FROM orders WHERE id=? AND status='DELIVERED'", row.order_id)
        : row.reservation_id
          ? one("SELECT user_id FROM reservations WHERE id=? AND status='DELIVERED'", row.reservation_id)
          : null;
      if (changed.length && holder)
        notify(
          holder.user_id,
          "order",
          "ข้อมูลที่นั่งอัปเดตแล้ว",
          "กดดูคำสั่งซื้อเพื่อดูโปรไฟล์ / PIN ล่าสุด",
          "/orders/" + (row.order_id ?? row.reservation_id),
        );
      auditDetail(user, "SEAT_EDIT", inventoryId, { fields: changed });
      return { id: inventoryId, changed };
    });
  }

  /**
   * New ID / password for a whole shared account (all its seats, sold ones too, because the
   * buyers share it). Every buyer holding a seat is notified.
   */
  function adminUpdateGroupLogin(user, groupIdRaw, input = {}) {
    requireAdmin(user);
    const groupId = clean(groupIdRaw, 1, 80, "บัญชีแชร์");
    return tx(() => {
      const rows = groupRows(groupId);
      if (!rows.length || rows[0].unit_kind !== "seat") fail(404, "ไม่พบบัญชีแชร์");
      const oldLogin = decrypt(rows[0].login_id_enc);
      const oldPassword = decrypt(rows[0].password_enc);
      const loginId = input.loginId != null && String(input.loginId).trim() ? clean(input.loginId, 1, 160, "ID") : oldLogin;
      const password = input.password != null && String(input.password) ? clean(input.password, 1, 500, "รหัสผ่าน") : oldPassword;
      if (loginId === oldLogin && password === oldPassword) return { groupId, changed: [] };
      const loginKey = inventoryLoginKey(false, loginId);
      const clash = one(
        "SELECT id FROM inventory WHERE login_key=? AND COALESCE(group_id,'')<>? LIMIT 1",
        loginKey,
        groupId,
      );
      if (clash) fail(409, "ID นี้มีในระบบแล้ว");
      run(
        "UPDATE inventory SET login_id_enc=?, password_enc=?, login_key=? WHERE group_id=?",
        encrypt(loginId),
        encrypt(password),
        loginKey,
        groupId,
      );
      const changed = [];
      if (loginId !== oldLogin) changed.push("loginId");
      if (password !== oldPassword) changed.push("password");
      const told = new Set();
      for (const r of rows) {
        if (r.defective) continue;
        const holder = r.order_id
          ? one("SELECT user_id FROM orders WHERE id=? AND status='DELIVERED'", r.order_id)
          : r.reservation_id
            ? one("SELECT user_id FROM reservations WHERE id=? AND status='DELIVERED'", r.reservation_id)
            : null;
        const ref = r.order_id ?? r.reservation_id;
        if (!holder || told.has(ref)) continue;
        told.add(ref);
        notify(holder.user_id, "order", "บัญชีอัปเดตรหัสแล้ว", "กดดูคำสั่งซื้อเพื่อดูรหัสล่าสุด", "/orders/" + ref);
      }
      auditDetail(user, "SEAT_GROUP_LOGIN", groupId, { fields: changed, notified: told.size });
      return { groupId, changed, notified: told.size };
    });
  }

  /** PDPA export: every answer this customer typed at checkout. */
  const exportInputs = (userId) =>
    all(
      `SELECT f.order_id,f.state,f.created_at,f.inputs_enc FROM order_fulfilment f
       JOIN orders o ON o.id=f.order_id WHERE o.user_id=? ORDER BY f.created_at DESC`,
      userId,
    ).map(({ inputs_enc, ...r }) => ({ ...r, inputs: readInputs({ inputs_enc }) }));

  return {
    exportInputs,
    typeOfProduct,
    typeOfVariant,
    isManualVariant,
    effectiveType,
    publicDelivery,
    adminDelivery,
    adminSetDelivery,
    checkoutInputs,
    recordInputs,
    markWaiting,
    orderFulfilment,
    adminOrderFulfilment,
    revealMessage,
    fulfilmentQueue,
    fulfilOrder,
    importGrouped,
    adminSeatGroup,
    adminSetSeatCount,
    adminUpdateSeat,
    adminUpdateGroupLogin,
    clock,
    notifyStaffRoles,
  };
}
