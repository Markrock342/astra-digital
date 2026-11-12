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
import { catalog, categories } from "./catalog.mjs";
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
import { createAdminVariantStockApis } from "./admin-variant-stock-apis.mjs";
import { createAdminOrderReplaceApis } from "./admin-order-replace.mjs";
import { createOrderHistoryApis } from "./admin-order-history.mjs";
import { createAdminProductImageApis } from "./admin-product-images.mjs";
import { createFileStore } from "./file-store.mjs";
import { createAuthHardening } from "./auth-hardening.mjs";
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
  const insertInventoryCredential = (
    variantId,
    loginId,
    password,
    { legacy = 0 } = {},
  ) => {
    run(
      `INSERT INTO inventory(
        id, variant_id, fingerprint, login_id_enc, password_enc, legacy_single_secret
      ) VALUES(?,?,?,?,?,?)`,
      randomUUID(),
      variantId,
      inventoryFingerprint(loginId, password),
      encrypt(loginId),
      encrypt(password),
      legacy ? 1 : 0,
    );
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
          balance: one(
            "SELECT COALESCE(SUM(amount),0) AS value FROM ledger WHERE user_id=? AND kind='DEMO_CREDIT'",
            user.id,
          ).value,
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
  const notify = (userId, kind, title, body) => {
    run(
      "INSERT INTO notifications(id,user_id,kind,title,body,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)",
      randomUUID(),
      userId,
      kind,
      title,
      body,
    );
  };
  const notifyStaffRoles = (kind, title, body) => {
    for (const staff of all(
      "SELECT id FROM users WHERE role IN ('STAFF','ADMIN')",
    ))
      notify(staff.id, kind, title, body);
  };
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
  const salesRevenueSatang = (range = null) => {
    const bounds = range
      ? " AND COALESCE(finalized_at, created_at) >= ? AND COALESCE(finalized_at, created_at) <= ?"
      : "";
    const refundBounds = range
      ? " AND created_at >= ? AND created_at <= ?"
      : "";
    const params = range ? [range.fromUtc, range.toUtc] : [];
    const succeeded = one(
      "SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE status='SUCCEEDED'" +
        bounds,
      ...params,
    ).n;
    // Refunds land in Work 3 / FR-F6; until then nothing to subtract.
    const refunded = one(
      "SELECT COALESCE(SUM(ABS(amount)),0) AS n FROM ledger WHERE kind='REFUND'" +
        refundBounds,
      ...params,
    ).n;
    return succeeded - refunded;
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
  const notifyStaffChatThrottled = (threadId, title, body) => {
    const now = Date.now();
    const last = staffChatCooldown.get(threadId) ?? 0;
    if (now - last < 60000) return;
    staffChatCooldown.set(threadId, now);
    for (const staff of all(
      "SELECT id FROM users WHERE role IN ('STAFF','ADMIN')",
    ))
      notify(staff.id, "chat", title, body);
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
  const issueSession = (user) => {
    const token = randomBytes(32).toString("hex");
    const now = clock();
    // ADMIN/STAFF: 12h absolute + 2h idle; customers keep 7 days (auth-hardening.mjs).
    const lifetime = auth.sessionLifetime(user);
    run("DELETE FROM sessions WHERE expires_at<?", now);
    run(
      "INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen) VALUES(?,?,?,?,?)",
      hash(token),
      user.id,
      now + lifetime,
      now,
      now,
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
    issueSession: (user) => issueSession(user),
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
      run(
        "INSERT INTO runtime_flags(key,value) VALUES('template-ready','1')",
      );
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
  function register(rawInput) {
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
    return issueSession(one("SELECT * FROM users WHERE id=?", id));
  }
  // Lockout, failed-login audit and the TOTP second step live in auth-hardening.mjs.
  const login = (rawInput, ctx) => auth.login(rawInput, ctx);
  function demo() {
    if (!allowSandbox) fail(403, "ร้านนี้ไม่เปิดบัญชีทดลอง");
    const suffix = randomBytes(8).toString("hex");
    const visitor = register({
      name: "ผู้เยี่ยมชม " + suffix.slice(0, 4),
      email: suffix + "@demo.astra.local",
      password: randomBytes(24).toString("hex"),
    });
    run("UPDATE users SET is_demo=1 WHERE id=?", visitor.user.id);
    return visitor;
  }
  function demoMerchant() {
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
    );
  }
  function session(token) {
    if (!token) return null;
    return auth.sessionUser(hash(token));
  }
  const PUBLIC_STOCK_CAP = 10;
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
  function mapProduct(p) {
    const lowAt = getLowStockAt();
    return {
      ...p,
      ...productImageFields(p.id),
      variants: all(
        `SELECT v.*, CASE WHEN p.preorder=1 THEN 0 ELSE (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND ${inventoryAvailableAliased}) END AS stock FROM variants v JOIN products p ON p.id=v.product_id WHERE v.product_id=? AND COALESCE(v.active,1)=1 ORDER BY v.sort_order ASC, CASE WHEN v.id='stream-plus-full' THEN 0 WHEN v.id LIKE '%-30' THEN 1 ELSE 2 END, price, v.id`,
        p.id,
      ).map((v) => ({
        ...v,
        price: p.preorder && v.id === "cinema-max-30" ? 0 : v.price,
        // Public stock is capped at the per-order maximum so exact inventory stays private.
        stock: Math.min(v.stock, PUBLIC_STOCK_CAP),
        stockStatus:
          v.stock <= 0 ? "out" : v.stock <= lowAt ? "low" : "in",
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
    return {
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
      ...(raw ? JSON.parse(raw.value) : {}),
    };
  }
  function saveSettings(user, input) {
    requireAdmin(user);
    const current = settings();
    const before = { ...current };
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
    run(
      "INSERT INTO runtime_flags(key,value) VALUES('shop-settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(current),
    );
    // S10: keep what changed (short values only) so the audit log answers "who changed what".
    const changed = {};
    for (const [field, value] of Object.entries(current)) {
      if (JSON.stringify(before[field]) === JSON.stringify(value)) continue;
      const short = (v) => (typeof v === "string" && v.length > 80 ? v.slice(0, 80) + "…" : v);
      changed[field] = { from: short(before[field] ?? null), to: short(value) };
    }
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user.id,
      "SAVE_SETTINGS",
      user.id,
      Object.keys(changed).length ? JSON.stringify({ changed }) : null,
    );
    return { shop: current };
  }
  function overview() {
    return {
      shop: settings(),
      customers: one("SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'").n,
      products: one(
        `SELECT COUNT(*) AS n FROM inventory i JOIN variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id WHERE p.active=1 AND p.hidden_seed=0 AND p.preorder=0 AND ${inventoryAvailableAliased}`,
      ).n,
      orders: one("SELECT COUNT(*) AS n FROM orders WHERE status='DELIVERED'")
        .n,
      categories,
      activity: all(
        "SELECT 'purchase' AS kind,u.name,p.name AS product,p.art,v.label,o.created_at AS time FROM orders o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id WHERE o.status='DELIVERED' UNION ALL SELECT 'register' AS kind,u.name,NULL AS product,NULL AS art,NULL AS label,u.created_at AS time FROM users u WHERE role='CUSTOMER' ORDER BY time DESC LIMIT 4",
      ).map((a) => ({
        ...a,
        name: a.name.slice(0, 2) + "***" + a.name.slice(-1),
      })),
    };
  }
  function createOrder(user, input) {
    requireUser(user);
    if (!settings().shopOpen) fail(409, "ร้านปิดให้บริการชั่วคราว");
    const variantId = clean(input.variantId, 1, 80, "สินค้า");
    const quantity = integer(input.quantity, 1, 10, "จำนวน");
    const requestKey = clean(input.requestKey, 8, 128, "รหัสคำขอ");
    const reservation = one(
      "SELECT * FROM reservations WHERE user_id=? AND request_key=?",
      user.id,
      requestKey,
    );
    if (reservation) {
      if (
        reservation.variant_id !== variantId ||
        reservation.quantity !== quantity
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
      if (prior.variant_id !== variantId || prior.quantity !== quantity)
        fail(409, "รหัสคำขอถูกใช้กับคำสั่งซื้ออื่นแล้ว");
      return { ...orderDetail(user, prior.id), paymentToken: null };
    }
    const variant = one(
      "SELECT v.*,p.preorder FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1 AND p.hidden_seed=0 AND COALESCE(v.active,1)=1",
      variantId,
    );
    if (!variant) fail(404, "ไม่พบสินค้า");
    if (variant.preorder) {
      const token = randomBytes(32).toString("hex"),
        id = randomUUID();
      const price = variant.id === "cinema-max-30" ? 0 : variant.price;
      run(
        "INSERT INTO reservations(id,user_id,variant_id,quantity,total,request_key,payment_hash) VALUES(?,?,?,?,?,?,?)",
        id,
        user.id,
        variantId,
        quantity,
        price * quantity,
        requestKey,
        hash(token),
      );
      audit(user, "CREATE_PREORDER", id);
      return { ...orderDetail(user, id), paymentToken: token };
    }

    if (
      one(
        `SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND ${inventoryAvailableSql}`,
        variantId,
      ).n < quantity
    )
      fail(409, "สินค้าคงเหลือไม่เพียงพอ กรุณาเลือกจำนวนใหม่");
    const token = randomBytes(32).toString("hex"),
      id = randomUUID();
    run(
      "INSERT INTO orders(id,user_id,variant_id,quantity,total,request_key,payment_hash) VALUES(?,?,?,?,?,?,?)",
      id,
      user.id,
      variantId,
      quantity,
      variant.price * quantity,
      requestKey,
      hash(token),
    );
    audit(user, "CREATE_ORDER", id);
    return { ...orderDetail(user, id), paymentToken: token };
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
        );
        notifyStaffRoles(
          "preorder_queue_admin",
          "คิวพรีออเดอร์ใหม่",
          "คิว #" + queueNumber + " · " + id.slice(0, 8),
        );
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
      run("UPDATE orders SET status='DELIVERED' WHERE id=?", id);
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
      );
      notifyStaffRoles(
        "order_new",
        "ออเดอร์ใหม่",
        "คำสั่งซื้อ " + id.slice(0, 8) + " ชำระแล้วและส่งของแล้ว",
      );
      maybeNotifyStockLow(order.variant_id);
      audit(user, "PAYMENT_AND_DELIVERY", id);
      return orderDetail(user, id);
    });
  }
  function retry(user, id) {
    requireUser(user);
    const reservation = one(
      "SELECT status FROM reservations WHERE id=? AND user_id=?",
      id,
      user.id,
    );
    if (reservation) {
      if (reservation.status !== "PENDING_PAYMENT")
        fail(409, "คำสั่งซื้อไม่อยู่ระหว่างรอชำระเงิน");
      const token = randomBytes(32).toString("hex");
      run("UPDATE reservations SET payment_hash=? WHERE id=?", hash(token), id);
      return { ...orderDetail(user, id), paymentToken: token };
    }
    const order = one(
      "SELECT status FROM orders WHERE id=? AND user_id=?",
      id,
      user.id,
    );
    if (!order) fail(404, "ไม่พบคำสั่งซื้อ");
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
    const newCustomers = one(
      `SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'${timeFilter}`,
      ...params,
    ).n;
    return {
      from: range?.from ?? null,
      to: range?.to ?? null,
      timezone: "Asia/Bangkok",
      revenue: salesRevenueSatang(range),
      orderCount,
      newCustomers,
    };
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
  function importCodes(user, input) {
    requireAdmin(user);
    const variantId = clean(input.variantId, 1, 80, "ตัวเลือกสินค้า");
    if (!one("SELECT id FROM variants WHERE id=?", variantId))
      fail(404, "ไม่พบตัวเลือกสินค้า");
    const hasCodes = input.codes !== undefined && input.codes !== null;
    const hasItems = input.items !== undefined && input.items !== null;
    if (hasCodes && hasItems)
      fail(400, "ส่งได้แค่ codes หรือ items อย่างใดอย่างหนึ่ง");
    if (hasItems) {
      if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100)
        fail(400, "รายการคู่ต้องเป็น array 1–100 รายการ");
      const pairs = [];
      for (const item of input.items) {
        if (!item || typeof item !== "object")
          fail(400, "รายการคู่ไม่ถูกต้อง");
        if (typeof item.loginId !== "string" || typeof item.password !== "string")
          fail(400, "loginId และ password ต้องเป็นข้อความ");
        const loginId = item.loginId.trim();
        const password = item.password;
        if (!loginId || loginId.length > 160)
          fail(400, "loginId ไม่ถูกต้อง");
        if (password.length > 500)
          fail(400, "password ยาวเกินกำหนด");
        pairs.push({ loginId, password });
      }
      if (new Set(pairs.map((p) => inventoryFingerprint(p.loginId, p.password))).size !== pairs.length)
        fail(409, "มีคู่ซ้ำในรายการ");
      return tx(() => {
        for (const { loginId, password } of pairs) {
          const fingerprint = inventoryFingerprint(loginId, password);
          if (one("SELECT id FROM inventory WHERE fingerprint=?", fingerprint))
            fail(409, "คู่นี้มีอยู่ในคลังแล้ว");
          insertInventoryCredential(variantId, loginId, password, { legacy: 0 });
        }
        audit(user, "IMPORT_CODES", variantId);
        return { imported: pairs.length };
      });
    }
    const text = clean(input.codes, 1, 20000, "รายการโค้ด");
    const codes = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      codes.length > 100 ||
      codes.some((c) => !/^[A-Za-z0-9][A-Za-z0-9._:@+/=-]{3,159}$/.test(c))
    )
      fail(
        400,
        "รหัสสินค้าใช้ตัวอักษร ตัวเลข และเครื่องหมายที่กำหนดได้ ไม่เกิน 100 รายการต่อครั้ง",
      );
    if (new Set(codes).size !== codes.length) fail(409, "มีโค้ดซ้ำในรายการ");
    return tx(() => {
      for (const code of codes) {
        const fingerprint = inventoryFingerprint(code, "");
        if (one("SELECT id FROM inventory WHERE fingerprint=?", fingerprint))
          fail(409, "โค้ดนี้มีอยู่ในคลังแล้ว");
        insertInventoryCredential(variantId, code, "", { legacy: 1 });
      }
      audit(user, "IMPORT_CODES", variantId);
      return { imported: codes.length };
    });
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
        "UPDATE reservations SET status='DELIVERED', delivered_at=?, delivered_by=? WHERE id=? AND status='PREORDER'",
        now,
        user.id,
        reservationId,
      );
      notify(
        reservation.user_id,
        "order",
        "พรีออเดอร์พร้อมใช้งานแล้ว",
        "รหัสสินค้าถูกจัดส่งแล้ว กดดูคำสั่งซื้อเพื่อรับรหัส",
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
    if (!categories.some((c) => c.id === input.category))
      fail(400, "หมวดหมู่ไม่ถูกต้อง");
    // Price belongs to the variants once a product exists (VariantManager); only a new
    // product takes it here, for its first variant. Updating never overwrites prices.
    const price = input.id ? null : integer(input.price, 100, 10000000, "ราคา");
    const hasPreorder = Object.prototype.hasOwnProperty.call(input, "preorder");
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
          "INSERT INTO variants(id,product_id,label,price,active,sort_order) VALUES(?,?,?,?,1,0)",
          id + "-30",
          id,
          "โค้ดดิจิทัล",
          price,
        );
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
      run(
        "INSERT INTO chat_messages(id,thread_id,sender_type,body) VALUES(?,?,?,?)",
        randomUUID(),
        thread.id,
        "USER",
        body,
      );
      notify(
        user.id,
        "chat",
        "เปิดแชทแล้ว",
        "ทีมงานจะตอบกลับในเว็บนี้",
      );
      notifyStaffChatThrottled(
        thread.id,
        "ลูกค้าเปิดแชทใหม่",
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
      "SELECT id,thread_id,sender_type,body,created_at FROM chat_messages WHERE thread_id=? ORDER BY created_at ASC,rowid ASC",
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
      run(
        "INSERT INTO chat_messages(id,thread_id,sender_type,body) VALUES(?,?,?,?)",
        randomUUID(),
        id,
        senderType,
        body,
      );
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
          "ลูกค้าส่งข้อความใหม่",
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
      "SELECT id,kind,title,body,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100",
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
  const { adminTransactions } = createAdminFinanceApis({
    requireAdmin,
    one,
    all,
    fail,
    clean,
    bangkokDayRange,
  });
  const {
    adminCustomerDetail,
    adminUpdateCustomer,
    adminSetCustomerStatus,
    adminSignOutCustomer,
    adminResetCustomerPassword,
    adminAuditLog,
    adminCancelOrder,
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
  });
  const { team, saveStaff, setMemberRole, setStaffActive, assignChatThread } = createTeamApis({
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
  const {
    adminProductVariants,
    createVariant,
    updateVariant,
    deleteVariant,
    adminVariantInventory,
    markInventoryDefect,
    deleteInventoryUnit,
    importInventory,
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
    importCodes,
    getLowStockAt,
    randomUUID,
  });
  const { salesReport } = createReportApis({ requireAdmin, all, one, fail, bangkokDayRange });
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
         SELECT user_id,total,created_at FROM orders WHERE status='DELIVERED'
         UNION ALL
         SELECT user_id,total,created_at FROM reservations WHERE status IN ('PREORDER','DELIVERED')
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
  const service = {
    db,
    reviews,
    settings,
    saveSettings,
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
    orderDetail,
    staffOrders,
    adminOrders,
    adminOrderDetail,
    adminRevealOrderCredentials,
    adminCustomers,
    adminProducts,
    adminTransactions,
    adminCustomerDetail,
    adminUpdateCustomer,
    adminSetCustomerStatus,
    adminSignOutCustomer,
    adminResetCustomerPassword,
    adminAuditLog,
    adminCancelOrder,
    adminAddOrderNote,
    replaceOrderCredential,
    loginTotp: auth.loginTotp,
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
    importCodes: importInventory,
    deliverReservation,
    saveProduct,
    addProductImage,
    reorderProductImages,
    deleteProductImage,
    getFile,
    profile,
    publicUser,
    queueBoard,
    myQueue,
    chatThreads,
    openChatThread,
    chatMessages,
    postChatMessage,
    closeChatThread,
    notifications,
    markNotificationRead,
    buyerRanking,
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
      uploads: true,
    }),
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
      return all(
        // Wallet shows the customer's credit only; PAYMENT_IN/FEE/WITHDRAWAL are shop-side money.
        "SELECT id,amount,label,created_at FROM ledger WHERE user_id=? AND kind IN ('DEMO_CREDIT','TOPUP','PURCHASE','REFUND','ADJUSTMENT') ORDER BY created_at DESC,rowid DESC",
        user.id,
      );
    },
  };
  return withLive(service, { run, all });
}
