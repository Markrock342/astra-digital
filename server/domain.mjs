import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { catalog } from "./catalog.mjs";
import { createCategoryApis } from "./categories.mjs";
import {
  ROLES,
  withoutClientPrivileges,
  assertAuthenticated,
  assertAdmin,
  assertStaff,
  isStaff,
  isAdmin,
} from "./auth-policy.mjs";
import { credentialFingerprint } from "./migrate-005.mjs";
import { createAdminListApis } from "./admin-list-apis.mjs";
import { createAdminFinanceApis } from "./admin-finance-apis.mjs";
import { createAdminCustomerApis } from "./admin-customers.mjs";
import { withLive } from "./live.mjs";
import { createTeamApis } from "./admin-team.mjs";
import { createReportApis } from "./admin-reports.mjs";
import {
  createAdminVariantStockApis,
  maskCode,
  maskSecret,
  parseImportEntries,
} from "./admin-variant-stock-apis.mjs";
import { createAdminProductBulkApis } from "./admin-product-bulk.mjs";
import { createAdminOrderReplaceApis } from "./admin-order-replace.mjs";
import { createAdminOrderResendApis } from "./admin-order-resend.mjs";
import { createOrderHistoryApis } from "./admin-order-history.mjs";
import { createAdminProductImageApis } from "./admin-product-images.mjs";
import { createProfileUploadApis } from "./profile-uploads.mjs";
import { createFileStore } from "./file-store.mjs";
import { createAuthHardening } from "./auth-hardening.mjs";
import { createAdminMoneyApis } from "./admin-money.mjs";
import { createAccountSessionApis, sessionContext } from "./account-sessions.mjs";
import {
  createPendingExpiry,
  EXPIRED_MESSAGE,
  PENDING_EXPIRY_DEFAULT,
  PENDING_EXPIRY_MAX,
  PENDING_EXPIRY_MIN,
} from "./pending-expiry.mjs";
import {
  createOrderExtras,
  normalizeUsageInstructions,
} from "./order-extras.mjs";
import { createCouponApis, normalizeCouponCode } from "./coupons.mjs";
import { createAccountEmail } from "./account-email.mjs";
import { normalizeLegal } from "./legal.mjs";
import { normalizeFaq } from "./faq.mjs";
import { createBroadcastApis } from "./broadcast.mjs";
import {
  createMoneyScope,
  walletBalanceSql,
  walletHistory,
  walletRowSql,
} from "./money.mjs";
import {
  dropAppendOnlyMoney,
  ensureAppendOnlyMoney,
} from "./ensure-admin-fr.mjs";
import { createAlerts, DAILY_SUMMARY_HOUR, nextBangkokHour } from "./alerts.mjs";
import { BACKUP_HOUR_BANGKOK, createBackupApis } from "./backup.mjs";
export { ROLES } from "./auth-policy.mjs";
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new ApiError(status, message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const passwordHash = (value) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(value, salt, 64).toString("hex");
};
const passwordMatches = (value, stored) => {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(value, salt, 64);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
};
export function createCommerceCore({
  db,
  transaction,
  allowDemoAdmin = false,
  allowSandbox = true,
  key = randomBytes(32),
  seed = true,
  adminPassword,
  fileStore: fileStoreOption,
  uploads,
  // Injected clock for session / lockout / TOTP tests.
  clock = () => Date.now(),
  // Outside-the-website alerts (alerts.mjs): fetch is injectable for tests, waitUntil keeps a
  // Durable Object alive for the send, alertRedirect is a loopback-only test hook.
  alertFetch,
  alertRedirect,
  waitUntil,
  // R2 bucket binding BACKUPS for the automatic daily backup (absent = off).
  backups,
  // Email + Turnstile (server/email.mjs, server/turnstile.mjs). Both off when omitted.
  email: mailer = null,
  turnstile = null,
  publicBaseUrl = "",
} = {}) {
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const fileStore =
    fileStoreOption ?? createFileStore({ db, uploads });
  const tx =
    transaction ??
    ((fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    });
  const encrypt = (value) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    return [
      iv.toString("hex"),
      cipher.update(value, "utf8", "hex") + cipher.final("hex"),
      cipher.getAuthTag().toString("hex"),
    ].join(":");
  };
  const decrypt = (value) => {
    const [iv, data, tag] = value.split(":");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return decipher.update(data, "hex", "utf8") + decipher.final("utf8");
  };
  const inventoryFingerprint = (loginId, password) =>
    credentialFingerprint(key, loginId, password);
  // Duplicate check key: the same account (loginId, any case, any password) or the
  // same single code text. Keyed, so the database never holds a plain loginId.
  const inventoryLoginKey = (legacy, loginId) =>
    createHmac("sha256", key)
      .update(
        JSON.stringify({
          v: 1,
          kind: legacy ? "code" : "login",
          value: legacy ? String(loginId).trim() : String(loginId).trim().toLowerCase(),
        }),
        "utf8",
      )
      .digest("hex");
  const insertInventoryCredential = (
    variantId,
    loginId,
    password,
    { legacy = 0 } = {},
  ) => {
    run(
      `INSERT INTO inventory(
        id, variant_id, fingerprint, login_id_enc, password_enc, legacy_single_secret, login_key
      ) VALUES(?,?,?,?,?,?,?)`,
      randomUUID(),
      variantId,
      inventoryFingerprint(loginId, password),
      encrypt(loginId),
      encrypt(password),
      legacy ? 1 : 0,
      inventoryLoginKey(legacy, loginId),
    );
  };
  /** Rows from before login_key existed (or written by migrations) get their key on first use. */
  const backfillLoginKeys = () => {
    for (const row of all(
      "SELECT id,login_id_enc,legacy_single_secret FROM inventory WHERE login_key IS NULL LIMIT 5000",
    )) {
      let value = "";
      try {
        value = inventoryLoginKey(row.legacy_single_secret, decrypt(row.login_id_enc));
      } catch {
        // Unreadable row: mark it so it is not retried; '' never matches a real key.
      }
      run("UPDATE inventory SET login_key=? WHERE id=?", value, row.id);
    }
  };
  const inventoryAvailableSql =
    "order_id IS NULL AND reservation_id IS NULL AND COALESCE(defective,0)=0";
  const inventoryAvailableAliased =
    "i.order_id IS NULL AND i.reservation_id IS NULL AND COALESCE(i.defective,0)=0";
  // Legacy single-secret rows stay in `codes`; real ID + password pairs go to
  // `credentials`, so the customer never sees one item listed twice.
  const readDeliveredItems = (column, bindId) => {
    if (column !== "order_id" && column !== "reservation_id")
      throw new Error("invalid inventory bind column");
    const codes = [];
    const credentials = [];
    for (const row of all(
      `SELECT login_id_enc, password_enc, legacy_single_secret FROM inventory
       WHERE ${column}=? AND COALESCE(defective,0)=0 ORDER BY rowid`,
      bindId,
    )) {
      const loginId = decrypt(row.login_id_enc);
      if (row.legacy_single_secret) codes.push(loginId);
      else credentials.push({ loginId, password: decrypt(row.password_enc) });
    }
    return { codes, credentials };
  };
  const publicUser = (user) =>
    user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          // S4: one balance formula (signed net over wallet rows), see money.mjs.
          balance: one(walletBalanceSql, user.id).value,
          avatarUrl: user.avatar_key ? "/api/files/" + user.avatar_key : null,
        }
      : null;
  const audit = (user, action, entity) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id) VALUES(?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
    );
  /** Append-only ledger row (MIG-006 columns). Never UPDATE/DELETE money rows. */
  const insertLedgerEntry = ({
    userId,
    amount,
    reference,
    label,
    kind = "DEMO_CREDIT",
    direction,
    fee = 0,
    status = "SUCCEEDED",
    orderId = null,
    paymentId = null,
    providerRef = null,
    actorId = null,
    reason = null,
    createdAt = null,
  }) => {
    const dir = direction ?? (amount < 0 ? "out" : "in");
    const net =
      kind === "DEMO_CREDIT"
        ? amount
        : dir === "out"
          ? -(Math.abs(amount) + fee)
          : Math.abs(amount) - fee;
    const storedAmount = kind === "DEMO_CREDIT" ? amount : Math.abs(amount);
    const when =
      createdAt ??
      new Date().toISOString().slice(0, 19).replace("T", " ");
    run(
      `INSERT INTO ledger(
        id,user_id,amount,reference,label,kind,direction,fee,net,status,
        order_id,payment_id,provider_ref,actor_id,reason,finalized_at,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      randomUUID(),
      userId,
      storedAmount,
      reference,
      label,
      kind,
      dir,
      fee,
      net,
      status,
      orderId,
      paymentId,
      providerRef,
      actorId,
      reason,
      status === "SUCCEEDED" ? when : null,
      when,
    );
  };
  const requireUser = (user) => assertAuthenticated(user, fail);
  const requireAdmin = (user) => assertAdmin(user, fail);
  const requireStaff = (user) => assertStaff(user, fail);
  const paymentChannel = () =>
    one("SELECT * FROM payment_channel WHERE id='primary'") ?? {
      id: "primary",
      provider: "unset",
      active: 0,
      note: "ช่องทางเดียว — ห้ามเปิด SlipOK/Gateway จนกว่าลูกค้าเลือก",
    };
  const assertSandboxPayAllowed = () => {
    if (!allowSandbox)
      fail(501, "การชำระเงินยังไม่เปิด ระบบจะเชื่อมช่องทางจ่ายภายหลัง");
    const channel = paymentChannel();
    if (channel.provider !== "unset" && channel.provider !== "sandbox")
      fail(
        501,
        "ช่องทางจ่ายนี้รอการเชื่อมต่อ — ตอนนี้รับเฉพาะ sandbox",
      );
    // unset+inactive = โหมดเริ่มต้นยังจ่ายได้; sandbox ต้อง active ก่อน
    if (channel.provider === "sandbox" && !Number(channel.active))
      fail(403, "ช่องทางจ่ายยังไม่ได้เปิดใช้งาน");
  };
  // `link` is an in-app path the bell opens (e.g. /orders/<id>); null = the old
  // kind-based fallback. Only site-relative paths are stored.
  const notify = (userId, kind, title, body, link = null) => {
    run(
      "INSERT INTO notifications(id,user_id,kind,title,body,link,created_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)",
      randomUUID(),
      userId,
      kind,
      title,
      body,
      typeof link === "string" && /^\/(?!\/)/.test(link) ? link : null,
    );
  };
  const notifyStaffRoles = (kind, title, body, link = null) => {
    for (const staff of all(
      "SELECT id FROM users WHERE role IN ('STAFF','ADMIN')",
    ))
      notify(staff.id, kind, title, body, link);
  };
  const orderExtras = createOrderExtras({
    one,
    all,
    run,
    fail,
    clean: (...a) => clean(...a),
    clock,
    requireUser: (u) => requireUser(u),
    requireStaff: (u) => requireStaff(u),
    isStaff,
    isAdmin,
    settings: () => settings(),
    orderRefundState: (...a) => orderRefundState(...a),
  });
  const stockLowCooldown = new Map();
  const maybeNotifyStockLow = (variantId) => {
    const row = one(
      `SELECT v.id,v.label,p.name,
              (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}) AS stock
       FROM variants v JOIN products p ON p.id=v.product_id
       WHERE v.id=? AND p.preorder=0`,
      variantId,
    );
    if (!row || row.stock > getLowStockAt()) return;
    const now = Date.now();
    const last = stockLowCooldown.get(variantId) ?? 0;
    if (now - last < 300000) return;
    stockLowCooldown.set(variantId, now);
    notifyStaffRoles(
      "stock_low",
      "สต็อกใกล้หมด",
      row.name + " / " + row.label + " เหลือ " + row.stock,
    );
  };
  // S2: test money (sandbox payments, DEMO_CREDIT) counts only while the shop is in test mode.
  const moneyScope = createMoneyScope(allowSandbox);
  /** FR-F10 parts: gross paid (payments SUCCEEDED) and refunds, in one Bangkok range. */
  const salesMoney = (range = null) => {
    const bounds = range
      ? " AND COALESCE(finalized_at, created_at) >= ? AND COALESCE(finalized_at, created_at) <= ?"
      : "";
    const refundBounds = range
      ? " AND created_at >= ? AND created_at <= ?"
      : "";
    const params = range ? [range.fromUtc, range.toUtc] : [];
    const paid = one(
      `SELECT COALESCE(SUM(amount),0) AS n, COUNT(*) AS count FROM payments WHERE status='SUCCEEDED' AND ${moneyScope.payment()}` +
        bounds,
      ...params,
    );
    const refunds = one(
      `SELECT COALESCE(SUM(ABS(amount)),0) AS n FROM ledger WHERE kind='REFUND' AND ${moneyScope.ledger()}` +
        refundBounds,
      ...params,
    ).n;
    return { gross: paid.n, paidCount: paid.count, refunds };
  };
  /** FR-F10: one revenue formula — payments SUCCEEDED minus refunds. */
  const salesRevenueSatang = (range = null) => {
    const m = salesMoney(range);
    return m.gross - m.refunds;
  };
  /** Interpret YYYY-MM-DD as Asia/Bangkok calendar days → UTC SQL timestamps. */
  const bangkokDayRange = (from, to) => {
    const day = (label, value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        fail(400, label + " ต้องเป็น YYYY-MM-DD");
      return value;
    };
    const fromDay = day("วันเริ่ม", from);
    const toDay = day("วันสิ้นสุด", to);
    if (fromDay > toDay) fail(400, "ช่วงวันไม่ถูกต้อง");
    const fromUtc = new Date(fromDay + "T00:00:00+07:00")
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const toUtc = new Date(toDay + "T23:59:59+07:00")
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    return { from: fromDay, to: toDay, fromUtc, toUtc };
  };
  const nextQueueNumber = () => {
    const row = one(
      "SELECT COALESCE(MAX(queue_number),0)+1 AS n FROM reservations",
    );
    return row.n;
  };
  const chatRate = new Map();
  const staffChatCooldown = new Map();
  const assertChatRateLimit = (userId) => {
    const now = Date.now();
    let hit = chatRate.get(userId);
    if (!hit || hit.expires < now) hit = { n: 0, expires: now + 60000 };
    hit.n += 1;
    chatRate.set(userId, hit);
    if (hit.n > 30) fail(429, "ส่งข้อความเร็วเกินไป กรุณาลองใหม่ในหนึ่งนาที");
  };
  const adminChatLink = (threadId) => "/admin/chat?thread=" + encodeURIComponent(threadId);
  const notifyStaffChatThrottled = (threadId, title, body) => {
    const now = Date.now();
    const last = staffChatCooldown.get(threadId) ?? 0;
    if (now - last < 60000) return;
    staffChatCooldown.set(threadId, now);
    alerts.emit("chat_message", { threadId });
    for (const staff of all(
      "SELECT id FROM users WHERE role IN ('STAFF','ADMIN')",
    ))
      notify(staff.id, "chat", title, body, adminChatLink(threadId));
  };
  const integer = (v, min, max, label) => {
    if (!Number.isSafeInteger(v) || v < min || v > max)
      fail(400, label + "ไม่ถูกต้อง");
    return v;
  };
  const clean = (v, min, max, label) => {
    if (typeof v !== "string" || v.trim().length < min || v.trim().length > max)
      fail(400, label + "ไม่ถูกต้อง");
    return v.trim();
  };
  const coupons = createCouponApis({
    requireAdmin,
    requireUser,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    randomUUID,
    clock,
    moneyScope,
  });
  const { releaseCouponForOrder } = coupons;
  const categoryApis = createCategoryApis({ requireAdmin, one, all, run, tx, fail });
  // ctx: { ip, userAgent } from the request. Only a coarse device label and the IP
  // cut to /24 (IPv6 /48) are stored, for the "my devices" list (account-sessions.mjs).
  const issueSession = (user, ctx = {}) => {
    const token = randomBytes(32).toString("hex");
    const now = clock();
    // ADMIN/STAFF: 12h absolute + 2h idle; customers keep 7 days (auth-hardening.mjs).
    const lifetime = auth.sessionLifetime(user);
    const context = sessionContext(ctx);
    run("DELETE FROM sessions WHERE expires_at<?", now);
    run(
      "INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen,device,ip_masked) VALUES(?,?,?,?,?,?,?)",
      hash(token),
      user.id,
      now + lifetime,
      now,
      now,
      context.device,
      context.ipMasked,
    );
    return { user: publicUser(user), token, maxAge: Math.floor(lifetime / 1000) };
  };
  const auth = createAuthHardening({
    one,
    run,
    tx,
    fail,
    key,
    clock,
    encrypt,
    decrypt,
    passwordMatches,
    issueSession: (user, ctx) => issueSession(user, ctx),
  });
  const accountSessions = createAccountSessionApis({
    one,
    all,
    run,
    tx,
    fail,
    key,
    clock,
    hash,
    requireUser,
  });
  const alerts = createAlerts({
    one,
    all,
    run,
    encrypt,
    decrypt,
    fail,
    requireAdmin,
    reauthAdmin: auth.reauthAdmin,
    clock,
    fetch: alertFetch,
    waitUntil,
    redirect: alertRedirect,
    shopName: () => settings().shopName,
    summaryFor: (day) => salesMoney(bangkokDayRange(day, day)),
    stockInfo: (variantId) => {
      const row = one(
        `SELECT v.id,v.label,p.id AS product_id,p.name,
                (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}) AS stock
         FROM variants v JOIN products p ON p.id=v.product_id
         WHERE v.id=? AND p.preorder=0`,
        variantId,
      );
      if (!row) return null;
      const level = row.stock <= 0 ? "out" : row.stock <= getLowStockAt() ? "low" : "ok";
      return { level, stock: row.stock, name: row.name, label: row.label, productId: row.product_id };
    },
  });
  const backupApis = createBackupApis({
    db,
    one,
    run,
    requireAdmin,
    reauthAdmin: auth.reauthAdmin,
    fail,
    clock,
    backups,
    state: alerts.state,
    meta: () => ({
      shop: settings().shopName,
      mode: allowSandbox ? "sandbox" : "live",
      storage: publicService.storageKind ?? "local-sqlite",
    }),
  });
  function seedData() {
    if (one("SELECT id FROM products LIMIT 1")) return;
    tx(() => {
      for (const p of catalog) {
        run(
          "INSERT INTO products(id,name,category,description,art,featured) VALUES(?,?,?,?,?,?)",
          p.id,
          p.name,
          p.category,
          p.description,
          p.art,
          p.featured ? 1 : 0,
        );
        run(
          "INSERT INTO variants(id,product_id,label,price,active,sort_order) VALUES(?,?,?,?,1,0)",
          p.id + "-30",
          p.id,
          p.category === "gift" ? "โค้ดดิจิทัล" : "30 วัน",
          p.price,
        );
      }
      for (const p of catalog.slice(0, 5))
        run(
          "INSERT INTO variants(id,product_id,label,price,active,sort_order) VALUES(?,?,?,?,1,1)",
          p.id + "-90",
          p.id,
          "90 วัน",
          p.price * 2.5,
        );
      const variants = all("SELECT id FROM variants");
      let n = 1;
      for (const v of variants)
        for (let i = 0; i < 4; i++) {
          const code = "DEMO-KEY-NOT-VALID-" + String(n++).padStart(4, "0");
          insertInventoryCredential(v.id, code, "", { legacy: 1 });
        }
      // Real persisted demo activity, never fabricated live events.
      for (const [i, name] of ["jd-demo", "first-demo"].entries()) {
        const id = randomUUID();
        run(
          "INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,datetime('now',?))",
          id,
          name + "@example.invalid",
          name,
          passwordHash(randomBytes(32).toString("hex")),
          i === 0 ? "-9 hours" : "-2 days",
        );
        run(
          `INSERT INTO ledger(id,user_id,amount,reference,label,kind,direction,fee,net,status,finalized_at,created_at)
           VALUES(?,?,?,?,?,'DEMO_CREDIT','in',0,?,?,?,datetime('now','-2 days'))`,
          randomUUID(),
          id,
          50000,
          "seed-grant-" + id,
          "เครดิตเริ่มต้น (ทดลอง)",
          50000,
          "SUCCEEDED",
          new Date(Date.now() - 2 * 86400000)
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
        );
        const order = randomUUID();
        run(
          "INSERT INTO orders(id,user_id,variant_id,quantity,total,status,request_key,payment_hash,created_at) VALUES(?,?,?,1,10000,'DELIVERED',?,?,datetime('now','-1 day'))",
          order,
          id,
          "stream-plus-30",
          "seed-" + i,
          hash(randomBytes(32)),
        );
        const stock = one(
          `SELECT id FROM inventory WHERE variant_id=? AND ${inventoryAvailableSql} LIMIT 1`,
          "stream-plus-30",
        );
        run(
          "UPDATE inventory SET order_id=?,sold_at=datetime('now','-1 day') WHERE id=?",
          order,
          stock.id,
        );
        run(
          `INSERT INTO ledger(id,user_id,amount,reference,label,kind,direction,fee,net,status,order_id,finalized_at,created_at)
           VALUES(?,?,?,?,?,'DEMO_CREDIT','out',0,?,?,?,?,datetime('now','-1 day'))`,
          randomUUID(),
          id,
          -10000,
          order,
          "ซื้อ STREAM+",
          -10000,
          "SUCCEEDED",
          order,
          new Date(Date.now() - 86400000)
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
        );
      }
    });
  }
  if (seed) seedData();
  if (
    seed &&
    !one("SELECT key FROM runtime_flags WHERE key='reference-catalog-v1'")
  )
    tx(() => {
      const legacy = catalog.filter((p) => !p.featured).map((p) => p.id);
      for (const id of legacy)
        run("UPDATE products SET hidden_seed=1 WHERE id=?", id);
      run(
        "UPDATE products SET name='DISNEY+',description='mergmrgmgreg;mfgg',featured=1 WHERE id='stream-plus'",
      );
      run(
        "UPDATE products SET name='MONOMAX',description='wrgwreg3g34g43rtq34twefq24t',featured=0,preorder=1 WHERE id='cinema-max'",
      );
      run(
        "UPDATE variants SET label='DISNEY+ 30 DAYS หาร',price=10000 WHERE id='stream-plus-30'",
      );
      run(
        "UPDATE variants SET label='fyhdtjthjht',price=11000 WHERE id='stream-plus-90'",
      );
      run(
        "INSERT OR IGNORE INTO variants(id,product_id,label,price,active,sort_order) VALUES('stream-plus-full','stream-plus','DISNEY+ 30 DAYS ยกแอค',38900,1,2)",
      );
      run(
        "UPDATE variants SET label='MONOMAX 30 DAYS หาร',price=12900 WHERE id='cinema-max-30'",
      );
      run(
        "UPDATE variants SET label='MONOMAX 30 DAYS ยกแอค',price=12900 WHERE id='cinema-max-90'",
      );
      for (const [variantId, target] of [
        ["stream-plus-30", 8],
        ["stream-plus-90", 17],
      ]) {
        const present = one(
          `SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND ${inventoryAvailableSql}`,
          variantId,
        ).n;
        for (let i = present; i < target; i++) {
          const code =
            "DEMO-KEY-NOT-VALID-REF-" +
            variantId.toUpperCase() +
            "-" +
            String(i).padStart(4, "0");
          insertInventoryCredential(variantId, code, "", { legacy: 1 });
        }
      }
      run(
        "UPDATE users SET username='1122',name='1122' WHERE email='first-demo@example.invalid'",
      );
      run(
        "UPDATE users SET username='jd000',name='jd000' WHERE email='jd-demo@example.invalid'",
      );
      const reviewOrder = one(
        "SELECT o.id,o.user_id FROM orders o JOIN users u ON u.id=o.user_id WHERE u.email='first-demo@example.invalid' AND o.status='DELIVERED' LIMIT 1",
      );
      if (
        reviewOrder &&
        !one("SELECT id FROM reviews WHERE order_id=?", reviewOrder.id)
      )
        run(
          "INSERT INTO reviews(id,order_id,user_id,rating,comment) VALUES(?,?,?,?,?)",
          randomUUID(),
          reviewOrder.id,
          reviewOrder.user_id,
          5,
          "",
        );
      run("INSERT INTO runtime_flags VALUES('reference-catalog-v1','applied')");
    });
  if (
    !allowSandbox &&
    !one("SELECT key FROM runtime_flags WHERE key='template-ready'")
  ) {
    const demoIds = catalog.map((p) => p.id);
    const marks = demoIds.map(() => "?").join(",");
    tx(() => {
      // S9: ledger/audit are append-only; this one-time cleanup is the only delete.
      dropAppendOnlyMoney(db);
      const demoUsers = all(
        // Launch cleanup removes only accounts the demo buttons created. Real customers who
        // signed up during testing (with or without an email) are never selected by pattern.
        "SELECT id FROM users WHERE is_demo=1",
      ).map((row) => row.id);
      run(
        `DELETE FROM inventory WHERE variant_id IN (SELECT id FROM variants WHERE product_id IN (${marks}))`,
        ...demoIds,
      );
      run(
        `DELETE FROM reviews WHERE order_id IN (SELECT o.id FROM orders o JOIN variants v ON v.id=o.variant_id WHERE v.product_id IN (${marks}))`,
        ...demoIds,
      );
      run(
        `DELETE FROM payments WHERE order_id IN (SELECT o.id FROM orders o JOIN variants v ON v.id=o.variant_id WHERE v.product_id IN (${marks}))`,
        ...demoIds,
      );
      run(
        `DELETE FROM reservations WHERE variant_id IN (SELECT id FROM variants WHERE product_id IN (${marks}))`,
        ...demoIds,
      );
      run(
        `DELETE FROM orders WHERE variant_id IN (SELECT id FROM variants WHERE product_id IN (${marks}))`,
        ...demoIds,
      );
      run(
        `DELETE FROM variants WHERE product_id IN (${marks})`,
        ...demoIds,
      );
      run(`DELETE FROM products WHERE id IN (${marks})`, ...demoIds);
      if (demoUsers.length) {
        const users = demoUsers.map(() => "?").join(",");
        run(
          `DELETE FROM sessions WHERE user_id IN (${users})`,
          ...demoUsers,
        );
        run(
          `DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE user_id IN (${users}))`,
          ...demoUsers,
        );
        run(
          `DELETE FROM chat_threads WHERE user_id IN (${users})`,
          ...demoUsers,
        );
        run(
          `DELETE FROM notifications WHERE user_id IN (${users})`,
          ...demoUsers,
        );
        run(`DELETE FROM payments WHERE user_id IN (${users})`, ...demoUsers);
        run(`DELETE FROM ledger WHERE user_id IN (${users})`, ...demoUsers);
        run(`DELETE FROM reviews WHERE user_id IN (${users})`, ...demoUsers);
        // Accounts a demo visitor bought from real products during testing still point at
        // their orders; those units were handed out, so they go with the orders (unsold
        // stock is untouched).
        run(
          `DELETE FROM inventory WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (${users})) OR reservation_id IN (SELECT id FROM reservations WHERE user_id IN (${users}))`,
          ...demoUsers,
          ...demoUsers,
        );
        run(
          `DELETE FROM reservations WHERE user_id IN (${users})`,
          ...demoUsers,
        );
        run(`DELETE FROM orders WHERE user_id IN (${users})`, ...demoUsers);
        run(
          `DELETE FROM users WHERE id IN (${users}) AND role<>'ADMIN'`,
          ...demoUsers,
        );
        // Demo owner accounts stay for the audit trail but can never sign in again.
        run(`UPDATE users SET status='SUSPENDED' WHERE id IN (${users}) AND role='ADMIN'`, ...demoUsers);
      }
      const saved = one(
        "SELECT value FROM runtime_flags WHERE key='shop-settings'",
      );
      if (saved) {
        const current = JSON.parse(saved.value);
        if (
          current.line === "@832wjrpn" ||
          current.email === "ceo.natthanan@shipx.sbs" ||
          String(current.policy || "").includes("ตัวอย่างสาธิต")
        )
          run("DELETE FROM runtime_flags WHERE key='shop-settings'");
      }
      // Coupon uses taken by demo orders deleted above must not count after launch.
      if (one("SELECT name FROM sqlite_master WHERE type='table' AND name='coupon_redemptions'"))
        run(
          `DELETE FROM coupon_redemptions
           WHERE (order_id IS NOT NULL AND order_id NOT IN (SELECT id FROM orders))
              OR (reservation_id IS NOT NULL AND reservation_id NOT IN (SELECT id FROM reservations))`,
        );
      run(
        "INSERT INTO runtime_flags(key,value) VALUES('template-ready','1')",
      );
      ensureAppendOnlyMoney(db);
    });
  }
  if (adminPassword) {
    if (adminPassword.length < 8)
      throw new Error("ASTRA_ADMIN_PASSWORD must have at least 8 characters");
    const email = "admin@astra.local";
    const existing = one("SELECT id FROM users WHERE email=?", email);
    const adminId = existing?.id ?? randomUUID();
    // Apply the env password only when the secret itself changes, so a password the
    // owner changed in the back office survives restarts. Rotating the secret still wins.
    const secretMark = createHmac("sha256", key).update("admin-secret:" + adminPassword).digest("hex");
    const appliedMark = one("SELECT value FROM runtime_flags WHERE key='admin-secret'")?.value;
    if (existing && appliedMark !== secretMark) {
      run(
        "UPDATE users SET password_hash=?,role=? WHERE id=?",
        passwordHash(adminPassword),
        ROLES.ADMIN,
        existing.id,
      );
      // Escape hatch: rotating the secret also clears the owner's 2FA and lockout,
      // so an operator who lost the authenticator can always get back in.
      auth.resetSecondFactor(existing.id, "admin-secret-rotated");
    } else if (existing) run("UPDATE users SET role=? WHERE id=?", ROLES.ADMIN, existing.id);
    else
      run(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,?)",
        adminId,
        email,
        "ผู้ดูแลร้าน",
        passwordHash(adminPassword),
        ROLES.ADMIN,
      );
    run(
      "INSERT INTO runtime_flags(key,value) VALUES('admin-secret',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      secretMark,
    );
    // Owner can sign in with the short name "admin" too, unless a customer took it.
    if (!one("SELECT id FROM users WHERE username='admin' AND id<>?", adminId))
      run("UPDATE users SET username='admin' WHERE id=?", adminId);
  }
  function register(rawInput, ctx = {}) {
    const input = withoutClientPrivileges(rawInput);
    const name = clean(input.name ?? input.username, 2, 60, "ชื่อผู้ใช้");
    const username = input.username
      ? clean(input.username, 3, 32, "ชื่อผู้ใช้")
      : null;
    if (username && !/^[a-zA-Z0-9_.-]+$/.test(username))
      fail(
        400,
        "ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข จุด ขีด และขีดล่าง",
      );
    if (username && one("SELECT id FROM users WHERE username=?", username))
      fail(409, "ชื่อผู้ใช้นี้ถูกใช้แล้ว");
    const email = clean(
      input.email ||
        (username ?? randomBytes(8).toString("hex")) + "@no-email.asiax.local",
      5,
      160,
      "อีเมล",
    ).toLowerCase();
    if (
      input.confirmPassword !== undefined &&
      input.password !== input.confirmPassword
    )
      fail(400, "รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      fail(400, "รูปแบบอีเมลไม่ถูกต้อง");
    const password = clean(
      input.password,
      10,
      128,
      "รหัสผ่าน (อย่างน้อย 10 ตัวอักษร)",
    );
    if (one("SELECT id FROM users WHERE email=?", email))
      fail(409, "อีเมลนี้ถูกใช้งานแล้ว");
    const id = randomUUID();
    tx(() => {
      run(
        "INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)",
        id,
        email,
        name,
        passwordHash(password),
      );
      if (username) run("UPDATE users SET username=? WHERE id=?", username, id);
      if (allowSandbox)
        insertLedgerEntry({
          userId: id,
          amount: 50000,
          reference: "welcome-" + id,
          label: "เครดิตต้อนรับ (ทดลอง)",
          kind: "DEMO_CREDIT",
          direction: "in",
        });
      audit({ id }, "REGISTER", id);
    });
    return issueSession(one("SELECT * FROM users WHERE id=?", id), ctx);
  }
  // Lockout, failed-login audit and the TOTP second step live in auth-hardening.mjs.
  const login = (rawInput, ctx) => auth.login(rawInput, ctx);
  function demo(ctx = {}) {
    if (!allowSandbox) fail(403, "ร้านนี้ไม่เปิดบัญชีทดลอง");
    const suffix = randomBytes(8).toString("hex");
    const visitor = register({
      name: "ผู้เยี่ยมชม " + suffix.slice(0, 4),
      email: suffix + "@demo.astra.local",
      password: randomBytes(24).toString("hex"),
    }, ctx);
    run("UPDATE users SET is_demo=1 WHERE id=?", visitor.user.id);
    return visitor;
  }
  function demoMerchant(ctx = {}) {
    if (!allowDemoAdmin)
      fail(403, "บัญชีผู้ดูแลทดลองใช้ได้เฉพาะพื้นที่สาธิตส่วนตัว");
    const suffix = randomBytes(8).toString("hex");
    const registered = register({
      name: "เจ้าของร้านทดลอง",
      email: suffix + "@merchant.astra.local",
      password: randomBytes(24).toString("hex"),
    });
    run("UPDATE users SET role=?,is_demo=1 WHERE id=?", ROLES.ADMIN, registered.user.id);
    run("DELETE FROM sessions WHERE token_hash=?", hash(registered.token));
    audit({ id: registered.user.id }, "DEMO_MERCHANT", registered.user.id);
    return issueSession(
      one("SELECT * FROM users WHERE id=?", registered.user.id),
      ctx,
    );
  }
  function session(token) {
    if (!token) return null;
    return auth.sessionUser(hash(token));
  }
  const getLowStockAt = () => {
    const raw = settings().lowStockAt;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 3;
  };
  const {
    productImageFields,
    addProductImage,
    reorderProductImages,
    deleteProductImage,
    getFile,
  } = createAdminProductImageApis({
    requireAdmin,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    audit,
    fileStore,
  });
  // Profile avatar + shop logo (UP-2). Wired after product images so fileStore is ready.
  // settings()/persistShopSettings are function declarations (hoisted) in this scope.
  const { setAvatar, removeAvatar, setLogo, removeLogo } = createProfileUploadApis({
    requireUser,
    requireAdmin,
    one,
    run,
    fail,
    audit,
    fileStore,
    // Read stored JSON only — settings() hides logoKey from API consumers.
    readShopSettings: () => {
      const raw = one(
        "SELECT value FROM runtime_flags WHERE key='shop-settings'",
      );
      const s = raw ? JSON.parse(raw.value) : {};
      delete s.logoUrl;
      return s;
    },
    writeShopSettings: (obj) => persistShopSettings(obj),
  });
  function mapProduct(row) {
    // Usage instructions are for buyers of a delivered order only (order-extras.mjs).
    const { usage_instructions: _usage, ...p } = row;
    const lowAt = getLowStockAt();
    return {
      ...p,
      ...productImageFields(p.id),
      variants: all(
        `SELECT v.*, CASE WHEN p.preorder=1 THEN 0 ELSE (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}) END AS stock FROM variants v JOIN products p ON p.id=v.product_id WHERE v.product_id=? AND COALESCE(v.active,1)=1 ORDER BY v.sort_order ASC, CASE WHEN v.id='stream-plus-full' THEN 0 WHEN v.id LIKE '%-30' THEN 1 ELSE 2 END, price, v.id`,
        p.id,
      ).map(({ stock, ...v }) => ({
        ...v,
        price: p.preorder && v.id === "cinema-max-30" ? 0 : v.price,
        // Customers never see a stock number: only a status and whether it can be
        // ordered now (preorder = always). Exact counts stay on the admin APIs.
        stockStatus: stock <= 0 ? "out" : stock <= lowAt ? "low" : "in",
        available: !!p.preorder || stock > 0,
      })),
      rating: one(
        "SELECT AVG(r.rating) AS average,COUNT(*) AS count FROM reviews r JOIN orders o ON o.id=r.order_id JOIN variants v ON v.id=o.variant_id WHERE v.product_id=?",
        p.id,
      ),
      sold: one(
        "SELECT COALESCE(SUM(o.quantity),0) AS count FROM orders o JOIN variants v ON v.id=o.variant_id WHERE v.product_id=? AND o.status='DELIVERED'",
        p.id,
      ).count,
    };
  }
  function products() {
    return all("SELECT * FROM products WHERE active=1 AND hidden_seed=0").map(
      mapProduct,
    );
  }
  function productDetail(id) {
    const productId = clean(id, 1, 80, "สินค้า");
    const p = one(
      "SELECT * FROM products WHERE id=? AND active=1 AND hidden_seed=0",
      productId,
    );
    if (!p) fail(404, "ไม่พบสินค้า");
    return mapProduct(p);
  }
  function settings() {
    const raw = one(
      "SELECT value FROM runtime_flags WHERE key='shop-settings'",
    );
    const base = {
      shopName: "ร้านค้า",
      description: "",
      announcement: "",
      line: "",
      email: "",
      phone: "",
      facebook: "",
      discord: "",
      policy: "",
      requireTerms: true,
      stockOrder: "oldest",
      shopOpen: true,
      lowStockAt: 3,
      // Unpaid orders/preorders older than this are cancelled (pending-expiry.mjs).
      pendingExpiryMinutes: PENDING_EXPIRY_DEFAULT,
      ...(raw ? JSON.parse(raw.value) : {}),
    };
    // logoUrl is derived for API consumers; logoKey stays internal (never expose).
    delete base.logoUrl;
    const logoKey =
      typeof base.logoKey === "string" && base.logoKey.length > 0
        ? base.logoKey
        : null;
    delete base.logoKey;
    return {
      ...base,
      logoUrl: logoKey ? "/api/files/" + logoKey : null,
    };
  }
  function persistShopSettings(settingsObj) {
    const stored = { ...settingsObj };
    delete stored.logoUrl;
    run(
      "INSERT INTO runtime_flags(key,value) VALUES('shop-settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(stored),
    );
  }
  function saveSettings(user, input) {
    requireAdmin(user);
    const current = settings();
    const before = { ...current };
    // settings() hides logoKey — reattach from store so saveSettings cannot wipe the logo.
    const rawLogo = one(
      "SELECT value FROM runtime_flags WHERE key='shop-settings'",
    );
    if (rawLogo) {
      const parsed = JSON.parse(rawLogo.value);
      if (typeof parsed.logoKey === "string" && parsed.logoKey)
        current.logoKey = parsed.logoKey;
    }
    for (const [field, max] of [
      ["shopName", 80],
      ["description", 1000],
      ["announcement", 1000],
      ["line", 200],
      ["email", 200],
      ["phone", 200],
      ["facebook", 200],
      ["discord", 200],
      ["policy", 10000],
    ]) {
      if (input[field] !== undefined)
        current[field] = clean(
          input[field],
          field === "shopName" ? 2 : 0,
          max,
          field,
        );
    }
    if (input.requireTerms !== undefined)
      current.requireTerms =
        input.requireTerms === true || input.requireTerms === "on";
    if (input.shopOpen !== undefined) {
      if (typeof input.shopOpen !== "boolean") fail(400, "สถานะร้านไม่ถูกต้อง");
      current.shopOpen = input.shopOpen;
    }
    if (input.stockOrder !== undefined) {
      if (!["oldest", "newest", "random"].includes(input.stockOrder))
        fail(400, "ลำดับสต็อกไม่ถูกต้อง");
      current.stockOrder = input.stockOrder;
    }
    if (input.lowStockAt !== undefined) {
      current.lowStockAt = integer(input.lowStockAt, 1, 100, "เกณฑ์สต็อกใกล้หมด");
    }
    if (input.pendingExpiryMinutes !== undefined) {
      // Form posts send text; accept "30" as well as 30.
      const raw = input.pendingExpiryMinutes;
      const value = typeof raw === "string" && /^\s*\d{1,5}\s*$/.test(raw) ? Number(raw) : raw;
      if (!Number.isSafeInteger(value) || value < PENDING_EXPIRY_MIN || value > PENDING_EXPIRY_MAX)
        fail(400, `เวลารอชำระเงินต้องอยู่ระหว่าง ${PENDING_EXPIRY_MIN}–${PENDING_EXPIRY_MAX} นาที`);
      current.pendingExpiryMinutes = value;
    }
    // Legal pages form (ตั้งค่า › ข้อกำหนดและนโยบาย). Plain text only; escaped when rendered.
    if (input.legal !== undefined) current.legal = normalizeLegal(input.legal, fail);
    // FAQ form (ตั้งค่า › คำถามที่พบบ่อย). Plain text only; escaped when rendered.
    if (input.faq !== undefined)
      current.faq = normalizeFaq(input.faq, fail, {
        productExists: (id) => !!one("SELECT id FROM products WHERE id=?", id),
      });
    // Client cannot set logo via this form — logoKey stays; logoUrl is never stored.
    delete current.logoUrl;
    persistShopSettings(current);
    // S10: keep what changed (short values only) so the audit log answers "who changed what".
    const changed = {};
    for (const [field, value] of Object.entries(current)) {
      if (JSON.stringify(before[field]) === JSON.stringify(value)) continue;
      const short = (v) => (typeof v === "string" && v.length > 80 ? v.slice(0, 80) + "…" : v);
      if (value && typeof value === "object") {
        // Nested settings (legal pages): list which parts changed instead of copying long text.
        const from = before[field] ?? {};
        changed[field] = {
          fields: [...new Set([...Object.keys(from), ...Object.keys(value)])].filter(
            (key) => JSON.stringify(from[key]) !== JSON.stringify(value[key]),
          ),
        };
        continue;
      }
      changed[field] = { from: short(before[field] ?? null), to: short(value) };
    }
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      "SAVE_SETTINGS",
      user.id,
      Object.keys(changed).length ? JSON.stringify({ changed }) : null,
    );
    return { shop: settings() };
  }
  /** Public legal pages data: the saved form (or nothing → built-in defaults) + the old policy text. */
  function legal() {
    const shop = settings();
    return { legal: shop.legal ?? null, policy: shop.policy ?? "" };
  }
  /** Public FAQ data: the saved list, or null → built-in defaults (server/faq.mjs). */
  function faq() {
    return { faq: settings().faq ?? null };
  }
  function overview() {
    // The legal text and FAQ can be long; storefront pages fetch them from /api/legal and /api/faq.
    const { legal: _legal, faq: _faq, ...shop } = settings();
    return {
      shop,
      customers: one("SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'").n,
      products: one(
        `SELECT COUNT(*) AS n FROM inventory i JOIN variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id WHERE p.active=1 AND p.hidden_seed=0 AND p.preorder=0 AND ${inventoryAvailableAliased}`,
      ).n,
      orders: one("SELECT COUNT(*) AS n FROM orders WHERE status='DELIVERED'")
        .n,
      // Visible categories with at least one product on sale: {id,name,name_en,icon,count}.
      categories: categoryApis.publicCategories(),
      activity: all(
        "SELECT 'purchase' AS kind,u.name,p.name AS product,p.art,v.label,o.created_at AS time FROM orders o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id WHERE o.status='DELIVERED' UNION ALL SELECT 'register' AS kind,u.name,NULL AS product,NULL AS art,NULL AS label,u.created_at AS time FROM users u WHERE role='CUSTOMER' ORDER BY time DESC LIMIT 4",
      ).map((a) => ({
        ...a,
        name: a.name.slice(0, 2) + "***" + a.name.slice(-1),
      })),
    };
  }
  /** Variant a customer may buy, with the price the shop charges (never the client's). */
  const buyableVariant = (variantId) => {
    const variant = one(
      "SELECT v.*,p.preorder FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1 AND p.hidden_seed=0 AND COALESCE(v.active,1)=1",
      variantId,
    );
    if (!variant) fail(404, "ไม่พบสินค้า");
    const unitPrice =
      variant.preorder && variant.id === "cinema-max-30" ? 0 : variant.price;
    return { ...variant, unitPrice };
  };
  /**
   * POST /api/coupons/check — discount preview for one line. Same rules as
   * createOrder; nothing is written. An unusable code answers { valid:false, reason }.
   */
  function checkCoupon(user, input = {}) {
    requireUser(user);
    const variantId = clean(input.variantId, 1, 80, "สินค้า");
    const quantity = integer(input.quantity, 1, 10, "จำนวน");
    const variant = buyableVariant(variantId);
    try {
      const result = coupons.evaluate(user, input.code, {
        productId: variant.product_id,
        subtotal: variant.unitPrice * quantity,
      });
      return {
        valid: true,
        code: result.code,
        subtotal: result.subtotal,
        discount: result.discount,
        total: result.total,
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400)
        return { valid: false, reason: error.message };
      throw error;
    }
  }
  function createOrder(user, input) {
    requireUser(user);
    if (!settings().shopOpen) fail(409, "ร้านปิดให้บริการชั่วคราว");
    const variantId = clean(input.variantId, 1, 80, "สินค้า");
    const quantity = integer(input.quantity, 1, 10, "จำนวน");
    const requestKey = clean(input.requestKey, 8, 128, "รหัสคำขอ");
    if (input.couponCode != null && typeof input.couponCode !== "string")
      fail(400, "โค้ดส่วนลดไม่ถูกต้อง");
    const couponCode = normalizeCouponCode(input.couponCode) || null;
    // Check, count and insert in one transaction so a coupon's last use is taken once.
    return tx(() => {
      const reservation = one(
        "SELECT * FROM reservations WHERE user_id=? AND request_key=?",
        user.id,
        requestKey,
      );
      if (reservation) {
        if (
          reservation.variant_id !== variantId ||
          reservation.quantity !== quantity ||
          (reservation.coupon_code ?? null) !== couponCode
        )
          fail(409, "รหัสคำขอถูกใช้กับคำสั่งซื้ออื่นแล้ว");
        return { ...orderDetail(user, reservation.id), paymentToken: null };
      }
      const prior = one(
        "SELECT * FROM orders WHERE user_id=? AND request_key=?",
        user.id,
        requestKey,
      );
      if (prior) {
        if (
          prior.variant_id !== variantId ||
          prior.quantity !== quantity ||
          (prior.coupon_code ?? null) !== couponCode
        )
          fail(409, "รหัสคำขอถูกใช้กับคำสั่งซื้ออื่นแล้ว");
        return { ...orderDetail(user, prior.id), paymentToken: null };
      }
      const variant = buyableVariant(variantId);
      const subtotal = variant.unitPrice * quantity;
      if (
        !variant.preorder &&
        one(
          `SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND ${inventoryAvailableSql}`,
          variantId,
        ).n < quantity
      )
        fail(409, "สินค้าคงเหลือไม่เพียงพอ กรุณาเลือกจำนวนใหม่");
      // Discount from the coupon row and the database price only (never the client's).
      const applied = couponCode
        ? coupons.evaluate(user, couponCode, { productId: variant.product_id, subtotal })
        : null;
      const discount = applied?.discount ?? 0;
      const token = randomBytes(32).toString("hex"),
        id = randomUUID();
      run(
        // created_at comes from the service clock (same clock the unpaid-order expiry uses).
        `INSERT INTO ${variant.preorder ? "reservations" : "orders"}(id,user_id,variant_id,quantity,total,request_key,payment_hash,warranty_days,discount,coupon_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        user.id,
        variantId,
        quantity,
        subtotal - discount,
        requestKey,
        hash(token),
        // Warranty is what the customer saw when buying; the end date is set at delivery.
        variant.warranty_days ?? 0,
        discount,
        applied ? applied.code : null,
        new Date(clock()).toISOString().slice(0, 19).replace("T", " "),
      );
      if (applied)
        coupons.redeem({
          coupon: applied.coupon,
          userId: user.id,
          orderId: variant.preorder ? null : id,
          reservationId: variant.preorder ? id : null,
          amount: discount,
        });
      audit(user, variant.preorder ? "CREATE_PREORDER" : "CREATE_ORDER", id);
      return { ...orderDetail(user, id), paymentToken: token };
    });
  }
  function orderDetail(user, id) {
    requireUser(user);
    const orderId = clean(id, 1, 80, "คำสั่งซื้อ");
    let order = one(
      "SELECT o.*,p.name,p.art,v.label FROM orders o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id WHERE o.id=? AND o.user_id=?",
      orderId,
      user.id,
    );
    let ownerView = !!order;
    if (!order && isStaff(user)) {
      order = one(
        "SELECT o.*,p.name,p.art,v.label FROM orders o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id WHERE o.id=?",
        orderId,
      );
    }
    if (!order) {
      let reservation = one(
        "SELECT o.*,p.name,p.art,v.label FROM reservations o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id WHERE o.id=? AND o.user_id=?",
        orderId,
        user.id,
      );
      ownerView = !!reservation;
      if (!reservation && isStaff(user)) {
        reservation = one(
          "SELECT o.*,p.name,p.art,v.label FROM reservations o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id WHERE o.id=?",
          orderId,
        );
      }
      if (!reservation) fail(404, "ไม่พบคำสั่งซื้อ");
      // admin_note is internal (FR-O7): never sent to the customer.
      const { payment_hash, request_key, admin_note, ...safe } = reservation;
      const delivered =
        ownerView && reservation.status === "DELIVERED"
          ? readDeliveredItems("reservation_id", orderId)
          : { codes: [], credentials: [] };
      return {
        ...safe,
        preorder: true,
        reviewed: true,
        ...delivered,
        ...orderExtras.customerOrderExtras(orderId, ownerView),
        ...orderRefundState(orderId, true),
        discount: reservation.discount ?? 0,
        subtotal: reservation.total + (reservation.discount ?? 0),
        queueNumber: reservation.queue_number ?? null,
      };
    }
    // admin_note is internal (FR-O7): never sent to the customer.
      const { payment_hash, request_key, admin_note, ...safe } = order;
    const delivered =
      ownerView && order.status === "DELIVERED"
        ? readDeliveredItems("order_id", orderId)
        : { codes: [], credentials: [] };
    return {
      ...safe,
      reviewed: !!one("SELECT id FROM reviews WHERE order_id=?", orderId),
      ...delivered,
      ...orderExtras.customerOrderExtras(orderId, ownerView),
      ...orderRefundState(orderId, false),
      discount: order.discount ?? 0,
      subtotal: order.total + (order.discount ?? 0),
    };
  }
  function staffOrders(user, { limit = 50, cursor } = {}) {
    requireStaff(user);
    let lim = 50;
    if (limit != null && String(limit).trim() !== "") {
      const parsed = Number(limit);
      if (!Number.isInteger(parsed) || parsed < 1)
        fail(400, "จำนวนรายการไม่ถูกต้อง");
      lim = Math.min(100, parsed);
    }
    let cursorCreated = null;
    let cursorId = null;
    if (cursor != null && String(cursor).trim() !== "") {
      try {
        const raw = Buffer.from(String(cursor), "base64url").toString("utf8");
        const [created, id] = raw.split("\n");
        if (!created || !id) fail(400, "cursor ไม่ถูกต้อง");
        cursorCreated = created;
        cursorId = id;
      } catch {
        fail(400, "cursor ไม่ถูกต้อง");
      }
    }
    const cursorSql = cursorCreated
      ? " WHERE created_at < ? OR (created_at = ? AND id < ?)"
      : "";
    const params = cursorCreated
      ? [cursorCreated, cursorCreated, cursorId, lim + 1]
      : [lim + 1];
    const rows = all(
      `SELECT id,status,total,quantity,created_at,customer_id,customer,product_id,product,preorder,queue_number
       FROM (
         SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product,0 AS preorder,NULL AS queue_number
         FROM orders o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
         UNION ALL
         SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product,1 AS preorder,o.queue_number
         FROM reservations o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
       )
       ${cursorSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      ...params,
    ).map((row) => ({ ...row, codes: undefined }));
    const page = rows.slice(0, lim);
    const next =
      rows.length > lim
        ? Buffer.from(
            page[page.length - 1].created_at + "\n" + page[page.length - 1].id,
            "utf8",
          ).toString("base64url")
        : null;
    return { orders: page, nextCursor: next };
  }
  function getPaymentChannel() {
    const channel = paymentChannel();
    return {
      id: channel.id,
      provider: channel.provider,
      active: !!channel.active,
      note: channel.note,
      sandboxOnly:
        channel.provider === "unset" || channel.provider === "sandbox",
    };
  }
  function setPaymentChannel(user, rawInput) {
    requireAdmin(user);
    const input = withoutClientPrivileges(rawInput);
    const provider = clean(input.provider ?? "", 1, 32, "ช่องทางจ่าย");
    if (!["unset", "sandbox", "slipok", "gateway"].includes(provider))
      fail(400, "ช่องทางจ่ายไม่รองรับ");
    if (
      (provider === "slipok" || provider === "gateway") &&
      process.env.ASTRA_CLIENT_PAYMENT_PROVIDER !== provider
    )
      fail(
        501,
        "ยังไม่เปิด SlipOK/Gateway จนกว่าลูกค้าเลือกและยืนยันช่องทาง",
      );
    const active = input.active === true || input.active === 1 ? 1 : 0;
    if (active && provider === "unset")
      fail(400, "ต้องเลือก sandbox ก่อนเปิดใช้งานช่องทาง");
    const note = clean(
      input.note ??
        "ช่องทางเดียว — ห้ามเปิด SlipOK/Gateway จนกว่าลูกค้าเลือก",
      1,
      200,
      "หมายเหตุ",
    );
    run(
      "INSERT INTO payment_channel(id,provider,active,note) VALUES('primary',?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, active=excluded.active, note=excluded.note",
      provider,
      active,
      note,
    );
    audit(user, "SET_PAYMENT_CHANNEL", provider);
    return getPaymentChannel();
  }
  function pay(user, id, input) {
    requireUser(user);
    assertSandboxPayAllowed();
    if (
      one("SELECT id FROM reservations WHERE id=? AND user_id=?", id, user.id)
    )
      return tx(() => {
        const o = one(
          "SELECT * FROM reservations WHERE id=? AND user_id=?",
          id,
          user.id,
        );
        if (o.status === "PREORDER") return orderDetail(user, id);
        if (o.status === "CANCELLED" && o.expired_at) fail(409, EXPIRED_MESSAGE);
        if (o.status !== "PENDING_PAYMENT")
          fail(409, "คำสั่งซื้อนี้ไม่สามารถชำระเงินได้");
        if (
          typeof input.paymentToken !== "string" ||
          !timingSafeEqual(
            Buffer.from(hash(input.paymentToken)),
            Buffer.from(o.payment_hash),
          )
        )
          fail(403, "ข้อมูลยืนยันการชำระเงินไม่ถูกต้อง");
        if (!["success", "failure"].includes(input.outcome))
          fail(400, "ผลการทดลองไม่ถูกต้อง");
        if (input.outcome === "failure") {
          run("UPDATE reservations SET status='FAILED' WHERE id=?", id);
          releaseCouponForOrder(id, "PAYMENT_FAILED");
          return orderDetail(user, id);
        }
        if (publicUser(user).balance < o.total)
          fail(409, "เครดิตทดลองไม่เพียงพอ กรุณาเติมเครดิตก่อน");
        if (o.total)
          insertLedgerEntry({
            userId: user.id,
            amount: -o.total,
            reference: "preorder:" + id,
            label: "ชำระสินค้าสั่งจอง " + id.slice(0, 8),
            kind: "DEMO_CREDIT",
            direction: "out",
            orderId: id,
          });
        const queueNumber = o.queue_number ?? nextQueueNumber();
        run(
          "UPDATE reservations SET status='PREORDER', queue_number=? WHERE id=?",
          queueNumber,
          id,
        );
        const paymentId = randomUUID();
        run(
          `INSERT OR IGNORE INTO payments(
            id, order_id, reservation_id, user_id, amount, currency, status,
            provider, provider_ref, idempotency_key, created_at, finalized_at
          ) VALUES(?,NULL,?,?,?,'THB','SUCCEEDED','sandbox',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
          paymentId,
          id,
          user.id,
          o.total,
          "sandbox:preorder:" + id,
          "pay:reservation:" + id,
        );
        if (o.total)
          insertLedgerEntry({
            userId: user.id,
            amount: o.total,
            reference: "payment-in:" + paymentId,
            label: "รับชำระพรีออเดอร์ " + id.slice(0, 8),
            kind: "PAYMENT_IN",
            direction: "in",
            orderId: id,
            paymentId,
            providerRef: "sandbox:preorder:" + id,
          });
        notify(
          user.id,
          "preorder_queue",
          "ได้รับเลขคิวพรีออเดอร์",
          "คิวของคุณคือ #" + queueNumber,
          "/orders/" + id,
        );
        notifyStaffRoles(
          "preorder_queue_admin",
          "คิวพรีออเดอร์ใหม่",
          "คิว #" + queueNumber + " · " + id.slice(0, 8),
          "/admin/orders/" + id,
        );
        alerts.emit("preorder_paid", {
          id,
          queueNumber,
          variantId: o.variant_id,
          quantity: o.quantity,
          total: o.total,
        });
        audit(user, "PREORDER_PAID", id);
        return orderDetail(user, id);
      });
    return tx(() => {
      const order = one(
        "SELECT * FROM orders WHERE id=? AND user_id=?",
        id,
        user.id,
      );
      if (!order) fail(404, "ไม่พบคำสั่งซื้อ");
      if (order.status === "DELIVERED") return orderDetail(user, id);
      if (order.status === "CANCELLED" && order.expired_at) fail(409, EXPIRED_MESSAGE);
      if (order.status !== "PENDING_PAYMENT")
        fail(409, "คำสั่งซื้อนี้ไม่สามารถชำระเงินได้");
      if (
        typeof input.paymentToken !== "string" ||
        !timingSafeEqual(
          Buffer.from(hash(input.paymentToken)),
          Buffer.from(order.payment_hash),
        )
      )
        fail(403, "ข้อมูลยืนยันการชำระเงินไม่ถูกต้อง");
      if (!["success", "failure"].includes(input.outcome))
        fail(400, "ผลการทดลองไม่ถูกต้อง");
      if (input.outcome === "failure") {
        run("UPDATE orders SET status='FAILED' WHERE id=?", id);
        releaseCouponForOrder(id, "PAYMENT_FAILED");
        audit(user, "PAYMENT_FAILED", id);
        return orderDetail(user, id);
      }
      const available = all(
        `SELECT id FROM inventory WHERE variant_id=? AND ${inventoryAvailableSql} ORDER BY ` +
          (settings().stockOrder === "newest"
            ? "rowid DESC"
            : settings().stockOrder === "random"
              ? "RANDOM()"
              : "rowid ASC") +
          " LIMIT ?",
        order.variant_id,
        order.quantity,
      );
      if (available.length !== order.quantity) {
        run("UPDATE orders SET status='OUT_OF_STOCK' WHERE id=?", id);
        releaseCouponForOrder(id, "OUT_OF_STOCK");
        audit(user, "OUT_OF_STOCK", id);
        return orderDetail(user, id);
      }
      const balance = publicUser(user).balance;
      if (balance < order.total)
        fail(409, "เครดิตทดลองไม่เพียงพอ กรุณาเติมเครดิตก่อน");
      insertLedgerEntry({
        userId: user.id,
        amount: -order.total,
        reference: id,
        label: "ชำระคำสั่งซื้อ " + id.slice(0, 8),
        kind: "DEMO_CREDIT",
        direction: "out",
        orderId: id,
      });
      for (const item of available)
        run(
          `UPDATE inventory SET order_id=?,sold_at=CURRENT_TIMESTAMP WHERE id=? AND ${inventoryAvailableSql}`,
          id,
          item.id,
        );
      // Warranty runs from delivery, using the days snapshotted when the order was placed.
      run(
        `UPDATE orders SET status='DELIVERED',
           warranty_until=CASE WHEN COALESCE(warranty_days,0)>0
             THEN datetime('now','+'||warranty_days||' days') END
         WHERE id=?`,
        id,
      );
      const paymentId = randomUUID();
      run(
        `INSERT OR IGNORE INTO payments(
          id, order_id, reservation_id, user_id, amount, currency, status,
          provider, provider_ref, idempotency_key, created_at, finalized_at
        ) VALUES(?,?,NULL,?,?,'THB','SUCCEEDED','sandbox',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        paymentId,
        id,
        user.id,
        order.total,
        "sandbox:order:" + id,
        "pay:order:" + id,
      );
      insertLedgerEntry({
        userId: user.id,
        amount: order.total,
        reference: "payment-in:" + paymentId,
        label: "รับชำระออเดอร์ " + id.slice(0, 8),
        kind: "PAYMENT_IN",
        direction: "in",
        orderId: id,
        paymentId,
        providerRef: "sandbox:order:" + id,
      });
      notify(
        user.id,
        "code_delivery",
        "ส่งโค้ดสำเร็จ",
        "คำสั่งซื้อ " + id.slice(0, 8) + " ได้รับโค้ดแล้ว",
        "/orders/" + id,
      );
      notifyStaffRoles(
        "order_new",
        "ออเดอร์ใหม่",
        "คำสั่งซื้อ " + id.slice(0, 8) + " ชำระแล้วและส่งของแล้ว",
        "/admin/orders/" + id,
      );
      maybeNotifyStockLow(order.variant_id);
      alerts.emit("order_paid", {
        id,
        variantId: order.variant_id,
        quantity: order.quantity,
        total: order.total,
      });
      alerts.stockAfterSale(order.variant_id);
      audit(user, "PAYMENT_AND_DELIVERY", id);
      return orderDetail(user, id);
    });
  }
  function retry(user, id) {
    requireUser(user);
    const reservation = one(
      "SELECT status,expired_at FROM reservations WHERE id=? AND user_id=?",
      id,
      user.id,
    );
    if (reservation) {
      if (reservation.status === "CANCELLED" && reservation.expired_at) fail(409, EXPIRED_MESSAGE);
      if (reservation.status !== "PENDING_PAYMENT")
        fail(409, "คำสั่งซื้อไม่อยู่ระหว่างรอชำระเงิน");
      const token = randomBytes(32).toString("hex");
      run("UPDATE reservations SET payment_hash=? WHERE id=?", hash(token), id);
      return { ...orderDetail(user, id), paymentToken: token };
    }
    const order = one(
      "SELECT status,expired_at FROM orders WHERE id=? AND user_id=?",
      id,
      user.id,
    );
    if (!order) fail(404, "ไม่พบคำสั่งซื้อ");
    if (order.status === "CANCELLED" && order.expired_at) fail(409, EXPIRED_MESSAGE);
    if (order.status !== "PENDING_PAYMENT")
      fail(409, "คำสั่งซื้อไม่อยู่ระหว่างรอชำระเงิน");
    const token = randomBytes(32).toString("hex");
    run("UPDATE orders SET payment_hash=? WHERE id=?", hash(token), id);
    return { ...orderDetail(user, id), paymentToken: token };
  }
  const TEST_CREDIT_CAP = 10000 * 100;
  function topup(user, input) {
    requireUser(user);
    if (!allowSandbox) fail(501, "การเติมเครดิตทดลองปิดอยู่");
    if (![100, 300, 500, 1000].includes(input.amount))
      fail(400, "กรุณาเลือกยอดเครดิตที่กำหนด");
    const ref =
      "topup-" + user.id + "-" + clean(input.requestKey, 8, 128, "รหัสคำขอ");
    tx(() => {
      const prior = one("SELECT amount FROM ledger WHERE reference=?", ref);
      if (prior && prior.amount !== input.amount * 100)
        fail(409, "รหัสคำขอนี้ถูกใช้กับยอดเติมอื่นแล้ว");
      if (!prior) {
        // Test credit buys real stock if someone loads it, so keep it small: a balance
        // cap and a daily top-up count per account.
        const balance = one(
          "SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE user_id=? AND kind='DEMO_CREDIT'",
          user.id,
        ).n;
        if (balance + input.amount * 100 > TEST_CREDIT_CAP)
          fail(409, "เครดิตทดลองมีได้สูงสุด " + TEST_CREDIT_CAP / 100 + " บาทต่อบัญชี");
        const today = one(
          "SELECT COUNT(*) AS n FROM audit WHERE user_id=? AND action='DEMO_TOPUP' AND created_at >= datetime('now','-1 day')",
          user.id,
        ).n;
        if (today >= 10) fail(429, "เติมเครดิตทดลองได้วันละ 10 ครั้ง");
        insertLedgerEntry({
          userId: user.id,
          amount: input.amount * 100,
          reference: ref,
          label: "เติมเครดิตทดลอง",
          kind: "DEMO_CREDIT",
          direction: "in",
        });
        audit(user, "DEMO_TOPUP", ref);
      }
    });
    return publicUser(user);
  }
  function adminSummary(user, query = {}) {
    requireAdmin(user);
    const hasFrom = query.from != null && String(query.from).trim() !== "";
    const hasTo = query.to != null && String(query.to).trim() !== "";
    if (hasFrom !== hasTo)
      fail(400, "ต้องส่ง from และ to คู่กัน");
    const range = hasFrom
      ? bangkokDayRange(
          clean(query.from, 10, 10, "วันเริ่ม"),
          clean(query.to, 10, 10, "วันสิ้นสุด"),
        )
      : null;
    const timeFilter = range
      ? " AND created_at >= ? AND created_at <= ?"
      : "";
    const params = range ? [range.fromUtc, range.toUtc] : [];
    const orderCount = one(
      `SELECT (
         (SELECT COUNT(*) FROM orders WHERE 1=1${timeFilter})
         + (SELECT COUNT(*) FROM reservations WHERE 1=1${timeFilter})
       ) AS n`,
      ...params,
      ...params,
    ).n;
    // Payment success rate: orders created in the range that got a successful payment.
    const paidCreated = one(
      `SELECT (
         (SELECT COUNT(*) FROM orders o WHERE 1=1${timeFilter.replaceAll("created_at", "o.created_at")}
            AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='SUCCEEDED' AND ${moneyScope.payment("p.")}))
         + (SELECT COUNT(*) FROM reservations o WHERE 1=1${timeFilter.replaceAll("created_at", "o.created_at")}
            AND EXISTS (SELECT 1 FROM payments p WHERE p.reservation_id=o.id AND p.status='SUCCEEDED' AND ${moneyScope.payment("p.")}))
       ) AS n`,
      ...params,
      ...params,
    ).n;
    const newCustomers = one(
      `SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'${timeFilter}`,
      ...params,
    ).n;
    const money = salesMoney(range);
    const revenue = money.gross - money.refunds;
    // Revenue per Bangkok day with the same formula as the revenue card (FR-F10).
    const paidAt = "COALESCE(finalized_at, created_at)";
    const dayOf = (col) => `substr(datetime(${col}, '+7 hours'), 1, 10)`;
    const daily = new Map();
    for (const row of all(
      `SELECT ${dayOf(paidAt)} AS day, SUM(amount) AS n FROM payments
       WHERE status='SUCCEEDED' AND ${moneyScope.payment()}${range ? ` AND ${paidAt} >= ? AND ${paidAt} <= ?` : ""}
       GROUP BY day`,
      ...params,
    ))
      daily.set(row.day, { day: row.day, gross: row.n, refunds: 0 });
    for (const row of all(
      `SELECT ${dayOf("created_at")} AS day, SUM(ABS(amount)) AS n FROM ledger
       WHERE kind='REFUND' AND ${moneyScope.ledger()}${timeFilter}
       GROUP BY day`,
      ...params,
    )) {
      const entry = daily.get(row.day) ?? { day: row.day, gross: 0, refunds: 0 };
      entry.refunds = row.n;
      daily.set(row.day, entry);
    }
    return {
      from: range?.from ?? null,
      to: range?.to ?? null,
      timezone: "Asia/Bangkok",
      mode: moneyScope.mode,
      revenue,
      gross: money.gross,
      refunds: money.refunds,
      orderCount,
      paidOrders: money.paidCount,
      // AOV = revenue ÷ paid orders (not all created orders).
      aov: money.paidCount ? Math.round(revenue / money.paidCount) : 0,
      paymentSuccessRate: orderCount ? paidCreated / orderCount : null,
      paidCreated,
      newCustomers,
      customerCredit: outstandingCredit(),
      daily: [...daily.values()]
        .map((d) => ({ ...d, revenue: d.gross - d.refunds }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  }
  /** Customer credit still owed by the shop (a liability, not revenue). */
  function outstandingCredit() {
    return one(
      `SELECT COALESCE(SUM(net),0) AS n FROM ledger l
       WHERE ${walletRowSql("l.")} AND ${moneyScope.ledger("l.")}`,
    ).n;
  }
  function adminOverview(user) {
    requireAdmin(user);
    return {
      // FR-F10: one formula — payments SUCCEEDED minus REFUND ledger (0 until refunds ship).
      revenue: salesRevenueSatang(),
      orderCount: one(
        "SELECT (SELECT COUNT(*) FROM orders)+(SELECT COUNT(*) FROM reservations) AS n",
      ).n,
      delivered: one(
        "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE status='DELIVERED'",
      ).n,
      stock: one(
        `SELECT COUNT(*) AS n FROM inventory i JOIN variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id WHERE ${inventoryAvailableAliased} AND p.hidden_seed=0 AND p.preorder=0`,
      ).n,
      // Every category (hidden ones too) for the product editor and the list filter.
      categories: categoryApis.listCategories(),
      products: all("SELECT * FROM products WHERE hidden_seed=0").map((p) => ({
        ...p,
        ...productImageFields(p.id),
        variants: all(
          `SELECT v.*,CASE WHEN p.preorder=1 THEN 0 ELSE (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}) END AS stock FROM variants v JOIN products p ON p.id=v.product_id WHERE v.product_id=?`,
          p.id,
        ).map((v) => ({
          ...v,
          price: p.preorder && v.id === "cinema-max-30" ? 0 : v.price,
        })),
      })),
      // S8: only what the dashboard shows — the latest orders and two counters.
      // Full lists live behind the paged, filtered admin APIs.
      orders: all(
        "SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product FROM orders o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id UNION ALL SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product FROM reservations o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id ORDER BY 5 DESC LIMIT 6",
      ),
      pendingPayment: one(
        "SELECT (SELECT COUNT(*) FROM orders WHERE status='PENDING_PAYMENT')+(SELECT COUNT(*) FROM reservations WHERE status='PENDING_PAYMENT') AS n",
      ).n,
      preorderQueue: one("SELECT COUNT(*) AS n FROM reservations WHERE status='PREORDER'").n,
    };
  }
  const importStatusText = {
    duplicate_batch: { pair: "มีคู่ซ้ำในรายการ", code: "มีโค้ดซ้ำในรายการ" },
    existing: { pair: "คู่นี้มีอยู่ในคลังแล้ว", code: "โค้ดนี้มีอยู่ในคลังแล้ว" },
  };
  /**
   * Stock import, one line at a time (Sellix-style "remove duplicates").
   * - dryRun: report each line (ok / duplicate_batch / existing / invalid), write nothing.
   * - skipDuplicates: add only the ok lines, report how many were skipped.
   * - otherwise: all or nothing, as before (any bad line rejects the batch).
   * A line is a duplicate when its loginId (trimmed, any case) or code text is
   * already in the batch or anywhere in inventory (available, sold or defective).
   * Results never carry a password; loginIds are shown, codes are masked.
   */
  function importCodes(user, input = {}) {
    requireAdmin(user);
    const variantId = clean(input.variantId, 1, 80, "ตัวเลือกสินค้า");
    if (!one("SELECT id FROM variants WHERE id=?", variantId))
      fail(404, "ไม่พบตัวเลือกสินค้า");
    const entries = parseImportEntries(input, fail);
    const dryRun = input.dryRun === true;
    const skipDuplicates = input.skipDuplicates === true;
    const classify = () => {
      backfillLoginKeys();
      const seen = new Map();
      return entries.map((entry) => {
        const legacy = entry.kind === "code";
        const secret = legacy ? entry.code : entry.loginId;
        const shown = entry.error
          ? { display: maskSecret(entry.raw ?? secret ?? "") }
          : legacy
            ? { display: maskCode(entry.code) }
            : { display: entry.loginId.slice(0, 120), passwordMasked: "••••••••" };
        const base = { line: entry.line, kind: entry.kind, ...shown };
        if (entry.error) return { ...base, status: "invalid", reason: entry.error };
        const loginKey = inventoryLoginKey(legacy, secret);
        if (seen.has(loginKey))
          return {
            ...base,
            status: "duplicate_batch",
            duplicateOf: seen.get(loginKey),
            reason: "ซ้ำกับบรรทัด " + seen.get(loginKey),
          };
        seen.set(loginKey, entry.line);
        const fingerprint = inventoryFingerprint(secret, legacy ? "" : entry.password);
        const existing = one(
          `SELECT CASE WHEN COALESCE(defective,0)=1 THEN 'defective'
                       WHEN order_id IS NOT NULL OR reservation_id IS NOT NULL THEN 'sold'
                       ELSE 'available' END AS status,
                  variant_id
           FROM inventory WHERE login_key=? OR fingerprint=? LIMIT 1`,
          loginKey,
          fingerprint,
        );
        if (existing)
          return {
            ...base,
            status: "existing",
            existingStatus: existing.status,
            reason:
              existing.status === "sold"
                ? "มีในระบบแล้ว (ขายไปแล้ว)"
                : existing.status === "defective"
                  ? "มีในระบบแล้ว (ถูกแจ้งเสีย)"
                  : existing.variant_id === variantId
                    ? "มีในสต็อกตัวเลือกนี้แล้ว"
                    : "มีในสต็อกตัวเลือกอื่นแล้ว",
          };
        return { ...base, status: "ok", entry };
      });
    };
    const summarize = (lines) => ({
      total: lines.length,
      ok: lines.filter((l) => l.status === "ok").length,
      duplicateInBatch: lines.filter((l) => l.status === "duplicate_batch").length,
      existing: lines.filter((l) => l.status === "existing").length,
      invalid: lines.filter((l) => l.status === "invalid").length,
    });
    const publicLines = (lines) => lines.map(({ entry, ...line }) => line);
    if (dryRun) {
      const lines = tx(classify);
      return { dryRun: true, variantId, lines: publicLines(lines), counts: summarize(lines) };
    }
    return tx(() => {
      const lines = classify();
      const counts = summarize(lines);
      if (!skipDuplicates) {
        const invalid = lines.find((l) => l.status === "invalid");
        if (invalid) fail(400, "บรรทัด " + invalid.line + ": " + invalid.reason);
        const duplicate = lines.find((l) => l.status !== "ok");
        if (duplicate)
          fail(
            409,
            "บรรทัด " + duplicate.line + ": " + importStatusText[duplicate.status][duplicate.kind],
          );
      }
      const ok = lines.filter((l) => l.status === "ok");
      for (const { entry } of ok) {
        if (entry.kind === "code") insertInventoryCredential(variantId, entry.code, "", { legacy: 1 });
        else insertInventoryCredential(variantId, entry.loginId, entry.password, { legacy: 0 });
      }
      const result = {
        imported: ok.length,
        skipped: counts.total - ok.length,
        skippedDuplicates: counts.duplicateInBatch + counts.existing,
        skippedInvalid: counts.invalid,
      };
      run(
        "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
        user.id,
        "IMPORT_CODES",
        variantId,
        JSON.stringify({
          total: counts.total,
          imported: result.imported,
          skippedDuplicates: result.skippedDuplicates,
          skippedInvalid: result.skippedInvalid,
          skipDuplicates,
        }),
      );
      return { ...result, lines: publicLines(lines), counts };
    });
  }
  function previewImportCodes(user, input = {}) {
    return importCodes(user, { ...input, dryRun: true });
  }
  function deliverReservation(user, id) {
    requireStaff(user);
    const reservationId = clean(id, 1, 80, "รหัสพรีออเดอร์");
    return tx(() => {
      const reservation = one(
        "SELECT * FROM reservations WHERE id=?",
        reservationId,
      );
      if (!reservation) fail(404, "ไม่พบพรีออเดอร์");
      if (reservation.status === "DELIVERED") {
        return {
          id: reservation.id,
          status: reservation.status,
          delivered_at: reservation.delivered_at,
          delivered_by: reservation.delivered_by,
          delivered: true,
        };
      }
      if (reservation.status !== "PREORDER")
        fail(409, "พรีออเดอร์นี้ส่งของไม่ได้");
      const available = all(
        `SELECT id FROM inventory WHERE variant_id=? AND ${inventoryAvailableSql} ORDER BY rowid LIMIT ?`,
        reservation.variant_id,
        reservation.quantity,
      );
      if (available.length < reservation.quantity)
        fail(409, "สต็อกไม่พอสำหรับส่งของ");
      // Same text format as CURRENT_TIMESTAMP so dateTime() and period filters work.
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      for (const row of available) {
        const updated = run(
          `UPDATE inventory SET reservation_id=?, sold_at=? WHERE id=? AND ${inventoryAvailableSql}`,
          reservationId,
          now,
          row.id,
        );
        if (!updated.changes) fail(409, "สต็อกไม่พอสำหรับส่งของ");
      }
      run(
        `UPDATE reservations SET status='DELIVERED', delivered_at=?, delivered_by=?,
           warranty_until=CASE WHEN COALESCE(warranty_days,0)>0
             THEN datetime(?,'+'||warranty_days||' days') END
         WHERE id=? AND status='PREORDER'`,
        now,
        user.id,
        now,
        reservationId,
      );
      notify(
        reservation.user_id,
        "order",
        "พรีออเดอร์พร้อมใช้งานแล้ว",
        "รหัสสินค้าถูกจัดส่งแล้ว กดดูคำสั่งซื้อเพื่อรับรหัส",
        "/orders/" + reservationId,
      );
      maybeNotifyStockLow(reservation.variant_id);
      audit(user, "DELIVER_RESERVATION", reservationId);
      return {
        id: reservationId,
        status: "DELIVERED",
        delivered_at: now,
        delivered_by: user.id,
        delivered: true,
      };
    });
  }
  function saveProduct(user, input) {
    requireAdmin(user);
    const id = input.id ? clean(input.id, 1, 80, "รหัสสินค้า") : randomUUID();
    const name = clean(input.name, 2, 80, "ชื่อสินค้า");
    const description = clean(input.description, 5, 1000, "รายละเอียด");
    if (typeof input.category !== "string" || !categoryApis.exists(input.category))
      fail(400, "หมวดหมู่ไม่ถูกต้อง");
    // Price belongs to the variants once a product exists (VariantManager); only a new
    // product takes it here, for its first variant. Updating never overwrites prices.
    const price = input.id ? null : integer(input.price, 100, 10000000, "ราคา");
    const hasPreorder = Object.prototype.hasOwnProperty.call(input, "preorder");
    const hasUsage = Object.prototype.hasOwnProperty.call(input, "usageInstructions");
    const usageInstructions = hasUsage
      ? normalizeUsageInstructions(input.usageInstructions, fail)
      : null;
    // First option of a new product: the form sends its name and warranty. API callers
    // that send neither keep the old default label (backward compatible).
    const firstLabel =
      input.id || input.firstLabel === undefined || input.firstLabel === null
        ? "โค้ดดิจิทัล"
        : clean(input.firstLabel, 1, 80, "ชื่อตัวเลือกแรก");
    const firstWarranty =
      input.id ||
      input.firstWarrantyDays === undefined ||
      input.firstWarrantyDays === null ||
      input.firstWarrantyDays === ""
        ? 0
        : integer(input.firstWarrantyDays, 0, 365, "วันรับประกัน");
    const preorderFlag =
      input.preorder === true || input.preorder === "on" || input.preorder === 1
        ? 1
        : 0;
    return tx(() => {
      if (input.id) {
        const existing = one("SELECT id,preorder FROM products WHERE id=?", id);
        if (!existing) fail(404, "ไม่พบสินค้า");
        const preorder = hasPreorder ? preorderFlag : existing.preorder ? 1 : 0;
        run(
          "UPDATE products SET name=?,description=?,category=?,active=?,featured=?,preorder=? WHERE id=?",
          name,
          description,
          input.category,
          input.active === false ? 0 : 1,
          input.featured === true || input.featured === "on" ? 1 : 0,
          preorder,
          id,
        );
        if (preorder !== existing.preorder)
          audit(user, preorder ? "PRODUCT_SET_PREORDER" : "PRODUCT_SET_READY", id);
        if (hasUsage)
          run("UPDATE products SET usage_instructions=? WHERE id=?", usageInstructions, id);
      } else {
        run(
          "INSERT INTO products(id,name,category,description,art,active,featured,preorder) VALUES(?,?,?,?,?,?,?,?)",
          id,
          name,
          input.category,
          description,
          "gift",
          input.active === false ? 0 : 1,
          input.featured === true || input.featured === "on" ? 1 : 0,
          hasPreorder ? preorderFlag : 0,
        );
        run(
          "INSERT INTO variants(id,product_id,label,price,active,sort_order,warranty_days) VALUES(?,?,?,?,1,0,?)",
          id + "-30",
          id,
          firstLabel,
          price,
          firstWarranty,
        );
        if (usageInstructions)
          run("UPDATE products SET usage_instructions=? WHERE id=?", usageInstructions, id);
      }
      audit(user, "SAVE_PRODUCT", id);
      const saved = one("SELECT preorder FROM products WHERE id=?", id);
      return { id, preorder: !!saved?.preorder };
    });
  }
  function profile(user, rawInput) {
    requireUser(user);
    const input = withoutClientPrivileges(rawInput);
    const name = clean(input.name, 2, 60, "ชื่อ");
    if (input.newPassword) {
      if (
        !passwordMatches(
          clean(input.currentPassword, 1, 128, "รหัสผ่านเดิม"),
          user.password_hash,
        )
      )
        fail(400, "รหัสผ่านเดิมไม่ถูกต้อง");
      run(
        "UPDATE users SET password_hash=? WHERE id=?",
        passwordHash(clean(input.newPassword, 10, 128, "รหัสผ่านใหม่")),
        user.id,
      );
      run("DELETE FROM sessions WHERE user_id=?", user.id);
    }
    run("UPDATE users SET name=? WHERE id=?", name, user.id);
    audit(user, "UPDATE_PROFILE", user.id);
    return publicUser(one("SELECT * FROM users WHERE id=?", user.id));
  }
  function reviews() {
    return all(
      "SELECT r.id,r.rating,r.comment,r.created_at,u.name,p.name AS product FROM reviews r JOIN users u ON u.id=r.user_id JOIN orders o ON o.id=r.order_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id ORDER BY r.created_at DESC,r.rowid DESC",
    ).map((r) => ({
      ...r,
      name: r.name.slice(0, 2) + "***" + r.name.slice(-1),
    }));
  }
  function addReview(user, input) {
    requireUser(user);
    const orderId = clean(input.orderId, 1, 80, "คำสั่งซื้อ");
    const rating = integer(input.rating, 1, 5, "คะแนน");
    const comment = clean(input.comment, 2, 600, "ความคิดเห็น");
    return tx(() => {
      const order = one(
        "SELECT status,created_at FROM orders WHERE id=? AND user_id=?",
        orderId,
        user.id,
      );
      if (!order || order.status !== "DELIVERED")
        fail(403, "รีวิวได้เฉพาะคำสั่งซื้อของคุณที่จัดส่งสำเร็จแล้ว");
      if (Date.now() - Date.parse(order.created_at + "Z") > 7 * 86400000)
        fail(403, "รีวิวได้ภายใน 7 วันหลังซื้อเท่านั้น");
      if (one("SELECT id FROM reviews WHERE order_id=?", orderId))
        fail(409, "คุณรีวิวคำสั่งซื้อนี้แล้ว");
      run(
        "INSERT INTO reviews(id,order_id,user_id,rating,comment) VALUES(?,?,?,?,?)",
        randomUUID(),
        orderId,
        user.id,
        rating,
        comment,
      );
      audit(user, "ADD_REVIEW", orderId);
      return { ok: true };
    });
  }
  function queueBoard(user) {
    requireStaff(user);
    return all(
      `SELECT r.id,r.queue_number,r.status,r.total,r.quantity,r.created_at,
              u.id AS customer_id,u.name AS customer,p.name AS product,v.label
       FROM reservations r
       JOIN users u ON u.id=r.user_id
       JOIN variants v ON v.id=r.variant_id
       JOIN products p ON p.id=v.product_id
       WHERE r.queue_number IS NOT NULL AND r.status='PREORDER'
       ORDER BY r.queue_number ASC`,
    );
  }
  function myQueue(user) {
    requireUser(user);
    return all(
      `SELECT id,queue_number,status,total,quantity,created_at
       FROM reservations
       WHERE user_id=? AND queue_number IS NOT NULL
       ORDER BY queue_number ASC`,
      user.id,
    ).map((row) => ({
      ...row,
      queueNumber: row.queue_number,
    }));
  }
  function chatThreads(user) {
    requireUser(user);
    if (isStaff(user))
      return all(
        `SELECT t.*,u.name AS customer,u.email AS customer_email,a.name AS assignee,
                (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id) AS messages,
                COALESCE(
                  (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.thread_id=t.id),
                  t.created_at
                ) AS lastMessageAt,
                (
                  SELECT COUNT(*) FROM chat_messages m
                  WHERE m.thread_id=t.id AND m.sender_type='USER'
                    AND m.created_at > COALESCE(
                      (SELECT r.last_read_at FROM chat_thread_reads r
                       WHERE r.thread_id=t.id AND r.user_id=?),
                      '1970-01-01 00:00:00'
                    )
                ) AS unreadCount
         FROM chat_threads t JOIN users u ON u.id=t.user_id LEFT JOIN users a ON a.id=t.assigned_to
         ORDER BY lastMessageAt DESC, t.id DESC`,
        user.id,
      );
    return all(
      `SELECT t.*,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id) AS messages,
              COALESCE(
                (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.thread_id=t.id),
                t.created_at
              ) AS lastMessageAt,
              0 AS unreadCount
       FROM chat_threads t WHERE t.user_id=? ORDER BY lastMessageAt DESC, t.id DESC`,
      user.id,
    );
  }
  function openChatThread(user, rawInput) {
    requireUser(user);
    const input = withoutClientPrivileges(rawInput);
    const body = clean(input.body ?? "สวัสดี ต้องการความช่วยเหลือ", 1, 1000, "ข้อความ");
    assertChatRateLimit(user.id);
    return tx(() => {
      // "แจ้งปัญหาบัญชีนี้": checked inside the transaction so the daily limit holds.
      const report = orderExtras.chatReportLink(user, input);
      let thread = one(
        "SELECT * FROM chat_threads WHERE user_id=? AND status='OPEN' ORDER BY created_at DESC LIMIT 1",
        user.id,
      );
      if (!thread) {
        const id = randomUUID();
        run(
          "INSERT INTO chat_threads(id,user_id,status) VALUES(?,?,'OPEN')",
          id,
          user.id,
        );
        thread = one("SELECT * FROM chat_threads WHERE id=?", id);
      }
      const messageId = randomUUID();
      run(
        "INSERT INTO chat_messages(id,thread_id,sender_type,body) VALUES(?,?,?,?)",
        messageId,
        thread.id,
        "USER",
        body,
      );
      orderExtras.attachChatReport(thread.id, messageId, report);
      notify(
        user.id,
        "chat",
        "เปิดแชทแล้ว",
        "ทีมงานจะตอบกลับในเว็บนี้",
      );
      notifyStaffChatThrottled(
        thread.id,
        report ? "ลูกค้าแจ้งปัญหาบัญชี" : "ลูกค้าเปิดแชทใหม่",
        body.slice(0, 120),
      );
      audit(user, "OPEN_CHAT", thread.id);
      return { thread, messages: chatMessages(user, thread.id) };
    });
  }
  function chatMessages(user, threadId) {
    requireUser(user);
    const id = clean(threadId, 1, 80, "แชท");
    const thread = one("SELECT * FROM chat_threads WHERE id=?", id);
    if (!thread) fail(404, "ไม่พบแชท");
    if (thread.user_id !== user.id && !isStaff(user))
      fail(403, "ไม่มีสิทธิ์ดูแชทนี้");
    if (isStaff(user) && thread.user_id !== user.id) {
      const latest = one(
        "SELECT COALESCE(MAX(created_at), CURRENT_TIMESTAMP) AS t FROM chat_messages WHERE thread_id=?",
        id,
      ).t;
      run(
        `INSERT INTO chat_thread_reads(user_id,thread_id,last_read_at)
         VALUES(?,?,?)
         ON CONFLICT(user_id,thread_id) DO UPDATE SET last_read_at=excluded.last_read_at`,
        user.id,
        id,
        latest,
      );
    }
    return all(
      "SELECT id,thread_id,sender_type,body,created_at,order_id,report_reason FROM chat_messages WHERE thread_id=? ORDER BY created_at ASC,rowid ASC",
      id,
    );
  }
  function postChatMessage(user, threadId, rawInput) {
    requireUser(user);
    const input = withoutClientPrivileges(rawInput);
    const id = clean(threadId, 1, 80, "แชท");
    const body = clean(input.body, 1, 1000, "ข้อความ");
    const thread = one("SELECT * FROM chat_threads WHERE id=?", id);
    if (!thread) fail(404, "ไม่พบแชท");
    if (thread.status !== "OPEN") fail(409, "แชทนี้ปิดแล้ว");
    const staffReply = isStaff(user) && thread.user_id !== user.id;
    if (thread.user_id !== user.id && !staffReply)
      fail(403, "ไม่มีสิทธิ์ส่งข้อความในแชทนี้");
    assertChatRateLimit(user.id);
    return tx(() => {
      const live = one("SELECT * FROM chat_threads WHERE id=?", id);
      if (!live || live.status !== "OPEN") fail(409, "แชทนี้ปิดแล้ว");
      const senderType = staffReply
        ? user.role === ROLES.ADMIN
          ? "ADMIN"
          : "STAFF"
        : "USER";
      const report = staffReply ? null : orderExtras.chatReportLink(user, input);
      const messageId = randomUUID();
      run(
        "INSERT INTO chat_messages(id,thread_id,sender_type,body) VALUES(?,?,?,?)",
        messageId,
        id,
        senderType,
        body,
      );
      orderExtras.attachChatReport(id, messageId, report);
      if (staffReply)
        notify(
          live.user_id,
          "chat",
          "มีข้อความใหม่จากทีมงาน",
          body.slice(0, 120),
        );
      else if (!isStaff(user))
        notifyStaffChatThrottled(
          id,
          report ? "ลูกค้าแจ้งปัญหาบัญชี" : "ลูกค้าส่งข้อความใหม่",
          body.slice(0, 120),
        );
      audit(user, "CHAT_MESSAGE", id);
      return chatMessages(user, id);
    });
  }
  function closeChatThread(user, threadId) {
    requireUser(user);
    const id = clean(threadId, 1, 80, "แชท");
    return tx(() => {
      const thread = one("SELECT * FROM chat_threads WHERE id=?", id);
      if (!thread) fail(404, "ไม่พบแชท");
      if (thread.user_id !== user.id && !isStaff(user))
        fail(403, "ไม่มีสิทธิ์ปิดแชทนี้");
      if (thread.status === "CLOSED")
        return one("SELECT * FROM chat_threads WHERE id=?", id);
      run("UPDATE chat_threads SET status='CLOSED' WHERE id=?", id);
      audit(user, "CLOSE_CHAT", id);
      return one("SELECT * FROM chat_threads WHERE id=?", id);
    });
  }
  function notifications(user) {
    requireUser(user);
    return all(
      "SELECT id,kind,title,body,link,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100",
      user.id,
    );
  }
  function markNotificationRead(user, notificationId) {
    requireUser(user);
    const id = clean(notificationId, 1, 80, "การแจ้งเตือน");
    const row = one(
      "SELECT id FROM notifications WHERE id=? AND user_id=?",
      id,
      user.id,
    );
    if (!row) fail(404, "ไม่พบการแจ้งเตือน");
    run(
      "UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND read_at IS NULL",
      id,
      user.id,
    );
    return { ok: true };
  }
  const RANKING_PERIODS = ["day", "week", "month", "all"];
  // Shop time is Asia/Bangkok (UTC+7, no DST); stored timestamps are UTC "YYYY-MM-DD HH:MM:SS".
  function rankingSince(period, now = new Date()) {
    if (period === "all") return null;
    const offset = 7 * 3600000;
    const local = new Date(now.getTime() + offset);
    let start = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      period === "month" ? 1 : local.getUTCDate(),
    );
    if (period === "week") start -= ((local.getUTCDay() + 6) % 7) * 86400000;
    return new Date(start - offset).toISOString().slice(0, 19).replace("T", " ");
  }
  const {
    adminOrderPaymentSummary,
    refundOrder: refundOrderCore,
    adjustCustomerCredit,
    paymentSummaryFor,
    orderRefundState,
  } = createAdminMoneyApis({
    requireAdmin,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    integer,
    insertLedgerEntry,
    notify,
    allowSandbox,
  });
  function refundOrder(user, id, input = {}) {
    const result = refundOrderCore(user, id, input);
    if (!result?.replayed)
      alerts.emit("refund", {
        orderId: id,
        amount: input.amount,
        destination: input.destination,
        by: user.name,
      });
    return result;
  }
  const orderHistory = createOrderHistoryApis({
    requireStaff,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    decrypt,
    randomUUID,
  });
  const { adminAddOrderNote } = orderHistory;
  const listApis = createAdminListApis({
    requireStaff,
    one,
    all,
    tx,
    fail,
    clean,
    audit,
    run,
    notify,
    readDeliveredItems,
    inventoryAvailableAliased,
    getLowStockAt,
    bangkokDayRange,
    isAdmin,
    paymentSummaryFor,
    history: orderHistory,
  });
  const { adminOrders, adminRevealOrderCredentials, adminCustomers } = listApis;
  // NFR-3: team members handle orders but never see money movement (payment rows,
  // provider refs, refunds, fees). Admins get the full record.
  function adminOrderDetail(user, id) {
    const detail = listApis.adminOrderDetail(user, id);
    if (isAdmin(user)) return detail;
    const safe = { ...detail, payments: [] };
    for (const key of Object.keys(safe))
      if (/^(payment|refund|fee|outstanding)/i.test(key) && key !== "payments") delete safe[key];
    safe.timeline = (detail.timeline ?? []).filter((e) => !/refund|fee/i.test(String(e.event)));
    return safe;
  }
  function adminProducts(user, query) {
    const page = listApis.adminProducts(user, query);
    return {
      ...page,
      products: page.products.map((p) => ({
        ...p,
        ...productImageFields(p.id),
      })),
    };
  }
  const { adminTransactions, adminTransactionDetail } = createAdminFinanceApis({
    requireAdmin,
    one,
    all,
    fail,
    clean,
    bangkokDayRange,
    moneyScope,
    outstandingCredit,
  });
  const {
    adminCustomerDetail: adminCustomerDetailRaw,
    adminUpdateCustomer,
    adminSetCustomerStatus,
    adminSignOutCustomer,
    adminResetCustomerPassword,
    adminAuditLog,
    adminCancelOrder,
    cancelUnpaidOrder,
  } = createAdminCustomerApis({
    passwordHash,
    requireStaff,
    requireAdmin,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    moneyScope,
    releaseCouponForOrder,
  });
  function assignChatThread(user, threadId, input = {}) {
    const thread = assignChatThreadCore(user, threadId, input);
    if (thread?.assigned_to)
      alerts.emit("chat_assigned", { threadId: thread.id, assignee: thread.assignee, by: user.name });
    return thread;
  }
  // Attach avatarUrl without editing admin-customers.mjs (MUST_NOT).
  function adminCustomerDetail(user, id) {
    const detail = adminCustomerDetailRaw(user, id);
    const key = one(
      "SELECT avatar_key FROM users WHERE id=?",
      detail.customer.id,
    )?.avatar_key;
    return {
      ...detail,
      customer: {
        ...detail.customer,
        avatarUrl: key ? "/api/files/" + key : null,
      },
    };
  }
  const {
    team: teamRaw,
    saveStaff,
    setMemberRole,
    setStaffActive,
    assignChatThread: assignChatThreadCore,
  } = createTeamApis({
    passwordHash,
    requireAdmin,
    requireStaff,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    notify,
    confirmPassword: auth.confirmPassword,
  });
  // Attach avatarUrl without editing admin-team.mjs (MUST_NOT). Team lists stay small.
  function team(user) {
    const members = teamRaw(user);
    if (!members.length) return members;
    const keys = all(
      `SELECT id, avatar_key FROM users WHERE id IN (${members.map(() => "?").join(",")})`,
      ...members.map((m) => m.id),
    );
    const byId = new Map(keys.map((r) => [r.id, r.avatar_key]));
    return members.map((m) => ({
      ...m,
      avatarUrl: byId.get(m.id) ? "/api/files/" + byId.get(m.id) : null,
    }));
  }
  const {
    adminProductVariants,
    createVariant,
    updateVariant,
    deleteVariant,
    adminVariantInventory,
    markInventoryDefect,
    deleteInventoryUnit,
  } = createAdminVariantStockApis({
    requireStaff,
    requireAdmin,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    audit,
    integer,
    inventoryAvailableSql,
    inventoryAvailableAliased,
    decrypt,
    getLowStockAt,
    randomUUID,
  });
  const { bulkUpdateProducts, duplicateProduct } = createAdminProductBulkApis({
    requireAdmin,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    randomUUID,
    categoryExists: categoryApis.exists,
  });
  const { salesReport } = createReportApis({
    requireAdmin,
    all,
    one,
    fail,
    bangkokDayRange,
    moneyScope,
  });
  const { replaceOrderCredential } = createAdminOrderReplaceApis({
    requireAdmin,
    one,
    all,
    run,
    tx,
    fail,
    clean,
    audit,
    inventoryAvailableSql,
    notify,
    maybeNotifyStockLow,
    recordReplacement: orderHistory.recordReplacement,
  });
  const { resendOrderCredentials } = createAdminOrderResendApis({
    requireStaff,
    one,
    run,
    tx,
    fail,
    clean,
    notify,
    randomUUID,
  });
  /** S2: in live mode an order paid with sandbox money is not real spend. */
  const liveOnlySql = (idCol, payCol) =>
    moneyScope.live
      ? ` AND NOT EXISTS (SELECT 1 FROM payments sp WHERE sp.${payCol}=${idCol} AND sp.provider='sandbox')`
      : "";
  function buyerRanking(user, query = {}) {
    requireAdmin(user);
    const rawLimit = query.limit ?? null;
    const n = rawLimit === null || rawLimit === "" ? 10 : Number(rawLimit);
    integer(n, 1, 50, "จำนวนอันดับ");
    const period = query.period ?? "all";
    if (!RANKING_PERIODS.includes(period)) fail(400, "ช่วงเวลาไม่ถูกต้อง");
    const since = rankingSince(period);
    // Paid spend: delivered orders plus paid preorders (PREORDER after pay, DELIVERED once fulfilled).
    return all(
      `SELECT u.name,u.email,COUNT(*) AS orders,SUM(x.total) AS spent_satang
       FROM (
         SELECT user_id,total,created_at FROM orders o WHERE status='DELIVERED'${liveOnlySql("o.id", "order_id")}
         UNION ALL
         SELECT user_id,total,created_at FROM reservations o WHERE status IN ('PREORDER','DELIVERED')${liveOnlySql("o.id", "reservation_id")}
       ) x
       JOIN users u ON u.id=x.user_id
       WHERE u.role='CUSTOMER' AND (? IS NULL OR x.created_at >= ?)
       GROUP BY u.id
       ORDER BY spent_satang DESC, orders DESC, u.created_at ASC
       LIMIT ?`,
      since,
      since,
      n,
    ).map((row, index) => ({
      rank: index + 1,
      name: row.name,
      email: row.email,
      orders: row.orders,
      spentSatang: row.spent_satang,
    }));
  }
  const accountEmail = createAccountEmail({
    one,
    all,
    run,
    fail,
    key,
    clock,
    passwordHash,
    settings,
    requireAdmin,
    clearLockout: auth.clearLockout,
    mailer,
    turnstile,
    publicBaseUrl,
    waitUntil,
  });
  const broadcasts = createBroadcastApis({
    one,
    all,
    run,
    tx,
    fail,
    clock,
    requireAdmin,
    confirmPassword: auth.confirmPassword,
    emailQueue: accountEmail.queue,
    emailEnabled: accountEmail.enabled,
    shopName: () => {
      const name = String(settings().shopName ?? "").trim();
      return name && name !== "ร้านค้า" ? name : "ASIA EXTRA";
    },
    publicBaseUrl,
  });
  const service = {
    db,
    reviews,
    settings,
    saveSettings,
    legal,
    faq,
    broadcastStatus: broadcasts.broadcastStatus,
    broadcastPreview: broadcasts.broadcastPreview,
    sendBroadcast: broadcasts.sendBroadcast,
    addReview,
    register,
    login,
    demo,
    demoMerchant,
    session,
    products,
    productDetail,
    overview,
    createOrder,
    checkCoupon,
    adminCoupons: coupons.adminCoupons,
    adminCoupon: coupons.adminCoupon,
    adminCreateCoupon: coupons.adminCreateCoupon,
    adminUpdateCoupon: coupons.adminUpdateCoupon,
    adminDisableCoupon: coupons.adminDisableCoupon,
    adminDuplicateCoupon: coupons.adminDuplicateCoupon,
    adminCouponRedemptions: coupons.adminCouponRedemptions,
    // Categories (server/categories.mjs).
    publicCategories: categoryApis.publicCategories,
    adminCategories: categoryApis.adminCategories,
    adminCreateCategory: categoryApis.adminCreateCategory,
    adminUpdateCategory: categoryApis.adminUpdateCategory,
    adminReorderCategories: categoryApis.adminReorderCategories,
    adminDeleteCategory: categoryApis.adminDeleteCategory,
    // For code that ends an unpaid order (e.g. auto-expiry); see server/coupons.mjs.
    releaseCouponForOrder,
    orderDetail,
    staffOrders,
    adminOrders,
    adminOrderDetail,
    adminRevealOrderCredentials,
    adminCustomers,
    adminProducts,
    adminTransactions,
    adminTransactionDetail,
    adminOrderPaymentSummary,
    refundOrder,
    adjustCustomerCredit,
    adminCustomerDetail,
    adminUpdateCustomer,
    adminSetCustomerStatus,
    adminSignOutCustomer,
    adminResetCustomerPassword,
    adminAuditLog,
    adminCancelOrder,
    adminAddOrderNote,
    replaceOrderCredential,
    resendOrderCredentials,
    loginTotp: (rawInput, ctx) => auth.loginTotp(rawInput, ctx),
    confirmPassword: auth.confirmPassword,
    reauthAdmin: auth.reauthAdmin,
    totpStatus: auth.totpStatus,
    totpSetup: auth.totpSetup,
    totpEnable: auth.totpEnable,
    totpDisable: auth.totpDisable,
    team,
    saveStaff,
    setMemberRole,
    setStaffActive,
    assignChatThread,
    salesReport,
    adminProductVariants,
    createVariant,
    updateVariant,
    deleteVariant,
    adminVariantInventory,
    markInventoryDefect,
    deleteInventoryUnit,
    getPaymentChannel,
    setPaymentChannel,
    pay,
    retry,
    topup,
    adminOverview,
    adminSummary,
    importCodes,
    previewImportCodes,
    bulkUpdateProducts,
    duplicateProduct,
    deliverReservation,
    saveProduct,
    addProductImage,
    reorderProductImages,
    deleteProductImage,
    getFile,
    setAvatar,
    removeAvatar,
    setLogo,
    removeLogo,
    profile,
    publicUser,
    queueBoard,
    myQueue,
    orderReceipt: orderExtras.orderReceipt,
    adminOrderReceipt: orderExtras.adminOrderReceipt,
    chatThreads,
    openChatThread,
    chatMessages,
    postChatMessage,
    closeChatThread,
    notifications,
    markNotificationRead,
    buyerRanking,
    listSessions: accountSessions.listSessions,
    revokeSession: accountSessions.revokeSession,
    revokeOtherSessions: accountSessions.revokeOtherSessions,
    // Outside-the-website alerts + backup (alerts.mjs, backup.mjs).
    alertSettings: alerts.alertSettings,
    saveAlertSettings: alerts.saveAlertSettings,
    testAlert: alerts.testAlert,
    alertsTick: (now) => alerts.tick(now),
    alertsIdle: alerts.idle,
    backupStatus: backupApis.backupStatus,
    exportBackup: backupApis.exportBackup,
    runBackupNow: backupApis.runBackupNow,
    /** Next Durable Object alarm time (ms) or null when nothing is scheduled. */
    nextScheduledRun: (now = clock()) => {
      const times = [];
      if (alerts.wantsSchedule()) times.push(nextBangkokHour(now, DAILY_SUMMARY_HOUR));
      if (backupApis.hasBackups) times.push(nextBangkokHour(now, BACKUP_HOUR_BANGKOK));
      return times.length ? Math.min(...times) : null;
    },
    /** Durable Object alarm: daily summary (21:00) and R2 backup (from 04:00), both once a day. */
    runScheduledJobs: async (now = clock()) => {
      const summary = alerts.tick(now, { force: true });
      const backup = backupApis.backupDue(now) ? await backupApis.runBackup(now) : null;
      if (summary) await summary;
      return { backup };
    },
    mode: allowSandbox ? "sandbox" : "live",
    features: Object.freeze({
      credentialPair: true,
      preorderDelivery: true,
      adminChatInbox: true,
      adminOpsNotifications: true,
      salesRevenueFromPayments: true,
      adminOrdersApi: true,
      adminCustomersApi: true,
      adminProductsApi: true,
      adminSummaryApi: true,
      productPreorderForm: true,
      adminFinance: true,
      adminCustomerManage: true,
      liveUpdates: true,
      teamAccounts: true,
      chatAssignment: true,
      adminVariantCrud: true,
      adminStockApi: true,
      adminReplaceCredential: true,
      resendCredentials: true,
      notificationLinks: true,
      uploads: true,
      livemodeFinance: true,
      adminRefunds: true,
      creditAdjust: true,
      pendingExpiry: true,
      accountSessions: true,
      outsideAlerts: true,
      backupExport: true,
      coupons: true,
      faq: true,
      broadcasts: true,
      categories: true,
      // Off until the provider / keys are configured (see server/email.mjs, turnstile.mjs).
      email: accountEmail.enabled,
      passwordReset: accountEmail.enabled,
      turnstile: !!turnstile?.enabled,
    }),
    turnstile: turnstile?.enabled ? turnstile : null,
    requestPasswordReset: accountEmail.requestPasswordReset,
    resetPassword: accountEmail.resetPassword,
    sendOrderConfirmation: accountEmail.sendOrderConfirmation,
    adminIntegrations: accountEmail.integrationsStatus,
    emailIdle: accountEmail.idle,
    salesRevenueSatang,
    logout: (token) =>
      run("DELETE FROM sessions WHERE token_hash=?", hash(token ?? "")),
    orders: (user) => {
      requireUser(user);
      return all(
        "SELECT id FROM orders WHERE user_id=? ORDER BY created_at DESC,rowid DESC",
        user.id,
      )
        .concat(
          all(
            "SELECT id FROM reservations WHERE user_id=? ORDER BY created_at DESC,rowid DESC",
            user.id,
          ),
        )
        .map((o) => orderDetail(user, o.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    ledger: (user) => {
      requireUser(user);
      // Wallet rows only (money.mjs); `amount` is signed, with the balance after each row.
      return walletHistory(all, user.id, 500);
    },
  };
  // Order emails run after pay / deliverReservation returned; money logic is untouched.
  accountEmail.hookOrderEmails(service);
  const live = withLive(service, { run, all });
  // Unpaid-order expiry runs lazily on these calls (pending-expiry.mjs). The bump goes
  // through live.mjs so listeners hear "orders changed" only when something expired.
  const expiry = createPendingExpiry({
    one,
    all,
    run,
    tx,
    clock,
    settings,
    cancelUnpaidOrder,
    bump: (topics) => live.bumpLive(topics),
  });
  for (const name of [
    "orders",
    "orderDetail",
    "staffOrders",
    "adminOrders",
    "adminOrderDetail",
    "adminOverview",
    "createOrder",
    "pay",
    "retry",
    // Audience "unpaid order" must not count orders whose payment window already ran out.
    "broadcastPreview",
    "sendBroadcast",
  ]) {
    const call = live[name];
    live[name] = (user, ...args) => {
      if (user) {
        expiry.maybeSweep();
        if (name === "pay" || name === "retry") expiry.expireIfStale(user, args[0]);
      }
      return call(user, ...args);
    };
  }
  live.sweepPendingOrders = expiry.sweep;
  // Alerts wrap outermost: queued alerts go out only after the whole call succeeded.
  const publicService = alerts.wrap(live);
  return publicService;
}
