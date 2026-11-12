/** FR-S4 team accounts (one STAFF level) and FR-M1 chat assignment. */
import { randomBytes, randomUUID } from "node:crypto";

export function createTeamApis({ passwordHash, requireAdmin, requireStaff, one, all, run, tx, fail, clean, notify }) {
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
    created_at: row.created_at,
  });

  function team(user) {
    requireStaff(user);
    return all(
      "SELECT id,name,email,role,status,created_at FROM users WHERE role IN ('ADMIN','STAFF') ORDER BY role, created_at",
    ).map(member);
  }

  function saveStaff(user, input = {}) {
    requireAdmin(user);
    const name = clean(input.name, 2, 60, "ชื่อ");
    return tx(() => {
      if (input.id) {
        const row = one("SELECT * FROM users WHERE id=? AND role='STAFF'", clean(input.id, 1, 80, "ทีมงาน"));
        if (!row) fail(404, "ไม่พบทีมงาน");
        run("UPDATE users SET name=? WHERE id=?", name, row.id);
        auditDetail(user, "STAFF_UPDATE", row.id, { name });
        return { member: member(one("SELECT * FROM users WHERE id=?", row.id)) };
      }
      const email = clean(input.email, 5, 160, "อีเมล").toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "อีเมลไม่ถูกต้อง");
      if (one("SELECT id FROM users WHERE email=?", email)) fail(409, "อีเมลนี้มีบัญชีแล้ว");
      const id = randomUUID();
      const password = temporaryPassword();
      run(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,'STAFF')",
        id,
        email,
        name,
        passwordHash(password),
      );
      auditDetail(user, "STAFF_CREATE", id, { email });
      return { member: member(one("SELECT * FROM users WHERE id=?", id)), temporaryPassword: password };
    });
  }

  function setStaffActive(user, id, input = {}) {
    requireAdmin(user);
    return tx(() => {
      const row = one("SELECT * FROM users WHERE id=? AND role='STAFF'", clean(id, 1, 80, "ทีมงาน"));
      if (!row) fail(404, "ไม่พบทีมงาน");
      const active = input.active === true;
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

  return { team, saveStaff, setStaffActive, assignChatThread };
}
