import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Package,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  X,
} from "lucide-react";
import {
  Art,
  Empty,
  ErrorMessage,
  Link,
  ProductCard,
  Quantity,
  usePageTitle,
  useStore,
} from "./App";
import { t } from "./i18n";
import { BrandLogo, shopName } from "./Theme";
import { WarrantyDays } from "./Warranty";
import { api, dateTime, money } from "./api";
import type { Order, Product, Review } from "./types";
import { MAX_PER_ORDER } from "./types";
export function ReferenceCatalog() {
  const { products, loading } = useStore();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const filtered = products
    .filter((p) =>
      (p.name + " " + p.description)
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "low"
        ? Math.min(...a.variants.map((v) => v.price)) -
          Math.min(...b.variants.map((v) => v.price))
        : sort === "high"
          ? Math.min(...b.variants.map((v) => v.price)) -
            Math.min(...a.variants.map((v) => v.price))
          : b.featured - a.featured,
    );
  return (
    <section className="reference-catalog">
      <div className="reference-catalog-title">
        <h2>{t("สินค้าทั้งหมด")}</h2>
        <p>{filtered.length}{" "}{t("รายการ")}</p>
      </div>
      <div className="reference-catalog-tools">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label={t("ค้นหาสินค้า")}
            placeholder={t("ค้นหา")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label={t("ล้างการค้นหา")}
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <label className="sort-field">
          <select
            aria-label={t("เรียงสินค้า")}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="featured">{t("แนะนำ")}</option>
            <option value="low">{t("ราคา: ต่ำไปสูง")}</option>
            <option value="high">{t("ราคา: สูงไปต่ำ")}</option>
          </select>
        </label>
      </div>
      {loading ? (
        <div className="product-grid">
          {[1, 2].map((i) => (
            <div className="product-skeleton" key={i} />
          ))}
        </div>
      ) : filtered.length ? (
        <div className="product-grid">
          {filtered.map((p) => (
            <ProductCard product={p} key={p.id} />
          ))}
        </div>
      ) : (
        <Empty
          icon={<Search />}
          heading={query ? t("ไม่พบสินค้าที่ค้นหา") : t("ยังไม่มีสินค้า")}
          description={
            query
              ? t("ลองค้นหาด้วยคำอื่น")
              : t("สินค้ากำลังมาเร็วๆ นี้")
          }
          action={
            query ? (
              <button className="button secondary" onClick={() => setQuery("")}>
                {t("ล้างตัวกรอง")}
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
export function ReferenceCatalogPage() {
  return (
    <main className="container page-main reference-catalog-page">
      <div className="page-heading">
        <h1>{t("สินค้า")}</h1>
        <p>{t("สินค้าทั้งหมดของร้าน")}</p>
      </div>
      <ReferenceCatalog />
    </main>
  );
}
export function ReferenceAuth({ register = false }: { register?: boolean }) {
  const { user, go, refresh, toast, overview } = useStore();
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(location.search).get("next");
  const target =
    next?.startsWith("/") && !next.startsWith("//") ? next : "/account";
  useEffect(() => {
    if (user) go(target);
  }, [user?.id]);
  // Second step for ADMIN/STAFF accounts with 2FA: the password was right, no session yet.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ needsTotp?: boolean; challenge?: string }>(
        register ? "/register" : "/login",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      if (result.needsTotp && result.challenge) {
        setChallenge(result.challenge);
        setUseRecovery(false);
        return;
      }
      await refresh();
      go(target);
      toast(register ? t("สมัครสมาชิกสำเร็จ") : t("เข้าสู่ระบบสำเร็จ"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setBusy(true);
    setError("");
    try {
      await api("/login/totp", { challenge, code });
      await refresh();
      go(target);
      toast(t("เข้าสู่ระบบสำเร็จ"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (challenge)
    return (
      <main className="reference-auth-main">
        <div className="reference-auth-heading">
          <Link to="/" className="reference-auth-brand" aria-label={t("หน้าแรก")}>
            <BrandLogo />
          </Link>
          <h1>{t("ยืนยันตัวตน 2 ขั้น")}</h1>
          <p>
            {useRecovery
              ? t("กรอกรหัสกู้คืนที่บันทึกไว้ตอนเปิดใช้งาน รหัสแต่ละชุดใช้ได้ครั้งเดียว")
              : t("เปิดแอปยืนยันตัวตนในโทรศัพท์ แล้วกรอกรหัส 6 หลักที่แสดงอยู่")}
          </p>
        </div>
        <form onSubmit={submitCode} className="reference-auth-form" key={useRecovery ? "recovery" : "totp"}>
          <ErrorMessage message={error} />
          <label className="field">
            {useRecovery ? t("รหัสกู้คืน") : t("รหัสยืนยัน 6 หลัก")}
            <input
              name="code"
              autoComplete="one-time-code"
              inputMode={useRecovery ? "text" : "numeric"}
              pattern={useRecovery ? undefined : "[0-9]{6}"}
              minLength={6}
              maxLength={useRecovery ? 11 : 6}
              placeholder={useRecovery ? "xxxxx-xxxxx" : "000000"}
              autoFocus
              required
            />
          </label>
          <button className="button primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : t("ยืนยันและเข้าสู่ระบบ")}
          </button>
        </form>
        <p className="reference-auth-help">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setError("");
            }}
          >
            {useRecovery ? t("ใช้รหัสจากแอปยืนยันตัวตนแทน") : t("ไม่มีโทรศัพท์? ใช้รหัสกู้คืน")}
          </button>
          {" · "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setChallenge(null);
              setError("");
            }}
          >
            {t("กลับไปกรอกรหัสผ่าน")}
          </button>
        </p>
      </main>
    );
  return (
    <main className="reference-auth-main">
      <div className="reference-auth-heading">
        <Link to="/" className="reference-auth-brand" aria-label={t("หน้าแรก")}>
          <BrandLogo />
        </Link>
        <h1>{register ? t("สมัครสมาชิก") : t("เข้าสู่ระบบ")}</h1>
        <p>{shopName(overview?.shop?.shopName)}</p>
      </div>
      <form onSubmit={submit} className="reference-auth-form">
        <ErrorMessage message={error} />
        <label className="field">
          {t("ชื่อผู้ใช้")}
          <input
            name="username"
            autoComplete="username"
            minLength={register ? 3 : 1}
            maxLength={register ? 32 : 160}
            required
          />
          {register && <small>{t("ใช้สำหรับเข้าสู่ระบบ")}</small>}
        </label>
        {register && (
          <label className="field">
            {t("อีเมล (ไม่บังคับ)")}
            <input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={160}
            />
          </label>
        )}
        <label className="field">
          {t("รหัสผ่าน")}
          <div className="password-field">
            <input
              name="password"
              type={show ? "text" : "password"}
              autoComplete={register ? "new-password" : "current-password"}
              aria-describedby={register ? "password-rule" : undefined}
              minLength={register ? 10 : 1}
              maxLength={128}
              required
            />
            <button
              type="button"
              className="icon-button"
              aria-label={show ? t("ซ่อนรหัสผ่าน") : t("แสดงรหัสผ่าน")}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </label>
        {register && (
          <small id="password-rule" className="field-hint">
            {t("อย่างน้อย 10 ตัวอักษร")}
          </small>
        )}
        {register && (
          <label className="field">
            {t("ยืนยันรหัสผ่าน")}
            <input
              name="confirmPassword"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
            />
          </label>
        )}
        {register && (
          <label className="checkbox-label consent-check">
            <input type="checkbox" name="acceptTerms" required />
            <span>
              {t("ฉันยอมรับ")} <Link to="/terms">{t("ข้อกำหนดร้าน")}</Link> {t("และ")}{" "}
              <Link to="/privacy">{t("นโยบายความเป็นส่วนตัว")}</Link>
            </span>
          </label>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : register ? (
            t("สมัครสมาชิก")
          ) : (
            t("เข้าสู่ระบบ")
          )}
        </button>
      </form>
      {!register && (
        <p className="reference-auth-help">
          {t("ลืมรหัสผ่าน? ติดต่อร้านผ่านช่องทางในหน้า")}{" "}
          <Link to="/support">{t("ติดต่อเรา")}</Link>{" "}
          {t("ร้านจะตั้งรหัสผ่านชั่วคราวให้หลังยืนยันตัวตน")}
        </p>
      )}
      <p className="reference-auth-switch">
        {register ? t("มีบัญชีแล้ว?") : t("ยังไม่มีบัญชี?")}{" "}
        <Link
          to={
            (register ? "/login" : "/register") +
            "?next=" +
            encodeURIComponent(target)
          }
        >
          {register ? t("เข้าสู่ระบบ") : t("สมัครสมาชิก")}
        </Link>
      </p>
    </main>
  );
}
export function ReferenceProduct({ id }: { id: string }) {
  const { products, loading, setBasket, go, toast, overview } = useStore();
  const product = products.find(
    (p) =>
      p.id === id ||
      p.id ===
        (id === "disney"
          ? "stream-plus"
          : id === "monomax"
            ? "cinema-max"
            : id),
  );
  const [selected, setSelected] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [image, setImage] = useState(0);
  const variant =
    product?.variants.find((v) => v.id === selected) ??
    product?.variants.find((v) => v.available) ??
    product?.variants[0];
  usePageTitle(
    product?.name ?? (loading ? t("สินค้า") : t("ไม่พบสินค้า")),
    product?.description,
  );
  const [reviews, setReviews] = useState<Review[]>([]);
  useEffect(() => {
    api<{ reviews: Review[] }>("/reviews")
      .then((r) =>
        setReviews(r.reviews.filter((x) => x.product === product?.name)),
      )
      .catch(() => {});
  }, [product?.id]);
  if (loading)
    return (
      <main className="container page-main reference-product-page">
        <div className="skeleton-product" aria-busy="true" aria-label={t("กำลังโหลดสินค้า")}>
          <div className="skeleton-block skeleton-media" />
          <div>
            <div className="skeleton-block skeleton-line" />
            <div className="skeleton-block skeleton-line short" />
            <div className="skeleton-block skeleton-panel short" />
          </div>
        </div>
      </main>
    );
  if (!product || !variant)
    return (
      <main className="container page-main reference-product-page">
        <Empty
          icon={<Package />}
          heading={t("ไม่พบสินค้า")}
          description={t("สินค้านี้อาจปิดขายแล้ว")}
        />
      </main>
    );
  const available =
    overview?.shop?.shopOpen !== false &&
    variant.available;
  const buy = (checkout: boolean) => {
    setBasket({ variantId: variant.id, quantity });
    if (checkout) go("/checkout");
    else {
      toast(t("เพิ่มสินค้าในตะกร้าแล้ว"));
      go("/cart");
    }
  };
  // Uploaded images (admin › รูปสินค้า) come first; the bundled artwork is the fallback.
  const uploaded = product.images ?? [];
  const imageCount = uploaded.length
    ? uploaded.length
    : product.art === "stream" ? 3 : product.art === "cinema" ? 2 : 1;
  const bundled = (i: number) =>
    "/products/" + (product.art === "stream" ? "disney" : "monomax") + (i ? "-" + i : "") + ".webp";
  const current = Math.min(image, imageCount - 1);
  return (
    <main className="container page-main reference-product-page">
      <Link to="/products" className="back-link">
        <ArrowLeft size={16} />
        {t("สินค้าทั้งหมด")}
      </Link>
      <div className="reference-product-grid">
        <div className="reference-gallery">
          <div className="reference-main-image">
            {uploaded.length ? (
              <img src={uploaded[current].url} alt={product.name} />
            ) : ["stream", "cinema"].includes(product.art) ? (
              <img src={bundled(current)} alt={product.name} />
            ) : (
              <Art type={product.art} name={product.name} />
            )}
          </div>
          {imageCount > 1 && (
            <div className="reference-thumbnails">
              {Array.from({ length: imageCount }, (_, i) => (
                <button
                  className={current === i ? "selected" : ""}
                  key={i}
                  onClick={() => setImage(i)}
                  aria-label={t("รูปสินค้า ") + (i + 1)}
                >
                  <img src={uploaded.length ? uploaded[i].url : bundled(i)} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="reference-product-info">
          {!!product.preorder && <span className="preorder-pill">{t("สั่งจอง")}</span>}
          <h1>{product.name}</h1>
          {product.rating?.count > 0 && (
            <div className="reference-product-rating">
              <span className="review-stars" role="img" aria-label={t("คะแนน {n} จาก 5", { n: product.rating.average?.toFixed(1) ?? 0 })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={14} fill={n <= Math.round(product.rating.average ?? 0) ? "currentColor" : "none"} />
                ))}
              </span>
              {product.rating.average?.toFixed(1)}{" "}
              <span>· {product.rating.count}{" "}{t("รีวิว")}</span>
              <span>{t("ขายแล้ว")}{" "}{product.sold}</span>
            </div>
          )}
          <div className="reference-price">{money(variant.price)}</div>
          {!!product.preorder && (
            <p className="preorder-how">
              {t("สินค้าพรีออเดอร์: ชำระแล้วได้เลขคิวทันที ร้านส่ง ID และรหัสผ่านตามลำดับคิว และแจ้งเตือนในเว็บเมื่อส่งแล้ว")}
            </p>
          )}
          <fieldset className="reference-variants">
            <legend>{t("ตัวเลือก")}</legend>
            {product.variants.map((v) => (
              <button
                key={v.id}
                className={variant.id === v.id ? "selected" : ""}
                onClick={() => {
                  setSelected(v.id);
                  setQuantity(1);
                }}
              >
                <span>
                  {v.label}
                  <small>
                    {product.preorder
                      ? ""
                      : v.stockStatus === "low"
                        ? t("เหลือน้อย")
                        : v.stockStatus !== "out"
                          ? t("มีสินค้า")
                          : t("สินค้าหมด")}
                  </small>
                  <WarrantyDays days={v.warranty_days} />
                </span>
                <strong>{money(v.price)}</strong>
              </button>
            ))}
          </fieldset>
          <div className="reference-buy-row">
            <Quantity
              value={quantity}
              max={variant.available ? MAX_PER_ORDER : 0}
              onChange={setQuantity}
            />
            <button
              className="button secondary"
              disabled={!available}
              onClick={() => buy(false)}
            >
              <ShoppingBag size={17} />
              {t("ใส่ตะกร้า")}
            </button>
            <button
              className="button primary"
              disabled={!available}
              onClick={() => buy(true)}
            >
              {product.preorder ? t("จองเลย") : t("ซื้อเลย")}
            </button>
          </div>
          <p className="reference-delivery-note">
            <KeyRound size={15} />
            {product.preorder
              ? t("ชำระตอนจอง ได้เลขคิว รับของในประวัติการซื้อ")
              : t("สินค้าดิจิทัล ได้รับทันทีหลังชำระเงินในหน้าประวัติการซื้อ")}
          </p>
          <section className="reference-product-description">
            <h2>{t("รายละเอียด")}</h2>
            <p>{product.description}</p>
          </section>
        </div>
      </div>
      <section className="reference-faq">
        <h2>{t("คำถามที่พบบ่อย")}</h2>
        {(product.preorder
          ? [
              [t("พรีออเดอร์ได้ของเมื่อไหร่"), t("ร้านส่งตามลำดับคิวที่ได้หลังชำระเงิน เมื่อส่งแล้วจะมีแจ้งเตือนในเว็บ และดู ID กับรหัสผ่านได้ในประวัติการซื้อ")],
              [t("ดูเลขคิวได้ที่ไหน"), t("เปิดประวัติการซื้อ แล้วกดคำสั่งซื้อนั้น เลขคิวอยู่ในหน้ารายละเอียด")],
              [t("มีปัญหากับบัญชีที่ได้รับ ทำอย่างไร"), t("กดปุ่มแชทมุมขวาล่างเพื่อติดต่อร้าน แจ้งเลขคำสั่งซื้อด้วย")],
            ]
          : [
              [t("ได้รับสินค้าเมื่อไหร่"), t("ทันทีหลังชำระเงินสำเร็จ ID และรหัสผ่านจะแสดงในหน้าคำสั่งซื้อ และเปิดดูซ้ำได้ในประวัติการซื้อ")],
              [t("มีปัญหากับบัญชีที่ได้รับ ทำอย่างไร"), t("กดปุ่มแชทมุมขวาล่างเพื่อติดต่อร้าน แจ้งเลขคำสั่งซื้อด้วย")],
            ]
        ).map(([q, a]) => (
          <details key={q}>
            <summary>
              {q}
              <ChevronDown size={16} />
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
      <section className="reference-product-reviews">
        <h2>{t("รีวิวจากผู้ซื้อ")}</h2>
        {reviews.length ? (
          <div className="reference-rating-layout">
            <div className="reference-rating-summary">
              <strong>{product.rating.average?.toFixed(1)}</strong>
              <span>{t("จาก")}{" "}{reviews.length}{" "}{t("รีวิว")}</span>
              {[5, 4, 3, 2, 1].map((n) => (
                <div className="rating-bar" key={n}>
                  <span>{n}</span>
                  <i>
                    <b
                      style={{
                        width:
                          (100 * reviews.filter((r) => r.rating === n).length) /
                            reviews.length +
                          "%",
                      }}
                    />
                  </i>
                  <span>{reviews.filter((r) => r.rating === n).length}</span>
                </div>
              ))}
            </div>
            <div>
              {reviews.map((r) => (
                <div className="reference-review-item" key={r.id}>
                  <div className="review-stars">
                    {Array.from({ length: r.rating }, (_, i) => (
                      <Star key={i} size={13} fill="currentColor" />
                    ))}
                    <time>{dateTime(r.created_at)}</time>
                  </div>
                  <p>
                    {r.comment ||
                      t("ให้คะแนน ") + r.rating + t(" ดาว โดยไม่ได้เขียนความเห็น")}
                  </p>
                  <span className="review-owner">
                    {r.name}
                    <span>
                      <ShieldCheck size={12} />
                      {t("ผู้ซื้อจริง")}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty
            icon={<Star />}
            heading={t("ยังไม่มีรีวิว")}
            description={t("รีวิวเขียนได้เฉพาะคนที่ซื้อสินค้านี้แล้วเท่านั้น")}
          />
        )}
      </section>
      <section className="reference-related">
        <h2>{t("สินค้าที่คุณอาจชอบ")}</h2>
        <div className="product-grid">
          {products
            .filter((p) => p.id !== product.id)
            .slice(0, 4)
            .map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
        </div>
      </section>
    </main>
  );
}

export function ReferenceReviews() {
  const { user, overview, refresh, toast } = useStore();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  async function load() {
    try {
      setReviews((await api<{ reviews: Review[] }>("/reviews")).reviews);
      if (user)
        setOrders(
          (await api<{ orders: Order[] }>("/orders")).orders.filter(
            (o) =>
              o.status === "DELIVERED" &&
              !o.reviewed &&
              Date.now() - Date.parse(o.created_at + "Z") <= 7 * 86400000,
          ),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void load();
  }, [user?.id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const values = Object.fromEntries(new FormData(e.currentTarget));
      await api("/reviews", { ...values, rating: Number(values.rating) });
      await load();
      await refresh();
      toast(t("ขอบคุณสำหรับรีวิวของคุณ"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const average = reviews.length
    ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length
    : 0;
  const good = reviews.length
    ? Math.round(
        (100 * reviews.filter((r) => r.rating >= 4).length) / reviews.length,
      )
    : 0;
  return (
    <main className="reference-credit-page">
      <div className="container">
        <section className="reference-credit-hero">
          <div>
            <span className="verified-pill">
              <ShieldCheck size={14} />
              {t("รีวิวจากผู้ซื้อจริงเท่านั้น")}
            </span>
            <h1>{t("เครดิตร้าน")}</h1>
            <h2>{shopName(overview?.shop?.shopName)}</h2>
            <p>
              {t("ทุกรีวิวมาจากลูกค้าที่ซื้อจริง และเขียนได้ภายใน 7 วันหลังซื้อเท่านั้น ร้านแก้ไขหรือซ่อนรีวิวไม่ได้")}
            </p>
            {ready && reviews.length > 0 && (
              <div className="credit-trust-badges">
                <span>
                  <ShieldCheck size={14} />
                  {reviews.length}{" "}{t("รีวิวยืนยันแล้ว")}
                </span>
                <span>
                  <Star size={14} />
                  {good}{t("% ให้ 4 ดาวขึ้นไป")}
                </span>
              </div>
            )}
          </div>
          {ready && reviews.length > 0 && (
          <div className="credit-summary">
            <div className="credit-score-ring">
              <strong>{average.toFixed(1)}</strong>
              <div className="review-stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    size={12}
                    key={n}
                    fill={n <= Math.round(average) ? "currentColor" : "none"}
                  />
                ))}
              </div>
              <small>{reviews.length}{" "}{t("รีวิว")}</small>
            </div>
            <div className="credit-rating-bars">
              {[5, 4, 3, 2, 1].map((n) => (
                <div className="rating-bar" key={n}>
                  <span>
                    {n}
                    <Star size={9} fill="currentColor" />
                  </span>
                  <i>
                    <b
                      style={{
                        width:
                          (100 * reviews.filter((r) => r.rating === n).length) /
                            reviews.length +
                          "%",
                      }}
                    />
                  </i>
                  <span>{reviews.filter((r) => r.rating === n).length}</span>
                </div>
              ))}
            </div>
          </div>
          )}
        </section>
        {ready && reviews.length > 0 && (
        <div className="credit-filter-bar">
          {[0, 5, 4, 3, 2, 1].map((n) => (
            <button
              key={n}
              className={filter === n ? "selected" : ""}
              onClick={() => setFilter(n)}
            >
              {n ? (
                <>
                  {n}
                  <Star size={11} fill="currentColor" />
                  {reviews.filter((r) => r.rating === n).length}
                </>
              ) : (
                <>
                  {t("ทั้งหมด")}{" "}<small>{reviews.length}</small>
                </>
              )}
            </button>
          ))}
        </div>
        )}
        <ErrorMessage message={error} />
        {orders.length > 0 && (
          <form className="panel review-form" onSubmit={submit}>
            <h2>{t("แบ่งปันประสบการณ์ของคุณ")}</h2>
            <label className="field">
              {t("คำสั่งซื้อ")}
              <select
                name="orderId"
                defaultValue={
                  new URLSearchParams(location.search).get("order") ??
                  orders[0].id
                }
              >
                {orders.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name} · #{o.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("คะแนน")}
              <select name="rating" defaultValue="5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <option value={n} key={n}>
                    {n}{" "}{t("ดาว")}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("ความคิดเห็น")}
              <textarea
                name="comment"
                minLength={2}
                maxLength={600}
                required
                placeholder={t("บอกเล่าประสบการณ์การสั่งซื้อของคุณ")}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Star size={16} />
              )}
              {t("ส่งรีวิว")}
            </button>
          </form>
        )}
        {ready && reviews.length === 0 ? (
          <Empty
            icon={<Star />}
            heading={t("ยังไม่มีรีวิว")}
            description={t("รีวิวจากลูกค้าที่ซื้อจริงจะแสดงที่นี่")}
          />
        ) : (
          <div className="credit-review-grid">
            {reviews
              .filter((r) => !filter || r.rating === filter)
              .map((r) => (
                <article className="review-card credit-review-card" key={r.id}>
                  <div className="review-stars">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        size={14}
                        key={n}
                        fill={n <= r.rating ? "currentColor" : "none"}
                      />
                    ))}
                    <time>{dateTime(r.created_at).split(" ").slice(0, 3).join(" ")}</time>
                  </div>
                  <p>
                    {r.comment ||
                      t("ให้คะแนน ") + r.rating + t(" ดาว โดยไม่ได้เขียนความเห็น")}
                  </p>
                  <div className="credit-review-owner">
                    <span className="avatar">{r.name.slice(0, 2)}</span>
                    <div>
                      <strong>{r.name}</strong>
                      <small>
                        <ShieldCheck size={12} />
                        {t("ผู้ซื้อจริง")}
                      </small>
                    </div>
                  </div>
                  <div className="credit-review-product">
                    <Art
                      small
                      name={r.product}
                      type={
                        r.product === "DISNEY+"
                          ? "stream"
                          : r.product === "MONOMAX"
                            ? "cinema"
                            : "gift"
                      }
                    />
                    <div>
                      {r.product}
                      <small>
                        {r.product === "DISNEY+"
                          ? t("DISNEY+ 30 DAYS หาร")
                          : t("โค้ดดิจิทัล")}
                      </small>
                    </div>
                  </div>
                </article>
              ))}
          </div>
        )}
        {!!reviews.length &&
          !reviews.some((r) => !filter || r.rating === filter) && (
            <p className="empty-inline">{t("ยังไม่มีรีวิวในคะแนนนี้")}</p>
          )}
      </div>
    </main>
  );
}
