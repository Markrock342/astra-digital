import { t } from "./i18n";
import type { Product, Variant } from "./types";

export const variantStockClass = (product: Product, variant: Variant) => product.preorder ? ""
  : variant.available ? " variant-stock-in" : " variant-stock-out";

export function VariantStock({ product, variant }: { product: Product; variant: Variant }) {
  return <span className="variant-stock-detail">
    {!product.preorder && <span>{variant.stockRemaining != null
      ? variant.stockRemaining > 0 ? t("เหลือ {n}", { n: variant.stockRemaining }) : t("สินค้าหมด")
      : t("พร้อมส่ง")}</span>}
    <span>{t("ขายแล้ว")} {variant.sold ?? 0} {t("รายการ")}</span>
  </span>;
}
