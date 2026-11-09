/** Auth/RBAC policy aligned with docs/architecture/auth-rbac.md (Approved). */
export const ROLES = Object.freeze({
  CUSTOMER: "CUSTOMER",
  ADMIN: "ADMIN",
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

export function isAdmin(user) {
  return !!user && user.role === ROLES.ADMIN;
}
