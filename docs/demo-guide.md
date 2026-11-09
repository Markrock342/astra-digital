# Demo guide

## Customer journey

1. Open `http://127.0.0.1:4330` after running `npm run dev`.
2. Browse products; try categories, stock filter, search and price sorting.
3. Open STREAM+ and select 30 or 90 days and quantity.
4. Click ซื้อสินค้าเลย, review the basket and continue. If signed out, choose เข้าชมด้วยบัญชีทดลอง to receive an individual customer account with 500 TEST credits.
5. Confirm the server-created order using TEST credits. No card or bank information is requested.
6. The delivery screen shows the allocated `DEMO-KEY-NOT-VALID-...` code. Copy it, reload, and use แสดงโค้ด to reveal it again.
7. Open ประวัติการซื้อ to view the same order and code. Another account cannot access it.
8. Open เครดิตร้าน after delivery to leave one review for the completed order.
9. Open เติมเงิน, select a preset amount, acknowledge the sandbox and confirm. Check the credit ledger.
10. Try light/dark/system themes and mobile bottom navigation.

## Failure and stock

- For payment failure, create another order and use ทดลองกรณีชำระเงินไม่สำเร็จ. No debit or code is created. A failed order is terminal; place a new order to try again.
- To demonstrate stock exhaustion, create a product in admin without importing stock. Its buy controls are disabled. Import one code and buy it; the product returns to out-of-stock.
- The automated tests also exercise a last-code race and repeated payment confirmations.

## Admin journey

1. Follow README to provision a local admin with an environment-supplied password, then log in as `admin@astra.local`.
2. Open `/admin` for database-derived order, sales and stock totals.
3. Open สินค้า → เพิ่มสินค้า. Set name, category, price and description. Toggle active status or edit later.
4. Open คลังโค้ด → นำเข้าโค้ด. Select the product/package; enter one `DEMO-...` code per line. Only uppercase letters, numbers and hyphens are accepted. Duplicate imports are rejected atomically.
5. Use a separate browser profile/customer account to purchase the imported code.
6. Refresh admin inventory; the sold unit is no longer available. Check the order and credit ledger.
7. Search/filter orders; export CSV. Open รายงาน for category sales and best-selling products.
8. Open ข้อมูลระบบ for runtime facts and recent audit records.

## Screenshots and test isolation

`npm run test:e2e` writes actual screenshots into `docs/screenshots/`: desktop/mobile home, catalog, customer account, successful delivery, admin overview/inventory and wallet. Tests use isolated in-memory data; running QA does not reset the interactive demo.

## Online demo and merchant entry

Open `/stores` on the published domain and click **เริ่มทดลองเป็นเจ้าของร้าน**. This creates your own browser's demo store without a shared password. Select **จัดการร้านค้า** to enter `/admin`, or **ดูหน้าร้าน** to shop against the same products and inventory. The storefront footer also links back to the merchant portal.

Each browser has its own isolated test data. A customer can freely edit products and import DEMO keys without changing another customer's shop. Signing in is scoped to that demo browser; this is not a permanent cross-device merchant account.

The interface includes hero entrances, animated counters, staggered reveals, card/menu/button feedback and success animation. Browser reduced-motion preferences disable those effects.
