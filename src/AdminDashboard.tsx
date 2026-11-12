// Dashboard numbers from the server (FR-R2/R3): one revenue formula (FR-F10),
// Bangkok-day ranges, comparison with the previous period, real to-do counts.
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Clock3, FlaskConical, MessageCircle, Receipt } from "lucide-react";
import { Link } from "./App";
import { useLive } from "./live";
import { api, money } from "./api";

type Summary = {
  revenue: number;
  orderCount: number;
  newCustomers: number;
  paidOrders: number;
  aov: number;
  refunds: number;
  paymentSuccessRate: number | null;
  mode?: "sandbox" | "live";
};
type Daily = { day: string; revenue: number };

/** Shop money mode from /api/health: "sandbox" while ASTRA_TEST_PAYMENTS is on. */
let modeCache: Promise<string> | null = null;
export function useShopMode() {
  const [mode, setMode] = useState<string | null>(null);
  useEffect(() => {
    modeCache ??= api<{ mode?: string }>("/health")
      .then((h) => h.mode ?? "sandbox")
      .catch(() => {
        modeCache = null;
        return "live";
      });
    void modeCache.then(setMode);
  }, []);
  return mode;
}

/** S2: amber banner on every money page while the shop runs on test money. */
export function TestMoneyBanner() {
  const mode = useShopMode();
  if (mode !== "sandbox") return null;
  return (
    <div className="test-money-banner" role="note">
      <FlaskConical size={17} />
      <span>
        <strong>โหมดทดสอบ: ตัวเลขนี้ไม่ใช่เงินจริง</strong>
        <small>รวมการชำระและเครดิตทดลอง เมื่อเปิดร้านจริงระบบจะตัดเงินทดสอบออกจากทุกตัวเลขและ CSV</small>
      </span>
    </div>
  );
}

const percent = (value: number | null | undefined) =>
  value == null ? "–" : (Math.round(value * 1000) / 10).toLocaleString("th-TH") + "%";
type Product = { id: string; name: string; sold: number; stock: number; stockStatus: string; preorder: boolean };

const day = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(Date.now() - offset * 86400000));
const ranges = {
  today: { label: "วันนี้", days: 1, compare: "เทียบเมื่อวาน" },
  week: { label: "7 วัน", days: 7, compare: "เทียบ 7 วันก่อนหน้า" },
  month: { label: "30 วัน", days: 30, compare: "เทียบ 30 วันก่อนหน้า" },
  all: { label: "ทั้งหมด", days: 0, compare: "ตั้งแต่เปิดร้าน" },
} as const;
type Range = keyof typeof ranges;

export function Change({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return null;
  if (!before && !now) return <small>ไม่มีทั้งสองช่วง</small>;
  if (!before) return <small className="trend up">ใหม่ในช่วงนี้</small>;
  const pct = Math.round(((now - before) / before) * 100);
  return (
    <small className={"trend " + (pct > 0 ? "up" : pct < 0 ? "down" : "")}>
      {pct > 0 ? "▲ " : pct < 0 ? "▼ " : ""}
      {Math.abs(pct)}%
    </small>
  );
}

export function AdminDashboard({
  pendingPayment,
  preorderQueue,
  children,
}: {
  pendingPayment: number;
  preorderQueue: number;
  children?: ReactNode;
}) {
  const [range, setRange] = useState<Range>("today");
  const [now, setNow] = useState<Summary | null>(null);
  const [before, setBefore] = useState<Summary | undefined>(undefined);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [best, setBest] = useState<Product[]>([]);
  const [low, setLow] = useState<Product[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useLive(["orders", "catalog", "chat", "customers"], () => setTick((n) => n + 1));

  useEffect(() => {
    const { days } = ranges[range];
    const current = days ? `?from=${day(days - 1)}&to=${day(0)}` : "";
    const previous = days ? `?from=${day(days * 2 - 1)}&to=${day(days)}` : null;
    const chartDays = days || 30;
    setError("");
    Promise.all([
      api<Summary>("/admin/summary" + current),
      previous ? api<Summary>("/admin/summary" + previous) : Promise.resolve(undefined),
      // Chart uses the same formula as the revenue card (FR-F10): paid minus refunds, per day.
      api<{ daily: Daily[] }>(`/admin/summary?from=${day(Math.max(chartDays, 7) - 1)}&to=${day(0)}`),
    ])
      .then(([a, b, chart]) => {
        setNow(a);
        setBefore(b);
        setDaily(chart.daily);
      })
      .catch((e) => setError((e as Error).message));
  }, [range, tick]);

  useEffect(() => {
    api<{ products: Product[] }>("/admin/products?sort=sold&limit=5")
      .then((d) => setBest(d.products.filter((p) => p.sold > 0)))
      .catch(() => {});
    Promise.all([
      api<{ products: Product[] }>("/admin/products?stock=out&type=ready&status=active&limit=20"),
      api<{ products: Product[] }>("/admin/products?stock=low&type=ready&status=active&limit=20"),
    ])
      .then(([out, lowStock]) => setLow([...out.products, ...lowStock.products]))
      .catch(() => {});
    api<{ threads: { unreadCount?: number; status?: string }[] }>("/chat/threads")
      .then((d) => setUnread(d.threads.reduce((n, t) => n + (t.unreadCount ?? 0), 0)))
      .catch(() => {});
  }, [tick]);

  // Fill missing days so the chart reads as a calendar, not a list of sales.
  const chartDays = Math.max(ranges[range].days || 30, 7);
  const bars = Array.from({ length: chartDays }, (_, i) => {
    const key = day(chartDays - 1 - i);
    return { day: key, value: daily.find((d) => d.day === key)?.revenue ?? 0 };
  });
  const peak = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const tasks = [
    { show: preorderQueue > 0, to: "/admin/preorders", icon: Clock3, title: "คิวพรีออเดอร์รอส่ง", text: "ลูกค้าจ่ายแล้ว รอแอดมินส่ง ID และรหัสผ่าน", count: preorderQueue },
    { show: unread > 0, to: "/admin/chat", icon: MessageCircle, title: "แชทยังไม่ได้อ่าน", text: "ลูกค้าส่งข้อความมาที่ร้าน", count: unread },
    { show: low.length > 0, to: "/admin/products", icon: AlertTriangle, title: "สต็อกหมดหรือใกล้หมด", text: low.map((p) => p.name).slice(0, 3).join(", "), count: low.length },
    { show: pendingPayment > 0, to: "/admin/orders", icon: Receipt, title: "ออเดอร์รอชำระ", text: "ลูกค้าสร้างออเดอร์แล้วยังไม่จ่าย", count: pendingPayment },
  ].filter((t) => t.show);

  return (
    <>
      <div className="reference-section-heading">
        <div>
          <h2>ยอดขายและเงินเข้า</h2>
          <p>{ranges[range].compare} · เวลาไทย · ยอดขาย = เงินที่ชำระสำเร็จ หักคืนเงิน</p>
        </div>
        <div className="segmented-control" role="group" aria-label="ช่วงเวลา">
          {(Object.keys(ranges) as Range[]).map((key) => (
            <button key={key} className={range === key ? "active" : ""} onClick={() => setRange(key)}>
              {ranges[key].label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
      <TestMoneyBanner />
      <section className="reference-admin-metrics metrics-six">
        <div>
          <span>ยอดขาย</span>
          <strong>{now ? money(now.revenue) : "–"}</strong>
          {now && <Change now={now.revenue} before={before?.revenue} />}
        </div>
        <div>
          <span>ออเดอร์</span>
          <strong>{now ? now.orderCount : "–"}</strong>
          {now && <Change now={now.orderCount} before={before?.orderCount} />}
        </div>
        <div>
          <span>ลูกค้าใหม่</span>
          <strong>{now ? now.newCustomers : "–"}</strong>
          {now && <Change now={now.newCustomers} before={before?.newCustomers} />}
        </div>
        <div>
          <span>ยอดเฉลี่ยต่อออเดอร์</span>
          <strong>{now && now.paidOrders ? money(now.aov) : "–"}</strong>
          {now && now.paidOrders ? <Change now={now.aov} before={before?.aov} /> : <small>ยอดขาย ÷ ออเดอร์ที่ชำระแล้ว</small>}
        </div>
        <div>
          <span>คืนเงิน</span>
          <strong>{now ? money(now.refunds) : "–"}</strong>
          {now && <Change now={now.refunds} before={before?.refunds} />}
        </div>
        <div>
          <span>อัตราชำระสำเร็จ</span>
          <strong>{now ? percent(now.paymentSuccessRate) : "–"}</strong>
          <small>{now ? `ชำระแล้ว ${now.paidOrders} จาก ${now.orderCount} ออเดอร์` : ""}</small>
        </div>
      </section>
      <div className="reference-dashboard-grid">
        <section className="reference-admin-card sales-graph">
          <div className="reference-card-heading">
            <h2>ยอดขายรายวัน</h2>
            <Link to="/admin/payments">ดูรายการเงิน</Link>
          </div>
          {bars.some((b) => b.value) ? (
            <div className="daily-bars" role="img" aria-label={"ยอดขายรายวัน " + chartDays + " วันล่าสุด"}>
              {bars.map((b) => (
                <div key={b.day} title={b.day + " · " + money(b.value)}>
                  <i
                    className={b.value < 0 ? "negative" : ""}
                    style={{ height: Math.max(b.value ? 4 : 1, (Math.abs(b.value) / peak) * 160) }}
                  />
                  <small>{chartDays <= 7 || Number(b.day.slice(8)) % 5 === 1 ? Number(b.day.slice(8)) : ""}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="reference-chart-empty">ยังไม่มียอดขายในช่วงนี้</div>
          )}
        </section>
        <section className="reference-admin-card tasks-card">
          <div className="reference-card-heading">
            <h2>งานที่ต้องทำ</h2>
            <span>{tasks.length} เรื่อง</span>
          </div>
          {tasks.length ? (
            tasks.map((t) => (
              <Link to={t.to} className="task-item" key={t.title}>
                <span className="task-icon">
                  <t.icon size={22} />
                </span>
                <div>
                  <strong>{t.title}</strong>
                  <p>{t.text}</p>
                </div>
                <b>{t.count}</b>
                <ChevronRight size={17} />
              </Link>
            ))
          ) : (
            <p className="reference-empty-text">ไม่มีงานค้างในขณะนี้</p>
          )}
        </section>
        <section className="reference-admin-card">
          <div className="reference-card-heading">
            <h2>ขายดีที่สุด</h2>
            <span>ทั้งหมด</span>
          </div>
          {best.length ? (
            best.map((p, i) => (
              <Link to={"/admin/products/" + p.id} className="reference-bestseller" key={p.id}>
                <span>
                  {i + 1}. {p.name}
                </span>
                <strong>{p.sold} ชิ้น</strong>
              </Link>
            ))
          ) : (
            <p className="reference-empty-text">ยังไม่มีสินค้าที่ขายได้</p>
          )}
        </section>
        {children}
      </div>
    </>
  );
}
