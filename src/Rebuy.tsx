// "ซื้อซ้ำ" and "ใกล้หมดอายุ? ต่ออายุ" on the customer's order history and order page.
// Availability comes from the public catalog already in the store (server/rebuy.mjs);
// the server checks stock and price again when the order is placed at checkout.
import { Clock, PackageX, Repeat } from "lucide-react";
import { Link, useStore } from "./App";
import { t } from "./i18n";
import { rebuyAction, renewalDue } from "../server/rebuy.mjs";
import type { Order } from "./types";
import "./rebuy.css";

export function RebuyActions({ order }: { order: Order }) {
  const { products, overview, setBasket, go, loading } = useStore();
  if (loading) return null;
  const action = rebuyAction(order, products, { shopOpen: overview?.shop?.shopOpen !== false });
  if (!action) return null;
  const renew = renewalDue(order);
  const name = order.name + (order.label ? " · " + order.label : "");
  const buy = () => {
    if (action.kind !== "buy") return;
    setBasket({ variantId: action.variantId, quantity: action.quantity });
    go("/checkout");
  };
  const control =
    action.kind === "buy" ? (
      <button
        type="button"
        className={"button small " + (renew ? "primary" : "secondary") + " rebuy-button"}
        aria-label={(renew ? t("ต่ออายุ") : t("ซื้อซ้ำ")) + " " + name}
        onClick={buy}
      >
        <Repeat size={15} aria-hidden="true" />
        {renew ? t("ต่ออายุ") : t("ซื้อซ้ำ")}
      </button>
    ) : action.kind === "out" ? (
      <span className="rebuy-out">
        <span className="rebuy-out-badge">
          <PackageX size={14} aria-hidden="true" />
          {t("สินค้าหมด")}
        </span>
        <Link to={action.to} className="rebuy-link">
          {t("ดูสินค้า")}
        </Link>
      </span>
    ) : (
      <span className="rebuy-out">
        <span className="rebuy-out-badge is-gone">{t("สินค้านี้ไม่มีขายแล้ว")}</span>
        <Link to={action.to} className="rebuy-link">
          {t("ดูสินค้าอื่น")}
        </Link>
      </span>
    );
  return (
    <div className={"rebuy-actions" + (renew ? " is-renew" : "")}>
      {renew && (
        <span className="rebuy-renew-note">
          <Clock size={15} aria-hidden="true" />
          {t("ใกล้หมดอายุ?")}
        </span>
      )}
      {control}
    </div>
  );
}
