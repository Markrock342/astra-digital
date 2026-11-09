/** Auth/RBAC policy aligned with docs/architecture/auth-rbac.md (+ STAFF from W1 schema). */
export const ROLES = Object.freeze({
  CUSTOMER: "CUSTOMER",
  ADMIN: "ADMIN",
  STAFF: "STAFF",
});

/** Drop privilege-bearing fields so client JSON cannot become authorization truth. */
export function withoutClientPrivileges(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const {
    role: _role,
    roles: _roles,
    isAdmin: _isAdmin,
    permissions: _permissions,
    ...safe
  } = input;
  return safe;
}

export function assertAuthenticated(user, fail) {
  if (!user) fail(401, "กรุณาเข้าสู่ระบบก่อนดำเนินการ");
  return user;
}

export function assertAdmin(user, fail) {
  assertAuthenticated(user, fail);
  if (user.role !== ROLES.ADMIN) fail(403, "เฉพาะผู้ดูแลร้านเท่านั้น");
  return user;
}

/** Staff or Admin — for queue/chat ops in later weeks; never from client body. */
export function assertStaff(user, fail) {
  assertAuthenticated(user, fail);
  if (user.role !== ROLES.ADMIN && user.role !== ROLES.STAFF)
    fail(403, "เฉพาะพนักงานหรือผู้ดูแลร้านเท่านั้น");
  return user;
}

export function isAdmin(user) {
  return !!user && user.role === ROLES.ADMIN;
}

export function isStaff(user) {
  return !!user && (user.role === ROLES.STAFF || user.role === ROLES.ADMIN);
}
