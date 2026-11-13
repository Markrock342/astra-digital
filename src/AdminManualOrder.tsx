// Back office: create an order for a customer who paid outside the site (bank transfer /
// LINE). Layout follows Medusa Admin "Create draft order" (github.com/medusajs/medusa, MIT):
// customer → items → price → payment, with a summary card and one confirm step. Built
// from the existing shadcn/ui-style admin pieces (cards, fields, chips) in styles.css.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Banknote, FileImage, LoaderCircle, Plus, UserRound, X } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { checkSource, toWebp, uploadImage } from "./image-upload";
import type { AdminProduct } from "./types";
import "./manual-orders.css";

type CustomerHit = { id: string; name: string; email: string; username?: string | null; status?: string };
type Quote = {
  preorder: boolean;
  normalUnitPrice: number;
  unitPrice: number;
  priceChanged: boolean;
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  couponError: string | null;
  reasonMissing: boolean;
  enoughStock: boolean;
  warrantyDays: number;
};
/** Admin order detail: the manual-order record (ADMIN sees the money fields). */
export type ManualOrderInfo = {
  createdByAdmin: true;
  paymentMethod: string;
  paymentMethodLabel: string;
  adminName?: string | null;
  reference?: string | null;
  note?: string | null;
  normalUnitPrice?: number;
  unitPrice?: number;
  priceReason?: string | null;
  test?: boolean;
  hasSlip?: boolean;
  createdAt?: string;
};

/** Baht text → satang, or null when it is not a valid positive amount. */
const toSatang = (text: string) => {
  const value = Number(text.replace(/,/g, "").trim());
  if (!text.trim() || !Number.isFinite(value) || value <= 0) return null;
  const satang = Math.round(value * 100);
  return Math.abs(satang - value * 100) < 1e-6 ? satang : null;
};
const shortId = (id: string) => "#" + id.slice(0, 8).toUpperCase();

/** "สร้างโดยแอดมิน · โอนนอกเว็บ" chip for admin lists and headings. */
export function ManualOrderBadge({ method }: { method?: string }) {
  return (
    <span className="manual-order-badge" title="แอดมินสร้างออเดอร์นี้ให้ลูกค้า">
      สร้างโดยแอดมิน{method ? " · " + method : ""}
    </span>
  );
}

/** Order detail card: method, reference, who created it, price change, slip. */
export function ManualOrderCard({ id, manual, onChanged }: { id: string; manual: ManualOrderInfo; onChanged: () => void }) {
  const { user, toast } = useStore();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slipVersion, setSlipVersion] = useState(0);
  const admin = user?.role === "ADMIN";
  async function upload(file: File | undefined) {
    if (!file) return;
    const problem = checkSource(file);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      await uploadImage("/admin/orders/" + id + "/slip", await toWebp(file, 1600));
      toast("แนบสลิปแล้ว");
      setSlipVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="reference-admin-card admin-detail-card manual-order-card">
      <div className="manual-order-card-head">
        <h2>ออเดอร์จากหลังบ้าน</h2>
        <ManualOrderBadge />
      </div>
      <dl className="manual-order-facts">
        <div>
          <dt>ช่องทางชำระ</dt>
          <dd>{manual.paymentMethodLabel}</dd>
        </div>
        {manual.reference && (
          <div>
            <dt>เลขอ้างอิงการโอน</dt>
            <dd>{manual.reference}</dd>
          </div>
        )}
        {manual.adminName && (
          <div>
            <dt>สร้างโดย</dt>
            <dd>
              {manual.adminName}
              {manual.createdAt && <small> · {dateTime(manual.createdAt)}</small>}
            </dd>
          </div>
        )}
        {manual.note && (
          <div>
            <dt>หมายเหตุ</dt>
            <dd>{manual.note}</dd>
          </div>
        )}
        {manual.unitPrice != null && manual.normalUnitPrice != null && manual.unitPrice !== manual.normalUnitPrice && (
          <div>
            <dt>ราคาที่เปลี่ยน</dt>
            <dd>
              {money(manual.unitPrice)} / ชิ้น <small>(ราคาปกติ {money(manual.normalUnitPrice)})</small>
              {manual.priceReason && <small className="manual-order-reason">เหตุผล: {manual.priceReason}</small>}
            </dd>
          </div>
        )}
      </dl>
      {admin && (
        <div className="manual-order-slip">
          {manual.hasSlip ? (
            <a href={"/api/admin/orders/" + id + "/slip"} target="_blank" rel="noreferrer" className="manual-order-slip-link">
              <img src={"/api/admin/orders/" + id + "/slip?v=" + slipVersion} alt="สลิปการโอน" />
              <span>ดูสลิป</span>
            </a>
          ) : (
            <p className="muted">ยังไม่มีสลิป</p>
          )}
          <label className="button secondary manual-order-file">
            <FileImage size={15} />
            {busy ? "กำลังอัปโหลด…" : manual.hasSlip ? "เปลี่ยนสลิป" : "แนบสลิป"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      <ErrorMessage message={error} />
    </section>
  );
}

/** /admin/orders/new */
export function AdminManualOrder({ products }: { products: AdminProduct[] }) {
  const { go, toast } = useStore();
  const [customerQuery, setCustomerQuery] = useState("");
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priceText, setPriceText] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [slip, setSlip] = useState<File | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [overLimitPrompt, setOverLimitPrompt] = useState(false);
  const [overLimitReason, setOverLimitReason] = useState("");
  const requestKey = useRef(crypto.randomUUID());

  const sellable = products.filter((p) => p.active && p.variants.length > 0);
  const product = sellable.find((p) => p.id === productId) ?? null;
  const variant = product?.variants.find((v) => v.id === variantId) ?? null;
  const qty = Number(quantity);
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= 10;
  const unitPrice = priceText.trim() ? toSatang(priceText) : null;
  const priceInvalid = priceText.trim() !== "" && unitPrice == null;

  // Customer search (same API as the customer list), debounced.
  useEffect(() => {
    const term = customerQuery.trim();
    if (customer || term.length < 2) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      api<{ customers: CustomerHit[] }>("/admin/customers?limit=8&q=" + encodeURIComponent(term))
        .then((r) => setHits(r.customers))
        .catch((e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(timer);
  }, [customerQuery, customer]);

  // Server price preview: the order is priced again on the server when created.
  useEffect(() => {
    setConfirming(false);
    setOverLimitPrompt(false);
    setOverLimitReason("");
    if (!customer || !variantId || !qtyOk || priceInvalid) {
      setQuote(null);
      setQuoteError("");
      return;
    }
    let live = true;
    setQuoting(true);
    const timer = setTimeout(() => {
      api<Quote>("/admin/manual-orders/quote", {
        customerId: customer.id,
        variantId,
        quantity: qty,
        unitPrice: unitPrice ?? undefined,
        priceReason: priceReason.trim() || undefined,
        couponCode: couponCode.trim() || undefined,
      })
        .then((q) => {
          if (!live) return;
          setQuote(q);
          setQuoteError("");
        })
        .catch((e) => {
          if (!live) return;
          setQuote(null);
          setQuoteError((e as Error).message);
        })
        .finally(() => live && setQuoting(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [customer?.id, variantId, quantity, priceText, priceReason, couponCode]);

  const priceChanged = unitPrice != null && variant != null && unitPrice !== (quote?.normalUnitPrice ?? variant.price);

  function review(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!customer) return setError("กรุณาเลือกลูกค้า");
    if (!variant) return setError("กรุณาเลือกสินค้าและตัวเลือก");
    if (!qtyOk) return setError("จำนวนต้องเป็น 1–10 ชิ้น");
    if (priceInvalid) return setError("กรุณาใส่ราคาเป็นบาท เช่น 89 หรือ 89.50");
    if (priceChanged && priceReason.trim().length < 3) return setError("เปลี่ยนราคาแล้ว กรุณาใส่เหตุผล");
    if (reference.trim().length < 3) return setError("กรุณาใส่เลขอ้างอิงการโอน");
    if (quoteError) return setError(quoteError);
    if (!quote) return setError("กำลังคำนวณราคา กรุณารอสักครู่");
    if (quote.couponError) return setError(quote.couponError);
    if (!quote.enoughStock) return setError("สินค้าคงเหลือไม่พอ");
    setPassword("");
    setConfirming(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!customer || !variant || !quote) return;
    if (overLimitPrompt && overLimitReason.trim().length < 3)
      return setError("กรุณาใส่เหตุผลที่ยืนยันเกินลิมิตอย่างน้อย 3 ตัวอักษร");
    setBusy(true);
    setError("");
    try {
      const result = await api<{ replayed: boolean; order: { id: string; status: string } }>("/admin/manual-orders", {
        customerId: customer.id,
        variantId,
        quantity: qty,
        unitPrice: unitPrice ?? undefined,
        priceReason: priceChanged ? priceReason.trim() : undefined,
        couponCode: couponCode.trim() || undefined,
        method: "OFFSITE_TRANSFER",
        reference: reference.trim(),
        note: note.trim() || undefined,
        requestKey: requestKey.current,
        currentPassword: password,
        ...(overLimitPrompt
          ? { confirmOverLimit: true, overLimitReason: overLimitReason.trim() }
          : {}),
      });
      let slipNote = "";
      if (slip) {
        try {
          await uploadImage("/admin/orders/" + result.order.id + "/slip", await toWebp(slip, 1600));
        } catch (err) {
          slipNote = " · แนบสลิปไม่สำเร็จ (" + (err as Error).message + ") แนบใหม่ได้ในหน้าออเดอร์";
        }
      }
      toast(
        (result.order.status === "PREORDER" ? "สร้างพรีออเดอร์ เข้าคิวแล้ว " : "สร้างออเดอร์และส่งของให้ลูกค้าแล้ว ") +
          shortId(result.order.id) +
          slipNote,
      );
      go("/admin/orders/" + result.order.id);
    } catch (err) {
      const message = (err as Error).message;
      // Storefront limit copy: "สินค้านี้จำกัด N ชิ้นต่อบัญชี…" — offer an audited override.
      if (!overLimitPrompt && /จำกัด\s*\d+\s*ชิ้นต่อบัญชี/.test(message)) {
        setOverLimitPrompt(true);
        setOverLimitReason("");
        setError(message);
      } else {
        setError(message);
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link to="/admin/orders" className="back-link">
        <ArrowLeft size={15} />
        ออเดอร์
      </Link>
      <div className="reference-admin-heading">
        <div>
          <h1>สร้างออเดอร์ให้ลูกค้า</h1>
          <p>สำหรับลูกค้าที่โอนเงินนอกเว็บแล้ว ระบบส่งของและนับยอดเหมือนออเดอร์ปกติ ไม่ใช้เครดิตของลูกค้า</p>
        </div>
      </div>
      <form className="manual-order-layout" onSubmit={confirming ? submit : review} noValidate>
        <div className="manual-order-main">
          <section className="reference-admin-card admin-detail-card">
            <h2>1. ลูกค้า</h2>
            {customer ? (
              <div className="manual-order-picked">
                <UserRound size={18} />
                <span>
                  {customer.name}
                  <small>{customer.email.endsWith(".local") ? (customer.username ?? "") : customer.email}</small>
                </span>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => {
                    setCustomer(null);
                    setCustomerQuery("");
                  }}
                >
                  <X size={15} />
                  เปลี่ยน
                </button>
              </div>
            ) : (
              <>
                <label className="field">
                  ค้นหาลูกค้า
                  <input
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    placeholder="ชื่อ อีเมล หรือชื่อผู้ใช้ อย่างน้อย 2 ตัวอักษร"
                    maxLength={80}
                    autoFocus
                  />
                </label>
                {hits && hits.length === 0 && <p className="muted">ไม่พบลูกค้าที่ตรงกับคำค้น</p>}
                {hits && hits.length > 0 && (
                  <ul className="manual-order-hits" aria-label="ผลการค้นหาลูกค้า">
                    {hits.map((c) => {
                      const blocked = !!c.status && c.status !== "ACTIVE";
                      return (
                        <li key={c.id}>
                          <button type="button" disabled={blocked} onClick={() => setCustomer(c)}>
                            <span>
                              {c.name}
                              <small>
                                {c.email.endsWith(".local") ? (c.username ?? "—") : c.email}
                                {blocked && " · ถูกระงับ"}
                              </small>
                            </span>
                            {!blocked && <Plus size={15} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="reference-admin-card admin-detail-card">
            <h2>2. สินค้า</h2>
            <div className="manual-order-row">
              <label className="field">
                สินค้า
                <select
                  aria-label="สินค้า"
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    const next = sellable.find((p) => p.id === e.target.value);
                    setVariantId(next?.variants.length === 1 ? next.variants[0].id : "");
                    setPriceText("");
                  }}
                >
                  <option value="">เลือกสินค้า</option>
                  {sellable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.preorder ? " (พรีออเดอร์)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                ตัวเลือก
                <select
                  aria-label="ตัวเลือก"
                  value={variantId}
                  disabled={!product}
                  onChange={(e) => {
                    setVariantId(e.target.value);
                    setPriceText("");
                  }}
                >
                  <option value="">เลือกตัวเลือก</option>
                  {product?.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} · {money(v.price)}
                      {product.preorder ? "" : " · เหลือ " + v.stock}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field manual-order-qty">
                จำนวน
                <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} maxLength={2} />
              </label>
            </div>
            {product?.preorder ? (
              <p className="field-help">สินค้าพรีออเดอร์: ระบบสร้างคิวที่ชำระแล้ว ส่งของภายหลังจากหน้าคิวพรีออเดอร์</p>
            ) : (
              variant && <p className="field-help">ส่งของทันทีจากสต็อก (บัญชีที่ใกล้หมดอายุก่อนส่งก่อน)</p>
            )}
          </section>

          <section className="reference-admin-card admin-detail-card">
            <h2>3. ราคาและโค้ดส่วนลด</h2>
            <div className="manual-order-row">
              <label className="field">
                ราคาต่อชิ้น (บาท)
                <input
                  inputMode="decimal"
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  placeholder={variant ? "ราคาปกติ " + ((quote?.normalUnitPrice ?? variant.price) / 100).toFixed(2) : "เลือกสินค้าก่อน"}
                  disabled={!variant}
                />
              </label>
              <label className="field">
                โค้ดส่วนลด (ไม่บังคับ)
                <input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  maxLength={32}
                  placeholder="เช่น WELCOME10"
                />
              </label>
            </div>
            <p className="field-help">เว้นว่าง = ราคาปกติของร้าน · ถ้าเปลี่ยนราคาต้องใส่เหตุผล</p>
            {priceChanged && (
              <label className="field">
                เหตุผลที่เปลี่ยนราคา (บันทึกภายใน)
                <input value={priceReason} onChange={(e) => setPriceReason(e.target.value)} maxLength={300} placeholder="เช่น ลูกค้าประจำ ตกลงราคาทาง LINE" />
              </label>
            )}
          </section>

          <section className="reference-admin-card admin-detail-card">
            <h2>4. การชำระเงิน</h2>
            <fieldset className="refund-destination manual-order-method">
              <legend>ช่องทางชำระ</legend>
              <label className="selected">
                <input type="radio" name="manual-method" checked readOnly />
                <span>
                  <Banknote size={15} /> โอนนอกเว็บ
                  <small>ลูกค้าโอนผ่านธนาคารหรือ LINE แล้ว ร้านตรวจยอดเอง</small>
                </span>
              </label>
            </fieldset>
            <label className="field">
              เลขอ้างอิงการโอน
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="เช่น เลขที่รายการธนาคาร หรือเวลาโอน" />
            </label>
            <label className="field">
              หมายเหตุ (ไม่บังคับ)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="เช่น ลูกค้าแจ้งทาง LINE" />
            </label>
            <div className="manual-order-slip-pick">
              <label className="button secondary manual-order-file">
                <FileImage size={15} />
                {slip ? "เปลี่ยนสลิป" : "แนบสลิป (ไม่บังคับ)"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (file && checkSource(file)) return setError(checkSource(file));
                    setSlip(file);
                  }}
                />
              </label>
              {slip && (
                <span className="manual-order-slip-name">
                  {slip.name}
                  <button type="button" className="button ghost" aria-label="เอาสลิปออก" onClick={() => setSlip(null)}>
                    <X size={14} />
                  </button>
                </span>
              )}
            </div>
          </section>
        </div>

        <aside className="reference-admin-card admin-detail-card manual-order-summary" aria-label="สรุปออเดอร์">
          <h2>สรุป</h2>
          {!customer || !variant ? (
            <p className="muted">เลือกลูกค้าและสินค้าเพื่อดูยอด</p>
          ) : quoting && !quote ? (
            <p className="muted">
              <LoaderCircle className="spin" size={14} /> กำลังคำนวณ…
            </p>
          ) : quote ? (
            <>
              <dl className="manual-order-totals">
                <div>
                  <dt>ราคาปกติ</dt>
                  <dd>{money(quote.normalUnitPrice)} × {qty}</dd>
                </div>
                {quote.priceChanged && (
                  <div>
                    <dt>ราคาที่เก็บ</dt>
                    <dd>{money(quote.unitPrice)} × {qty}</dd>
                  </div>
                )}
                {quote.discount > 0 && (
                  <div>
                    <dt>ส่วนลด {quote.couponCode}</dt>
                    <dd className="negative">−{money(quote.discount)}</dd>
                  </div>
                )}
                <div className="is-total">
                  <dt>ยอดที่ลูกค้าโอน</dt>
                  <dd>{money(quote.total)}</dd>
                </div>
              </dl>
              {quote.couponError && <p className="manual-order-warn">{quote.couponError}</p>}
              {!quote.enoughStock && <p className="manual-order-warn">สินค้าคงเหลือไม่พอสำหรับจำนวนนี้</p>}
              <p className="field-help">
                {quote.preorder ? "เข้าคิวพรีออเดอร์ทันที" : "ส่งรหัสให้ลูกค้าทันที"} · ลูกค้าได้รับแจ้งเตือน · ไม่ตัดเครดิตลูกค้า
                {quote.warrantyDays > 0 && " · รับประกัน " + quote.warrantyDays + " วัน"}
              </p>
            </>
          ) : (
            <ErrorMessage message={quoteError} />
          )}
          <ErrorMessage message={error} />
          {confirming && quote ? (
            <div className="manual-confirm" role="group" aria-label="ยืนยันสร้างออเดอร์">
              <p>
                สร้างออเดอร์ให้ <strong>{customer?.name}</strong> ยอด <strong>{money(quote.total)}</strong>
              </p>
              <small>โอนนอกเว็บ · อ้างอิง {reference.trim()} · ยกเลิกเองไม่ได้ ต้องใช้การคืนเงิน</small>
              {overLimitPrompt && (
                <label className="field">
                  เหตุผลที่ยืนยันเกินลิมิตต่อบัญชี
                  <textarea
                    name="overLimitReason"
                    rows={2}
                    maxLength={300}
                    required
                    value={overLimitReason}
                    onChange={(e) => setOverLimitReason(e.target.value)}
                    placeholder="เช่น ลูกค้าโอนเพิ่มนอกเว็บตามตกลง"
                    autoFocus
                  />
                </label>
              )}
              <label className="field">
                รหัสผ่านของคุณ
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus={!overLimitPrompt}
                />
              </label>
              <div className="admin-action-row">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setOverLimitPrompt(false);
                    setOverLimitReason("");
                  }}
                >
                  แก้ไข
                </button>
                <button
                  className="button primary"
                  disabled={busy || !password || (overLimitPrompt && overLimitReason.trim().length < 3)}
                >
                  {busy
                    ? "กำลังสร้าง…"
                    : overLimitPrompt
                      ? "ยืนยันเกินลิมิต " + money(quote.total)
                      : "ยืนยันสร้างออเดอร์ " + money(quote.total)}
                </button>
              </div>
            </div>
          ) : (
            <button className="button primary full" disabled={busy}>
              ตรวจสอบก่อนสร้าง
            </button>
          )}
        </aside>
      </form>
    </>
  );
}
