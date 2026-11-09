import {
  createCipheriv,
  createHash,
  scryptSync,
  randomBytes,
} from "node:crypto";
export const oldNames = [
  "001_initial.sql",
  "002_reviews.sql",
  "003_reference_layout.sql",
];
export const tables = [
  "users",
  "sessions",
  "products",
  "variants",
  "orders",
  "inventory",
  "ledger",
  "audit",
  "reviews",
  "runtime_flags",
  "reservations",
  "schema_migrations",
];
export const sessionToken = "a".repeat(64);
export const fixturePassword = "Migration-test-only-Password123";
export const deliveredCode = "DEMO-UPGRADE-DELIVERED-0001";
export const availableCode = "DEMO-UPGRADE-AVAILABLE-0002";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function seedLegacy(db, migrations, key) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  if (
    db
      .prepare("SELECT name FROM schema_migrations WHERE name=?")
      .get(oldNames[2])
  )
    return;
  for (let i = 0; i < migrations.length; i++) {
    db.exec(migrations[i]);
    db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
      oldNames[i],
    );
  }
  const salt = randomBytes(16).toString("hex");
  const password =
    salt + ":" + scryptSync(fixturePassword, salt, 64).toString("hex");
  for (const [id, role] of [
    ["buyer-old", "CUSTOMER"],
    ["admin-old", "ADMIN"],
    ["other-old", "CUSTOMER"],
  ])
    db.prepare(
      "INSERT INTO users(id,email,name,password_hash,role,username) VALUES(?,?,?,?,?,?)",
    ).run(id, id + "@example.invalid", id, password, role, id);
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    hash(sessionToken),
    "buyer-old",
    Date.now() + 86400000,
  );
  db.prepare(
    "INSERT INTO products(id,name,category,description,art,featured) VALUES('stream-plus','Preserved product','streaming','Preserved description','stream',1)",
  ).run();
  db.prepare(
    "INSERT INTO variants VALUES('stream-plus-30','stream-plus','Preserved package',10000)",
  ).run();
  db.prepare(
    "INSERT INTO orders(id,user_id,variant_id,quantity,total,status,request_key,payment_hash) VALUES('order-old','buyer-old','stream-plus-30',1,10000,'DELIVERED','request-old','hash-old')",
  ).run();
  const encrypt = (value) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = cipher.update(value, "utf8", "hex") + cipher.final("hex");
    return [iv.toString("hex"), data, cipher.getAuthTag().toString("hex")].join(
      ":",
    );
  };
  for (const [id, code, order] of [
    ["unit-sold", deliveredCode, "order-old"],
    ["unit-available", availableCode, null],
  ])
    db.prepare(
      "INSERT INTO inventory(id,variant_id,fingerprint,secret,order_id) VALUES(?,?,?,?,?)",
    ).run(id, "stream-plus-30", hash(code), encrypt(code), order);
  db.prepare(
    "INSERT INTO ledger(id,user_id,amount,reference,label) VALUES('grant-old','buyer-old',100000,'grant-old','TEST grant')",
  ).run();
  db.prepare(
    "INSERT INTO ledger(id,user_id,amount,reference,label) VALUES('debit-old','buyer-old',-10000,'order-old','TEST purchase')",
  ).run();
  db.prepare(
    "INSERT INTO audit(user_id,action,entity_id) VALUES('buyer-old','LEGACY_PURCHASE','order-old')",
  ).run();
  db.prepare(
    "INSERT INTO reviews(id,order_id,user_id,rating,comment) VALUES('review-old','order-old','buyer-old',5,'Preserved review')",
  ).run();
  db.prepare(
    "INSERT INTO reservations(id,user_id,variant_id,quantity,total,request_key,payment_hash) VALUES('reservation-old','buyer-old','stream-plus-30',1,10000,'reserve-old','hash-reserve')",
  ).run();
  db.prepare(
    "INSERT INTO runtime_flags VALUES('reference-catalog-v1','1')",
  ).run();
  db.prepare("INSERT INTO runtime_flags VALUES(?,?)").run(
    "shop-settings",
    JSON.stringify({
      shopName: "Preserved shop",
      shopOpen: true,
      stockOrder: "oldest",
    }),
  );
}
export function legacySnapshot(db) {
  return Object.fromEntries(
    tables.map((name) => [
      name,
      db.prepare("SELECT * FROM " + name + " ORDER BY 1").all(),
    ]),
  );
}
