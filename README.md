# ASTRA DIGITAL

ร้านสินค้าดิจิทัลภาษาไทยสำหรับสาธิต อิงโครงหน้าร้าน Nexus และหน้ารายการร้านของ Zyron ใช้ชื่อและโลโก้ ASTRA แยกจากแอป NurseGo โดยสมบูรณ์

## ลิงก์ส่งให้ลูกค้า

- [หน้าร้าน](https://astra-demo-133.pages.dev/)
- [ร้านค้าของฉัน / เริ่มทดลองหลังบ้าน](https://astra-demo-133.pages.dev/stores)
- [ระบบจัดการร้าน](https://astra-demo-133.pages.dev/admin)

ลูกค้าเปิด `/stores` แล้วกด **เริ่มทดลองเป็นเจ้าของร้าน** ได้ทันที ไม่มีรหัสผ่าน admin กลาง ข้อมูลสินค้า สต็อก และคำสั่งซื้อแยกตามเบราว์เซอร์ ทุกยอดเป็นเครดิตทดลองและโค้ดทุกชิ้นเป็น DEMO ที่ใช้กับบริการจริงไม่ได้

สองหน้าของเดโมใช้ข้อมูลชุดเดียวกันภายในพื้นที่ทดลองของผู้ใช้: เพิ่มสินค้าจากหลังบ้าน → เปิดหน้าร้าน → ทดลองซื้อและรับโค้ด → กลับมาตรวจคำสั่งซื้อและสต็อกได้ การแยกพื้นที่ป้องกันลูกค้าทดลองแก้ข้อมูลของกันและกัน บัญชีทดลองจึงไม่ใช่บัญชีจริงแบบข้ามอุปกรณ์

## รันเวอร์ชัน Cloudflare ในเครื่อง

ต้องมี Node.js 24.14+ และ npm

```sh
cd /Users/code/nursejob/demos/astra-digital
npm ci
npm run cloud:setup
npm run build
npm run cloud:dev
```

เปิด [http://127.0.0.1:4332](http://127.0.0.1:4332) ใช้ Worker และ durable SQLite เหมือนออนไลน์ รวมถึงการเริ่มพื้นที่ผู้ดูแลทดลอง `cloud:setup` สร้าง `.dev.vars` ที่ถูก ignore และไม่เขียนทับกุญแจเดิม ข้อมูล local Cloudflare อยู่ใน `.wrangler/` และแยกจากข้อมูลออนไลน์

## รัน Node SQLite แบบเดิม

```sh
npm run migrate
npm run seed
npm run dev
```

เปิด [http://127.0.0.1:4330](http://127.0.0.1:4330) · API พอร์ต 4331 กด เข้าสู่ระบบ → เข้าชมด้วยบัญชีทดลอง หรือสมัครด้วยชื่อผู้ใช้ อีเมลไม่บังคับ และรหัสผ่านอย่างน้อย 10 ตัวอักษร

ข้อมูลอยู่ที่ `.data/commerce.sqlite` และกุญแจ `.data/inventory.key` เก็บทั้งคู่เพื่ออ่านโค้ดหลัง restart การรัน seed ซ้ำไม่ reset ข้อมูล Node runtime นี้ไม่มี automatic merchant elevation; provision admin ผ่าน environment เท่านั้น (Cloudflare version มีการแยกพื้นที่เพื่อรองรับปุ่มทดลองหลังบ้าน)

ใน zsh ของ macOS รับรหัสผ่านผู้ดูแลโดยไม่แสดงบนหน้าจอหรือเขียนลง history:

```sh
read -rs 'ASTRA_ADMIN_PASSWORD?Admin password (12+ characters): '
export ASTRA_ADMIN_PASSWORD
npm run dev
```

เข้าสู่ระบบ Node ด้วย `admin@astra.local` และรหัสที่ตั้ง การตั้ง environment นี้ถือเป็นคำสั่ง provision/อัปเดต admin โดยผู้ควบคุมเซิร์ฟเวอร์ ไม่เกี่ยวกับบัญชีเว็บอ้างอิง

รัน Node แบบเสิร์ฟ build ทั้งหน้าเว็บและ API:

```sh
npm run build
NODE_ENV=production PORT=4330 npm start
```

## Cloudflare deployment

ใช้ Worker `astra` กับ SQLite-backed Durable Object `Commerce` และ static assets จาก `dist/` ไม่ต้องเปิดเครื่อง local เพื่อให้ลูกค้าใช้งาน

```sh
npx wrangler whoami
npm run deploy
```

`wrangler.jsonc` ประกาศ binding, migration namespace และ Worker URL แล้ว Cloudflare runtime secrets ถูกตั้งบน Worker แยกจาก source:

- `SPACE_SIGNING_KEY`: HMAC สำหรับ cookie พื้นที่ทดลอง
- `INVENTORY_KEY`: root key สำหรับเข้ารหัสโค้ดแต่ละพื้นที่

ห้ามเปลี่ยนกุญแจของ Worker ที่ใช้งานแล้วโดยไม่มีแผนย้ายข้อมูล เพราะจะกระทบ cookie และโค้ดเดิม ไม่ commit `.dev.vars`, `.data`, `.wrangler` หรือใช้บัญชีเว็บอ้างอิงกับเดโมนี้

Deploy แรกและ secrets ถูกติดตั้งแล้วสำหรับ Worker ปัจจุบัน หากตั้ง instance ใหม่ ให้ตั้ง secrets ผ่าน `wrangler secret put` หรือ secret bulk บน stdin แล้วตรวจ health ก่อนส่งลิงก์

URL สำรองของ Worker คือ [astra.demo-agent-jum.workers.dev](https://astra.demo-agent-jum.workers.dev) cookie ของแต่ละ hostname แยกกัน จึงควรส่ง Pages link หลักให้ลูกค้าตลอด

## Short Pages hostname

The user approved Cloudflare Pages project `astra-demo`. Cloudflare assigned its actual hostname `astra-demo-133.pages.dev`; do not assume `astra-demo.pages.dev` belongs to this project.

`pages/wrangler.jsonc` declares the `COMMERCE_API` service binding to Worker `astra`. `cloud/pages-proxy.mjs` forwards same-origin `/api/*` requests through that binding, while Pages serves the frontend. The same Worker owns durable data, sessions and secret keys; no database is duplicated. Pages is now the primary customer URL. The unrelated custom hostname previously used has been unbound and removed from deployment configuration.

To update the short URL after changing frontend code:

```sh
npm run build
node scripts/build-pages.mjs
npm run deploy:pages
```

For API changes also deploy Worker `astra` using `npm run deploy`. Never copy runtime secrets into the Pages output.

## ตรวจสอบ

```sh
npm run build
npm test
npm run test:e2e
npm run qa:cloud -- http://127.0.0.1:4332
npm run qa:cloud -- https://astra-demo-133.pages.dev
```

หากยังไม่มี Chromium ให้รัน `npx playwright install chromium` หรือระบุ `PLAYWRIGHT_CHROMIUM_EXECUTABLE`

- Business/API tests 14 รายการ: payment/credit/inventory, retries, owner/admin access, encryption, persistence, reviews และขอบเขตสิทธิ์ผู้ดูแลทดลอง
- Browser tests 6 ชุด: shop/search/theme/responsive, purchase/delivery/history/review/top-up/logout, payment failure, registration/profile, admin create/import/sell/export และ routes
- Cloud QA 28 checks ใช้ Worker จริง: เชื่อมหน้าร้าน/หลังบ้าน, private workspace isolation, encrypted delivery/persistence, concurrent last-code purchase, idempotent debit, merchant/customer roles, motion/reduced-motion, mobile overflow และ JS runtime errors
- ทดสอบความกว้าง 360, 390, 768, 1024, 1440px ตารางหลังบ้านเลื่อนในกรอบได้
- Cloud QA บนเว็บจริงแก้เฉพาะพื้นที่ทดลองที่สร้างเอง ไม่แก้ presentation หรือพื้นที่ของลูกค้า

ภาพล่าสุดจาก Cloud QA อยู่ที่ `docs/screenshots/cloud/` รวมหน้าร้าน ระบบร้านค้า หลังบ้าน มือถือ และการรับโค้ด

## ขอบเขต

สินค้าอ้างอิง 2 รายการ พร้อมสต็อกขายทันที 25 ชิ้นตอนเริ่มพื้นที่ทดลอง (ข้อมูลเดิมถูกเก็บไว้) มี catalog/search/filter, single-variant cart, checkout, TEST top-up/ledger, encrypted delivery, order history, verified-order reviews, merchant portal และ admin products/inventory/orders/customers/reports/CSV/audit

แอนิเมชัน: hero entrance, counters, scroll reveals, product/card hover, button/menu feedback, delivery success และ reduced-motion support หลังบ้านใช้ light workspace แยกจาก dark storefront

ยังไม่มีเงินจริง gateway, withdraw/transfer, coupon engine, preorders, refunds, mail/password recovery, permanent multi-tenant organizations หรือ cross-device production identity ดู [production gaps](docs/production-gap.md)

## เอกสาร

- [การตรวจเว็บอ้างอิงและผล human-assisted login](docs/reference-analysis.md)
- [ตารางฟีเจอร์](docs/feature-matrix.md)
- [คู่มือสาธิต](docs/demo-guide.md)
- [สถาปัตยกรรม](docs/architecture.md)
- [สิ่งที่ต้องทำก่อนเปิดจริง](docs/production-gap.md)

ฟอนต์ Noto Sans Thai ใช้ SIL Open Font License ดู `public/fonts/OFL.txt` กราฟิก ASTRA/สินค้าสร้างจาก CSS/SVG สำหรับเดโมนี้


รายละเอียดการเทียบ UI และ motion ล่าสุด: [reference-analysis](docs/reference-analysis.md) · [ขอบเขตเดโม](docs/feature-matrix.md) · [ผลตรวจออนไลน์](docs/cloud-qa-result.json)

## ทำงานร่วมกับเพื่อนและ deploy อัตโนมัติ

ดู [continuous-deployment.md](docs/continuous-deployment.md): push/merge เข้า `main` → build + tests → deploy Worker และ Pages → ตรวจเว็บออนไลน์ เพื่อนที่มีสิทธิ์ write ใน repo ใช้ระบบเดียวกันได้โดยไม่ต้องมีบัญชี Cloudflare ส่วน branch อื่นและ PR จะตรวจโค้ดก่อน ยังไม่แทนที่เดโมลูกค้า
