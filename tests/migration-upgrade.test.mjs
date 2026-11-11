import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommerce } from "../server/commerce.mjs";
import { executeSqliteMigration } from "../server/sqlite-migrations.mjs";
import {
  seedLegacy,
  legacySnapshot,
  oldNames,
  sessionToken,
  deliveredCode,
  availableCode,
  fixturePassword,
} from "./fixtures/legacy-commerce.mjs";
const migrations = oldNames.map((name) =>
  readFileSync(
    new URL("../server/migrations/" + name, import.meta.url),
    "utf8",
  ),
);
const upgrade = readFileSync(
  new URL("../server/migrations/004_commerce_ops.sql", import.meta.url),
  "utf8",
);
function assertPreserved(before, after) {
  for (const [table, rows] of Object.entries(before)) {
    if (table === "inventory") {
      assert.equal(after.inventory.length, rows.length, "inventory row count");
      for (const row of rows) {
        const found = after.inventory.find((r) => r.id === row.id);
        assert.ok(found, "missing inventory " + row.id);
        assert.equal(found.variant_id, row.variant_id);
        assert.equal(found.order_id ?? null, row.order_id ?? null);
        assert.equal(found.sold_at ?? null, row.sold_at ?? null);
        assert.equal(found.legacy_single_secret, 1);
        assert.equal("secret" in found, false);
        assert.ok(found.login_id_enc);
        assert.ok(found.password_enc);
      }
      continue;
    }
    const originalColumns = rows.length ? Object.keys(rows[0]) : [];
    const actual = after[table]
      .slice(0, table === "schema_migrations" ? rows.length : undefined)
      .map((row) =>
        Object.fromEntries(originalColumns.map((k) => [k, row[k]])),
      );
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual)),
      JSON.parse(JSON.stringify(rows)),
      table + " must preserve all original values",
    );
  }
}
test("004 upgrades a populated persistent database without changing users, sessions, orders, balances or encrypted keys", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-upgrade-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "commerce.sqlite"),
    key = randomBytes(32);
  const old = new DatabaseSync(path);
  old.exec("PRAGMA foreign_keys=ON");
  seedLegacy(old, migrations, key);
  const before = legacySnapshot(old);
  old.close();
  let s = createCommerce({ path, key, seed: false });
  assertPreserved(before, legacySnapshot(s.db));
  assert.deepEqual(s.db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(s.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(s.publicUser(s.session(sessionToken)).balance, 90000);
  assert.deepEqual(s.orderDetail(s.session(sessionToken), "order-old").codes, [
    deliveredCode,
  ]);
  assert.equal(
    s.login({ username: "buyer-old", password: fixturePassword }).user.id,
    "buyer-old",
  );
  s.db.prepare("UPDATE users SET role='STAFF' WHERE id='other-old'").run();
  assert.equal(
    s.db.prepare("SELECT role FROM users WHERE id='other-old'").get().role,
    "STAFF",
  );
  const user = s.session(sessionToken);
  const order = s.createOrder(user, {
    variantId: "stream-plus-30",
    quantity: 1,
    requestKey: "after-upgrade-purchase",
  });
  assert.deepEqual(
    s.pay(user, order.id, {
      paymentToken: order.paymentToken,
      outcome: "success",
    }).codes,
    [availableCode],
  );
  assert.equal(s.publicUser(user).balance, 80000);
  const applied = s.db
    .prepare(
      "SELECT COUNT(*) AS n FROM schema_migrations WHERE name='004_commerce_ops.sql'",
    )
    .get().n;
  assert.equal(applied, 1);
  assert.equal(
    s.db
      .prepare(
        "SELECT COUNT(*) AS n FROM schema_migrations WHERE name='005_credential_preorder_indexes.sql'",
      )
      .get().n,
    1,
  );
  const detail = s.orderDetail(s.session(sessionToken), "order-old");
  assert.deepEqual(detail.credentials, [
    { loginId: deliveredCode, password: "" },
  ]);
  const after = legacySnapshot(s.db);
  s.db.close();
  s = createCommerce({ path, key, seed: false });
  assert.deepEqual(legacySnapshot(s.db), after);
  assert.deepEqual(s.orderDetail(s.session(sessionToken), "order-old").codes, [
    deliveredCode,
  ]);
  s.db.close();
});

test("MU1/MU5: 005 remaps secret to dual credential on populated DB", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-005-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "commerce.sqlite");
  const key = randomBytes(32);
  const old = new DatabaseSync(path);
  old.exec("PRAGMA foreign_keys=ON");
  seedLegacy(old, migrations, key);
  const legacyCount = old
    .prepare("SELECT COUNT(*) AS n FROM inventory")
    .get().n;
  assert.ok(legacyCount > 0);
  old.close();
  const s = createCommerce({ path, key, seed: false });
  assert.equal(
    s.db
      .prepare(
        "SELECT COUNT(*) AS n FROM schema_migrations WHERE name='005_credential_preorder_indexes.sql'",
      )
      .get().n,
    1,
  );
  const cols = s.db
    .prepare("PRAGMA table_info(inventory)")
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes("login_id_enc"));
  assert.ok(cols.includes("password_enc"));
  assert.ok(cols.includes("reservation_id"));
  assert.equal(cols.includes("secret"), false);
  assert.equal(
    s.db
      .prepare(
        "SELECT COUNT(*) AS n FROM inventory WHERE legacy_single_secret=1",
      )
      .get().n,
    legacyCount,
  );
  const resCols = s.db
    .prepare("PRAGMA table_info(reservations)")
    .all()
    .map((c) => c.name);
  assert.ok(resCols.includes("delivered_at"));
  assert.ok(resCols.includes("delivered_by"));
  s.db
    .prepare(
      "UPDATE reservations SET status='DELIVERED', delivered_at=CURRENT_TIMESTAMP, delivered_by='admin-old' WHERE id='reservation-old'",
    )
    .run();
  assert.equal(
    s.db
      .prepare("SELECT status FROM reservations WHERE id='reservation-old'")
      .get().status,
    "DELIVERED",
  );
  s.db
    .prepare(
      "UPDATE inventory SET reservation_id='reservation-old', order_id=NULL WHERE id='unit-available'",
    )
    .run();
  assert.throws(() => {
    s.db
      .prepare(
        "UPDATE inventory SET order_id='order-old', reservation_id='reservation-old' WHERE id='unit-available'",
      )
      .run();
  });
  const indexes = s.db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name);
  assert.ok(indexes.includes("orders_status_created"));
  assert.ok(indexes.includes("reservations_status_created"));
  s.db.close();
});

test("MU2: 005 apply is idempotent on reopen", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "astra-005-idem-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "commerce.sqlite");
  const key = randomBytes(32);
  const old = new DatabaseSync(path);
  old.exec("PRAGMA foreign_keys=ON");
  seedLegacy(old, migrations, key);
  old.close();
  let s = createCommerce({ path, key, seed: false });
  const snap = legacySnapshot(s.db);
  s.db.close();
  s = createCommerce({ path, key, seed: false });
  assert.deepEqual(legacySnapshot(s.db), snap);
  assert.equal(
    s.db
      .prepare(
        "SELECT COUNT(*) AS n FROM schema_migrations WHERE name='005_credential_preorder_indexes.sql'",
      )
      .get().n,
    1,
  );
  s.db.close();
});

test("a foreign-key violation aborts and rolls back the entire rebuild and migration marker", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    seedLegacy(db, migrations, randomBytes(32));
    const before = legacySnapshot(db);
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => {
      try {
        executeSqliteMigration(
          db,
          upgrade +
            ";INSERT INTO sessions VALUES('orphan','missing-user',9999999999999);",
        );
        db.prepare("INSERT INTO schema_migrations(name) VALUES(?)").run(
          "004_commerce_ops.sql",
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }, /foreign-key integrity check/);
    assert.deepEqual(legacySnapshot(db), before);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(
      () =>
        db.prepare("INSERT INTO sessions VALUES('bad','missing-user',1)").run(),
      /FOREIGN KEY/,
    );
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name='users_new'").get(),
      undefined,
    );
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name='payments'").get(),
      undefined,
    );
  } finally {
    db.close();
  }
});

test(
  "workerd upgrades an existing Durable Object, rolls back invalid changes, and reopens with the same sessions and delivered key",
  { timeout: 60000 },
  async (t) => {
    const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
    const { build } = await import("esbuild");
    const dir = mkdtempSync(join(tmpdir(), "astra-workerd-upgrade-"));
    const root = fileURLToPath(new URL("../", import.meta.url));
    let mf;
    t.after(async () => {
      await mf?.dispose();
      rmSync(dir, { recursive: true, force: true });
    });
    const imports = `import {createHmac} from 'node:crypto';import{seedLegacy,legacySnapshot}from './tests/fixtures/legacy-commerce.mjs';`;
    async function bundle(contents) {
      return (
        await build({
          stdin: {
            contents,
            resolveDir: root,
            sourcefile: "upgrade-probe.mjs",
          },
          bundle: true,
          write: false,
          format: "esm",
          platform: "node",
          target: "es2022",
          external: ["cloudflare:workers", "node:*"],
          loader: { ".sql": "text" },
        })
      ).outputFiles[0].text;
    }
    const legacy =
      await bundle(`import{DurableObject}from 'cloudflare:workers';${imports}import{executeSqliteMigration}from './server/sqlite-migrations.mjs';
 export class Commerce extends DurableObject{constructor(ctx,env){super(ctx,env);const sql=ctx.storage.sql;this.db={exec:s=>sql.exec(s),prepare:s=>({all:(...a)=>sql.exec(s,...a).toArray(),get:(...a)=>sql.exec(s,...a).toArray()[0],run:(...a)=>sql.exec(s,...a)})};const key=createHmac('sha256',env.INVENTORY_KEY).update(ctx.id.toString()).digest();ctx.storage.transactionSync(()=>seedLegacy(this.db,${JSON.stringify(migrations)},key))}
 async fetch(req){if(new URL(req.url).pathname==='/invalid-upgrade'){try{this.ctx.storage.transactionSync(()=>{executeSqliteMigration(this.db,${JSON.stringify(upgrade + ";INSERT INTO sessions VALUES('orphan','missing-user',9999999999999);")});this.db.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run('004_commerce_ops.sql')});return new Response('unexpected success',{status:500})}catch(e){return Response.json({error:e.message},{status:409})}}return Response.json(legacySnapshot(this.db))}}
 export default{fetch(){return new Response('fixture')}}`);
    const current =
      await bundle(`import{Commerce as ProductionCommerce}from './cloud/worker.mjs';${imports}
 export class Commerce extends ProductionCommerce{async fetch(req){if(new URL(req.url).pathname==='/snapshot')return Response.json(legacySnapshot(this.db));return super.fetch(req)}}export default{fetch(){return new Response('fixture')}}`);
    const options = (script) => ({
      ...convertV4MiniflareOptions({
        name: "astra-migration-test",
        modules: true,
        script,
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          COMMERCE: { className: "Commerce", useSQLite: true },
        },
        bindings: {
          SPACE_SIGNING_KEY: "migration-fixture-signing-only",
          INVENTORY_KEY: "migration-fixture-inventory-only",
        },
        cf: false,
      }),
      resourcePersistencePath: dir,
    });
    mf = new Miniflare(options(legacy));
    const stub = async () => {
      const ns = await mf.getDurableObjectNamespace("COMMERCE");
      return ns.get(ns.idFromName("existing-customer-workspace"));
    };
    const before = await (
      await (await stub()).fetch("http://fixture/snapshot")
    ).json();
    assert.equal(before.users.length, 3);
    assert.ok(before.inventory.every((i) => !i.secret.includes("DEMO-")));
    const bad = await (await stub()).fetch("http://fixture/invalid-upgrade");
    assert.equal(bad.status, 409);
    assert.match((await bad.json()).error, /foreign-key integrity check/);
    assert.deepEqual(
      await (await (await stub()).fetch("http://fixture/snapshot")).json(),
      before,
    );
    await mf.setOptions(options(current));
    const upgraded = await (
      await (await stub()).fetch("http://fixture/snapshot")
    ).json();
    assertPreserved(before, upgraded);
    assert.ok(upgraded.ledger.every((l) => l.kind === "DEMO_CREDIT"));
    assert.equal(
      upgraded.schema_migrations.filter(
        (m) => m.name === "004_commerce_ops.sql",
      ).length,
      1,
    );
    const headers = { Cookie: "astra_session=" + sessionToken };
    const health = await (
      await (await stub()).fetch("http://fixture/api/health")
    ).json();
    assert.equal(health.ok, true);
    assert.equal(health.storage, "cloudflare-durable-sqlite");
    const detail = await (
      await (
        await stub()
      ).fetch("http://fixture/api/orders/order-old", { headers })
    ).json();
    assert.deepEqual(detail.codes, [deliveredCode]);
    const me = await (
      await (await stub()).fetch("http://fixture/api/me", { headers })
    ).json();
    assert.equal(me.user.balance, 90000);
    await mf.dispose();
    mf = new Miniflare(options(current));
    assert.deepEqual(
      await (await (await stub()).fetch("http://fixture/snapshot")).json(),
      upgraded,
    );
    assert.deepEqual(
      (
        await (
          await (
            await stub()
          ).fetch("http://fixture/api/orders/order-old", { headers })
        ).json()
      ).codes,
      [deliveredCode],
    );
  },
);
