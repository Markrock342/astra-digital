/**
 * HTTP routes for admin › สัญญาณผิดปกติ (fraud.mjs) and admin › ข้อความอีเมล
 * (email-templates.mjs). Kept out of api-handler.mjs so that file only gains one call.
 * Every service method checks ADMIN itself; this file only maps paths.
 *
 *   GET    /api/admin/fraud?status=open|reviewed|all
 *   POST   /api/admin/fraud/settings                 { rules: { key: { enabled, threshold, windowHours } } }
 *   POST   /api/admin/fraud/signals/:id/review       { note }
 *   POST   /api/admin/fraud/blocks                   { kind: EMAIL|DOMAIN, value, hours, reason }
 *   DELETE /api/admin/fraud/blocks/:id
 *   GET    /api/admin/email-templates
 *   PATCH  /api/admin/email-templates/:key           { subject, heading, body }
 *   DELETE /api/admin/email-templates/:key           (reset to default)
 *   POST   /api/admin/email-templates/:key/preview   { subject?, heading?, body? }
 *   POST   /api/admin/email-templates/:key/test      { subject?, heading?, body? }
 *
 * Returns [status, data] or null when the path is not one of these.
 */
const SEGMENT = "([A-Za-z0-9_-]{1,80})";
const SIGNAL_REVIEW = new RegExp("^/api/admin/fraud/signals/" + SEGMENT + "/review$");
const BLOCK = new RegExp("^/api/admin/fraud/blocks/" + SEGMENT + "$");
const TEMPLATE = new RegExp("^/api/admin/email-templates/" + SEGMENT + "$");
const TEMPLATE_ACTION = new RegExp("^/api/admin/email-templates/" + SEGMENT + "/(preview|test)$");

export function routeFraudAndTemplates(service, { method, path, user, input, url }) {
  if (!path.startsWith("/api/admin/fraud") && !path.startsWith("/api/admin/email-templates")) return null;
  const ctx = { origin: url.origin };
  let m;
  if (method === "GET") {
    if (path === "/api/admin/fraud")
      return [200, service.adminFraud(user, { status: url.searchParams.get("status") ?? "open" })];
    if (path === "/api/admin/email-templates") return [200, service.adminEmailTemplates(user)];
    return null;
  }
  if (method === "POST") {
    if (path === "/api/admin/fraud/settings") return [200, service.adminSaveFraudSettings(user, input)];
    if ((m = SIGNAL_REVIEW.exec(path))) return [200, service.adminReviewFraudSignal(user, m[1], input)];
    if (path === "/api/admin/fraud/blocks") return [201, service.adminBlockEmail(user, input)];
    if ((m = TEMPLATE_ACTION.exec(path)))
      return m[2] === "preview"
        ? [200, service.adminPreviewEmailTemplate(user, m[1], input, ctx)]
        : [200, service.adminSendTestEmail(user, m[1], input, ctx)];
    return null;
  }
  if (method === "PATCH" && (m = TEMPLATE.exec(path))) return [200, service.adminSaveEmailTemplate(user, m[1], input)];
  if (method === "DELETE") {
    if ((m = BLOCK.exec(path))) return [200, service.adminLiftEmailBlock(user, m[1])];
    if ((m = TEMPLATE.exec(path))) return [200, service.adminResetEmailTemplate(user, m[1])];
  }
  return null;
}
