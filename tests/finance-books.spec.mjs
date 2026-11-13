// การเงิน › ปิดยอดรายวัน / ถอนเงิน / กระทบยอด in the browser, at desktop and 390px:
// close a day with the password, late change → "ยอดเปลี่ยนหลังปิด" → adjustment, withdrawal with
// proof + cancel, CSV upload → mapping → auto match → manual match → complete.
import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createCommerce } from "../server/commerce.mjs";
import { createApp } from "../server/http.mjs";
import { ROLES } from "../server/auth-policy.mjs";

let server, service, base, admin, adminToken, staffToken, buyer;
const adminPassword = randomBytes(24).toString("hex");
const shots = process.env.FINANCE_SHOTS;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const bangkokDay = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(Date.now() - offset * 86400000));
const at = (day, hh, mm = 0) =>
  new Date(Date.parse(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`))
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
const yesterday = bangkokDay(1);
const paid = [];

test.describe.configure({ mode: "serial" });
test.setTimeout(60000);
test.beforeAll(async () => {
  service = createCommerce({ adminPassword });
  server = createApp(service, { production: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  adminToken = service.login({ email: "admin@astra.local", password: adminPassword }).token;
  admin = service.session(adminToken);
  service.setPaymentChannel(admin, { provider: "sandbox", active: true });
  service.importCodes(admin, {
    variantId: "stream-plus-30",
    items: Array.from({ length: 4 }, (_, i) => ({ loginId: `books-${i}-${randomUUID().slice(0, 6)}@example.invalid`, password: "pw" })),
  });
  const auth = service.register({ name: "Books Buyer", email: "books-buyer@example.invalid", password: "Books-buyer-Pass-123" });
  buyer = service.session(auth.token);
  for (const [hh, mm] of [
    [10, 0],
    [14, 30],
  ]) {
    const order = service.createOrder(buyer, { variantId: "stream-plus-30", quantity: 1, requestKey: "books-" + randomUUID() });
    service.pay(buyer, order.id, { paymentToken: order.paymentToken, outcome: "success" });
    service.db.prepare("UPDATE payments SET created_at=?, finalized_at=? WHERE order_id=?").run(at(yesterday, hh, mm), at(yesterday, hh, mm), order.id);
    paid.push(service.db.prepare("SELECT * FROM payments WHERE order_id=?").get(order.id));
  }
  const staffAuth = service.register({ name: "Books Staff", email: "books-staff@example.invalid", password: "Books-staff-Pass-123" });
  service.db.prepare("UPDATE users SET role=? WHERE id=?").run(ROLES.STAFF, staffAuth.user.id);
  staffToken = staffAuth.token;
  if (shots) mkdirSync(shots, { recursive: true });
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
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

test("daily close: sub-tabs, close with password, late change warning, adjustment, CSV, 390px", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/payments");
  const subnav = page.getByRole("navigation", { name: "เมนูย่อย" });
  for (const name of ["รายการเงิน", "ปิดยอดรายวัน", "กระทบยอด", "ถอนเงิน"]) await expect(subnav.getByRole("link", { name })).toBeVisible();
  await subnav.getByRole("link", { name: "ปิดยอดรายวัน" }).click();
  await expect(page).toHaveURL(base + "/admin/daily-close");
  await expect(page.getByRole("heading", { name: "ปิดยอดรายวัน" })).toBeVisible();
  await expect(page.locator(".test-money-banner")).toBeVisible();
  const row = page.locator(".finance-day-table tbody tr").nth(1);
  await expect(row).toContainText("ยังไม่ปิด");
  await expect(row).toContainText("+฿200.00");
  await expect(page.locator(".finance-day-table tbody tr").first()).toContainText("วันนี้");
  await shot(page, "daily-close-desktop");

  await row.click();
  const sheet = page.getByRole("dialog", { name: /ยอดวันที่/ });
  await expect(sheet).toContainText("รับชำระ");
  await expect(sheet).toContainText("เครดิตลูกค้า (หนี้สิน แยกจากเงินร้าน)");
  await shot(page, "daily-close-sheet");
  await sheet.getByRole("button", { name: "ปิดยอด", exact: true }).click();
  const dialog = page.locator(".finance-dialog");
  await dialog.getByLabel("หมายเหตุ (ไม่บังคับ)").fill("ตรวจกับ statement แล้ว");
  await dialog.getByLabel("รหัสผ่านของคุณ (ยืนยัน)").fill("wrong-password-123");
  await dialog.getByRole("button", { name: "ยืนยันปิดยอด" }).click();
  await expect(dialog.getByRole("alert")).toContainText("รหัสผ่านไม่ถูกต้อง");
  await dialog.getByLabel("รหัสผ่านของคุณ (ยืนยัน)").fill(adminPassword);
  await dialog.getByRole("button", { name: "ยืนยันปิดยอด" }).click();
  await expect(page.getByText(/ปิดยอดวันที่ .* แล้ว/)).toBeVisible();
  await expect(sheet).toContainText("ปิดแล้ว");
  await expect(sheet).toContainText("ตรวจกับ statement แล้ว");
  await page.keyboard.press("Escape");
  await expect(row).toContainText("ปิดแล้ว");

  // A late refund dated yesterday (e.g. recorded from the provider) changes the closed day.
  const order = service.db.prepare("SELECT order_id FROM payments WHERE id=?").get(paid[0].id).order_id;
  service.db
    .prepare(
      `INSERT INTO ledger(id,user_id,amount,reference,label,kind,direction,fee,net,status,order_id,created_at)
       VALUES(?,?,?,?,?,'REFUND','out',0,?,'SUCCEEDED',?,?)`,
    )
    .run(randomUUID(), buyer.id, 2500, "late-refund:" + randomUUID(), "คืนเงินย้อนหลัง", -2500, order, at(yesterday, 20));
  await page.reload();
  const callout = page.locator(".admin-callout.finance-changed");
  await expect(callout).toContainText("ยอดเปลี่ยนหลังปิด 1 วัน");
  await expect(row).toContainText("ยอดเปลี่ยนหลังปิด");
  await expect(row).toContainText("ต่าง −฿25.00");
  await shot(page, "daily-close-changed");
  await row.click();
  await expect(sheet).toContainText("ยอดตอนนี้");
  await sheet.getByRole("button", { name: /บันทึกปรับปรุง/ }).click();
  await dialog.getByLabel("เหตุผล").fill("คืนเงินลูกค้าย้อนหลัง");
  await dialog.getByLabel("รหัสผ่านของคุณ (ยืนยัน)").fill(adminPassword);
  await dialog.getByRole("button", { name: "บันทึกปรับปรุง" }).click();
  await expect(page.getByText("บันทึกปรับปรุงแล้ว")).toBeVisible();
  await expect(sheet).toContainText("บันทึกปรับปรุง −฿25.00 · คืนเงินลูกค้าย้อนหลัง");
  await page.keyboard.press("Escape");
  await expect(callout).toHaveCount(0);
  await expect(row).toContainText("ปิดแล้ว");

  const href = await page.getByRole("link", { name: "ดาวน์โหลด CSV" }).getAttribute("href");
  const csv = await page.request.get(base + href);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toMatch(/^day,status,opening/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(row).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "daily-close-390");
  await row.click();
  await expect(sheet).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "daily-close-sheet-390");
});

test("withdrawals: record with proof and password, masked account, cancel with reason, 390px", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/withdrawals");
  await expect(page.getByRole("heading", { name: "ถอนเงิน" })).toBeVisible();
  await expect(page.getByText("ยังไม่มีการถอนเงินในช่วงนี้")).toBeVisible();
  await page.getByRole("button", { name: "บันทึกการถอน" }).click();
  const dialog = page.locator(".finance-dialog");
  await dialog.getByLabel("ยอดถอน (บาท)").fill("1,250.50");
  await dialog.getByLabel("ธนาคารปลายทาง").fill("กสิกรไทย");
  await dialog.getByLabel("เลขบัญชีปลายทาง").fill("123-4-56789-0");
  await dialog.getByLabel("เลขอ้างอิงการโอน (ไม่บังคับ)").fill("KB-TRF-889");
  await dialog.getByLabel("หลักฐาน (รูป ไม่บังคับ)").setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: PNG });
  await dialog.getByLabel("รหัสผ่านของคุณ (ยืนยัน)").fill(adminPassword);
  await shot(page, "withdrawal-form");
  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกการถอนแล้ว")).toBeVisible();
  const row = page.locator(".admin-list-table tbody tr").first();
  await expect(row).toContainText("฿1,250.50");
  await expect(row).toContainText("••••7890");
  await expect(row).not.toContainText("56789");
  await expect(row.getByRole("link", { name: "หลักฐาน" })).toBeVisible();
  await expect(page.locator(".finance-stats")).toContainText("฿1,250.50");
  const proof = await page.request.get(base + (await row.getByRole("link", { name: "หลักฐาน" }).getAttribute("href")));
  expect(proof.status()).toBe(200);
  expect(proof.headers()["content-type"]).toBe("image/png");
  await shot(page, "withdrawals-desktop");

  await row.getByRole("button", { name: "ยกเลิก" }).click();
  await dialog.getByLabel("เหตุผลที่ยกเลิก").fill("บันทึกยอดผิด");
  await dialog.getByLabel("รหัสผ่านของคุณ (ยืนยัน)").fill(adminPassword);
  await dialog.getByRole("button", { name: "ยืนยันยกเลิก" }).click();
  await expect(page.getByText("ยกเลิกรายการถอนแล้ว")).toBeVisible();
  await expect(row).toContainText("ยกเลิกแล้ว");
  await expect(row).toContainText("บันทึกยอดผิด");
  await expect(page.locator(".finance-stats")).toContainText("ถอนสุทธิ เดือนนี้฿0.00");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(row).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "withdrawals-390");
  await page.getByRole("button", { name: "บันทึกการถอน" }).click();
  await expect(dialog).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "withdrawal-form-390");
});

test("reconciliation: upload CSV, mapping, auto match, manual match with note, complete, 390px", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/reconcile");
  await expect(page.getByRole("heading", { name: "กระทบยอด", exact: true })).toBeVisible();
  await expect(page.getByText("ยังไม่เคยกระทบยอด")).toBeVisible();
  const [y, m, d] = yesterday.split("-");
  const thaiDate = `${d}/${m}/${Number(y) + 543}`;
  const csv = [
    "วันที่,เวลา,ถอน,ฝาก,รายละเอียด",
    `${thaiDate},10:01,,100.00,${paid[0].provider_ref}`,
    `${thaiDate},14:40,,99.00,=HYPERLINK("http://evil")`,
    `${thaiDate},18:00,,350.00,โอนเข้าไม่ทราบที่มา`,
    `${thaiDate},19:00,500.00,,ถอนออก`,
  ].join("\n");
  await page.getByLabel("ไฟล์ CSV").setInputFiles({ name: "kbank-yesterday.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("พบ 4 แถว")).toBeVisible();
  await expect(page.getByLabel("วันที่", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("เวลา (ถ้าแยกคอลัมน์)")).toHaveValue("1");
  await expect(page.getByLabel("ยอดเงินเข้า")).toHaveValue("3");
  await expect(page.getByLabel("เลขอ้างอิง")).toHaveValue("4");
  await shot(page, "recon-mapping");
  await page.getByRole("button", { name: "เริ่มกระทบยอด" }).click();
  await expect(page.getByRole("heading", { name: "kbank-yesterday.csv" })).toBeVisible();
  await expect(page.getByText(/ข้าม 1 แถว/)).toBeVisible();
  const stats = page.locator(".recon-stats");
  await expect(stats.locator(".recon-stat-matched")).toContainText("1");
  await expect(stats.locator(".recon-stat-statement_only")).toContainText("2");
  await expect(stats.locator(".recon-stat-system_only")).toContainText("1");
  await shot(page, "recon-run");
  const rowOf = (line) => page.locator(".recon-table tbody tr").filter({ has: page.locator("td:first-child", { hasText: new RegExp("^" + line + "$") }) });
  await expect(rowOf(2)).toContainText("ตรงกัน");
  await expect(rowOf(2)).toContainText("เลขอ้างอิง");
  await expect(rowOf(3)).toContainText('=HYPERLINK("http://evil")');

  await rowOf(3).getByRole("button", { name: "จับคู่" }).click();
  const dialog = page.locator(".finance-dialog");
  await dialog.locator(".recon-candidate").first().click();
  await dialog.getByLabel("หมายเหตุ (บังคับ)").fill("ลูกค้าโอนขาด 1 บาท");
  await dialog.getByRole("button", { name: "จับคู่", exact: true }).click();
  await expect(page.getByText("จับคู่แล้ว")).toBeVisible();
  await expect(rowOf(3)).toContainText("ยอดไม่ตรง");
  await expect(rowOf(3)).toContainText("ต่าง −฿1.00");
  await expect(stats.locator(".recon-stat-system_only")).toContainText("0");
  await expect(page.locator(".recon-history")).toContainText("จับคู่ แถว 3 · ลูกค้าโอนขาด 1 บาท");

  await stats.locator(".recon-stat-statement_only").click();
  await expect(page.locator(".recon-table tbody tr")).toHaveCount(1);
  await stats.locator(".recon-stat-statement_only").click();

  const exported = await page.request.get(base + (await page.getByRole("link", { name: "CSV" }).getAttribute("href")));
  const text = await exported.text();
  expect(text).toContain("\"'=HYPERLINK");
  expect(text).not.toMatch(/(^|,)=HYPERLINK/m);

  await page.getByRole("button", { name: "ตรวจเสร็จ" }).click();
  await dialog.getByRole("button", { name: "ยืนยันตรวจเสร็จ" }).click();
  await expect(page.locator(".recon-done")).toContainText("ตรวจเสร็จแล้ว");
  await expect(page.locator(".recon-table").getByRole("button", { name: /จับคู่|ยกเลิกคู่/ })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "recon-run-390");
  await page.getByRole("button", { name: "รอบกระทบยอดทั้งหมด" }).click();
  await expect(page.locator(".admin-list-table tbody tr").first()).toContainText("ตรวจเสร็จ");
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "recon-list-390");
  // Payments were never changed by reconciliation.
  for (const p of paid) expect(service.db.prepare("SELECT status, amount FROM payments WHERE id=?").get(p.id)).toEqual({ status: "SUCCEEDED", amount: p.amount });
});

test("dark theme keeps the finance pages readable; STAFF gets 403 and no finance menu", async ({ page }) => {
  await as(page, adminToken);
  await page.goto(base + "/admin/daily-close");
  await page.evaluate(() => localStorage.setItem("asiax-mode", "dark"));
  await page.reload();
  const card = page.locator(".finance-stats .reference-admin-card").first();
  await expect(card).toBeVisible();
  const colors = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, fg: s.color };
  });
  expect(colors.fg).not.toBe(colors.bg);
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, "daily-close-dark");
  await page.evaluate(() => localStorage.removeItem("asiax-mode"));

  await as(page, staffToken);
  for (const path of ["/api/admin/finance/days", "/api/admin/finance/withdrawals", "/api/admin/finance/reconciliations"]) {
    const res = await page.request.get(base + path);
    expect(res.status()).toBe(403);
  }
  await page.goto(base + "/admin/orders");
  await expect(page.locator(".reference-primary-nav")).not.toContainText("การเงิน");
});
