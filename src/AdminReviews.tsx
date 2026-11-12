// /admin/reviews — สินค้า › รีวิว. ADMIN and STAFF reply in place (one public reply per
// review, editable); only ADMIN hides, with a listed reason and a confirm step, and can show
// a hidden review again. Layout follows the shadcn/ui (MIT) data-table pattern used across
// the back office: stat cards, status tabs, dashed filter selects, then one card per row.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { EyeOff, LoaderCircle, MessageSquareReply, RotateCcw, Star } from "lucide-react";
import { ErrorMessage, Link, useStore } from "./App";
import { api, dateTime } from "./api";
import { useLive } from "./live";
import "./restock-reviews.css";

type AdminReview = {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  orderId: string;
  customerId: string;
  customer: string;
  productId: string;
  product: string;
  label: string;
  reply: { text: string; at: string; updatedAt: string | null; by: string | null } | null;
  hidden: { at: string; reason: string; reasonText: string; note: string; by: string | null } | null;
};
type ReviewList = {
  reviews: AdminReview[];
  nextCursor: string | null;
  summary: { total: number; hidden: number; unanswered: number; average: number | null };
  products: { id: string; name: string }[];
  reasons: { id: string; label: string }[];
  canHide: boolean;
};
type Filters = { hidden: string; rating: string; product: string; reply: string };

const qs = (filters: Record<string, string>) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const text = params.toString();
  return text ? "?" + text : "";
};

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className={"admin-filter-select" + (value ? " is-set" : "")}>
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="review-admin-stars" role="img" aria-label={`${rating} ดาว`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} fill={n <= rating ? "currentColor" : "none"} aria-hidden="true" />
      ))}
    </span>
  );
}

function ReplyBox({ review, onSaved }: { review: AdminReview; onSaved: (r: AdminReview) => void }) {
  const { toast } = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setEditing(false);
    setText(review.reply?.text ?? "");
  }, [review.id, review.reply?.text]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ review: AdminReview }>("/admin/reviews/" + review.id + "/reply", { text });
      onSaved(result.review);
      setEditing(false);
      toast(review.reply ? "แก้ไขคำตอบแล้ว" : "ตอบกลับรีวิวแล้ว ลูกค้าได้รับแจ้งเตือน");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!editing && review.reply)
    return (
      <div className="review-admin-reply">
        <span className="review-admin-reply-head">
          <strong>ตอบกลับจากร้าน</strong>
          <small>
            {review.reply.by ? review.reply.by + " · " : ""}
            {dateTime(review.reply.updatedAt ?? review.reply.at)}
            {review.reply.updatedAt ? " · แก้ไขแล้ว" : ""}
          </small>
        </span>
        <p>{review.reply.text}</p>
        <button type="button" className="button ghost" onClick={() => setEditing(true)}>
          แก้ไขคำตอบ
        </button>
      </div>
    );
  if (!editing)
    return (
      <div className="admin-action-row review-admin-reply-open">
        <button type="button" className="button secondary" onClick={() => setEditing(true)}>
          <MessageSquareReply size={15} />
          ตอบกลับ
        </button>
      </div>
    );
  return (
    <form className="review-admin-reply-form" onSubmit={save}>
      <label className="field">
        {review.reply ? "แก้ไขคำตอบของร้าน" : "ตอบกลับรีวิวนี้"}
        <textarea
          autoFocus
          aria-label={"ตอบกลับรีวิวของ " + review.customer}
          value={text}
          maxLength={1000}
          rows={3}
          placeholder="คำตอบนี้แสดงใต้รีวิวบนหน้าร้าน ใช้ถ้อยคำสุภาพ ไม่ใส่ข้อมูลส่วนตัวของลูกค้า"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <ErrorMessage message={error} />
      <div className="admin-action-row">
        <button className="button primary" disabled={busy || !text.trim()}>
          {busy ? <LoaderCircle className="spin" size={15} /> : <MessageSquareReply size={15} />}
          {review.reply ? "บันทึกคำตอบ" : "ส่งคำตอบ"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setText(review.reply?.text ?? "");
            setEditing(false);
          }}
        >
          ยกเลิก
        </button>
        <small className="field-help">{text.trim().length}/1000</small>
      </div>
    </form>
  );
}

function HidePanel({
  review,
  reasons,
  onDone,
  onCancel,
}: {
  review: AdminReview;
  reasons: ReviewList["reasons"];
  onDone: (r: AdminReview) => void;
  onCancel: () => void;
}) {
  const { toast } = useStore();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reasonText = reasons.find((r) => r.id === reason)?.label ?? "";
  function check(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!reason) return setError("เลือกเหตุผลในการซ่อน");
    if (reason === "OTHER" && note.trim().length < 3) return setError("อธิบายเหตุผลอย่างน้อย 3 ตัวอักษร");
    setConfirming(true);
  }
  async function hide() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ review: AdminReview }>("/admin/reviews/" + review.id + "/hide", {
        reason,
        note: note.trim() || undefined,
      });
      onDone(result.review);
      toast("ซ่อนรีวิวแล้ว · บันทึกเหตุผลไว้ในประวัติการทำงาน");
    } catch (err) {
      setError((err as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }
  if (confirming)
    return (
      <div className="money-confirm review-hide-confirm" role="group" aria-label="ยืนยันการซ่อนรีวิว">
        <p>
          ซ่อนรีวิว {review.rating} ดาวของ <strong>{review.customer}</strong> จากหน้าร้าน
        </p>
        <small>
          เหตุผล: {reasonText}
          {note.trim() ? " — " + note.trim() : ""} · คะแนนเฉลี่ยจะไม่นับรีวิวนี้ · แสดงอีกครั้งได้ภายหลัง · ระบบบันทึกชื่อผู้ซ่อนและเหตุผล
        </small>
        <ErrorMessage message={error} />
        <div className="admin-action-row">
          <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>
            แก้ไข
          </button>
          <button type="button" className="button danger" disabled={busy} onClick={() => void hide()}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <EyeOff size={15} />}
            ยืนยันซ่อนรีวิว
          </button>
        </div>
      </div>
    );
  return (
    <form className="admin-reason-form review-hide-form" onSubmit={check}>
      <fieldset>
        <legend>เหตุผลในการซ่อน</legend>
        <p className="field-help">ร้านไม่ซ่อนรีวิวเพราะคะแนนต่ำหรือคำติ ซ่อนได้เฉพาะกรณีด้านล่าง</p>
        <div className="review-reason-options">
          {reasons.map((r) => (
            <label key={r.id} className={reason === r.id ? "selected" : ""}>
              <input type="radio" name={"hide-reason-" + review.id} value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        {reason === "OTHER" ? "รายละเอียดเหตุผล" : "หมายเหตุ (ไม่บังคับ)"}
        <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorMessage message={error} />
      <div className="admin-action-row">
        <button type="button" className="button secondary" onClick={onCancel}>
          ยกเลิก
        </button>
        <button className="button danger">ซ่อนรีวิว…</button>
      </div>
    </form>
  );
}

function ReviewCard({
  review,
  canHide,
  reasons,
  onChange,
}: {
  review: AdminReview;
  canHide: boolean;
  reasons: ReviewList["reasons"];
  onChange: (r: AdminReview) => void;
}) {
  const { toast } = useStore();
  const [hiding, setHiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function unhide() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ review: AdminReview }>("/admin/reviews/" + review.id + "/unhide", {});
      onChange(result.review);
      toast("แสดงรีวิวบนหน้าร้านอีกครั้งแล้ว");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className={"reference-admin-card review-admin-card" + (review.hidden ? " is-hidden" : "")}
      data-testid="admin-review"
      data-review-id={review.id}
    >
      <header className="review-admin-head">
        <Stars rating={review.rating} />
        <span className="review-admin-badges">
          {review.hidden ? (
            <span className="status customer-status-banned">ซ่อนอยู่ · {review.hidden.reasonText}</span>
          ) : review.reply ? (
            <span className="status customer-status-active">ตอบแล้ว</span>
          ) : (
            <span className="status customer-status-suspended">ยังไม่ตอบ</span>
          )}
        </span>
        <time>{dateTime(review.created_at)}</time>
      </header>
      <p className="review-admin-comment">{review.comment}</p>
      <p className="review-admin-meta">
        <strong>{review.customer}</strong>
        <span>
          {review.product} · {review.label}
        </span>
        <Link to={"/admin/orders/" + review.orderId}>ออเดอร์ #{review.orderId.slice(0, 8).toUpperCase()}</Link>
      </p>
      {review.hidden && (
        <p className="review-admin-hidden-note">
          ซ่อนเมื่อ {dateTime(review.hidden.at)}
          {review.hidden.by ? " โดย " + review.hidden.by : ""} · เหตุผล: {review.hidden.reasonText}
          {review.hidden.note ? " — " + review.hidden.note : ""}
        </p>
      )}
      <ReplyBox review={review} onSaved={onChange} />
      <ErrorMessage message={error} />
      {canHide &&
        (review.hidden ? (
          <div className="admin-action-row review-admin-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => void unhide()}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
              แสดงอีกครั้ง
            </button>
          </div>
        ) : hiding ? (
          <HidePanel
            review={review}
            reasons={reasons}
            onCancel={() => setHiding(false)}
            onDone={(r) => {
              setHiding(false);
              onChange(r);
            }}
          />
        ) : (
          <div className="admin-action-row review-admin-actions">
            <button type="button" className="button ghost" onClick={() => setHiding(true)}>
              <EyeOff size={15} />
              ซ่อนรีวิว
            </button>
          </div>
        ))}
    </article>
  );
}

export function AdminReviews() {
  const [filters, setFilters] = useState<Filters>({ hidden: "", rating: "", product: "", reply: "" });
  const [data, setData] = useState<ReviewList | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  const request = useRef(0);
  useLive(["catalog"], () => setTick((n) => n + 1));
  useEffect(() => {
    const id = ++request.current;
    api<ReviewList>("/admin/reviews" + qs(filters))
      .then((result) => {
        if (id !== request.current) return;
        setData(result);
        setError("");
      })
      .catch((e) => id === request.current && setError((e as Error).message));
  }, [JSON.stringify(filters), tick]);
  async function more() {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api<ReviewList>("/admin/reviews" + qs({ ...filters, cursor: data.nextCursor }));
      setData({ ...page, reviews: [...data.reviews, ...page.reviews] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  const set = (key: keyof Filters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const replace = (r: AdminReview) =>
    setData((d) => (d ? { ...d, reviews: d.reviews.map((x) => (x.id === r.id ? r : x)) } : d));
  const s = data?.summary;
  return (
    <section className="review-admin-page">
      <div className="reference-admin-heading">
        <h1>รีวิวสินค้า</h1>
      </div>
      <p className="field-help review-admin-policy">
        ตอบกลับได้ทั้งแอดมินและทีมงาน คำตอบแสดงใต้รีวิวบนหน้าร้าน · ซ่อนรีวิวได้เฉพาะแอดมิน และเฉพาะสแปม/โฆษณา
        คำหยาบ/ข้อมูลส่วนตัว หรือเนื้อหาที่ไม่เกี่ยวกับสินค้า ไม่ซ่อนเพราะคะแนนต่ำ ทุกครั้งบันทึกในประวัติการทำงาน
      </p>
      <div className="admin-stat-row">
        {[
          ["รีวิวทั้งหมด", s ? String(s.total) : "–"],
          ["คะแนนเฉลี่ยบนหน้าร้าน", s?.average != null ? s.average.toFixed(1) : "–"],
          ["ยังไม่ตอบ", s ? String(s.unanswered) : "–"],
          ["ซ่อนอยู่", s ? String(s.hidden) : "–"],
        ].map(([label, value]) => (
          <div className="reference-admin-card" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="reference-status-tabs order-status-tabs" role="tablist" aria-label="สถานะรีวิว">
        {[
          ["", "ทั้งหมด"],
          ["no", "แสดงอยู่"],
          ["yes", "ซ่อนอยู่"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filters.hidden === key}
            className={filters.hidden === key ? "active" : ""}
            onClick={() => set("hidden")(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="admin-filters" role="search">
        <Select
          label="คะแนน"
          value={filters.rating}
          onChange={set("rating")}
          options={[["", "ทุกคะแนน"], ...[5, 4, 3, 2, 1].map((n) => [String(n), n + " ดาว"] as [string, string])]}
        />
        <Select
          label="สินค้า"
          value={filters.product}
          onChange={set("product")}
          options={[["", "ทุกสินค้า"], ...(data?.products ?? []).map((p) => [p.id, p.name] as [string, string])]}
        />
        <Select
          label="การตอบกลับ"
          value={filters.reply}
          onChange={set("reply")}
          options={[
            ["", "ตอบแล้วและยังไม่ตอบ"],
            ["no", "ยังไม่ตอบ"],
            ["yes", "ตอบแล้ว"],
          ]}
        />
      </div>
      <ErrorMessage message={error} />
      {!data && !error && (
        <div className="loading-row">
          <LoaderCircle className="spin" size={16} />
          กำลังโหลด
        </div>
      )}
      {data && data.reviews.length === 0 && <p className="reference-empty-text">ไม่มีรีวิวตามตัวกรองนี้</p>}
      <div className="review-admin-list">
        {data?.reviews.map((r) => (
          <ReviewCard key={r.id} review={r} canHide={data.canHide} reasons={data.reasons} onChange={replace} />
        ))}
      </div>
      {data?.nextCursor && (
        <div className="admin-list-footer">
          <span>แสดง {data.reviews.length} รายการ</span>
          <button type="button" className="button secondary" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? <LoaderCircle className="spin" size={15} /> : null}
            โหลดเพิ่ม
          </button>
        </div>
      )}
    </section>
  );
}
