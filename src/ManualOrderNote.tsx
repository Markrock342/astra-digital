// Storefront: one plain line on an order the shop created for the customer in the back
// office (customer paid outside the site). Kept apart from the lazy admin bundle.
import { getLang, t } from "./i18n";
import "./manual-order-note.css";

export function ManualOrderNote({ method }: { method?: string }) {
  const en = getLang() === "en";
  return (
    <span className="manual-order-note">
      {en
        ? "Created by the shop · paid by bank transfer"
        : t("ร้านสร้างคำสั่งซื้อให้ · ชำระแบบ") + (method ?? "โอนนอกเว็บ")}
    </span>
  );
}
