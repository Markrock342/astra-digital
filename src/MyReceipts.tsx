// "ใบเสร็จของฉัน" (/receipts, menu tile): every paid order with where its receipt stands and
// the one action that fits. Requests are made on the order page (OrderReceipts.tsx), so this
// page links there with ?receipt=open. Same card / list look as the purchase history.
import { useEffect, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import { Empty, ErrorMessage, Link, RequireLogin, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { useLive } from "./live";

const EN: Record<string, string> = {
  "ใบเสร็จของฉัน": "My receipts",
  "ยังไม่มีคำสั่งซื้อที่ชำระแล้ว": "No paid orders yet",
  "ชำระคำสั่งซื้อแล้วจึงขอใบเสร็จได้": "Receipts can be requested once an order is paid",
  "ขอได้ถึง {date}": "Request by {date}",
  "หมดเวลาขอใบเสร็จ": "Request window closed",
  "+ อีก {n} รายการ": "+ {n} more",
};
for (const [th, en] of Object.entries(EN)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

type Row = {
  orderId: string;
  number: string;
  createdAt: string;
  items: { product: string; option: string; quantity: number }[];
  total: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | null;
  reason: string | null;
  canRequest: boolean;
  /** UTC SQL time, like every server time (dateTime() shows it in Bangkok time). */
  expiresAt: string | null;
};

export function MyReceiptsPage() {
  const { user } = useStore();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const load = () => {
    if (user)
      api<{ receipts: Row[] }>("/account/order-receipts")
        .then((r) => setRows(r.receipts))
        .catch((e) => setError(e.message));
  };
  useEffect(load, [user?.id]);
  useLive(["orders", "notify"], load);
  return (
    <main className="container page-main my-receipts-page">
      <div className="page-heading">
        <h1>{t("ใบเสร็จของฉัน")}</h1>
      </div>
      {!user ? (
        <RequireLogin />
      ) : (
        <>
          <ErrorMessage message={error} />
          {!rows && !error ? (
            <div className="loading-row">
              <LoaderCircle className="spin" />
              {t("กำลังโหลด")}
            </div>
          ) : rows && rows.length ? (
            <section className="order-list-panel" aria-label={t("ใบเสร็จของฉัน")}>
              {rows.map((r) => (
                <ReceiptRow key={r.orderId} row={r} />
              ))}
            </section>
          ) : (
            !error && (
              <Empty
                icon={<FileText />}
                heading={t("ยังไม่มีคำสั่งซื้อที่ชำระแล้ว")}
                description={t("ชำระคำสั่งซื้อแล้วจึงขอใบเสร็จได้")}
              />
            )
          )}
        </>
      )}
    </main>
  );
}

function ReceiptRow({ row }: { row: Row }) {
  const first = row.items[0];
  const name = first ? first.product + (row.items.length > 1 ? " " + t("+ อีก {n} รายการ", { n: row.items.length - 1 }) : "") : "";
  const deadline = row.expiresAt ? dateTime(row.expiresAt) : "";
  const [line, tone] =
    row.status === "APPROVED"
      ? [t("อนุมัติแล้ว"), "is-ok"]
      : row.status === "PENDING"
        ? [t("รอทีมงานอนุมัติ"), "is-pending"]
        : row.status === "REJECTED"
          ? [t("ไม่อนุมัติ") + (row.reason ? " — " + row.reason : ""), "is-fail"]
          : row.canRequest
            ? [deadline ? t("ขอได้ถึง {date}", { date: deadline }) : t("ขอได้ภายใน 7 วันหลังชำระ"), ""]
            : [t("หมดเวลาขอใบเสร็จ"), ""];
  return (
    <article className="my-receipt-row">
      <div className="my-receipt-main">
        <strong>{name}</strong>
        <span className="my-receipt-meta">
          #{row.number} · {dateTime(row.createdAt)} · {money(row.total)}
        </span>
        <span className={"order-receipt-line " + tone}>{line}</span>
      </div>
      {row.status === "APPROVED" ? (
        <Link to={"/orders/" + row.orderId + "/receipt"} className="button secondary small">
          {t("ดู / พิมพ์ใบเสร็จ")}
        </Link>
      ) : row.canRequest ? (
        <Link to={"/orders/" + row.orderId + "?receipt=open"} className="button primary small">
          {row.status === "REJECTED" ? t("ขอใหม่") : t("ขอใบเสร็จ")}
        </Link>
      ) : null}
    </article>
  );
}
