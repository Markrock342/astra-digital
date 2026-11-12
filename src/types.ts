export type Variant = {
  id: string;
  product_id: string;
  label: string;
  price: number;
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
};
export type User = {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "ADMIN";
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
  reviewed: boolean;
  preorder?:boolean;
  paymentToken?: string | null;
};
export type Ledger = {
  id: string;
  amount: number;
  label: string;
  created_at: string;
};
export type ShopSettings={shopName:string;description:string;announcement:string;line:string;email:string;phone:string;facebook:string;discord:string;policy:string;stockOrder:string;shopOpen:boolean;requireTerms:boolean};
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
  customers: (Omit<User, "balance"> & { created_at: string })[];
  ledger: (Ledger & { name: string })[];
  audit: {
    id: number;
    action: string;
    entity_id: string;
    created_at: string;
  }[];
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
