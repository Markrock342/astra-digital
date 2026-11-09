import { openLocalCommerce } from "./commerce.mjs";
const service = openLocalCommerce();
console.log(
  "Database ready. Seed is idempotent.",
  JSON.stringify({
    products: service.products().length,
    variants: service.overview().products,
  }),
);
service.db.close();
