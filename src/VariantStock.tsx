import { t } from "./i18n";
import type { Product, Variant } from "./types";

export function VariantStock({ product, variant }: { product: Product; variant: Variant }) {
  const inStock = variant.available && (variant.stockRemaining == null || variant.stockRemaining > 0);
  return (
    <span className="variant-stock-detail">
      {!product.preorder && (
        <span className={"variant-stock-pill " + (inStock ? "variant-stock-in" : "variant-stock-out")}>
          {variant.stockRemaining != null
            ? variant.stockRemaining > 0
              ? t("เหลือ {n} ชิ้น", { n: variant.stockRemaining })
              : t("สินค้าหมด")
            : inStock
              ? t("พร้อมส่ง")
              : t("สินค้าหมด")}
        </span>
      )}
      <span className="variant-sold-count">{t("ขายแล้ว {n} ชิ้น", { n: variant.sold ?? 0 })}</span>
    </span>
  );
}
