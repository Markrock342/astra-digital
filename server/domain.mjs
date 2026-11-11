import {
  createHash,
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
} from "./auth-policy.mjs";
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
} = {}) {
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
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
  const publicUser = (user) =>
    user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          balance: one(
            "SELECT COALESCE(SUM(amount),0) AS value FROM ledger WHERE user_id=?",
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
    run("DELETE FROM sessions WHERE expires_at<?", Date.now());
    run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hash(token),
      user.id,
      Date.now() + 7 * 86400000,
    );
    return { user: publicUser(user), token };
  };
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
          "INSERT INTO variants VALUES(?,?,?,?)",
          p.id + "-30",
          p.id,
          p.category === "gift" ? "โค้ดดิจิทัล" : "30 วัน",
          p.price,
        );
      }
      for (const p of catalog.slice(0, 5))
        run(
          "INSERT INTO variants VALUES(?,?,?,?)",
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
          run(
            "INSERT INTO inventory(id,variant_id,fingerprint,secret) VALUES(?,?,?,?)",
            randomUUID(),
            v.id,
            hash(code),
            encrypt(code),
          );
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
          "INSERT INTO ledger(id,user_id,amount,reference,label,kind,created_at) VALUES(?,?,?,?,?,'DEMO_CREDIT',datetime('now','-2 days'))",
          randomUUID(),
          id,
          50000,
          "seed-grant-" + id,
          "เครดิตเริ่มต้น (ทดลอง)",
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
          "SELECT id FROM inventory WHERE variant_id=? AND order_id IS NULL LIMIT 1",
          "stream-plus-30",
        );
        run(
          "UPDATE inventory SET order_id=?,sold_at=datetime('now','-1 day') WHERE id=?",
          order,
          stock.id,
        );
        run(
          "INSERT INTO ledger(id,user_id,amount,reference,label,kind,created_at) VALUES(?,?,?,?,?,'DEMO_CREDIT',datetime('now','-1 day'))",
          randomUUID(),
          id,
          -10000,
          order,
          "ซื้อ STREAM+",
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
        "INSERT OR IGNORE INTO variants VALUES('stream-plus-full','stream-plus','DISNEY+ 30 DAYS ยกแอค',38900)",
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
          "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND order_id IS NULL",
          variantId,
        ).n;
        for (let i = present; i < target; i++) {
          const code =
            "DEMO-KEY-NOT-VALID-REF-" +
            variantId.toUpperCase() +
            "-" +
            String(i).padStart(4, "0");
          run(
            "INSERT INTO inventory(id,variant_id,fingerprint,secret) VALUES(?,?,?,?)",
            randomUUID(),
            variantId,
            hash(code),
            encrypt(code),
          );
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
        "SELECT id FROM users WHERE email LIKE '%@example.invalid' OR email LIKE '%@demo.astra.local' OR email LIKE '%@merchant.astra.local'",
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
    if (adminPassword.length < 12)
      throw new Error("ASTRA_ADMIN_PASSWORD must have at least 12 characters");
    const email = "admin@astra.local";
    const existing = one("SELECT id FROM users WHERE email=?", email);
    if (existing)
      run(
        "UPDATE users SET password_hash=?,role=? WHERE id=?",
        passwordHash(adminPassword),
        ROLES.ADMIN,
        existing.id,
      );
    else
      run(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,?)",
        randomUUID(),
        email,
        "ผู้ดูแล ASTRA",
        passwordHash(adminPassword),
        ROLES.ADMIN,
      );
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
        (username ?? randomBytes(8).toString("hex")) + "@demo.astra.local",
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
        run(
          "INSERT INTO ledger(id,user_id,amount,reference,label,kind) VALUES(?,?,?,?,?,'DEMO_CREDIT')",
          randomUUID(),
          id,
          50000,
          "welcome-" + id,
          "เครดิตต้อนรับ (ทดลอง)",
        );
      audit({ id }, "REGISTER", id);
    });
    return issueSession(one("SELECT * FROM users WHERE id=?", id));
  }
  function login(rawInput) {
    const input = withoutClientPrivileges(rawInput);
    const email = clean(
      input.email ?? input.username,
      3,
      160,
      "ชื่อผู้ใช้หรืออีเมล",
    );
    const password = clean(input.password, 1, 128, "รหัสผ่าน");
    const user = one(
      "SELECT * FROM users WHERE email=? OR username=?",
      email,
      email,
    );
    if (
      !passwordMatches(
        password,
        user?.password_hash ??
          "00000000000000000000000000000000:" + "00".repeat(64),
      )
    )
      fail(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    audit(user, "LOGIN", user.id);
    return issueSession(user);
  }
  function demo() {
    if (!allowSandbox) fail(403, "ร้านนี้ไม่เปิดบัญชีทดลอง");
    const suffix = randomBytes(8).toString("hex");
    return register({
      name: "ผู้เยี่ยมชม " + suffix.slice(0, 4),
      email: suffix + "@demo.astra.local",
      password: randomBytes(24).toString("hex"),
    });
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
    run("UPDATE users SET role=? WHERE id=?", ROLES.ADMIN, registered.user.id);
    run("DELETE FROM sessions WHERE token_hash=?", hash(registered.token));
    audit({ id: registered.user.id }, "DEMO_MERCHANT", registered.user.id);
    return issueSession(
      one("SELECT * FROM users WHERE id=?", registered.user.id),
    );
  }
  function session(token) {
    if (!token) return null;
    return (
      one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
        hash(token),
        Date.now(),
      ) ?? null
    );
  }
  function mapProduct(p) {
    return {
      ...p,
      variants: all(
        "SELECT v.*, CASE WHEN p.preorder=1 THEN 0 ELSE (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND i.order_id IS NULL) END AS stock FROM variants v JOIN products p ON p.id=v.product_id WHERE v.product_id=? ORDER BY CASE WHEN v.id='stream-plus-full' THEN 0 WHEN v.id LIKE '%-30' THEN 1 ELSE 2 END,price",
        p.id,
      ).map((v) => ({
        ...v,
        price: p.preorder && v.id === "cinema-max-30" ? 0 : v.price,
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
      ...(raw ? JSON.parse(raw.value) : {}),
    };
  }
  function saveSettings(user, input) {
    requireAdmin(user);
    const current = settings();
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
    run(
      "INSERT INTO runtime_flags(key,value) VALUES('shop-settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(current),
    );
    audit(user, "SAVE_SETTINGS", user.id);
    return { shop: current };
  }
  function overview() {
    return {
      shop: settings(),
      customers: one("SELECT COUNT(*) AS n FROM users WHERE role='CUSTOMER'").n,
      products: one(
        "SELECT COUNT(*) AS n FROM inventory i JOIN variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id WHERE p.active=1 AND p.hidden_seed=0 AND p.preorder=0 AND i.order_id IS NULL",
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
      "SELECT v.*,p.preorder FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.active=1 AND p.hidden_seed=0",
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
        "SELECT COUNT(*) AS n FROM inventory WHERE variant_id=? AND order_id IS NULL",
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
      const { payment_hash, request_key, ...safe } = reservation;
      return {
        ...safe,
        preorder: true,
        reviewed: true,
        codes: [],
        queueNumber: reservation.queue_number ?? null,
      };
    }
    const { payment_hash, request_key, ...safe } = order;
    return {
      ...safe,
      reviewed: !!one("SELECT id FROM reviews WHERE order_id=?", orderId),
      codes:
        ownerView && order.status === "DELIVERED"
          ? all("SELECT secret FROM inventory WHERE order_id=?", orderId).map(
              (c) => decrypt(c.secret),
            )
          : [],
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
    const rows = all(
      `SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product,0 AS preorder,NULL AS queue_number
       FROM orders o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
       UNION ALL
       SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product,1 AS preorder,o.queue_number
       FROM reservations o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
       ORDER BY 5 DESC, 1 DESC`,
    )
      .map(({ payment_hash, request_key, ...row }) => ({
        ...row,
        codes: undefined,
      }))
      .filter((row) => {
        if (!cursorCreated) return true;
        if (row.created_at < cursorCreated) return true;
        if (row.created_at > cursorCreated) return false;
        return row.id < cursorId;
      })
      .slice(0, lim + 1);
    const page = rows.slice(0, lim);
    const next =
      rows.length > lim
        ? Buffer.from(page[page.length - 1].created_at + "\n" + page[page.length - 1].id, "utf8").toString(
            "base64url",
          )
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
          run(
            "INSERT INTO ledger(id,user_id,amount,reference,label,kind) VALUES(?,?,?,?,?,'DEMO_CREDIT')",
            randomUUID(),
            user.id,
            -o.total,
            "preorder:" + id,
            "ชำระสินค้าสั่งจอง " + id.slice(0, 8),
          );
        const queueNumber = o.queue_number ?? nextQueueNumber();
        run(
          "UPDATE reservations SET status='PREORDER', queue_number=? WHERE id=?",
          queueNumber,
          id,
        );
        run(
          `INSERT OR IGNORE INTO payments(
            id, order_id, reservation_id, user_id, amount, currency, status,
            provider, provider_ref, idempotency_key, created_at, finalized_at
          ) VALUES(?,NULL,?,?,?,'THB','SUCCEEDED','sandbox',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
          randomUUID(),
          id,
          user.id,
          o.total,
          "sandbox:preorder:" + id,
          "pay:reservation:" + id,
        );
        notify(
          user.id,
          "preorder_queue",
          "ได้รับเลขคิวพรีออเดอร์",
          "คิวของคุณคือ #" + queueNumber,
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
        "SELECT id FROM inventory WHERE variant_id=? AND order_id IS NULL ORDER BY " +
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
      run(
        "INSERT INTO ledger(id,user_id,amount,reference,label,kind) VALUES(?,?,?,?,?,'DEMO_CREDIT')",
        randomUUID(),
        user.id,
        -order.total,
        id,
        "ชำระคำสั่งซื้อ " + id.slice(0, 8),
      );
      for (const item of available)
        run(
          "UPDATE inventory SET order_id=?,sold_at=CURRENT_TIMESTAMP WHERE id=? AND order_id IS NULL",
          id,
          item.id,
        );
      run("UPDATE orders SET status='DELIVERED' WHERE id=?", id);
      run(
        `INSERT OR IGNORE INTO payments(
          id, order_id, reservation_id, user_id, amount, currency, status,
          provider, provider_ref, idempotency_key, created_at, finalized_at
        ) VALUES(?,?,NULL,?,?,'THB','SUCCEEDED','sandbox',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        randomUUID(),
        id,
        user.id,
        order.total,
        "sandbox:order:" + id,
        "pay:order:" + id,
      );
      notify(
        user.id,
        "code_delivery",
        "ส่งโค้ดสำเร็จ",
        "คำสั่งซื้อ " + id.slice(0, 8) + " ได้รับโค้ดแล้ว",
      );
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
        run(
          "INSERT INTO ledger(id,user_id,amount,reference,label,kind) VALUES(?,?,?,?,?,'DEMO_CREDIT')",
          randomUUID(),
          user.id,
          input.amount * 100,
          ref,
          "เติมเครดิตทดลอง",
        );
        audit(user, "DEMO_TOPUP", ref);
      }
    });
    return publicUser(user);
  }
  function adminOverview(user) {
    requireAdmin(user);
    return {
      revenue: one(
        "SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status='DELIVERED'",
      ).n,
      orderCount: one(
        "SELECT (SELECT COUNT(*) FROM orders)+(SELECT COUNT(*) FROM reservations) AS n",
      ).n,
      delivered: one(
        "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE status='DELIVERED'",
      ).n,
      stock: one(
        "SELECT COUNT(*) AS n FROM inventory i JOIN variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id WHERE i.order_id IS NULL AND p.hidden_seed=0 AND p.preorder=0",
      ).n,
      products: all("SELECT * FROM products WHERE hidden_seed=0").map((p) => ({
        ...p,
        variants: all(
          "SELECT v.*,CASE WHEN p.preorder=1 THEN 0 ELSE (SELECT COUNT(*) FROM inventory i WHERE i.variant_id=v.id AND order_id IS NULL) END AS stock FROM variants v JOIN products p ON p.id=v.product_id WHERE v.product_id=?",
          p.id,
        ).map((v) => ({
          ...v,
          price: p.preorder && v.id === "cinema-max-30" ? 0 : v.price,
        })),
      })),
      orders: all(
        "SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product FROM orders o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id UNION ALL SELECT o.id,o.status,o.total,o.quantity,o.created_at,u.id AS customer_id,u.name AS customer,p.id AS product_id,p.name AS product FROM reservations o JOIN users u ON u.id=o.user_id JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id ORDER BY 5 DESC",
      ),
      customers: all("SELECT id,email,name,role,created_at FROM users"),
      ledger: all(
        "SELECT l.*,u.name FROM ledger l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC",
      ),
      audit: all("SELECT * FROM audit ORDER BY id DESC LIMIT 50"),
    };
  }
  function importCodes(user, input) {
    requireAdmin(user);
    const variantId = clean(input.variantId, 1, 80, "ตัวเลือกสินค้า");
    if (!one("SELECT id FROM variants WHERE id=?", variantId))
      fail(404, "ไม่พบตัวเลือกสินค้า");
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
        if (one("SELECT id FROM inventory WHERE fingerprint=?", hash(code)))
          fail(409, "โค้ดนี้มีอยู่ในคลังแล้ว");
        run(
          "INSERT INTO inventory(id,variant_id,fingerprint,secret) VALUES(?,?,?,?)",
          randomUUID(),
          variantId,
          hash(code),
          encrypt(code),
        );
      }
      audit(user, "IMPORT_CODES", variantId);
      return { imported: codes.length };
    });
  }
  function saveProduct(user, input) {
    requireAdmin(user);
    const id = input.id ? clean(input.id, 1, 80, "รหัสสินค้า") : randomUUID();
    const name = clean(input.name, 2, 80, "ชื่อสินค้า");
    const description = clean(input.description, 5, 1000, "รายละเอียด");
    if (!categories.some((c) => c.id === input.category))
      fail(400, "หมวดหมู่ไม่ถูกต้อง");
    const price = integer(input.price, 100, 10000000, "ราคา");
    return tx(() => {
      if (input.id) {
        if (!one("SELECT id FROM products WHERE id=?", id))
          fail(404, "ไม่พบสินค้า");
        run(
          "UPDATE products SET name=?,description=?,category=?,active=?,featured=? WHERE id=?",
          name,
          description,
          input.category,
          input.active === false ? 0 : 1,
          input.featured === true || input.featured === "on" ? 1 : 0,
          id,
        );
        run(
          "UPDATE variants SET price=? WHERE id=(SELECT id FROM variants WHERE product_id=? ORDER BY price LIMIT 1)",
          price,
          id,
        );
      } else {
        run(
          "INSERT INTO products(id,name,category,description,art,active,featured) VALUES(?,?,?,?,?,?,?)",
          id,
          name,
          input.category,
          description,
          "gift",
          input.active === false ? 0 : 1,
          input.featured === true || input.featured === "on" ? 1 : 0,
        );
        run(
          "INSERT INTO variants VALUES(?,?,?,?)",
          id + "-30",
          id,
          "โค้ดดิจิทัล",
          price,
        );
      }
      audit(user, "SAVE_PRODUCT", id);
      return { id };
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
       WHERE r.queue_number IS NOT NULL
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
        `SELECT t.*,u.name AS customer,u.email AS customer_email,
                (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id) AS messages
         FROM chat_threads t JOIN users u ON u.id=t.user_id
         ORDER BY t.created_at DESC`,
      );
    return all(
      `SELECT t.*,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id) AS messages
       FROM chat_threads t WHERE t.user_id=? ORDER BY t.created_at DESC`,
      user.id,
    );
  }
  function openChatThread(user, rawInput) {
    requireUser(user);
    const input = withoutClientPrivileges(rawInput);
    const body = clean(input.body ?? "สวัสดี ต้องการความช่วยเหลือ", 1, 1000, "ข้อความ");
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
  return {
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
    getPaymentChannel,
    setPaymentChannel,
    pay,
    retry,
    topup,
    adminOverview,
    importCodes,
    saveProduct,
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
        "SELECT id,amount,label,created_at FROM ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC",
        user.id,
      );
    },
  };
}
