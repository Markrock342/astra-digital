export type Variant = {
  id: string;
  product_id: string;
  label: string;
  price: number;
  /** 0 = no warranty. */
  warranty_days?: number;
  /** Public API caps this at 10; admin overview returns the exact count. */
  stock: number;
  stockStatus?: "in" | "low" | "out";
};
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
};
export type User = {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "ADMIN" | "STAFF";
  balance: number;
};
export type Order = {
  id: string;
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
};
export type Ledger = {
  id: string;
  /** Signed: + credit in, − credit out. */
  amount: number;
  label: string;
  created_at: string;
  type?: "TOPUP" | "PURCHASE" | "REFUND" | "ADJUSTMENT";
  balanceAfter?: number;
};
export type ShopSettings={shopName:string;description:string;announcement:string;line:string;email:string;phone:string;facebook:string;discord:string;policy:string;stockOrder:string;shopOpen:boolean;requireTerms:boolean;pendingExpiryMinutes?:number};
export type Overview = {
  shop?:ShopSettings;
  customers: number;
  products: number;
  orders: number;
  categories: { id: string; name: string }[];
  activity: {
    kind: string;
    name: string;
    product?: string;
    art?: string;
    label?: string;
    time: string;
  }[];
};
export type AdminData = {
  revenue: number;
  orderCount: number;
  delivered: number;
  stock: number;
  products: Product[];
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
};
export type Credential = { loginId: string; password: string };
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
