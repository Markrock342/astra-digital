// Shop switched off in ตั้งค่า (ร้านปิดอยู่): say so where a customer would buy or pay, instead
// of a silently greyed button. Alert layout follows shadcn/ui Alert (MIT, https://ui.shadcn.com/docs/components/alert).
import { Store } from "lucide-react";
import { useStore } from "./App";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";

const EN_CLOSED: Record<string, string> = {
  "ร้านปิดให้บริการชั่วคราว": "The shop is temporarily closed",
  "ยังสั่งซื้อไม่ได้ในตอนนี้ ดูสินค้าและทักแชทได้ตามปกติ": "Ordering is paused for now. You can still browse and chat with us.",
  "ยังชำระเงินไม่ได้ในตอนนี้ คำสั่งซื้อนี้ยังอยู่ ชำระได้เมื่อร้านเปิด (ภายในเวลาที่กำหนด)":
    "Payment is paused for now. This order is kept and can be paid when the shop reopens (within the time limit).",
};
for (const [th, en] of Object.entries(EN_CLOSED)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

export function useShopOpen() {
  const { overview } = useStore();
  return overview?.shop?.shopOpen !== false;
}

/** Nothing while the shop is open. `pay`: on an unpaid order page. */
export function ShopClosedNote({ pay = false }: { pay?: boolean }) {
  if (useShopOpen()) return null;
  return (
    <div className="shop-closed-note" role="status">
      <Store size={18} aria-hidden="true" />
      <div>
        <strong>{t("ร้านปิดให้บริการชั่วคราว")}</strong>
        <p>
          {pay
            ? t("ยังชำระเงินไม่ได้ในตอนนี้ คำสั่งซื้อนี้ยังอยู่ ชำระได้เมื่อร้านเปิด (ภายในเวลาที่กำหนด)")
            : t("ยังสั่งซื้อไม่ได้ในตอนนี้ ดูสินค้าและทักแชทได้ตามปกติ")}
        </p>
      </div>
    </div>
  );
}
