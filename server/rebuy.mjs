// "ซื้อซ้ำ" (buy again) and "ใกล้หมดอายุ? ต่ออายุ": pure helpers used by the storefront order
// history and order page. Availability comes from the public catalog (GET /api/products),
// which already lists only active, visible products and active options; the server checks
// stock and price again when the order is placed.

export const RENEW_WINDOW_DAYS = 5;
export const MAX_REBUY_QUANTITY = 10;
const DAY_MS = 86400000;

/**
 * What the buy-again button should do for one order:
 *  - null: not a delivered order (no button)
 *  - { kind: "buy", variantId, quantity, productId }: prefill the basket and go to checkout
 *  - { kind: "out", productId, to }: the option exists but cannot be ordered now → product page
 *  - { kind: "gone", to: "/products" }: the option or product was removed or hidden
 */
export function rebuyAction(order, products, { shopOpen = true } = {}) {
  if (!order || order.status !== "DELIVERED" || !order.variant_id) return null;
  for (const product of products ?? []) {
    const variant = product?.variants?.find((v) => v.id === order.variant_id);
    if (!variant) continue;
    const to = "/products/" + encodeURIComponent(product.id);
    if (!variant.available || shopOpen === false) return { kind: "out", productId: product.id, to };
    const quantity = Math.min(
      MAX_REBUY_QUANTITY,
      Math.max(1, Number.isInteger(order.quantity) ? order.quantity : 1),
    );
    return { kind: "buy", variantId: variant.id, quantity, productId: product.id, to };
  }
  return { kind: "gone", to: "/products" };
}

/** SQL UTC "YYYY-MM-DD HH:MM:SS" (or ISO) → ms; NaN when unreadable. */
const parseTime = (value) =>
  typeof value === "string"
    ? Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z")
    : NaN;

/**
 * True when a delivered order's warranty (used as the subscription period) ends within
 * RENEW_WINDOW_DAYS from now and has not ended yet.
 */
export function renewalDue(order, now = Date.now(), days = RENEW_WINDOW_DAYS) {
  if (!order || order.status !== "DELIVERED" || !order.warranty_until) return false;
  const end = parseTime(order.warranty_until);
  if (Number.isNaN(end)) return false;
  return end >= now && end - now <= days * DAY_MS;
}
