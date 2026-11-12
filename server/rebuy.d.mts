// Types for server/rebuy.mjs (imported by the React app).
export const RENEW_WINDOW_DAYS: number;
export const MAX_REBUY_QUANTITY: number;
export type RebuyAction =
  | { kind: "buy"; variantId: string; quantity: number; productId: string; to: string }
  | { kind: "out"; productId: string; to: string }
  | { kind: "gone"; to: string };
export function rebuyAction(
  order: { status: string; variant_id?: string | null; quantity?: number } | null | undefined,
  products: { id: string; variants: { id: string; available: boolean }[] }[] | null | undefined,
  options?: { shopOpen?: boolean },
): RebuyAction | null;
export function renewalDue(
  order: { status: string; warranty_until?: string | null } | null | undefined,
  now?: number,
  days?: number,
): boolean;
