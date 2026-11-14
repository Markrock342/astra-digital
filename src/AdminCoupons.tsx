// /admin/coupons — discount codes (ADMIN only). Layout follows the shadcn/ui
// "Tasks" data-table (MIT): search + status tabs → table with row actions, and the
// shadcn/ui form pattern for the editor (label, control, help text, live summary).
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Copy, LoaderCircle, Plus, Power, Search, TicketPercent } from "lucide-react";
import { ErrorMessage, Link, Status, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { confirmDialog } from "./dialogs";
import { useLive } from "./live";

export type CouponStatus = "active" | "scheduled" | "expired" | "used_up" | "disabled";
export type Coupon = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  maxDiscount: number | null;
  minTotal: number;
  startsAt: string | null;
  endsAt: string | null;
  startsAtLocal: string | null;
  endsAtLocal: string | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  scope: "ALL" | "PRODUCTS";
  products: { id: string; name: string }[];
  firstOrderOnly: boolean;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  uses: number;
  paidUses: number;
  discountGiven: number;
  status: CouponStatus;
};
type Redemption = {
  id: string;
  amount: number;
  created_at: string;
  released_at: string | null;
  released_reason: string | null;
  order_id: string;
  preorder: boolean;
  order_status: string | null;
  customer_id: string | null;
  customer: string | null;
  customer_email: string | null;
  paid: boolean;
};

const STATUS_TEXT: Record<CouponStatus, string> = {
  active: "ใช้งานอยู่",
  scheduled: "ตั้งเวลาไว้",
  expired: "หมดอายุ",
  used_up: "ใช้ครบแล้ว",
  disabled: "ปิดใช้งาน",
};
const STATUS_TABS: [string, string][] = [
  ["", "ทั้งหมด"],
  ["active", "ใช้งานอยู่"],
  ["scheduled", "ตั้งเวลาไว้"],
  ["expired", "หมดอายุ"],
  ["used_up", "ใช้ครบแล้ว"],
  ["disabled", "ปิดใช้งาน"],
];
const RELEASE_TEXT: Record<string, string> = {
  CANCELLED: "ยกเลิกออเดอร์",
  PAYMENT_FAILED: "ชำระไม่สำเร็จ",
  OUT_OF_STOCK: "สินค้าหมด",
  EXPIRED: "หมดเวลาชำระ",
};

export function CouponStatusPill({ status }: { status: CouponStatus }) {
  return <span className={"status coupon-status coupon-status-" + status}>{STATUS_TEXT[status]}</span>;
}

/** ฿50 / ฿49.50 — short baht for sentences. */
const baht = (satang: number) => {
  const value = satang / 100;
  return (
    "฿" +
    value.toLocaleString("th-TH", {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
};
/** "31 ธ.ค." in Bangkok time; the year is added when it is not this year. */
const thaiDay = (ms: number) => {
  const year = (d: number) => new Date(d + 7 * 3600000).getUTCFullYear();
  return new Date(ms).toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    ...(year(ms) !== year(Date.now()) ? { year: "numeric" } : {}),
  });
};
const localMs = (local: string | null | undefined) => {
  if (!local) return null;
  const ms = Date.parse((local.length === 10 ? local + "T00:00" : local) + ":00+07:00");
  return Number.isFinite(ms) ? ms : null;
};

type SummaryInput = {
  type: "PERCENT" | "FIXED";
  value: number | null;
  maxDiscount: number | null;
  minTotal: number;
  startsAtLocal: string | null;
  endsAtLocal: string | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  scope: "ALL" | "PRODUCTS";
  productNames: string[];
  firstOrderOnly: boolean;
};
/** One sentence a shop owner can read back, e.g. "ลด 10% สูงสุด ฿50 เมื่อซื้อครบ ฿100 ใช้ได้ 1 ครั้งต่อคน ถึง 31 ธ.ค." */
export function couponSentence(c: SummaryInput) {
  if (!c.value) return "ใส่มูลค่าส่วนลดเพื่อดูสรุป";
  const parts = [c.type === "PERCENT" ? "ลด " + c.value + "%" : "ลด " + baht(c.value)];
  if (c.type === "PERCENT" && c.maxDiscount) parts.push("สูงสุด " + baht(c.maxDiscount));
  if (c.minTotal > 0) parts.push("เมื่อซื้อครบ " + baht(c.minTotal));
  if (c.scope === "PRODUCTS")
    parts.push(
      c.productNames.length === 1
        ? "เฉพาะ " + c.productNames[0]
        : "เฉพาะสินค้าที่เลือก " + c.productNames.length + " รายการ",
    );
  if (c.firstOrderOnly) parts.push("เฉพาะคำสั่งซื้อแรก");
  if (c.perUserLimit) parts.push("ใช้ได้ " + c.perUserLimit + " ครั้งต่อคน");
  if (c.usageLimit) parts.push("รวม " + c.usageLimit.toLocaleString("th-TH") + " สิทธิ์");
  const start = localMs(c.startsAtLocal);
  const end = localMs(c.endsAtLocal);
  if (start && start > Date.now()) parts.push("เริ่ม " + thaiDay(start));
  if (end) parts.push("ถึง " + thaiDay(end));
  return parts.join(" ");
}
const sentenceOf = (c: Coupon) =>
  couponSentence({ ...c, productNames: c.products.map((p) => p.name) });

// ---------------------------------------------------------------- list

function CouponList() {
  const { go, toast } = useStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useLive(["orders"], () => setTick((n) => n + 1));
  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    const timer = setTimeout(() => {
      api<{ coupons: Coupon[]; counts: Record<string, number> }>(
        "/admin/coupons" + (params.size ? "?" + params : ""),
      )
        .then((data) => {
          setRows(data.coupons);
          setCounts(data.counts);
          setError("");
        })
        .catch((e) => setError((e as Error).message));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, status, tick]);
  async function duplicate(c: Coupon) {
    try {
      const { coupon } = await api<{ coupon: Coupon }>("/admin/coupons/" + c.id + "/duplicate", {});
      toast("คัดลอกเป็น " + coupon.code + " แล้ว (ปิดใช้งานไว้ก่อน)");
      go("/admin/coupons/" + coupon.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function disable(c: Coupon) {
    if (!(await confirmDialog({ title: "ปิดใช้งานโค้ด " + c.code + "? ลูกค้าจะใช้โค้ดนี้ไม่ได้อีก ออเดอร์ที่ใช้ไปแล้วไม่เปลี่ยน", danger: true }))) return;
    try {
      await api("/admin/coupons/" + c.id + "/disable", {});
      toast("ปิดใช้งาน " + c.code + " แล้ว");
      setTick((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>คูปองส่วนลด</h1>
          <p>โค้ดที่ลูกค้าใส่ตอนสั่งซื้อ ระบบคำนวณส่วนลดฝั่งเซิร์ฟเวอร์และนับสิทธิ์ให้อัตโนมัติ</p>
        </div>
        <Link to="/admin/coupons/new" className="button primary">
          <Plus size={16} />
          สร้างคูปอง
        </Link>
      </div>
      <div className="admin-filters" role="search">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="ค้นหาโค้ด"
            placeholder="ค้นหาโค้ด"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      <div className="reference-status-tabs order-status-tabs" role="tablist" aria-label="สถานะคูปอง">
        {STATUS_TABS.map(([key, label]) => (
          <button
            key={key || "all"}
            type="button"
            role="tab"
            aria-selected={status === key}
            className={status === key ? "active" : ""}
            onClick={() => setStatus(key)}
          >
            {label}
            <span className="tab-count" aria-label={(counts[key || "all"] ?? 0) + " รายการ"}>
              {(counts[key || "all"] ?? 0).toLocaleString("th-TH")}
            </span>
          </button>
        ))}
      </div>
      <ErrorMessage message={error} />
      <div className="table-scroll reference-table admin-list-table coupon-table">
        <table>
          <thead>
            <tr>
              <th>โค้ด</th>
              <th>สถานะ</th>
              <th className="num">ใช้แล้ว</th>
              <th className="num">ส่วนลดที่ให้ไป</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((c) => (
              <tr key={c.id} className="admin-row-link" onClick={() => go("/admin/coupons/" + c.id)}>
                <td>
                  <Link to={"/admin/coupons/" + c.id} className="coupon-code">
                    {c.code}
                  </Link>
                  <small>{sentenceOf(c)}</small>
                </td>
                <td>
                  <CouponStatusPill status={c.status} />
                </td>
                <td className="num">
                  {c.uses.toLocaleString("th-TH")}
                  {c.usageLimit ? " / " + c.usageLimit.toLocaleString("th-TH") : ""}
                  <small>ชำระแล้ว {c.paidUses}</small>
                </td>
                <td className="num">{money(c.discountGiven)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <span className="coupon-row-actions">
                    <button type="button" className="button ghost" onClick={() => duplicate(c)}>
                      <Copy size={14} />
                      คัดลอก
                    </button>
                    {c.active && (
                      <button type="button" className="button ghost" onClick={() => disable(c)}>
                        <Power size={14} />
                        ปิดใช้งาน
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows === null && !error && <p className="reference-empty-text">กำลังโหลด…</p>}
        {rows?.length === 0 && (
          <div className="coupon-empty">
            <TicketPercent size={22} />
            <p>{q || status ? "ไม่พบคูปองตามตัวกรอง" : "ยังไม่มีคูปอง สร้างโค้ดแรกเพื่อให้ลูกค้าใช้ตอนสั่งซื้อ"}</p>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- editor

type FormState = {
  code: string;
  type: "PERCENT" | "FIXED";
  value: string;
  maxDiscount: string;
  minTotal: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perUserLimit: string;
  scope: "ALL" | "PRODUCTS";
  productIds: string[];
  firstOrderOnly: boolean;
  active: boolean;
};
const emptyForm: FormState = {
  code: "",
  type: "PERCENT",
  value: "",
  maxDiscount: "",
  minTotal: "",
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  perUserLimit: "1",
  scope: "ALL",
  productIds: [],
  firstOrderOnly: false,
  active: true,
};
const bahtText = (satang: number | null) => (satang == null ? "" : String(satang / 100));
const formFrom = (c: Coupon): FormState => ({
  code: c.code,
  type: c.type,
  value: c.type === "PERCENT" ? String(c.value) : bahtText(c.value),
  maxDiscount: bahtText(c.maxDiscount),
  minTotal: c.minTotal ? bahtText(c.minTotal) : "",
  startsAt: c.startsAtLocal ?? "",
  endsAt: c.endsAtLocal ?? "",
  usageLimit: c.usageLimit ? String(c.usageLimit) : "",
  perUserLimit: c.perUserLimit ? String(c.perUserLimit) : "",
  scope: c.scope,
  productIds: c.products.map((p) => p.id),
  firstOrderOnly: c.firstOrderOnly,
  active: c.active,
});
/** Baht text → satang, or null when empty / not a number. */
const satangOf = (text: string) => {
  const n = Number(text.replace(/,/g, "").trim());
  return text.trim() && Number.isFinite(n) ? Math.round(n * 100) : null;
};
const intOf = (text: string) => {
  const n = Number(text.trim());
  return text.trim() && Number.isInteger(n) ? n : null;
};

function CouponEditor({ id }: { id: string }) {
  const { go, toast } = useStore();
  const isNew = id === "new";
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  async function load() {
    if (isNew) return;
    try {
      const [{ coupon: c }, { redemptions: r }] = await Promise.all([
        api<{ coupon: Coupon }>("/admin/coupons/" + id),
        api<{ redemptions: Redemption[] }>("/admin/coupons/" + id + "/redemptions"),
      ]);
      setCoupon(c);
      setForm(formFrom(c));
      setRedemptions(r);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setCoupon(null);
    setRedemptions(null);
    setForm(emptyForm);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    (async () => {
      const list: { id: string; name: string }[] = [];
      let cursor: string | null = null;
      try {
        do {
          const page: { products: { id: string; name: string }[]; nextCursor: string | null } = await api(
            "/admin/products?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          );
          list.push(...page.products.map((p) => ({ id: p.id, name: p.name })));
          cursor = page.nextCursor;
        } while (cursor && list.length < 1000);
      } catch {
        // product picker stays empty; the server still validates the ids
      }
      setProducts(list);
    })();
  }, []);
  const productNames = useMemo(
    () => form.productIds.map((pid) => products.find((p) => p.id === pid)?.name ?? pid),
    [form.productIds, products],
  );
  const sentence = couponSentence({
    type: form.type,
    value: form.type === "PERCENT" ? intOf(form.value) : satangOf(form.value),
    maxDiscount: satangOf(form.maxDiscount),
    minTotal: satangOf(form.minTotal) ?? 0,
    startsAtLocal: form.startsAt || null,
    endsAtLocal: form.endsAt || null,
    usageLimit: intOf(form.usageLimit),
    perUserLimit: intOf(form.perUserLimit),
    scope: form.scope,
    productNames,
    firstOrderOnly: form.firstOrderOnly,
  });
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const value = form.type === "PERCENT" ? intOf(form.value) : satangOf(form.value);
    if (value == null) return setError(form.type === "PERCENT" ? "กรุณาใส่เปอร์เซ็นต์ส่วนลด 1–90" : "กรุณาใส่จำนวนเงินส่วนลด");
    if (form.scope === "PRODUCTS" && form.productIds.length === 0)
      return setError("กรุณาเลือกสินค้าที่ใช้โค้ดได้อย่างน้อย 1 รายการ");
    const payload = {
      code: form.code.trim().toUpperCase(),
      type: form.type,
      value,
      maxDiscount: form.type === "PERCENT" ? satangOf(form.maxDiscount) : null,
      minTotal: satangOf(form.minTotal) ?? 0,
      startsAt: form.startsAt,
      endsAt: form.endsAt,
      usageLimit: intOf(form.usageLimit),
      perUserLimit: intOf(form.perUserLimit),
      scope: form.scope,
      productIds: form.scope === "PRODUCTS" ? form.productIds : [],
      firstOrderOnly: form.firstOrderOnly,
      active: form.active,
    };
    setBusy(true);
    try {
      const result = isNew
        ? await api<{ coupon: Coupon }>("/admin/coupons", payload)
        : await api<{ coupon: Coupon }>("/admin/coupons/" + id, payload, "PATCH");
      toast(isNew ? "สร้างคูปอง " + result.coupon.code + " แล้ว" : "บันทึกคูปองแล้ว");
      if (isNew) go("/admin/coupons/" + result.coupon.id);
      else {
        setCoupon(result.coupon);
        setForm(formFrom(result.coupon));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function duplicate() {
    try {
      const { coupon: copy } = await api<{ coupon: Coupon }>("/admin/coupons/" + id + "/duplicate", {});
      toast("คัดลอกเป็น " + copy.code + " แล้ว (ปิดใช้งานไว้ก่อน)");
      go("/admin/coupons/" + copy.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function disable() {
    if (!coupon || !(await confirmDialog({ title: "ปิดใช้งานโค้ด " + coupon.code + "? ลูกค้าจะใช้โค้ดนี้ไม่ได้อีก ออเดอร์ที่ใช้ไปแล้วไม่เปลี่ยน", danger: true }))) return;
    try {
      const { coupon: c } = await api<{ coupon: Coupon }>("/admin/coupons/" + id + "/disable", {});
      setCoupon(c);
      setForm(formFrom(c));
      toast("ปิดใช้งาน " + c.code + " แล้ว");
    } catch (err) {
      setError((err as Error).message);
    }
  }
  if (!isNew && !coupon)
    return (
      <>
        <Link to="/admin/coupons" className="back-link">
          <ArrowLeft size={15} />
          คูปองทั้งหมด
        </Link>
        <ErrorMessage message={error} />
        {!error && (
          <div className="loading-row">
            <LoaderCircle className="spin" />
            กำลังโหลด
          </div>
        )}
      </>
    );
  return (
    <>
      <Link to="/admin/coupons" className="back-link">
        <ArrowLeft size={15} />
        คูปองทั้งหมด
      </Link>
      <div className="reference-admin-heading">
        <div>
          <h1>{isNew ? "สร้างคูปอง" : coupon!.code}</h1>
          <p>
            {isNew
              ? "ตั้งโค้ด มูลค่าส่วนลด และเงื่อนไข เวลาทั้งหมดเป็นเวลาไทย"
              : "สร้างโดย " + (coupon!.createdBy ?? "–") + " · " + dateTime(coupon!.createdAt)}
          </p>
        </div>
        {!isNew && (
          <div className="coupon-heading-actions">
            <CouponStatusPill status={coupon!.status} />
            <button type="button" className="button secondary" onClick={duplicate}>
              <Copy size={15} />
              คัดลอก
            </button>
            {coupon!.active && (
              <button type="button" className="button secondary" onClick={disable}>
                <Power size={15} />
                ปิดใช้งาน
              </button>
            )}
          </div>
        )}
      </div>
      <div className="coupon-editor-layout">
        <form className="coupon-editor-form" onSubmit={save}>
          <section className="reference-admin-card editor-panel">
            <h2>โค้ดและมูลค่า</h2>
            <label className="field">
              โค้ดส่วนลด
              <input
                name="code"
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,30}[A-Za-z0-9]"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="coupon-code-input"
                value={form.code}
                onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                placeholder="เช่น WELCOME10"
              />
              <small>ตัวอักษร A–Z ตัวเลข และขีด (-) ยาว 3–32 ตัว ลูกค้าพิมพ์ตัวเล็กหรือใหญ่ก็ได้</small>
            </label>
            <fieldset className="product-type-group coupon-type-group">
              <legend className="field">ประเภทส่วนลด</legend>
              {(
                [
                  ["PERCENT", "ลดเป็นเปอร์เซ็นต์", "1–90% ของยอดสินค้า ตั้งเพดานส่วนลดได้"],
                  ["FIXED", "ลดเป็นจำนวนเงิน", "ลดเป็นบาทจากยอดสินค้า"],
                ] as const
              ).map(([value, label, help]) => (
                <label className="product-type-option" key={value}>
                  <input
                    type="radio"
                    name="type"
                    value={value}
                    checked={form.type === value}
                    onChange={() => set({ type: value, value: "", maxDiscount: "" })}
                  />
                  <TicketPercent size={20} />
                  <div>
                    <strong>{label}</strong>
                    <small>{help}</small>
                  </div>
                </label>
              ))}
            </fieldset>
            <div className="admin-form-grid">
              <label className="field">
                {form.type === "PERCENT" ? "ส่วนลด (%)" : "ส่วนลด (บาท)"}
                <input
                  name="value"
                  type="number"
                  inputMode="decimal"
                  required
                  min={1}
                  max={form.type === "PERCENT" ? 90 : 100000}
                  step={form.type === "PERCENT" ? 1 : 0.01}
                  value={form.value}
                  onChange={(e) => set({ value: e.target.value })}
                />
              </label>
              {form.type === "PERCENT" ? (
                <label className="field">
                  ส่วนลดสูงสุด (บาท)
                  <input
                    name="maxDiscount"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step={0.01}
                    placeholder="ไม่จำกัด"
                    value={form.maxDiscount}
                    onChange={(e) => set({ maxDiscount: e.target.value })}
                  />
                </label>
              ) : (
                <span aria-hidden="true" />
              )}
              <label className="field span-2">
                ยอดสั่งซื้อขั้นต่ำ (บาท)
                <input
                  name="minTotal"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  placeholder="ไม่มีขั้นต่ำ"
                  value={form.minTotal}
                  onChange={(e) => set({ minTotal: e.target.value })}
                />
                <small>เทียบกับยอดก่อนหักส่วนลด ทุกออเดอร์ต้องชำระอย่างน้อย ฿1</small>
              </label>
            </div>
          </section>
          <section className="reference-admin-card editor-panel">
            <h2>ช่วงเวลาและจำนวนสิทธิ์</h2>
            <div className="admin-form-grid">
              <label className="field">
                เริ่มใช้ได้ (เวลาไทย)
                <input
                  name="startsAt"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => set({ startsAt: e.target.value })}
                />
                <small>เว้นว่าง = ใช้ได้ทันที</small>
              </label>
              <label className="field">
                หมดอายุ (เวลาไทย)
                <input
                  name="endsAt"
                  type="datetime-local"
                  value={form.endsAt}
                  min={form.startsAt || undefined}
                  onChange={(e) => set({ endsAt: e.target.value })}
                />
                <small>เว้นว่าง = ไม่มีวันหมดอายุ</small>
              </label>
              <label className="field">
                จำนวนสิทธิ์ทั้งหมด
                <input
                  name="usageLimit"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="ไม่จำกัด"
                  value={form.usageLimit}
                  onChange={(e) => set({ usageLimit: e.target.value })}
                />
              </label>
              <label className="field">
                ใช้ได้กี่ครั้งต่อคน
                <input
                  name="perUserLimit"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="ไม่จำกัด"
                  value={form.perUserLimit}
                  onChange={(e) => set({ perUserLimit: e.target.value })}
                />
              </label>
            </div>
            <p className="field-help">
              ออเดอร์ที่ยังไม่ชำระนับเป็น 1 สิทธิ์ ถ้ายกเลิก ชำระไม่สำเร็จ หรือหมดเวลาชำระ ระบบคืนสิทธิ์ให้อัตโนมัติ
            </p>
          </section>
          <section className="reference-admin-card editor-panel">
            <h2>ใช้กับ</h2>
            <fieldset className="coupon-scope">
              <legend className="sr-only">ขอบเขตสินค้า</legend>
              <label className="checkbox-label">
                <input
                  type="radio"
                  name="scope"
                  checked={form.scope === "ALL"}
                  onChange={() => set({ scope: "ALL" })}
                />
                ทุกสินค้า
              </label>
              <label className="checkbox-label">
                <input
                  type="radio"
                  name="scope"
                  checked={form.scope === "PRODUCTS"}
                  onChange={() => set({ scope: "PRODUCTS" })}
                />
                เฉพาะสินค้าที่เลือก
              </label>
            </fieldset>
            {form.scope === "PRODUCTS" && (
              <div className="coupon-product-list" role="group" aria-label="สินค้าที่ใช้โค้ดได้">
                {products.length === 0 && <p className="muted">กำลังโหลดสินค้า…</p>}
                {products.map((p) => (
                  <label className="checkbox-label" key={p.id}>
                    <input
                      type="checkbox"
                      checked={form.productIds.includes(p.id)}
                      onChange={(e) =>
                        set({
                          productIds: e.target.checked
                            ? [...form.productIds, p.id]
                            : form.productIds.filter((x) => x !== p.id),
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.firstOrderOnly}
                onChange={(e) => set({ firstOrderOnly: e.target.checked })}
              />
              เฉพาะคำสั่งซื้อแรกของลูกค้า
            </label>
            <p className="field-help">ลูกค้าที่เคยชำระออเดอร์แล้วจะใช้โค้ดนี้ไม่ได้</p>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
              เปิดใช้งานโค้ด
            </label>
          </section>
          <ErrorMessage message={error} />
          <div className="editor-save-bar">
            <span>ตรวจสรุปเงื่อนไขด้านขวาก่อนบันทึก</span>
            <Link className="button secondary" to="/admin/coupons">
              ยกเลิก
            </Link>
            <button className="button primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : null}
              {isNew ? "สร้างคูปอง" : "บันทึก"}
            </button>
          </div>
        </form>
        <aside className="coupon-summary-col">
          <section className="reference-admin-card coupon-summary-card" aria-live="polite">
            <small>สรุปเงื่อนไข</small>
            <p className="coupon-ticket">
              <TicketPercent size={18} />
              <strong>{form.code || "โค้ดของคุณ"}</strong>
            </p>
            <p className="coupon-sentence" data-testid="coupon-sentence">
              {sentence}
            </p>
            {!form.active && <p className="muted">ปิดใช้งานอยู่ ลูกค้ายังใช้ไม่ได้</p>}
          </section>
          {coupon && (
            <div className="admin-stat-row coupon-stats">
              {[
                ["ใช้แล้ว", coupon.uses + (coupon.usageLimit ? " / " + coupon.usageLimit : "")],
                ["ชำระแล้ว", String(coupon.paidUses)],
                ["ส่วนลดที่ให้ไป", money(coupon.discountGiven)],
              ].map(([label, value]) => (
                <div className="reference-admin-card" key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
      {coupon && (
        <section className="reference-admin-card admin-detail-card">
          <h2>ประวัติการใช้โค้ด</h2>
          <div className="table-scroll reference-table admin-list-table">
            <table>
              <thead>
                <tr>
                  <th>ออเดอร์</th>
                  <th>ลูกค้า</th>
                  <th className="num">ส่วนลด</th>
                  <th>สถานะ</th>
                  <th>วันที่</th>
                </tr>
              </thead>
              <tbody>
                {redemptions?.map((r) => (
                  <tr key={r.id} className={r.released_at ? "coupon-released" : ""}>
                    <td>
                      <Link to={"/admin/orders/" + r.order_id} className="order-number">
                        #{r.order_id.slice(0, 8).toUpperCase()}
                      </Link>
                      <small>{r.preorder ? "พรีออเดอร์" : "พร้อมส่ง"}</small>
                    </td>
                    <td>
                      {r.customer_id ? <Link to={"/admin/customers/" + r.customer_id}>{r.customer}</Link> : "–"}
                      <small>{r.customer_email}</small>
                    </td>
                    <td className="num">{money(r.amount)}</td>
                    <td>
                      {r.released_at ? (
                        <span className="status coupon-status-disabled">
                          คืนสิทธิ์แล้ว · {RELEASE_TEXT[r.released_reason ?? ""] ?? r.released_reason}
                        </span>
                      ) : r.paid ? (
                        <span className="status coupon-status-active">ชำระแล้ว</span>
                      ) : r.order_status ? (
                        <Status status={r.order_status} />
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="nowrap">{dateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {redemptions?.length === 0 && <p className="reference-empty-text">ยังไม่มีลูกค้าใช้โค้ดนี้</p>}
          </div>
        </section>
      )}
    </>
  );
}

export function AdminCoupons({ id }: { id?: string }) {
  return id ? <CouponEditor id={id} /> : <CouponList />;
}
