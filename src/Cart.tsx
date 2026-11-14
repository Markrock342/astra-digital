// Multi-item basket + checkout under one order number.
// - CartPage (/cart): every line with a tick box, quantity, remove; ticked lines go to checkout.
// - MultiCheckout (/checkout with 2+ ticked lines): shop fields per line, one "บันทึกคำสั่งซื้อ".
// - CheckoutGroupPage (/checkouts/:id): one order number, pay once, every item's delivery.
// One ticked line keeps the single-order checkout in App.tsx (coupons, preorder terms).
// UI: shadcn/ui Checkbox + Card + sticky summary bar (MIT, https://ui.shadcn.com).
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Clock,
  Copy,
  CreditCard,
  LoaderCircle,
  ShieldCheck,
  QrCode,
  ShoppingBag,
  TicketPercent,
  Wallet,
  X,
} from "lucide-react";
import {
  Art,
  Empty,
  ErrorMessage,
  Link,
  PayDeadline,
  PayShell,
  Quantity,
  RequireLogin,
  Status,
  shownStatus,
  useStore,
  useTestPayments,
} from "./App";
import { api, dateTime, money } from "./api";
import { CheckoutFields, checkoutFieldsReady } from "./Delivery";
import { CheckoutPreorderRow, payNowFor } from "./Preorder";
import { EmailVerifyNotice, useEmailVerifyNeeded } from "./EmailVerify";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { useLive } from "./live";
import { copyLines } from "./OrderList";
import { PriceNote, PurchaseLimitNote, quantityCap, WasPrice } from "./Pricing";
import { ShopClosedNote, useShopOpen } from "./ShopClosed";
import type { Order, Product, Variant } from "./types";
import "./cart.css";

const EN: Record<string, string> = {
  "เลือกทั้งหมด ({n})": "Select all ({n})",
  "ราคาสินค้า ({n} ชิ้น)": "Items ({n})",
  "ยอดรวม {n} ชิ้น": "Total · {n} items",
  "ไปชำระเงิน": "Checkout",
  "เลือกสินค้าที่จะชำระ": "Pick items to pay for",
  "สั่งจอง": "Preorder",
  "สินค้าหมด": "Sold out",
  "เลือก {name}": "Select {name}",
  "ลบ {name}": "Remove {name}",
  "ราคาต่อชิ้น {price}": "{price} each",
  "สรุปรายการ": "Order summary",
  "ช่องทางชำระเงิน": "Payment method",
  "เครดิตร้าน": "Shop credit",
  "คงเหลือ {amount}": "Balance {amount}",
  "เข้าสู่ระบบเพื่อดูยอด": "Sign in to see your balance",
  "QR พร้อมเพย์": "PromptPay QR",
  "เปิดใช้เร็วๆ นี้": "Coming soon",
  "เครดิตไม่พอ ขาดอีก {amount}": "Not enough credit: {amount} short",
  "ยอดชำระ {n} ชิ้น": "To pay · {n} items",
  "เข้าสู่ระบบเพื่อชำระเงิน": "Sign in to pay",
  "ยังไม่ได้เลือกสินค้า": "No items picked",
  "เลือกสินค้าในตะกร้าก่อนชำระเงิน": "Pick items in your basket first",
  "ไปที่ตะกร้า": "Go to basket",
  "คำสั่งซื้อ {n} รายการ": "Order · {n} items",
  "สินค้าที่ได้รับ": "Your items",
  "ดูรายละเอียด": "Details",
  "ชำระเงินสำเร็จ ได้รับสินค้าแล้ว": "Paid. Your items are ready.",
  "คัดลอกแล้ว": "Copied",
};
for (const [th, en] of Object.entries(EN)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

export type CartLine = { variantId: string; quantity: number; selected: boolean };
export const CART_MAX_LINES = 20;
const KEY = "astra-cart";

/** Saved basket; the old single-item basket ("astra-basket") becomes one ticked line. */
export function loadCart(): CartLine[] {
  const ok = (l: any) => l && typeof l.variantId === "string" && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 10;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(raw))
      return raw.filter(ok).slice(0, CART_MAX_LINES).map((l) => ({ variantId: l.variantId, quantity: l.quantity, selected: l.selected !== false }));
    const old = JSON.parse(localStorage.getItem("astra-basket") ?? "null");
    return ok(old) ? [{ variantId: old.variantId, quantity: old.quantity, selected: true }] : [];
  } catch {
    return [];
  }
}
export function saveCart(lines: CartLine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
    localStorage.removeItem("astra-basket");
  } catch {
    /* private mode: the basket lives for this visit only */
  }
}
/** Add (or top up) a line. `only` = buy now: tick just this line. */
export function withLine(lines: CartLine[], variantId: string, quantity: number, only = false): CartLine[] {
  const found = lines.find((l) => l.variantId === variantId);
  const next = found
    ? lines.map((l) =>
        l.variantId === variantId ? { ...l, quantity: only ? quantity : Math.min(10, l.quantity + quantity), selected: true } : l,
      )
    : [...lines, { variantId, quantity, selected: true }].slice(-CART_MAX_LINES);
  return only ? next.map((l) => ({ ...l, selected: l.variantId === variantId })) : next;
}

type Row = { line: CartLine; product: Product; variant: Variant };
export function useCartRows() {
  const { cart, products } = useStore();
  return useMemo(() => {
    const rows: Row[] = [];
    for (const line of cart) {
      const product = products.find((p) => p.variants.some((v) => v.id === line.variantId));
      const variant = product?.variants.find((v) => v.id === line.variantId);
      if (product && variant) rows.push({ line, product, variant });
    }
    return rows;
  }, [cart, products]);
}
const canBuy = (r: Row) => r.variant.available && quantityCap(r.variant) > 0;
const cover = (p: Product) => p.images?.[0]?.url ?? p.imageUrl ?? null;

function LineArt({ product }: { product: Product }) {
  return (
    <span className="cart-line-art">
      <Art type={product.art} name={product.name} image={cover(product)} small />
    </span>
  );
}

export function CartPage() {
  const { cart, setCart, go, loading } = useStore();
  const shopOpen = useShopOpen();
  const rows = useCartRows();
  const buyable = rows.filter(canBuy);
  const picked = buyable.filter((r) => r.line.selected);
  const count = picked.reduce((n, r) => n + r.line.quantity, 0);
  const total = picked.reduce((n, r) => n + r.variant.price * r.line.quantity, 0);
  const allOn = buyable.length > 0 && picked.length === buyable.length;
  const update = (variantId: string, change: Partial<CartLine> | null) =>
    setCart(
      change === null
        ? cart.filter((l) => l.variantId !== variantId)
        : cart.map((l) => (l.variantId === variantId ? { ...l, ...change } : l)),
    );
  if (loading)
    return (
      <main className="container page-main reference-cart-page">
        <div className="skeleton-cart" aria-busy="true" aria-label={t("กำลังโหลดตะกร้า")}>
          <div className="skeleton-block skeleton-line" />
          <div className="skeleton-block skeleton-panel" />
        </div>
      </main>
    );
  return (
    <main className="container page-main reference-cart-page cart-v2">
      <div className="page-heading">
        <h1>{t("ตะกร้าสินค้า")}</h1>
      </div>
      {!rows.length ? (
        <Empty
          icon={<ShoppingBag />}
          heading={t("ตะกร้าของคุณยังว่าง")}
          description={t("เลือกสินค้าที่ชอบ แล้วกลับมาที่นี่เพื่อทำรายการ")}
          action={
            <Link to="/products" className="button primary">
              {t("เลือกดูสินค้า")}
              <ArrowRight size={17} />
            </Link>
          }
        />
      ) : (
        <>
          <div className="cart-select-all">
            <label className="cart-check">
              <input
                type="checkbox"
                checked={allOn}
                disabled={!buyable.length}
                onChange={() => setCart(cart.map((l) => ({ ...l, selected: !allOn })))}
              />
              <span aria-hidden="true">{allOn && <Check size={14} strokeWidth={3} />}</span>
              {t("เลือกทั้งหมด ({n})", { n: buyable.length })}
            </label>
          </div>
          <section className="cart-lines" aria-label={t("ตะกร้าสินค้า")}>
            {rows.map((r) => {
              const ok = canBuy(r);
              const on = ok && r.line.selected;
              return (
                <article className={"cart-line" + (ok ? "" : " is-unavailable")} key={r.line.variantId}>
                  <label className="cart-check">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!ok}
                      onChange={() => update(r.line.variantId, { selected: !on })}
                      aria-label={t("เลือก {name}", { name: r.product.name + " " + r.variant.label })}
                    />
                    <span aria-hidden="true">{on && <Check size={14} strokeWidth={3} />}</span>
                  </label>
                  <LineArt product={r.product} />
                  <div className="cart-line-main">
                    <Link to={"/products/" + r.product.id} className="cart-line-name">
                      {r.product.name}
                    </Link>
                    <p className="cart-line-option">
                      <span>{r.variant.label}</span>
                      {r.product.preorder ? <span className="cart-pill">{t("สั่งจอง")}</span> : null}
                      {!ok && <span className="cart-pill is-out">{t("สินค้าหมด")}</span>}
                    </p>
                    <span className="cart-price-extra">
                      <WasPrice variant={r.variant} />
                      <PriceNote variant={r.variant} />
                    </span>
                    <PurchaseLimitNote variant={r.variant} />
                    <div className="cart-line-foot">
                      {ok ? (
                        <Quantity
                          value={Math.min(r.line.quantity, quantityCap(r.variant))}
                          max={quantityCap(r.variant)}
                          onChange={(quantity) => update(r.line.variantId, { quantity })}
                        />
                      ) : (
                        <span />
                      )}
                      <strong>{money(r.variant.price * r.line.quantity)}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-button cart-line-remove"
                    aria-label={t("ลบ {name}", { name: r.product.name + " " + r.variant.label })}
                    onClick={() => update(r.line.variantId, null)}
                  >
                    <X size={18} />
                  </button>
                </article>
              );
            })}
          </section>
          <section className="cart-summary" aria-label={t("สรุปคำสั่งซื้อ")}>
            <div>
              <span>{t("ราคาสินค้า ({n} ชิ้น)", { n: count })}</span>
              <span>{money(total)}</span>
            </div>
            <div className="cart-summary-total">
              <strong>{t("ยอดรวม")}</strong>
              <strong>{money(total)}</strong>
            </div>
            <ShopClosedNote />
          </section>
          <div className="cart-bar">
            <div>
              <small>{t("ยอดรวม {n} ชิ้น", { n: count })}</small>
              <strong>{money(total)}</strong>
            </div>
            <button
              type="button"
              className="button primary"
              disabled={!picked.length || !shopOpen}
              onClick={() => go("/checkout")}
            >
              {picked.length ? t("ไปชำระเงิน") : t("เลือกสินค้าที่จะชำระ")}
            </button>
          </div>
        </>
      )}
    </main>
  );
}

type CouponResult = { valid: true; code: string; discount: number; variantId: string } | { valid: false; reason: string };

/**
 * /checkout: summary → payment method + discount code → pay, in one step (no "save the order
 * first"). Buy now ticks one line; the basket sends every ticked line.
 */
export function CheckoutPage() {
  const { user, go, cart, setCart, refresh, toast } = useStore();
  const shopOpen = useShopOpen();
  const verifyEmail = useEmailVerifyNeeded();
  const testPayments = useTestPayments();
  const rows = useCartRows().filter((r) => r.line.selected && canBuy(r));
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [method, setMethod] = useState("credit");
  const [code, setCode] = useState("");
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lines = rows.map((r) => ({ variantId: r.variant.id, quantity: Math.min(r.line.quantity, quantityCap(r.variant)) }));
  const linesKey = JSON.stringify(lines);
  const subtotal = rows.reduce((n, r) => n + r.variant.price * Math.min(r.line.quantity, quantityCap(r.variant)), 0);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const discount = coupon?.valid ? coupon.discount : 0;
  // Charged now: deposits / free queues count what they take today; the code's saving comes off its line.
  const total = rows.reduce((n, r, i) => {
    const line = r.variant.price * lines[i].quantity - (coupon?.valid && coupon.variantId === r.variant.id ? coupon.discount : 0);
    return n + payNowFor(r.product, line, lines[i].quantity);
  }, 0);
  const ready = rows.every((r) => checkoutFieldsReady(r.product.checkoutFields ?? [], values[r.variant.id] ?? {}));
  const short = !!user && testPayments && user.balance < total;
  async function check(raw: string) {
    setChecking(true);
    try {
      const result = await api<CouponResult>("/checkouts/coupon", { code: raw.trim(), lines });
      setCoupon(result);
      if (result.valid) setCode("");
    } catch (e) {
      setCoupon({ valid: false, reason: (e as Error).message });
    } finally {
      setChecking(false);
    }
  }
  // Basket changed: the best line for the code may change too.
  useEffect(() => {
    if (coupon?.valid) void check(coupon.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);
  async function pay() {
    if (!user) return go("/login?next=%2Fcheckout");
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string; orders: Order[] }>("/checkouts", {
        requestKey: crypto.randomUUID(),
        lines: rows.map((r, i) => ({
          ...lines[i],
          ...((r.product.checkoutFields ?? []).length ? { deliveryInputs: values[r.variant.id] ?? {} } : {}),
        })),
        ...(coupon?.valid ? { couponCode: coupon.code } : {}),
        ...(testPayments ? { pay: "success" } : {}),
      });
      for (const o of result.orders) if (o.paymentToken) sessionStorage.setItem("astra-pay-" + o.id, o.paymentToken);
      const done = new Set(result.orders.filter((o) => o.status !== "PENDING_PAYMENT" || !testPayments).map((o) => o.variant_id));
      setCart(cart.filter((l) => !done.has(l.variantId)));
      await refresh();
      if (testPayments && result.orders.some((o) => ["DELIVERED", "PREORDER"].includes(o.status)))
        toast(t("ชำระเงินสำเร็จ ได้รับสินค้าแล้ว"));
      go(result.orders.length === 1 ? "/orders/" + result.orders[0].id : "/checkouts/" + result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!rows.length)
    return (
      <main className="container page-main reference-cart-page cart-v2">
        <Empty
          icon={<ShoppingBag />}
          heading={t("ยังไม่ได้เลือกสินค้า")}
          description={t("เลือกสินค้าในตะกร้าก่อนชำระเงิน")}
          action={
            <Link to="/cart" className="button primary">
              {t("ไปที่ตะกร้า")}
              <ArrowRight size={17} />
            </Link>
          }
        />
      </main>
    );
  return (
    <main className="container page-main reference-cart-page cart-v2">
      <div className="page-heading">
        <h1>{t("สรุปรายการ")}</h1>
      </div>
      <section className="cart-lines" aria-label={t("สรุปรายการ")}>
        {rows.map((r, i) => (
          <article className="cart-line is-review" key={r.variant.id}>
            <LineArt product={r.product} />
            <div className="cart-line-main">
              <span className="cart-line-name">{r.product.name}</span>
              <p className="cart-line-option">
                <span>
                  {r.variant.label} · × {lines[i].quantity}
                </span>
                {r.product.preorder ? <span className="cart-pill">{t("สั่งจอง")}</span> : null}
                {coupon?.valid && coupon.variantId === r.variant.id && (
                  <span className="cart-pill is-deal">−{money(coupon.discount)}</span>
                )}
              </p>
              <span className="cart-price-extra">
                <WasPrice variant={r.variant} />
                <PriceNote variant={r.variant} />
              </span>
              {r.product.preorder ? (
                <CheckoutPreorderRow product={r.product} total={r.variant.price * lines[i].quantity} quantity={lines[i].quantity} />
              ) : null}
              <CheckoutFields
                fields={r.product.checkoutFields ?? []}
                values={values[r.variant.id] ?? {}}
                onChange={(v) => setValues({ ...values, [r.variant.id]: v })}
              />
            </div>
            <strong className="cart-line-price">{money(r.variant.price * lines[i].quantity)}</strong>
          </article>
        ))}
      </section>

      <section className="checkout-block" aria-labelledby="pay-method-title">
        <h2 id="pay-method-title">{t("ช่องทางชำระเงิน")}</h2>
        <div role="radiogroup" aria-labelledby="pay-method-title" className="pay-methods">
          <button
            type="button"
            role="radio"
            aria-checked={method === "credit"}
            className="pay-method"
            onClick={() => setMethod("credit")}
          >
            <Wallet size={20} aria-hidden="true" />
            <span>
              <strong>{t("เครดิตร้าน")}</strong>
              <small>{user ? t("คงเหลือ {amount}", { amount: money(user.balance) }) : t("เข้าสู่ระบบเพื่อดูยอด")}</small>
            </span>
            <span className="sort-check" aria-hidden="true">
              {method === "credit" && <Check size={16} strokeWidth={3} />}
            </span>
          </button>
          <button type="button" role="radio" aria-checked={false} className="pay-method" disabled>
            <QrCode size={20} aria-hidden="true" />
            <span>
              <strong>{t("QR พร้อมเพย์")}</strong>
              <small>{t("เปิดใช้เร็วๆ นี้")}</small>
            </span>
            <span className="sort-check" aria-hidden="true" />
          </button>
        </div>
        {short && (
          <p className="pay-short">
            {t("เครดิตไม่พอ ขาดอีก {amount}", { amount: money(total - user!.balance) })}{" "}
            <Link to="/wallet">{t("เติมเครดิตทดลอง")}</Link>
          </p>
        )}
      </section>

      <section className="checkout-block coupon-box" aria-labelledby="coupon-title">
        <h2 id="coupon-title">{t("โค้ดส่วนลด")}</h2>
        {coupon?.valid ? (
          <div className="coupon-applied">
            <TicketPercent size={18} />
            <span>
              <strong>{coupon.code}</strong>
              <small>{t("ใช้โค้ดแล้ว ลด {amount}", { amount: money(coupon.discount) })}</small>
            </span>
            <button type="button" className="text-button" onClick={() => setCoupon(null)}>
              {t("ลบโค้ด")}
            </button>
          </div>
        ) : !user ? (
          <p className="coupon-login">
            <Link to="/login?next=%2Fcheckout">{t("เข้าสู่ระบบเพื่อใช้โค้ดส่วนลด")}</Link>
          </p>
        ) : (
          <form
            className="coupon-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void check(code);
            }}
          >
            <label htmlFor="coupon-code" className="sr-only">
              {t("โค้ดส่วนลด")}
            </label>
            <div>
              <input
                id="coupon-code"
                value={code}
                maxLength={32}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("เช่น WELCOME10")}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  if (coupon && !coupon.valid) setCoupon(null);
                }}
              />
              <button className="button secondary" disabled={checking || !code.trim()}>
                {checking ? <LoaderCircle className="spin" size={16} /> : t("ใช้โค้ด")}
              </button>
            </div>
          </form>
        )}
        {coupon && !coupon.valid && <ErrorMessage message={coupon.reason} />}
      </section>

      <section className="cart-summary" aria-label={t("สรุปยอด")}>
        <div>
          <span>{t("ราคาสินค้า ({n} ชิ้น)", { n: count })}</span>
          <span>{money(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="summary-discount">
            <span>{t("ส่วนลด")}</span>
            <span>−{money(discount)}</span>
          </div>
        )}
        <div className="cart-summary-total">
          <strong>{t("ยอดชำระ")}</strong>
          <strong>{money(total)}</strong>
        </div>
        <p className="small-note">
          <ShieldCheck size={16} />
          {t("โค้ดถูกส่งไปยังบัญชีที่ใช้สั่งซื้อเท่านั้น")}
        </p>
        <ErrorMessage message={error} />
        <ShopClosedNote />
        <EmailVerifyNotice compact />
      </section>
      <div className="cart-bar">
        <div>
          <small>{t("ยอดชำระ {n} ชิ้น", { n: count })}</small>
          <strong>{money(total)}</strong>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={busy || !shopOpen || (!!user && (verifyEmail || !ready || short))}
          onClick={() => void pay()}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <CreditCard size={17} />}
          {user ? t("ชำระเงิน") : t("เข้าสู่ระบบเพื่อชำระเงิน")}
        </button>
      </div>
    </main>
  );
}

type Group = { id: string; created_at: string; orders: Order[] };
const due = (o: Order) => (o.status !== "PENDING_PAYMENT" ? 0 : o.preorder ? (o.amountDue ?? o.total) : o.total);

/** Status of the whole order: the "least done" line wins. */
export function groupStatus(orders: Order[]) {
  const shown = orders.map(shownStatus);
  for (const s of ["PENDING_PAYMENT", "WAITING", "CALLED", "PREORDER"]) if (shown.includes(s)) return s;
  return shown.every((s) => s === shown[0]) ? shown[0] : shown.includes("DELIVERED") ? "DELIVERED" : shown[0];
}

export function CheckoutGroupPage({ id }: { id: string }) {
  const { user, cart, setCart, refresh, toast } = useStore();
  const testPayments = useTestPayments();
  const shopOpen = useShopOpen();
  const verifyEmail = useEmailVerifyNeeded();
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => {
    if (user)
      api<Group>("/checkouts/" + id)
        .then(setGroup)
        .catch((e) => setError(e.message));
  };
  useEffect(load, [id, user?.id]);
  useLive(["orders"], () => {
    if (!busy) load();
  });
  if (!user)
    return (
      <main className="container page-main">
        <RequireLogin />
      </main>
    );
  if (!group)
    return (
      <main className="container page-main">
        {error ? <ErrorMessage message={error} /> : <div className="loading-row"><LoaderCircle className="spin" />{t("กำลังโหลด")}</div>}
      </main>
    );
  const amount = group.orders.reduce((n, o) => n + due(o), 0);
  const unpaid = group.orders.filter((o) => o.status === "PENDING_PAYMENT");
  const total = group.orders.reduce((n, o) => n + o.total, 0);
  async function pay(outcome: "success" | "failure") {
    setBusy(true);
    setError("");
    try {
      const tokens: Record<string, string> = {};
      for (const o of unpaid) {
        let token = sessionStorage.getItem("astra-pay-" + o.id);
        if (!token) {
          token = (await api<Order>("/orders/" + o.id + "/retry", {})).paymentToken!;
          sessionStorage.setItem("astra-pay-" + o.id, token);
        }
        tokens[o.id] = token;
      }
      const result = await api<Group>("/checkouts/" + id + "/pay", { tokens, outcome });
      setGroup(result);
      const settled = result.orders.filter((o) => o.status !== "PENDING_PAYMENT");
      for (const o of settled) sessionStorage.removeItem("astra-pay-" + o.id);
      const paidVariants = new Set(result.orders.filter((o) => ["DELIVERED", "PREORDER"].includes(o.status)).map((o) => o.variant_id));
      if (paidVariants.size) setCart(cart.filter((l) => !paidVariants.has(l.variantId)));
      await refresh();
      if (outcome === "success") toast(t("ชำระเงินสำเร็จ ได้รับสินค้าแล้ว"));
    } catch (e) {
      setError((e as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container page-main reference-order-page checkout-group-page">
      <div className="group-head">
        <div>
          <h1>#{group.id.slice(0, 8).toUpperCase()}</h1>
          <p>
            {t("คำสั่งซื้อ {n} รายการ", { n: group.orders.length })} · {dateTime(group.created_at)}
          </p>
        </div>
        <Status status={groupStatus(group.orders)} />
      </div>
      <section className="group-lines">
        {group.orders.map((o) => (
          <GroupLine key={o.id} order={o} />
        ))}
        <div className="group-total">
          <strong>{t("ยอดรวม")}</strong>
          <strong>{money(total)}</strong>
        </div>
      </section>
      {unpaid.length > 0 && (
        <section className="note-box group-pay">
          <Clock size={20} />
          <div>
            <strong>
              {t("ยอดคำสั่งซื้อ")} {money(amount)}
            </strong>
            <PayDeadline createdAt={group.created_at} />
            {testPayments ? (
              <>
                <p>
                  {t("โหมดทดสอบ: ชำระด้วยเครดิตทดลอง")} · {t("เครดิตคงเหลือ")} {money(user.balance)}
                </p>
                <ErrorMessage message={error} />
                <ShopClosedNote pay />
                <EmailVerifyNotice compact />
                <div className="pay-actions">
                  <button
                    className="button primary"
                    disabled={busy || user.balance < amount || !shopOpen || verifyEmail}
                    onClick={() => void pay("success")}
                  >
                    {busy ? <LoaderCircle className="spin" size={17} /> : <CreditCard size={17} />}
                    {t("ชำระเงิน")} {money(amount)}
                  </button>
                  {user.balance < amount && (
                    <Link to="/wallet" className="button secondary">
                      {t("เติมเครดิตทดลอง")}
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <p>{t("รอเชื่อมช่องทางชำระเงิน ระบบจะส่ง ID และรหัสผ่านหลังยืนยันยอดแล้วเท่านั้น")}</p>
            )}
          </div>
        </section>
      )}
      {unpaid.length > 0 && !testPayments && <PayShell total={amount} />}
      {unpaid.length === 0 && <ErrorMessage message={error} />}
    </main>
  );
}

function GroupLine({ order }: { order: Order }) {
  const { toast } = useStore();
  const lines = copyLines(order);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("คัดลอกแล้ว"));
    } catch {
      toast(t("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง"));
    }
  };
  return (
    <article className="group-line">
      <div className="group-line-head">
        <div>
          <strong>{order.name}</strong>
          <p>
            {order.label} · {order.quantity} × {money(order.quantity ? Math.round(order.total / order.quantity) : order.total)}
          </p>
        </div>
        <div className="group-line-side">
          <strong>{money(order.total)}</strong>
          <Status status={shownStatus(order)} />
        </div>
      </div>
      {lines.length > 0 && (
        <div className="group-items">
          <p className="group-items-title">{t("สินค้าที่ได้รับ")}</p>
          {lines.map((text, i) => (
            <div className="group-item" key={i}>
              <code>{text}</code>
              <button type="button" className="icon-button" aria-label={t("คัดลอก") + " " + (i + 1)} onClick={() => void copy(text)}>
                <Copy size={17} />
              </button>
            </div>
          ))}
        </div>
      )}
      <Link to={"/orders/" + order.id} className="group-line-link">
        {t("ดูรายละเอียด")}
        <ArrowRight size={15} />
      </Link>
    </article>
  );
}
