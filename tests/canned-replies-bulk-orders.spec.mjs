// Chat ข้อความสำเร็จรูป (canned replies) and bulk actions on the admin orders list,
// at desktop and 390px, as ADMIN and STAFF.
import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";
import { ROLES } from "../server/auth-policy.mjs";

const shots = process.env.BULK_SHOTS; // optional folder for review screenshots
let server, service, base, admin, adminToken, staffToken, buyer, thread, delivered, unpaid, csvBuyer, csvOrder;
const adminPassword = randomBytes(24).toString("hex");
const READY = "stream-plus-30";
let seq = 0;
const key = () => "e2e-bulk-" + String(++seq).padStart(6, "0");

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  const staffAuth = service.register({ name: "Bulk Staff", email: "bulk-staff@example.invalid", password: "Bulk-staff-Password-123" });
  service.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  staffToken = staffAuth.token;
  const auth = service.register({ name: "สมหญิง ลูกค้า", email: "bulk-buyer@example.invalid", password: "Bulk-buyer-Password-123" });
  buyer = service.session(auth.token);
  service.db.prepare("UPDATE users SET first_name=? WHERE id=?").run("สมหญิง", buyer.id);
  const paid = service.createOrder(buyer, { variantId: READY, quantity: 1, requestKey: key() });
  delivered = service.pay(buyer, paid.id, { paymentToken: paid.paymentToken, outcome: "success" });
  service.adminCreateCoupon(admin, { code: "E2E-BULK", type: "FIXED", value: 500, usageLimit: 5 });
  unpaid = [
    service.createOrder(buyer, { variantId: READY, quantity: 1, requestKey: key(), couponCode: "E2E-BULK" }),
    service.createOrder(buyer, { variantId: READY, quantity: 1, requestKey: key() }),
  ];
  thread = service.openChatThread(buyer, { body: "สอบถามเรื่องเข้าใช้งานค่ะ" }).thread;
  // A name that starts like a spreadsheet formula, to check the CSV escaping.
  const csv = service.register({ name: "=HYPERLINK(1)", email: "csv-buyer@example.invalid", password: "Csv-buyer-Password-123" });
  csvBuyer = service.session(csv.token);
  const csvCreated = service.createOrder(csvBuyer, { variantId: "stream-plus-90", quantity: 1, requestKey: key() });
  csvOrder = service.pay(csvBuyer, csvCreated.id, { paymentToken: csvCreated.paymentToken, outcome: "success" });
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.db.close();
});

async function as(page, token) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "astra_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shot = (page, name) =>
  shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage: false, animations: "disabled" }) : null;
const messageCount = () =>
  service.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id=?").get(thread.id).n;
const statusOf = (id) =>
  (service.db.prepare("SELECT status FROM orders WHERE id=?").get(id) ??
    service.db.prepare("SELECT status FROM reservations WHERE id=?").get(id)).status;

/** Copies an unpaid order `n` times with fresh ids (fills the list past one page). */
function cloneOrders(sourceId, n) {
  const cols = service.db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  const select = cols.map((c) => (c === "id" || c === "request_key" ? "?" : c)).join(",");
  const insert = service.db.prepare(`INSERT INTO orders(${cols.join(",")}) SELECT ${select} FROM orders WHERE id=?`);
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    insert.run(...cols.flatMap((c) => (c === "id" ? [id] : c === "request_key" ? ["clone-" + id] : [])), sourceId);
  }
}

test("admin manages canned replies and inserts one without sending (desktop)", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/chat?thread=" + thread.id);
  await expect(page.locator(".admin-chat-room-head")).toContainText("สมหญิง ลูกค้า");
  const before = messageCount();

  // Manage: add a reply with a placeholder chip.
  await page.getByRole("button", { name: "ข้อความสำเร็จรูป", exact: true }).first().click();
  const manager = page.getByRole("dialog", { name: "ข้อความสำเร็จรูป" });
  await expect(manager.getByRole("list", { name: "รายการข้อความสำเร็จรูป" }).locator("li")).toHaveCount(5);
  await manager.getByRole("button", { name: "เพิ่มข้อความ" }).click();
  await manager.getByLabel("ชื่อข้อความ").fill("ทดสอบนัดรับ");
  await manager.getByLabel("ข้อความที่ส่งให้ลูกค้า").fill("สวัสดี คุณ");
  await manager.getByRole("button", { name: "{ชื่อลูกค้า}" }).click();
  await manager.getByLabel("ข้อความที่ส่งให้ลูกค้า").press("End");
  await manager.getByLabel("ข้อความที่ส่งให้ลูกค้า").pressSequentially(" ทดสอบ");
  await shot(page, "canned-manager-desktop");
  await manager.getByRole("button", { name: "เพิ่มข้อความ" }).click();
  await expect(page.getByRole("status")).toContainText("เพิ่มข้อความแล้ว");
  await expect(manager.locator(".canned-manager-list li")).toHaveCount(6);
  expect(service.db.prepare("SELECT body FROM canned_replies WHERE title='ทดสอบนัดรับ'").get().body).toBe(
    "สวัสดี คุณ{ชื่อลูกค้า} ทดสอบ",
  );
  // Move it to the top.
  // One step at a time: wait for the list to re-render before the next click (each click is a
  // server reorder; clicking ahead under load raced the update).
  const position = () =>
    manager.locator(".canned-manager-list li").evaluateAll((items) => items.findIndex((li) => li.textContent.includes("ทดสอบนัดรับ")));
  for (let at = await position(); at > 0; at--) {
    await manager.getByRole("button", { name: "เลื่อนขึ้น ทดสอบนัดรับ" }).click();
    await expect.poll(position).toBe(at - 1);
  }
  await expect(manager.locator(".canned-manager-list li").first()).toContainText("ทดสอบนัดรับ");
  await manager.getByRole("button", { name: "ปิด" }).click();
  await expect(manager).toBeHidden();

  // Button picker: search, Enter inserts the filled text, nothing is sent.
  const composer = page.getByLabel("ข้อความตอบกลับ");
  await composer.fill("เรียนลูกค้า ");
  await page.locator(".canned-trigger").click();
  const picker = page.getByRole("dialog", { name: "ข้อความสำเร็จรูป" });
  await expect(picker.getByRole("option")).toHaveCount(6);
  await picker.getByLabel("ค้นข้อความสำเร็จรูป").fill("นัดรับ");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await shot(page, "canned-picker-desktop");
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await expect(composer).toHaveValue("เรียนลูกค้า สวัสดี คุณสมหญิง ทดสอบ");
  expect(messageCount()).toBe(before);

  // "/" at the start opens it too; arrows + Enter pick, the order number is filled.
  await composer.fill("");
  await expect(composer).toHaveValue("");
  // Type "/" first and let the picker open before the query (typing ahead raced the state update).
  await composer.press("/");
  await expect(picker).toBeVisible();
  await composer.pressSequentially("รับประกัน");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await composer.press("Enter");
  const orderNo = "#" + unpaid[1].id.slice(0, 8).toUpperCase();
  await expect(composer).toHaveValue(new RegExp("^เรียน คุณสมหญิง\\n.*" + orderNo));
  expect(messageCount()).toBe(before);
  // Esc closes the "/" picker and leaves the text.
  await composer.fill("");
  await composer.pressSequentially("/xyz");
  await expect(picker).toContainText("ไม่พบข้อความที่ตรงกับคำค้น");
  await composer.press("Escape");
  await expect(picker).toBeHidden();
  await expect(composer).toHaveValue("/xyz");
  // Sending is still the normal send button.
  await composer.fill("");
  await page.locator(".canned-trigger").click();
  await picker.getByRole("option", { name: /ขอบคุณที่ติดต่อ/ }).click();
  await page.getByRole("button", { name: "ส่ง", exact: true }).click();
  await expect.poll(messageCount).toBe(before + 1);
  const last = service.db.prepare("SELECT body,sender_type FROM chat_messages WHERE thread_id=? ORDER BY rowid DESC LIMIT 1").get(thread.id);
  expect(last.sender_type).toBe("ADMIN");
  expect(last.body).toContain("เรียน คุณสมหญิง");
  expect(last.body).not.toContain("{ชื่อลูกค้า}");
});

test("staff uses canned replies on a phone; no manage button; light and dark", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page, staffToken);
  await page.goto(base + "/admin/chat?thread=" + thread.id);
  await expect(page.locator(".admin-chat-room-head")).toContainText("สมหญิง ลูกค้า");
  await expect(page.locator(".reference-admin-heading").getByRole("button", { name: "ข้อความสำเร็จรูป" })).toHaveCount(0);
  const composer = page.getByLabel("ข้อความตอบกลับ");
  await composer.pressSequentially("/");
  const picker = page.getByRole("dialog", { name: "ข้อความสำเร็จรูป" });
  await expect(picker.getByRole("option").first()).toBeVisible();
  await expect(picker.getByRole("button", { name: "จัดการ" })).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);
  const box = await picker.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    const colors = await picker.evaluate((el) => {
      const s = getComputedStyle(el);
      const opt = getComputedStyle(el.querySelector("[role=option] strong"));
      return { bg: s.backgroundColor, fg: opt.color };
    });
    expect(colors.bg, theme).toBe("rgb(255, 255, 255)");
    expect(colors.fg, theme).not.toBe(colors.bg);
    await shot(page, "canned-picker-390-" + theme);
  }
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue(/^เรียน คุณสมหญิง/);
  expect(await noSideScroll(page)).toBe(true);
  // Staff cannot manage over the API either.
  const res = await page.request.post(base + "/api/admin/canned-replies", {
    headers: { "X-Astra-Request": "1", "Content-Type": "application/json" },
    data: { title: "x", body: "y" },
  });
  expect(res.status()).toBe(403);
});

test("admin bulk-cancels picked orders with a confirm dialog and exports CSV (desktop)", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/orders");
  const row = (id) => page.getByRole("checkbox", { name: "เลือกออเดอร์ #" + id.slice(0, 8).toUpperCase() });
  for (const o of [...unpaid, delivered]) await row(o.id).check();
  const bar = page.getByRole("region", { name: "จัดการออเดอร์ที่เลือก" });
  await expect(bar).toContainText("เลือก 3 ออเดอร์");
  await bar.getByRole("button", { name: "ยกเลิกที่ยังไม่ชำระ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันยกเลิก" });
  const counts = dialog.getByLabel("สรุปจำนวน");
  await expect(counts).toContainText("เลือก3");
  await expect(counts).toContainText("ยกเลิกได้2");
  await expect(counts).toContainText("ข้าม1");
  await expect(dialog.getByRole("list", { name: "ผลแต่ละออเดอร์" })).toContainText("#" + delivered.id.slice(0, 8).toUpperCase());
  await shot(page, "bulk-cancel-confirm-desktop");
  // Cancel the dialog first: nothing changes.
  await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  expect(statusOf(unpaid[0].id)).toBe("PENDING_PAYMENT");
  await bar.getByRole("button", { name: "ยกเลิกที่ยังไม่ชำระ" }).click();
  await dialog.getByLabel(/เหตุผล/).fill("ทดสอบยกเลิกหลายรายการ");
  await dialog.getByRole("button", { name: "ยืนยันยกเลิก 2 ออเดอร์" }).click();
  const result = page.getByRole("dialog", { name: "ผลการยกเลิก" });
  await expect(result.getByLabel("สรุปจำนวน")).toContainText("ยกเลิกแล้ว2");
  await shot(page, "bulk-cancel-result-desktop");
  await result.getByRole("button", { name: "เสร็จแล้ว" }).click();
  await expect(bar).toBeHidden();
  expect(unpaid.map((o) => statusOf(o.id))).toEqual(["CANCELLED", "CANCELLED"]);
  expect(statusOf(delivered.id)).toBe("DELIVERED");
  const audits = service.db.prepare("SELECT entity_id,detail FROM audit WHERE action='CANCEL_ORDER'").all();
  expect(audits.map((a) => a.entity_id).sort()).toEqual(unpaid.map((o) => o.id).sort());
  expect(JSON.parse(audits.find((a) => a.entity_id === unpaid[0].id).detail).couponReleased).toBe("E2E-BULK");
  const redemption = service.db.prepare("SELECT released_reason FROM coupon_redemptions WHERE order_id=?").get(unpaid[0].id);
  expect(redemption.released_reason).toBe("CANCELLED");

  // Export the picked rows; a formula-like name is written as text.
  await row(csvOrder.id).check();
  await row(delivered.id).check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    bar.getByRole("button", { name: "ดาวน์โหลด CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("orders-selected.csv");
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.split("\r\n")).toHaveLength(3);
  expect(csv).toContain(delivered.id);
  expect(csv).toContain('"\'=HYPERLINK(1)"');
  expect(csv).not.toContain(',"=HYPERLINK');
  await expect(page.getByRole("status")).toContainText("ดาวน์โหลด 2 ออเดอร์แล้ว");
});

test("select all matching the filter stops at 100 and cancels them in one go", async ({ page }) => {
  const seed = service.createOrder(buyer, { variantId: READY, quantity: 1, requestKey: key() });
  cloneOrders(seed.id, 104); // 105 unpaid orders in the "รอชำระ" tab
  await as(page, adminToken);
  await page.goto(base + "/admin/orders?tab=pending");
  await page.getByRole("checkbox", { name: "เลือกออเดอร์ทั้งหมดที่แสดง" }).check();
  const bar = page.getByRole("region", { name: "จัดการออเดอร์ที่เลือก" });
  await expect(bar).toContainText("เลือก 50 ออเดอร์");
  await page.getByRole("button", { name: /เลือกทั้งหมดที่ตรงตัวกรอง 100 รายการ \(สูงสุด 100\)/ }).click();
  await expect(bar).toContainText("เลือก 100 ออเดอร์");
  await expect(page.locator(".order-bulk-all")).toContainText("จากทั้งหมด 105");
  // Resend has nothing to do for unpaid orders: the confirm button says so.
  await bar.getByRole("button", { name: "ส่งรหัสซ้ำ" }).click();
  const resend = page.getByRole("dialog", { name: "ยืนยันส่งรหัสซ้ำ" });
  await expect(resend.getByRole("button", { name: "ไม่มีออเดอร์ที่ทำรายการได้" })).toBeDisabled();
  await resend.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await bar.getByRole("button", { name: "ยกเลิกที่ยังไม่ชำระ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันยกเลิก" });
  await expect(dialog).toContainText("ระบบใช้ 100 รายการล่าสุดเท่านั้น");
  await dialog.getByRole("button", { name: "ยืนยันยกเลิก 100 ออเดอร์" }).click();
  await expect(page.getByRole("dialog", { name: "ผลการยกเลิก" }).getByLabel("สรุปจำนวน")).toContainText("ยกเลิกแล้ว100");
  await page.getByRole("button", { name: "เสร็จแล้ว" }).click();
  const left = service.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='PENDING_PAYMENT'").get().n;
  expect(left).toBe(5);
  await expect(page.locator(".order-bulk-table tbody tr")).toHaveCount(5);
});

test("staff resends picked delivered orders on a phone (390px), no cancel button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(page, staffToken);
  await page.goto(base + "/admin/orders?tab=delivered");
  await expect(page.locator(".order-bulk-table tbody tr").first()).toBeVisible();
  await page.getByRole("checkbox", { name: "เลือกออเดอร์ #" + delivered.id.slice(0, 8).toUpperCase() }).check();
  const bar = page.getByRole("region", { name: "จัดการออเดอร์ที่เลือก" });
  await expect(bar).toContainText("เลือก 1 ออเดอร์");
  await expect(bar.getByRole("button", { name: "ยกเลิกที่ยังไม่ชำระ" })).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "bulk-bar-390");
  await bar.getByRole("button", { name: "ส่งรหัสซ้ำ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันส่งรหัสซ้ำ" });
  await expect(dialog.getByLabel("สรุปจำนวน")).toContainText("ส่งได้1");
  expect(await noSideScroll(page)).toBe(true);
  const box = await dialog.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await shot(page, "bulk-resend-confirm-390");
  await dialog.getByRole("button", { name: "ยืนยันส่งรหัสซ้ำ 1 ออเดอร์" }).click();
  await expect(page.getByRole("dialog", { name: "ผลการส่งรหัสซ้ำ" }).getByLabel("สรุปจำนวน")).toContainText("ส่งแล้ว1");
  const resends = service.db
    .prepare("SELECT user_id FROM audit WHERE action='RESEND_CREDENTIALS' AND entity_id=?")
    .all(delivered.id);
  expect(resends).toHaveLength(1);
  expect(resends[0].user_id).toBe(service.session(staffToken).id);
  // Select-all on phones lives above the cards.
  await page.getByRole("button", { name: "เสร็จแล้ว" }).click();
  await page.locator(".order-select-all").click();
  await expect(bar).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  // STAFF cannot cancel over the API either.
  const res = await page.request.post(base + "/api/admin/orders/bulk", {
    headers: { "X-Astra-Request": "1", "Content-Type": "application/json" },
    data: { action: "cancel", ids: [delivered.id] },
  });
  expect(res.status()).toBe(403);
});
