import type { Appearance } from "../server/appearance-rules.mjs";
export type Variant = {
  id: string;
  product_id: string;
  label: string;
  price: number;
  /** 0 = no warranty. */
  warranty_days?: number;
  /** Public catalog: a status only, never a stock number. */
  stockStatus: "in" | "low" | "out";
  /** Can be ordered now (in stock, or a preorder product). */
  available: boolean;
  // Pricing rules (server/pricing.mjs). `price` above is what this viewer pays now.
  /** Normal price before sale / tag price. */
  regularPrice?: number;
  /** Struck-through "was" price, only when above `price`. */
  compareAt?: number | null;
  discountPercent?: number | null;
  priceKind?: "regular" | "sale" | "tag";
  /** Customer tag whose price applies (only sent to that customer). */
  priceTag?: string | null;
  /** End of the running sale (UTC SQL time), if it has one. */
  saleEndsAt?: string | null;
  /** Per-account purchase limit, the stricter of product / option. */
  maxPerCustomer?: number | null;
  /** Units this signed-in customer can still buy (null when signed out / no limit). */
  remainingForYou?: number | null;
  /** Option groups (server/option-groups.mjs): groupId → valueId this variant names. */
  options?: Record<string, string>;
};
/** One option group of a product (แพ็กเกจ / ระยะเวลา / ...) and its values. */
export type OptionGroup = { id: string; name: string; values: { id: string; label: string }[] };
/** Admin APIs keep the exact ready-stock count. */
export type AdminVariant = Omit<Variant, "stockStatus" | "available"> & {
  stock: number;
  stockStatus?: Variant["stockStatus"];
  available?: boolean;
};
export type AdminProduct = Omit<Product, "variants"> & {
  variants: AdminVariant[];
  /** Stored delivery type (server/delivery.mjs); null = the old ID+password / code behaviour. */
  delivery_type?: string | null;
};
/** Most one order can buy; also the quantity cap while a variant is available. */
export const MAX_PER_ORDER = 10;
export type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  art: string;
  featured: number;
  preorder?:number;
  hidden_seed?:number;
  active: number;
  variants: Variant[];
  sold: number;
  rating: { average: number | null; count: number };
  /** Uploaded images in display order (W5 uploads); first is the cover. */
  images?: { id: string; url: string }[];
  imageUrl?: string | null;
  /** How a preorder product is reserved (server/preorder.mjs); null for ready stock. */
  preorderTerms?: PreorderTerms | null;
  /** How the item reaches the buyer (server/delivery.mjs). */
  deliveryType?: "account" | "shared" | "code" | "invite" | "manual";
  /** Shop-fulfilled product: what the customer fills in at checkout. */
  checkoutFields?: CheckoutField[];
  /** Option groups (empty = the simple variant list). */
  optionGroups?: OptionGroup[];
};
export type PreorderMode = "full" | "deposit" | "free";
export type PreorderTerms = {
  mode: PreorderMode;
  depositType?: "percent" | "fixed" | null;
  /** Percent (1–90) or satang per unit. */
  depositValue?: number | null;
  depositCapPercent?: number;
  payWindowHours?: number;
  lapsePolicy?: "refund_credit" | "keep" | null;
  maxPerCustomer?: number | null;
};
export type User = {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "ADMIN" | "STAFF";
  balance: number;
  /** Public file URL, or null when the account has no photo. */
  avatarUrl?: string | null;
  /** Email verification (server/email-verification.mjs). Staff / demo: always true. */
  emailVerified?: boolean;
  /** Only while not verified. required = orders / payment are blocked until verified. */
  emailVerification?: {
    required: boolean;
    canSend: boolean;
    hasEmail: boolean;
    resendInSeconds: number;
  };
};
export type Order = {
  id: string;
  /** The option bought (buy again prefills the basket with it). */
  variant_id?: string;
  name: string;
  art: string;
  label: string;
  quantity: number;
  total: number;
  status: string;
  created_at: string;
  codes: string[];
  /** ID + password pairs, only for the owner once delivered (DB-005). */
  credentials?: Credential[];
  /** Invite links (server/delivery.mjs). */
  links?: string[];
  /** Shop-fulfilled product: answers at checkout, queue state and the shop's message. */
  fulfilment?: {
    state: "input" | "waiting" | "done";
    inputs: { id: string; label: string; value: string }[];
    message: string;
    deliveredAt: string | null;
  } | null;
  queueNumber?: number | null;
  /** Fixed at delivery from the option's warranty days; null = no warranty. */
  warranty_until?: string | null;
  reviewed: boolean;
  preorder?:boolean;
  paymentToken?: string | null;
  /** FR-F6: set once the shop refunded part or all of the order. */
  refundStatus?: "REFUNDED" | "PARTIALLY_REFUNDED" | null;
  refundedTotal?: number;
  /** Set when an unpaid order was cancelled because the payment window ran out. */
  expired_at?: string | null;
  /** Coupon discount in satang (0 = none); `total` is already after it. */
  discount?: number;
  /** Price before the discount (total + discount). */
  subtotal?: number;
  coupon_code?: string | null;
  /** The shop created this order in the back office (customer paid outside the site). */
  createdByAdmin?: boolean;
  paymentMethodLabel?: string;
  // Preorder modes (server/preorder.mjs reservationView).
  preorderMode?: PreorderMode;
  /** queued → called → delivered, or lapsed / cancelled / shop_cancelled; null in full mode. */
  stage?: "queued" | "called" | "delivered" | "lapsed" | "cancelled" | "shop_cancelled" | null;
  deposit?: number;
  depositPaid?: number;
  balanceDue?: number;
  /** What the pay button charges now (deposit, balance or the full total). */
  amountDue?: number;
  /** UTC SQL time the balance must be paid by (stage called). */
  payBy?: string | null;
  calledAt?: string | null;
  endedAt?: string | null;
  payWindowHours?: number;
  lapsePolicy?: "refund_credit" | "keep" | null;
  /** Called / waiting reservations ahead of this one (stage queued). */
  queueAhead?: number | null;
};
/** POST /api/coupons/check: a preview only; the order is priced again on the server. */
export type CouponPreview = { valid: true; code: string; subtotal: number; discount: number; total: number };
export type CouponCheck = CouponPreview | { valid: false; reason: string };
export type Ledger = {
  id: string;
  /** Signed: + credit in, − credit out. */
  amount: number;
  label: string;
  created_at: string;
  type?: "TOPUP" | "PURCHASE" | "REFUND" | "ADJUSTMENT";
  balanceAfter?: number;
};
export type ShopSettings={shopName:string;description:string;announcement:string;line:string;email:string;phone:string;facebook:string;discord:string;address?:string;contactMessage?:string;logoUrl?:string|null;policy:string;stockOrder:string;shopOpen:boolean;requireTerms:boolean;requireEmailVerification?:boolean;pendingExpiryMinutes?:number};
export type Overview = {
  shop?:ShopSettings;
  customers: number;
  products: number;
  orders: number;
  /** Visible categories with at least one product on sale (count = products on sale). */
  categories: PublicCategory[];
  /** Home carousel: active banners inside their schedule window, in admin order. */
  banners?: HomeBanner[];
  /** ตั้งค่า › หน้าตาร้าน (server/appearance-rules.mjs); defaults = the built-in storefront. */
  appearance?: Appearance;
  activity: {
    kind: string;
    name: string;
    product?: string;
    art?: string;
    label?: string;
    time: string;
  }[];
};
export type PublicCategory = {
  id: string;
  name: string;
  name_en: string | null;
  /** Image library slug (/library/<slug>.webp) or null. */
  icon: string | null;
  count: number;
};
export type HomeBanner = {
  id: string;
  alt: string;
  /** In-shop path ("/products?category=ai") or an https URL; null = not clickable. */
  link: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
};
export type AdminBanner = Omit<HomeBanner, "imageUrl"> & {
  /** null until the main image is uploaded (draft: never shown). */
  imageUrl: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Bangkok wall time for the form ("YYYY-MM-DDTHH:MM"). */
  startsAtLocal: string | null;
  endsAtLocal: string | null;
  sortOrder: number;
  status: "live" | "scheduled" | "ended" | "off" | "draft";
  createdAt: string;
  updatedAt: string | null;
};
export type AdminCategory = PublicCategory & {
  name_th: string;
  sort_order: number;
  hidden: boolean;
  created_at: string;
  /** Products on sale (count = every product in the category). */
  active: number;
};
export type AdminData = {
  revenue: number;
  orderCount: number;
  delivered: number;
  stock: number;
  /** Every category, hidden ones too. */
  categories?: AdminCategory[];
  products: AdminProduct[];
  orders: {
    id: string;
    status: string;
    total: number;
    quantity: number;
    created_at: string;
    customer_id: string;
    customer: string;
    product_id: string;
    product: string;
    /** Created in the back office for a customer who paid outside the site. */
    createdByAdmin?: boolean;
  }[];
  pendingPayment: number;
  preorderQueue: number;
};

export type Review = {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  name: string;
  product: string;
  product_id?: string;
  /** The shop's public reply ("ตอบกลับจากร้าน"); null when there is none. */
  reply?: { text: string; at: string | null } | null;
};
export type Credential = {
  loginId: string;
  password: string;
  /** Shared account (server/delivery.mjs): seat number, profile / screen name and PIN. */
  seat?: number | null;
  profile?: string | null;
  pin?: string | null;
};
/** A field a shop-fulfilled product asks for at checkout (server/delivery.mjs). */
export type CheckoutField = { id: string; label: string; type: "text" | "email"; required: boolean };
export type Features = {
  credentialPair?: boolean;
  preorderDelivery?: boolean;
  adminChatInbox?: boolean;
  adminOpsNotifications?: boolean;
  salesRevenueFromPayments?: boolean;
  adminOrdersApi?: boolean;
  adminCustomersApi?: boolean;
  adminProductsApi?: boolean;
  adminSummaryApi?: boolean;
  productPreorderForm?: boolean;
  adminFinance?: boolean;
  adminCustomerManage?: boolean;
  adminVariantCrud?: boolean;
  adminStockApi?: boolean;
  adminReplaceCredential?: boolean;
  uploads?: boolean;
};
export type QueueItem = {
  id: string;
  queue_number: number;
  status: string;
  total: number;
  quantity: number;
  created_at: string;
  customer_id: string;
  customer: string;
  product: string;
  label: string;
};
