/** FR-S4 team accounts (ADMIN or STAFF) and FR-M1 chat assignment.
 * Admins can add admins and change roles. Guards: nobody changes their own role or
 * account, the owner login (re-promoted from the env secret on every start) stays
 * an active admin, and the shop always keeps at least one active admin. */
import { randomBytes, randomUUID } from "node:crypto";

export function createTeamApis({ ownerEmail = "admin@astra.local", passwordHash, requireAdmin, requireStaff, one, all, run, tx, fail, clean, notify, confirmPassword }) {
  const auditDetail = (user, action, entity, detail) =>
    run(
      "INSERT INTO audit(user_id,action,entity_id,detail) VALUES(?,?,?,?)",
      user?.id ?? null,
      action,
      entity ?? null,
      detail == null ? null : JSON.stringify(detail),
    );
  const temporaryPassword = () => {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    return Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join("");
  };
  const member = (row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: (row.status ?? "ACTIVE") === "ACTIVE",
    owner: row.email === ownerEmail,
    created_at: row.created_at,
  });
  const TEAM_ROLES = ["ADMIN", "STAFF"];
  const pickRole = (raw, fallback) => {
    if (raw == null || raw === "") return fallback;
    if (!TEAM_ROLES.includes(raw)) fail(400, "สิทธิ์ไม่ถูกต้อง");
    return raw;
  };
  const activeAdmins = () =>
    one("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN' AND COALESCE(status,'ACTIVE')='ACTIVE'").n;
  // Rows the acting admin may demote or suspend.
  function guardChange(user, row) {
    if (row.id === user.id) fail(400, "เปลี่ยนสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้");
    if (row.email === ownerEmail) fail(400, "บัญชีเจ้าของร้านเปลี่ยนสิทธิ์หรือปิดไม่ได้");
  }

  function team(user) {
    requireStaff(user);
    return all(
      "SELECT id,name,email,role,status,created_at FROM users WHERE role IN ('ADMIN','STAFF') ORDER BY role, created_at",
    ).map(member);
  }

  function saveStaff(user, input = {}) {
    requireAdmin(user);
    const name = clean(input.name, 2, 60, "ชื่อ");
    // Creating an admin or granting admin rights needs the acting admin's password again.
    // Checked before the transaction so a wrong password still counts toward the lockout.
    const existingRole = input.id
      ? one("SELECT role FROM users WHERE id=? AND role IN ('ADMIN','STAFF')", String(input.id))?.role
      : null;
    const makesAdmin = pickRole(input.role, existingRole ?? "STAFF") === "ADMIN" && existingRole !== "ADMIN";
    if (makesAdmin) confirmPassword(user, input.currentPassword);
    return tx(() => {
      if (input.id) {
        const row = one("SELECT * FROM users WHERE id=? AND role IN ('ADMIN','STAFF')", clean(input.id, 1, 80, "ทีมงาน"));
        if (!row) fail(404, "ไม่พบทีมงาน");
        const role = pickRole(input.role, row.role);
        if (role !== row.role) {
          guardChange(user, row);
          if (role === "ADMIN" && !makesAdmin) fail(409, "ข้อมูลทีมงานเปลี่ยนระหว่างทำรายการ กรุณาลองใหม่");
          if (row.role === "ADMIN" && (row.status ?? "ACTIVE") === "ACTIVE" && activeAdmins() <= 1)
            fail(409, "ต้องมีแอดมินที่ใช้งานอยู่อย่างน้อย 1 คน");
        }
        run("UPDATE users SET name=?,role=? WHERE id=?", name, role, row.id);
        auditDetail(user, "STAFF_UPDATE", row.id, { name });
        if (role !== row.role) auditDetail(user, "TEAM_ROLE", row.id, { from: row.role, to: role });
        return { member: member(one("SELECT * FROM users WHERE id=?", row.id)) };
      }
      const email = clean(input.email, 5, 160, "อีเมล").toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "อีเมลไม่ถูกต้อง");
      if (one("SELECT id FROM users WHERE email=?", email)) fail(409, "อีเมลนี้มีบัญชีแล้ว");
      const role = pickRole(input.role, "STAFF");
      if (role === "ADMIN" && !makesAdmin) fail(409, "ข้อมูลทีมงานเปลี่ยนระหว่างทำรายการ กรุณาลองใหม่");
      const id = randomUUID();
      const password = temporaryPassword();
      run(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,?)",
        id,
        email,
        name,
        passwordHash(password),
        role,
      );
      auditDetail(user, "STAFF_CREATE", id, { email, role });
      return { member: member(one("SELECT * FROM users WHERE id=?", id)), temporaryPassword: password };
    });
  }

  /** Grant or remove team rights on any existing account, including a customer who
   * signed up on the storefront. CUSTOMER means "back to a normal customer". Orders,
   * credit and chat history stay with the account. */
  function setMemberRole(user, id, input = {}) {
    requireAdmin(user);
    const role = input.role;
    if (!["ADMIN", "STAFF", "CUSTOMER"].includes(role)) fail(400, "สิทธิ์ไม่ถูกต้อง");
    // Granting admin rights needs the acting admin's password again (outside the tx so a
    // wrong password still counts toward the lockout).
    const target = one("SELECT role FROM users WHERE id=?", String(id ?? ""));
    if (role === "ADMIN" && target && target.role !== "ADMIN") confirmPassword(user, input.currentPassword);
    return tx(() => {
      const row = one("SELECT * FROM users WHERE id=?", clean(id, 1, 80, "บัญชี"));
      if (!row) fail(404, "ไม่พบบัญชี");
      if (row.role === role) return { member: member(row) };
      guardChange(user, row);
      if ((row.status ?? "ACTIVE") !== "ACTIVE") fail(409, "บัญชีนี้ถูกระงับอยู่ เปิดบัญชีก่อนจึงเปลี่ยนสิทธิ์ได้");
      if (row.role === "ADMIN" && activeAdmins() <= 1) fail(409, "ต้องมีแอดมินที่ใช้งานอยู่อย่างน้อย 1 คน");
      run("UPDATE users SET role=? WHERE id=?", role, row.id);
      if (role === "CUSTOMER") run("UPDATE chat_threads SET assigned_to=NULL WHERE assigned_to=?", row.id);
      auditDetail(user, "TEAM_ROLE", row.id, { from: row.role, to: role });
      const label = { ADMIN: "แอดมิน", STAFF: "ทีมงาน" }[role];
      if (label)
        notify(row.id, "team", "คุณได้รับสิทธิ์" + label, user.name + " เพิ่มคุณเป็น" + label + " เข้าหลังบ้านได้ที่เมนูบัญชี");
      return { member: member(one("SELECT * FROM users WHERE id=?", row.id)) };
    });
  }

  function setStaffActive(user, id, input = {}) {
    requireAdmin(user);
    return tx(() => {
      const row = one("SELECT * FROM users WHERE id=? AND role IN ('ADMIN','STAFF')", clean(id, 1, 80, "ทีมงาน"));
      if (!row) fail(404, "ไม่พบทีมงาน");
      const active = input.active === true;
      if (!active) {
        guardChange(user, row);
        if (row.role === "ADMIN" && (row.status ?? "ACTIVE") === "ACTIVE" && activeAdmins() <= 1)
          fail(409, "ต้องมีแอดมินที่ใช้งานอยู่อย่างน้อย 1 คน");
      }
      run("UPDATE users SET status=?,status_changed_at=CURRENT_TIMESTAMP,status_changed_by=? WHERE id=?", active ? "ACTIVE" : "SUSPENDED", user.id, row.id);
      if (!active) {
        run("DELETE FROM sessions WHERE user_id=?", row.id);
        run("UPDATE chat_threads SET assigned_to=NULL WHERE assigned_to=?", row.id);
      }
      auditDetail(user, active ? "STAFF_ENABLE" : "STAFF_DISABLE", row.id, null);
      return { member: member(one("SELECT * FROM users WHERE id=?", row.id)) };
    });
  }

  function assignChatThread(user, threadId, input = {}) {
    requireStaff(user);
    const id = clean(threadId, 1, 80, "แชท");
    return tx(() => {
      const thread = one("SELECT * FROM chat_threads WHERE id=?", id);
      if (!thread) fail(404, "ไม่พบแชท");
      let assignee = null;
      if (input.assigneeId) {
        assignee = one(
          "SELECT * FROM users WHERE id=? AND role IN ('ADMIN','STAFF') AND COALESCE(status,'ACTIVE')='ACTIVE'",
          clean(input.assigneeId, 1, 80, "ผู้รับผิดชอบ"),
        );
        if (!assignee) fail(400, "ผู้รับผิดชอบไม่ถูกต้อง");
      }
      run("UPDATE chat_threads SET assigned_to=? WHERE id=?", assignee?.id ?? null, id);
      if (assignee && assignee.id !== user.id)
        notify(assignee.id, "chat_assigned", "มีแชทมอบหมายให้คุณ", user.name + " มอบหมายแชทให้คุณดูแล");
      auditDetail(user, "CHAT_ASSIGN", id, { to: assignee?.name ?? null });
      return one(
        "SELECT t.*,a.name AS assignee FROM chat_threads t LEFT JOIN users a ON a.id=t.assigned_to WHERE t.id=?",
        id,
      );
    });
  }

  return { team, saveStaff, setMemberRole, setStaffActive, assignChatThread };
}
