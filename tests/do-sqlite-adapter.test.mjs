import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createDoSqliteAdapter } from "../server/do-sqlite-adapter.mjs";

test("DO adapter run maps rowsWritten to changes (documents Cloudflare bug)", () => {
  let drained = false;
  const sql = {
    exec() {
      return {
        rowsWritten: 1,
        [Symbol.iterator]() {
          drained = true;
          return [][Symbol.iterator]();
        },
        toArray() {
          drained = true;
          return [];
        },
      };
    },
  };
  const raw = sql.exec("UPDATE inventory SET sold_at=? WHERE id=?");
  assert.equal(raw.changes, undefined, "raw DO cursor has no .changes");
  assert.equal(!!raw.changes, false, "if (!x.changes) would fail before adapter");

  const db = createDoSqliteAdapter(sql);
  const result = db.prepare("UPDATE inventory SET sold_at=? WHERE id=?").run(
    "now",
    "inv-1",
  );
  assert.equal(drained, true, "run() must drain the cursor");
  assert.equal(result.changes, 1);
  assert.ok(result.changes, "domain if (!x.changes) must pass after a write");
});

test("DO adapter run returns changes 0 when nothing written", () => {
  const db = createDoSqliteAdapter({
    exec() {
      return {
        rowsWritten: 0,
        [Symbol.iterator]() {
          return [][Symbol.iterator]();
        },
      };
    },
  });
  assert.equal(db.prepare("UPDATE inventory SET x=1 WHERE 0").run().changes, 0);
});

test(
  "workerd DO: deliverReservation succeeds when run() maps rowsWritten (not node sqlite)",
  { timeout: 120000 },
  async (t) => {
    const { Miniflare, convertV4MiniflareOptions } = await import("miniflare");
    const { build } = await import("esbuild");
    const dir = mkdtempSync(join(tmpdir(), "astra-do-run-"));
    const root = fileURLToPath(new URL("../", import.meta.url));
    let mf;
    t.after(async () => {
      await mf?.dispose();
      rmSync(dir, { recursive: true, force: true });
    });

    const adminPassword = "DoAdapterTest-Admin-99";
    const script = (
      await build({
        entryPoints: [join(root, "cloud/worker.mjs")],
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        target: "es2022",
        external: ["cloudflare:workers", "node:*"],
        loader: { ".sql": "text" },
      })
    ).outputFiles[0].text;

    mf = new Miniflare({
      ...convertV4MiniflareOptions({
        name: "astra-do-run-changes",
        modules: true,
        script,
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          COMMERCE: { className: "Commerce", useSQLite: true },
        },
        bindings: {
          SPACE_SIGNING_KEY: "do-adapter-signing-fixture-only",
          INVENTORY_KEY: "do-adapter-inventory-fixture-only",
          ASTRA_ADMIN_PASSWORD: adminPassword,
          ASTRA_TEST_PAYMENTS: "on",
        },
        cf: false,
      }),
      resourcePersistencePath: dir,
    });

    const cookieJar = new Map();
    function storeCookies(response) {
      const raw = response.headers.getSetCookie?.() ?? [];
      const list = raw.length
        ? raw
        : [response.headers.get("set-cookie")].filter(Boolean);
      for (const line of list) {
        const [pair] = String(line).split(";");
        const i = pair.indexOf("=");
        if (i > 0) cookieJar.set(pair.slice(0, i), pair.slice(i + 1));
      }
    }
    function cookieHeader() {
      return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    async function shop() {
      const ns = await mf.getDurableObjectNamespace("COMMERCE");
      return ns.get(ns.idFromName("shop"));
    }
    async function api(method, path, body) {
      const headers = { "X-Astra-Request": "1" };
      if (cookieHeader()) headers.Cookie = cookieHeader();
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await (
        await shop()
      ).fetch("http://fixture" + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      storeCookies(response);
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return { status: response.status, data };
    }

    const health = await api("GET", "/api/health");
    assert.equal(health.status, 200, JSON.stringify(health.data));
    assert.equal(health.data.storage, "cloudflare-durable-sqlite");

    const login = await api("POST", "/api/login", {
      email: "admin@astra.local",
      password: adminPassword,
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(login.data.user.role, "ADMIN");

    const product = await api("POST", "/api/admin/products", {
      name: "DO Preorder QA",
      description: "Durable Object adapter deliver proof product",
      category: "streaming",
      price: 500,
      active: true,
      preorder: true,
    });
    assert.equal(product.status, 200, JSON.stringify(product.data));
    const productId = product.data.id;
    const variantId = productId + "-30";

    const imported = await api("POST", "/api/admin/inventory", {
      variantId,
      items: [
        { loginId: "do-pair-a@example.invalid", password: "secret-a" },
        { loginId: "do-pair-b@example.invalid", password: "secret-b" },
      ],
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.equal(imported.data.imported, 2);

    const channel = await api("POST", "/api/admin/payment-channel", {
      provider: "sandbox",
      active: true,
    });
    assert.equal(channel.status, 200, JSON.stringify(channel.data));

    cookieJar.clear();
    const buyer = await api("POST", "/api/register", {
      name: "DO Buyer",
      email: `do-buyer-${randomUUID()}@example.invalid`,
      password: "Buyer-only-Password-123",
    });
    assert.equal(buyer.status, 200, JSON.stringify(buyer.data));

    const topup = await api("POST", "/api/topup", {
      amount: 500,
      requestKey: "do-topup-" + randomUUID(),
    });
    assert.equal(topup.status, 200, JSON.stringify(topup.data));

    const order = await api("POST", "/api/orders", {
      variantId,
      quantity: 1,
      requestKey: "do-deliver-" + randomUUID(),
    });
    assert.ok(
      order.status === 200 || order.status === 201,
      JSON.stringify(order.data),
    );
    const paid = await api("POST", `/api/orders/${order.data.id}/pay`, {
      paymentToken: order.data.paymentToken,
      outcome: "success",
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.status, "PREORDER");

    cookieJar.clear();
    await api("POST", "/api/login", {
      email: "admin@astra.local",
      password: adminPassword,
    });
    const delivered = await api(
      "POST",
      `/api/admin/reservations/${order.data.id}/deliver`,
      {},
    );
    assert.equal(
      delivered.status,
      200,
      "deliver must not 409 สต็อกไม่พอ on DO — got " +
        JSON.stringify(delivered.data),
    );
    assert.equal(delivered.data.status, "DELIVERED");
    assert.equal(delivered.data.delivered, true);

    const again = await api(
      "POST",
      `/api/admin/reservations/${order.data.id}/deliver`,
      {},
    );
    assert.equal(again.status, 200);
    assert.equal(again.data.delivered_at, delivered.data.delivered_at);

    const me = await api("GET", "/api/me");
    if (me.data?.features?.adminReplaceCredential) {
      const detail = await api("GET", `/api/admin/orders/${order.data.id}`);
      const unitId = detail.data?.units?.[0]?.id;
      assert.ok(unitId, "admin order detail units[] should expose inventory id");
      const replace = await api(
        "POST",
        `/api/admin/orders/${order.data.id}/replace`,
        { inventoryId: unitId, reason: "บัญชีเข้าไม่ได้บน DO proof" },
      );
      assert.equal(
        replace.status,
        200,
        "replace must not fail on DO — got " + JSON.stringify(replace.data),
      );
    }
  },
);
