# Auth / RBAC Design — ASTRA (NOTT)

สถานะ: **ร่างสำหรับ Owner รีวิว (Task 0.2.1)** → รอ Approve ที่ Task **0.2.2**  
ยัง **ไม่** เป็นใบสั่ง implement จนกว่า Owner Approve  
อิงของจริง: `server/domain.mjs`, `server/api-handler.mjs`, `cloud/worker.mjs`, `tests/commerce.test.mjs`  
คู่กับ: [../modules/nott-backend-inventory.md](../modules/nott-backend-inventory.md) · [security.md](security.md)

## 1. เป้าหมาย

- ยืนยันตัวตน (Authentication) และมอบสิทธิ์ (Authorization) ฝั่ง server เท่านั้น
- **Never trust the client:** ห้ามรับ `role` / สิทธิ์ / ราคา / สถานะจ่าย จาก body ของ client เป็นแหล่งความจริง
- แยกชัด: บัญชีใน workspace เดโม ≠ บัญชี production ถาวรข้ามเครื่อง
- Phase 2 จะ implement/ปรับตามเอกสารนี้ใน PR แยก จาก design (ตาม brief)

## 2. Actors

| Actor | ความหมาย | วิธีได้มา |
|-------|----------|-----------|
| Anonymous | ไม่มี session ใช้ได้ | ไม่มี/หมดอายุ `astra_session` |
| Customer | ผู้ซื้อใน workspace | `register` / `login` / `demo` → role `CUSTOMER` |
| Admin (Merchant) | ผู้ดูแลร้านใน workspace | (Cloud) `demoMerchant` เมื่อ `allowDemoAdmin` · (Node) provision ผ่าน `ASTRA_ADMIN_PASSWORD` → `admin@astra.local` |
| System/Runtime | Worker/Node process | ถือ secrets; ไม่ใช่ผู้ใช้ปลายทาง |

Cloudflare เพิ่มมิติ **Workspace**:
- Cookie `astra_space` (id + HMAC) เลือก Durable Object ส่วนตัว
- Object ชื่อ `presentation` = อ่านอย่างเดียว ไม่ให้ POST API และ `allowDemoAdmin=false`

## 3. Roles (RBAC)

| Role | เก็บที่ | ตั้งค่าได้จาก client? |
|------|---------|------------------------|
| `CUSTOMER` | คอลัมน์ `users.role` (default) | **ไม่ได้** — `register` ไม่รับ field role |
| `ADMIN` | คอลัมน์ `users.role` | **ไม่ได้** จาก register/profile; เฉพาะเส้นทาง server ที่อนุญาต |

กฎ: ค่า role ที่ client ส่งมาใน JSON **ต้องถูกละเว้น** เสมอ (มีเทส `roles cannot be injected`)

`publicUser` อาจคืน `role` ให้ UI แสดงผล — เป็นข้อมูลอ่านอย่างเดียว ไม่ใช่หลักฐานสิทธิ์ฝั่ง server

## 4. Authentication flows

### 4.1 Session

1. Server สร้าง random token (32 bytes hex)
2. เก็บเฉพาะ `SHA-256(token)` ใน `sessions` พร้อม `expires_at` (7 วัน)
3. ส่ง cookie `astra_session` = raw token · `HttpOnly; SameSite=Lax; Path=/` · เพิ่ม `Secure` เมื่อ HTTPS
4. ทุกคำขอ: อ่าน cookie → `session(token)` join users ที่ยังไม่หมดอายุ
5. เปลี่ยนรหัสผ่าน → ลบ sessions ของ user นั้นทั้งหมด

### 4.2 เส้นทางออกเอกสารรับรอง

| เส้นทาง | ผล | จำกัด |
|---------|-----|--------|
| `POST /api/register` | สร้าง CUSTOMER + welcome TEST credit + session | password ≥ 10; ไม่ตั้ง role จาก input |
| `POST /api/login` | session ของ user ที่มีอยู่ | เทียบ scrypt แบบ constant-time; ไม่บอกว่าอีเมลมีหรือไม่แยกจากรหัสผิด |
| `POST /api/demo` | สมัคร guest CUSTOMER | สำหรับเดโม |
| `POST /api/demo-merchant` | สมัครแล้วยกระดับ ADMIN ใน workspace ปัจจุบัน | เฉพาะเมื่อ `allowDemoAdmin===true`; ไม่ข้าม workspace |
| `POST /api/logout` | ลบ session hash | |

Auth endpoints มี rate limit (local memory หรือ SQLite `rate_limits` บน Cloudflare)

### 4.3 Password

- scrypt + salt ต่อ user
- ไม่เก็บ plaintext
- ไม่มี email verification / reset ใน Sprint นี้ (ตรง `feature-matrix` / production-gap)

## 5. Authorization matrix (กลุ่มหลัก)

สัญลักษณ์: Public = ไม่บังคับ login · User = `requireUser` · Admin = `requireAdmin` · Owner = ต้องเป็นเจ้าของแถวข้อมูล

| กลุ่ม API | Anonymous | Customer | Admin |
|-----------|-----------|----------|-------|
| health, products, overview, reviews (อ่าน) | ได้อ่าน | ได้อ่าน | ได้อ่าน |
| me | user=null | โปรไฟล์ตน | โปรไฟล์ตน |
| orders list/detail, pay, retry, ledger, topup, profile, add review | 401 | ตนเท่านั้น (Owner) | ตนในฐานะผู้ซื้อ; admin overview คนละเส้น |
| admin overview / import / settings / products | 401/403 | 403 | ได้ |
| demo-merchant | ตาม `allowDemoAdmin` | — | สร้าง admin ใหม่ใน space |

กฎ Owner ที่บังคับ:
- อ่าน/จ่าย order ต้อง `user_id` ตรง; คนอื่นได้ 404/403 ตามของจริง (ไม่ leak ว่ามี order)
- Review ได้เฉพาะ order ของตนที่ `DELIVERED` ภายใน 7 วัน · หนึ่งรีวิวต่อ order
- Delivery codes คืนเฉพาะ owner ของ order ที่จัดส่งแล้ว — catalog/admin list **ไม่** คืน plaintext unused keys

## 6. demo-merchant & workspace boundary

```text
Browser
  └─ astra_space (signed) → Durable Object workspace
        └─ users/sessions/orders/... แยกต่อ space
              └─ demoMerchant() อัปเดต role=ADMIN เฉพาะ user ใน space นี้
```

ข้อกำหนด design:
1. `demoMerchant` ห้ามทำงานเมื่อ `allowDemoAdmin=false` (รวม presentation object)
2. การเป็น ADMIN ใน space A ไม่มีความหมายใน space B
3. เอกสารผลิตภัณฑ์และ UI ต้องไม่สื่อว่าเป็นบัญชี merchant ถาวรข้ามอุปกรณ์
4. Node local ไม่เปิด demo-merchant elevation อัตโนมัติ — ใช้ env admin provision แทน

## 7. ชั้นป้องกันที่ต้องคงไว้ (และขยายใน Phase 2)

1. Transport/cookie flags ตามสภาพ HTTPS  
2. Authentication = session hash lookup  
3. Authorization = role + ownership checks ใน domain  
4. Data scope = filter ด้วย `user_id` / workspace object  
5. Input validation ที่ขอบ API + domain  
6. Secrets ใน env/secret store เท่านั้น  
7. Audit events สำคัญ (LOGIN, REGISTER, DEMO_MERCHANT, PAYMENT_*, IMPORT_CODES, …)

Mutation เพิ่ม: ต้องมี `X-Astra-Request: 1` + JSON + same-origin Origin (CSRF/browser guard ระดับหนึ่ง)

## 8. เคสเชิงลบที่บังคับมีตอน Phase 2 (และมีหลายเคสอยู่แล้ว)

| เคส | ผลที่คาด |
|------|----------|
| ไม่มี session เรียก orders/ledger/admin | 401 |
| CUSTOMER เรียก admin_* | 403 |
| User A อ่าน/จ่าย order ของ B | 404 หรือ 403 โดยไม่คืนโค้ด |
| ส่ง `role: ADMIN` ตอน register/profile | ถูกละเว้น · ยังเป็น CUSTOMER |
| `demoMerchant` เมื่อ allowDemoAdmin=false | 403 |
| Token หมดอายุ / หลังเปลี่ยนรหัส | session ใช้ไม่ได้ |
| Origin แปลก / ไม่มี X-Astra-Request ตอน POST | 403 |

หลักฐานปัจจุบัน: `tests/commerce.test.mjs` (ownership, role injection, demo-merchant gate, password revoke, HTTP CSRF/owner)

## 9. สิ่งที่ออกแบบไว้แต่ยังไม่ทำใน Sprint 1 นี้

- Email verification / password recovery / MFA
- Permanent multi-tenant org + invite members
- Refresh-token rotation แบบแยก family
- RBAC ละเอียดเกิน CUSTOMER/ADMIN (เช่น staff ย่อย)
- ย้ายแหล่งความจริง role ไป IdP ภายนอก

ช่องว่างเหล่านี้ไปที่ `production-gap.md` — ไม่บล็อกการ Approve design นี้สำหรับ Sprint 1

## 10. ผลกระทบต่อ Phase ถัดไป

| Phase | ใช้ design นี้อย่างไร |
|-------|----------------------|
| 0.3 ERD | คง `users.role` check; sessions เป็น token_hash; อย่าเพิ่มคอลัมน์ให้ client เขียน role |
| 2 Auth implement | PR แยก: ให้พฤติกรรมตรง matrix + เคสเชิงลบ; ถ้ามี D1 ให้คงสัญญาเดียวกัน |
| 3 Product API | สิทธิ์อ่าน catalog เป็น public; ห้ามผูก key กับ anonymous |
| 4 Payment | การยืนยันจ่ายต้องเป็น user owner + server token — ไม่ใช้ role จาก client |

## 11. คำขอ Approve จาก Owner (Task 0.2.2)

กรุณายืนยันว่า:
1. ยอมรับ roles แค่ `CUSTOMER` | `ADMIN` ใน Sprint 1  
2. ยอมรับขอบเขต `demo-merchant` เป็นเดโมต่อ workspace เท่านั้น  
3. ยอมรับว่า email recovery/MFA อยู่นอก Sprint นี้  
4. ให้ใช้เอกสารนี้เป็นเกณฑ์ Phase 2  

ถ้าขอแก้ — ระบุข้อที่ต้องการเปลี่ยนก่อนเริ่ม Task 0.3.1
