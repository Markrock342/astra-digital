/**
 * ใบเสร็จคำสั่งซื้อ — customer requests a printable order receipt; staff approve before download.
 * Separate from tax-invoices.mjs (ใบกำกับภาษี). Print/PDF stays browser-side (window.print).
 *
 * Rules:
 *   - Window: 7 days from order paid_at (success time).
 *   - Status: PENDING | APPROVED | REJECTED (UI: ส่งคำขอ / อนุมัติ / ไม่อนุมัติ).
 *   - APPROVED once per order — no re-request.
 *   - REJECTED may re-request while still inside the same 7-day window.
 *   - receipt_profiles: many saved buyer blocks per customer account.
 */
import { randomUUID } from "node:crypto";
import { BUYER_TYPES, normalizeBuyer, HEAD_OFFICE, branchLabel } from "./tax-invoices.mjs";

export const RECEIPT_REQUEST_WINDOW_MS = 7 * 24 * 3600 * 1000;
export const RECEIPT_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

const PROVIDER_LABELS = Object.freeze({
  sandbox: "ชำระทดลอง",
  slipok: "สลิปโอน",
  gateway: "ชำระผ่านเกตเวย์",
  wallet: "เครดิตร้าน",
  unset: "ไม่ระบุช่องทาง",
});

const MANUAL_LABELS = Object.freeze({
  OFFSITE_TRANSFER: "โอนนอกเว็บ",
});

const dbTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

const text = (value, max, label, fail, { required = false, min = 1 } = {}) => {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") fail(400, label + "ไม่ถูกต้อง");
  let v = value.replace(/\r\n?/g, "\n");
  // eslint-disable-next-line no-control-regex
  v = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim();
  if (!v) {
    if (required) fail(400, "กรุณากรอก" + label);
    return "";
  }
  if (v.length < min) fail(400, label + "สั้นเกินไป");
  if (v.length > max) fail(400, label + "ยาวเกิน " + max + " ตัวอักษร");
  return v;
};

function parseDbTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (/^\d{13}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Human payment channel for the printable receipt (all order types). */
export function paymentMethodLabelForOrder({ one }, row) {
  const manual = one("SELECT method FROM manual_orders WHERE id=?", row.id);
  if (manual?.method) return MANUAL_LABELS[manual.method] ?? String(manual.method);
  const column = row.preorder ? "reservation_id" : "order_id";
  const pay = one(
    `SELECT provider FROM payments WHERE ${column}=? AND status='SUCCEEDED'
     ORDER BY COALESCE(finalized_at, created_at) DESC LIMIT 1`,
    row.id,
  );
  if (pay?.provider) return PROVIDER_LABELS[pay.provider] ?? String(pay.provider);
  return null;
}

export function createOrderReceipts({
  one,
  all,
  run,
  fail,
  clock = () => Date.now(),
  requireUser,
  requireStaff,
  requireAdmin,
  isAdmin,
  notify,
}) {
  const auditDetail = (userId, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      userId ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  const notifyStaffRoles = (kind, title, body, link) => {
    for (const staff of all(
      "SELECT id FROM users WHERE role IN ('STAFF','ADMIN') AND COALESCE(status,'ACTIVE')='ACTIVE'",
    ))
      notify?.(staff.id, kind, title, body, link);
  };

  function loadOrderRow(orderId) {
    const select = (table) =>
      one(
        `SELECT o.*, p.name AS product, v.label AS option_label
         FROM ${table} o JOIN variants v ON v.id=o.variant_id JOIN products p ON p.id=v.product_id
         WHERE o.id=?`,
        orderId,
      );
    const order = select("orders");
    if (order) return { ...order, preorder: false };
    const reservation = select("reservations");
    return reservation ? { ...reservation, preorder: true } : null;
  }

  function successAtMs(row) {
    const column = row.preorder ? "reservation_id" : "order_id";
    const paid = one(
      `SELECT MIN(COALESCE(finalized_at, created_at)) AS at FROM payments
       WHERE ${column}=? AND status='SUCCEEDED'`,
      row.id,
    )?.at;
    const fromPay = parseDbTime(paid);
    if (fromPay != null) return fromPay;
    if (row.status === "DELIVERED" || row.status === "PREORDER") {
      return parseDbTime(row.created_at) ?? clock();
    }
    return null;
  }

  function windowState(row, now = clock()) {
    const start = successAtMs(row);
    if (start == null) {
      return {
        eligible: false,
        reason: "ออเดอร์ยังไม่ชำระสำเร็จ จึงยังขอใบเสร็จไม่ได้",
        successAt: null,
        expiresAt: null,
        remainingMs: 0,
      };
    }
    const expiresAt = start + RECEIPT_REQUEST_WINDOW_MS;
    const remainingMs = Math.max(0, expiresAt - now);
    if (now > expiresAt) {
      return {
        eligible: false,
        reason: "หมดเวลายื่นคำขอใบเสร็จแล้ว (ภายใน 7 วันหลังสั่งซื้อสำเร็จ)",
        successAt: dbTime(start),
        expiresAt: dbTime(expiresAt),
        remainingMs: 0,
      };
    }
    return {
      eligible: true,
      reason: null,
      successAt: dbTime(start),
      expiresAt: dbTime(expiresAt),
      remainingMs,
    };
  }

  function buyerPublic(row) {
    if (!row) return null;
    return {
      type: row.buyer_type,
      name: row.buyer_name,
      taxId: row.buyer_tax_id,
      branch: row.buyer_branch,
      branchLabel: branchLabel(row.buyer_branch),
      address: row.buyer_address,
    };
  }

  function requestPublic(row) {
    if (!row) return null;
    return {
      orderId: row.order_id,
      preorder: !!row.preorder,
      status: row.status,
      statusLabel:
        row.status === "PENDING" ? "ส่งคำขอ" : row.status === "APPROVED" ? "อนุมัติ" : "ไม่อนุมัติ",
      reason: row.reason ?? null,
      buyer: buyerPublic(row),
      profileId: row.profile_id ?? null,
      requestedAt: row.requested_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at ?? null,
    };
  }

  function profilePublic(row) {
    return {
      id: row.id,
      label: row.label,
      type: row.buyer_type,
      name: row.buyer_name,
      taxId: row.buyer_tax_id,
      branch: row.buyer_branch,
      branchLabel: branchLabel(row.buyer_branch),
      address: row.buyer_address,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listReceiptProfiles(user) {
    requireUser(user);
    return {
      profiles: all(
        "SELECT * FROM receipt_profiles WHERE user_id=? ORDER BY updated_at DESC, created_at DESC",
        user.id,
      ).map(profilePublic),
    };
  }

  function saveReceiptProfile(user, input = {}, id = null) {
    requireUser(user);
    if (user.role !== "CUSTOMER" && !isAdmin(user)) fail(403, "ใช้ได้เฉพาะบัญชีลูกค้า");
    const label = text(input.label ?? "ข้อมูลใบเสร็จ", 80, "ชื่อโปรไฟล์", fail, { required: true, min: 1 });
    const buyer = normalizeBuyer(input, fail);
    const now = dbTime(clock());
    if (id) {
      const existing = one("SELECT * FROM receipt_profiles WHERE id=? AND user_id=?", id, user.id);
      if (!existing) fail(404, "ไม่พบข้อมูลใบเสร็จ");
      run(
        `UPDATE receipt_profiles SET label=?, buyer_type=?, buyer_name=?, buyer_tax_id=?, buyer_branch=?,
         buyer_address=?, updated_at=? WHERE id=?`,
        label,
        buyer.type,
        buyer.name,
        buyer.taxId,
        buyer.branch,
        buyer.address,
        now,
        id,
      );
      return profilePublic(one("SELECT * FROM receipt_profiles WHERE id=?", id));
    }
    const newId = randomUUID();
    run(
      `INSERT INTO receipt_profiles(id,user_id,label,buyer_type,buyer_name,buyer_tax_id,buyer_branch,buyer_address,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      newId,
      user.id,
      label,
      buyer.type,
      buyer.name,
      buyer.taxId,
      buyer.branch,
      buyer.address,
      now,
      now,
    );
    return profilePublic(one("SELECT * FROM receipt_profiles WHERE id=?", newId));
  }

  function deleteReceiptProfile(user, id) {
    requireUser(user);
    const existing = one("SELECT id FROM receipt_profiles WHERE id=? AND user_id=?", id, user.id);
    if (!existing) fail(404, "ไม่พบข้อมูลใบเสร็จ");
    run("DELETE FROM receipt_profiles WHERE id=?", id);
    return { ok: true };
  }

  function resolveBuyerFromInput(user, input = {}) {
    if (input.profileId) {
      const profile = one(
        "SELECT * FROM receipt_profiles WHERE id=? AND user_id=?",
        String(input.profileId),
        user.id,
      );
      if (!profile) fail(404, "ไม่พบโปรไฟล์ใบเสร็จ");
      return {
        profileId: profile.id,
        buyer: {
          type: profile.buyer_type,
          name: profile.buyer_name,
          taxId: profile.buyer_tax_id,
          branch: profile.buyer_branch,
          address: profile.buyer_address,
        },
      };
    }
    return { profileId: null, buyer: normalizeBuyer(input, fail) };
  }

  function orderReceiptState(user, orderId) {
    requireUser(user);
    const row = loadOrderRow(orderId);
    if (!row || row.user_id !== user.id) fail(404, "ไม่พบคำสั่งซื้อ");
    const existing = one("SELECT * FROM order_receipt_requests WHERE order_id=?", row.id);
    const window = windowState(row);
    let canRequest = false;
    let canDownload = existing?.status === "APPROVED";
    if (!existing) canRequest = window.eligible;
    else if (existing.status === "REJECTED") canRequest = window.eligible;
    else canRequest = false;
    return {
      orderId: row.id,
      preorder: !!row.preorder,
      request: requestPublic(existing),
      window,
      canRequest,
      canDownload,
      downloadBlockedReason: canDownload
        ? null
        : existing?.status === "PENDING"
          ? "คำขอใบเสร็จรอทีมงานอนุมัติ"
          : existing?.status === "REJECTED"
            ? "คำขอใบเสร็จไม่ได้รับการอนุมัติ" + (existing.reason ? " — " + existing.reason : "")
            : window.eligible
              ? "ยังไม่ได้ส่งคำขอใบเสร็จ"
              : window.reason,
    };
  }

  function requestOrderReceipt(user, orderId, input = {}) {
    requireUser(user);
    if (user.role !== "CUSTOMER" && !isAdmin(user)) fail(403, "ใช้ได้เฉพาะเจ้าของออเดอร์");
    const row = loadOrderRow(orderId);
    if (!row || row.user_id !== user.id) fail(404, "ไม่พบคำสั่งซื้อ");
    const existing = one("SELECT * FROM order_receipt_requests WHERE order_id=?", row.id);
    if (existing?.status === "APPROVED") fail(409, "ออเดอร์นี้มีใบเสร็จที่อนุมัติแล้ว ขอใหม่ไม่ได้");
    if (existing?.status === "PENDING") fail(409, "มีคำขอใบเสร็จรอดำเนินการอยู่แล้ว");
    const window = windowState(row);
    if (!window.eligible) fail(409, window.reason);
    const { profileId, buyer } = resolveBuyerFromInput(user, input);
    const now = dbTime(clock());
    if (existing) {
      run(
        `UPDATE order_receipt_requests SET status='PENDING', profile_id=?, buyer_type=?, buyer_name=?,
         buyer_tax_id=?, buyer_branch=?, buyer_address=?, reason=NULL, requested_at=?, updated_at=?,
         resolved_at=NULL, resolved_by=NULL WHERE order_id=?`,
        profileId,
        buyer.type,
        buyer.name,
        buyer.taxId,
        buyer.branch,
        buyer.address,
        now,
        now,
        row.id,
      );
    } else {
      run(
        `INSERT INTO order_receipt_requests(
           order_id,preorder,user_id,status,profile_id,buyer_type,buyer_name,buyer_tax_id,buyer_branch,
           buyer_address,reason,requested_at,updated_at,resolved_at,resolved_by
         ) VALUES(?,?,?,'PENDING',?,?,?,?,?,?,NULL,?,?,NULL,NULL)`,
        row.id,
        row.preorder ? 1 : 0,
        user.id,
        profileId,
        buyer.type,
        buyer.name,
        buyer.taxId,
        buyer.branch,
        buyer.address,
        now,
        now,
      );
    }
    auditDetail(user.id, "ORDER_RECEIPT_REQUEST", row.id, { profileId });
    notifyStaffRoles(
      "order_receipt",
      "คำขอใบเสร็จคำสั่งซื้อ",
      "ออเดอร์ #" + row.id.slice(0, 8).toUpperCase() + " รออนุมัติใบเสร็จ",
      "/admin/order-receipts",
    );
    return orderReceiptState(user, row.id);
  }

  function assertCustomerDownload(user, orderId) {
    const state = orderReceiptState(user, orderId);
    if (!state.canDownload) fail(403, state.downloadBlockedReason || "ยังดาวน์โหลดใบเสร็จไม่ได้");
    return state;
  }

  function adminOrderReceipts(user, { status = "PENDING" } = {}) {
    requireStaff(user);
    const st = String(status || "PENDING").toUpperCase();
    if (!RECEIPT_REQUEST_STATUSES.includes(st)) fail(400, "สถานะไม่ถูกต้อง");
    const rows = all(
      `SELECT r.*, u.name AS customer_name, u.email AS customer_email
       FROM order_receipt_requests r
       JOIN users u ON u.id=r.user_id
       WHERE r.status=?
       ORDER BY r.requested_at ASC`,
      st,
    );
    return {
      status: st,
      requests: rows.map((row) => ({
        ...requestPublic(row),
        customerName: row.customer_name,
        customerEmail: row.customer_email && !String(row.customer_email).endsWith(".local")
          ? row.customer_email
          : "",
      })),
    };
  }

  function adminOrderReceiptRequest(user, orderId) {
    requireStaff(user);
    const row = loadOrderRow(orderId);
    if (!row) fail(404, "ไม่พบคำสั่งซื้อ");
    const existing = one("SELECT * FROM order_receipt_requests WHERE order_id=?", row.id);
    return {
      orderId: row.id,
      preorder: !!row.preorder,
      customerId: row.user_id,
      request: requestPublic(existing),
      window: windowState(row),
    };
  }

  function adminApproveOrderReceipt(user, orderId) {
    requireAdmin(user);
    const existing = one("SELECT * FROM order_receipt_requests WHERE order_id=?", orderId);
    if (!existing) fail(404, "ไม่พบคำขอใบเสร็จ");
    if (existing.status !== "PENDING") fail(409, "คำขอนี้ไม่อยู่ในสถานะรออนุมัติ");
    const now = dbTime(clock());
    run(
      `UPDATE order_receipt_requests SET status='APPROVED', reason=NULL, resolved_at=?, resolved_by=?, updated_at=?
       WHERE order_id=?`,
      now,
      user.id,
      now,
      orderId,
    );
    auditDetail(user.id, "ORDER_RECEIPT_APPROVE", orderId, null);
    notify(
      existing.user_id,
      "order_receipt",
      "อนุมัติใบเสร็จคำสั่งซื้อแล้ว",
      "ดาวน์โหลดหรือพิมพ์ใบเสร็จออเดอร์ #" + orderId.slice(0, 8).toUpperCase() + " ได้แล้ว",
      "/orders/" + orderId + "/receipt",
    );
    return adminOrderReceiptRequest(user, orderId);
  }

  function adminRejectOrderReceipt(user, orderId, input = {}) {
    requireAdmin(user);
    const existing = one("SELECT * FROM order_receipt_requests WHERE order_id=?", orderId);
    if (!existing) fail(404, "ไม่พบคำขอใบเสร็จ");
    if (existing.status !== "PENDING") fail(409, "คำขอนี้ไม่อยู่ในสถานะรออนุมัติ");
    const reason = text(input.reason ?? "", 400, "เหตุผล", fail, { required: true, min: 3 });
    const now = dbTime(clock());
    run(
      `UPDATE order_receipt_requests SET status='REJECTED', reason=?, resolved_at=?, resolved_by=?, updated_at=?
       WHERE order_id=?`,
      reason,
      now,
      user.id,
      now,
      orderId,
    );
    auditDetail(user.id, "ORDER_RECEIPT_REJECT", orderId, { reason });
    notify(
      existing.user_id,
      "order_receipt",
      "คำขอใบเสร็จไม่ได้รับการอนุมัติ",
      reason,
      "/orders/" + orderId,
    );
    return adminOrderReceiptRequest(user, orderId);
  }

  /** Snapshot buyer for the printable short receipt when approved. */
  function receiptExtras(row) {
    const req = one(
      "SELECT * FROM order_receipt_requests WHERE order_id=? AND status='APPROVED'",
      row.id,
    );
    if (!req) return {};
    return {
      buyer: {
        type: req.buyer_type,
        name: req.buyer_name,
        taxId: req.buyer_tax_id,
        branch: req.buyer_branch,
        branchLabel: branchLabel(req.buyer_branch ?? HEAD_OFFICE),
        address: req.buyer_address,
      },
      orderReceiptApproved: true,
    };
  }

  return {
    listReceiptProfiles,
    createReceiptProfile: (user, input) => saveReceiptProfile(user, input, null),
    updateReceiptProfile: (user, id, input) => saveReceiptProfile(user, input, id),
    deleteReceiptProfile,
    orderReceiptState,
    requestOrderReceipt,
    assertCustomerDownload,
    adminOrderReceipts,
    adminOrderReceiptRequest,
    adminApproveOrderReceipt,
    adminRejectOrderReceipt,
    receiptExtras,
    paymentMethodLabelForOrder: (row) => paymentMethodLabelForOrder({ one }, row),
    windowState,
    successAtMs,
    BUYER_TYPES,
  };
}

const PROFILE = /^\/api\/account\/receipt-profiles(?:\/([^/]+))?$/;
const MY_ORDER = /^\/api\/orders\/([^/]+)\/order-receipt$/;
const ADMIN_LIST = "/api/admin/order-receipts";
const ADMIN_ONE = /^\/api\/admin\/orders\/([^/]+)\/order-receipt$/;
const ADMIN_ACTION = /^\/api\/admin\/orders\/([^/]+)\/order-receipt\/(approve|reject)$/;

export function routeOrderReceipts(service, { method, path, user, input, url }) {
  if (
    !path.includes("receipt-profile") &&
    !path.includes("order-receipt") &&
    path !== ADMIN_LIST
  )
    return null;
  let m;
  if (method === "GET") {
    if (path === "/api/account/receipt-profiles") return [200, service.listReceiptProfiles(user)];
    if ((m = MY_ORDER.exec(path))) return [200, service.orderReceiptState(user, m[1])];
    if (path === ADMIN_LIST)
      return [
        200,
        service.adminOrderReceipts(user, {
          status: url?.searchParams?.get("status") ?? "PENDING",
        }),
      ];
    if ((m = ADMIN_ONE.exec(path))) return [200, service.adminOrderReceiptRequest(user, m[1])];
    return null;
  }
  if (method === "POST") {
    if (path === "/api/account/receipt-profiles") return [200, service.createReceiptProfile(user, input)];
    if ((m = MY_ORDER.exec(path))) return [200, service.requestOrderReceipt(user, m[1], input)];
    if ((m = ADMIN_ACTION.exec(path))) {
      if (m[2] === "approve") return [200, service.adminApproveOrderReceipt(user, m[1])];
      return [200, service.adminRejectOrderReceipt(user, m[1], input)];
    }
    return null;
  }
  if (method === "PUT" || method === "PATCH") {
    if ((m = PROFILE.exec(path)) && m[1])
      return [200, service.updateReceiptProfile(user, m[1], input)];
    return null;
  }
  if (method === "DELETE") {
    if ((m = PROFILE.exec(path)) && m[1]) return [200, service.deleteReceiptProfile(user, m[1])];
    return null;
  }
  return null;
}
