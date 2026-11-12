// The shop's public reply under a review ("ตอบกลับจากร้าน"), product page and reviews page.
import { Store } from "lucide-react";
import { dateTime } from "./api";
import { t } from "./i18n";
import type { Review } from "./types";
import "./restock-reviews.css";

export function ReviewReply({ reply }: { reply: Review["reply"] }) {
  if (!reply?.text) return null;
  return (
    <div className="review-shop-reply">
      <span className="review-shop-reply-head">
        <Store size={13} aria-hidden="true" />
        <strong>{t("ตอบกลับจากร้าน")}</strong>
        {reply.at && <time>{dateTime(reply.at).split(" ").slice(0, 3).join(" ")}</time>}
      </span>
      <p>{reply.text}</p>
    </div>
  );
}
