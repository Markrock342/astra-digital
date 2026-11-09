/** Money amounts are integer satang (server-owned). */

export type CatalogVariant = {
  id: string;
  label: string;
  /** Integer satang */
  price: number;
  /** Available unsold units; advisory until payment transaction */
  stock: number;
};

export type CatalogRating = {
  average: number | null;
  count: number;
};

/** Public catalog card — never includes digital keys or ciphertext. */
export type CatalogProductSummary = {
  id: string;
  name: string;
  category: string;
  description: string;
  art: string;
  featured: boolean;
  preorder: boolean;
  variants: CatalogVariant[];
  rating: CatalogRating;
  sold: number;
};

export type CatalogProductDetail = CatalogProductSummary;

export type CatalogListResponse = {
  products: CatalogProductSummary[];
};

export type CatalogProductResponse = {
  product: CatalogProductDetail;
};

export type CatalogErrorResponse = {
  error: string;
};
