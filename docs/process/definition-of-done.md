# Definition of Done

งานถือว่าเสร็จได้ก็ต่อเมื่อมีหลักฐานครบ — ไม่ผ่านเพราะแค่บอกว่าทำแล้ว

## เกณฑ์ก่อนเริ่มเขียนโค้ด (งานใหญ่)
- [ ] มี Roadmap ระดับ Phase → Milestone → Task
- [ ] Owner **Approve** Roadmap แล้ว (หรือ Approve การแก้รอบล่าสุด)
- [ ] มี Task Spec ของ Current Task ครบตาม [handoff.md](handoff.md)

## เกณฑ์บังคับทุก Task (Agent ทำในแชทเดียว)
- [ ] ทำครบตามขอบเขต Current Task ไม่ล้ำข้อห้าม / ไม่ทำ Task อื่นเอง
- [ ] รายงาน/สรุประบุ Phase / Milestone / Task ID
- [ ] ตรวจของจริงในรีโปแล้ว (พาธ / API / สคีมา) ไม่เดา
- [ ] มีหลักฐานรันจริง: คำสั่งที่ใช้ + ผลที่ได้ หรือพฤติกรรมที่พิสูจน์ได้
- [ ] อัปเดต docs ที่เกี่ยวข้อง + `docs/status/CURRENT.md` (ใส่ Task ID)
- [ ] Self-QC ผ่านเกณฑ์แล้วจึง **commit** (ห้าม push จนกว่า Owner สั่ง)
- [ ] รายการไฟล์ที่เปลี่ยนชัดเจน (แยกโค้ด vs docs/schema)

## เกณฑ์หลัง Task ผ่าน (ก่อน/ตอน commit)
- [ ] ตัดสินผ่านด้วยหลักฐาน — ไม่ commit งานที่ไม่ผ่าน
- [ ] commit ในเครื่องได้ทั้งโค้ดและ docs/schema (ห้าม secret); แนะนำแยก commit
- [ ] ยังไม่ push จนกว่า Owner สั่ง — **push GitHub ได้เฉพาะโค้ด**; **ห้าม push** docs/schema; **ห้ามใช้ `.gitignore`** ตัด docs/schema

## ชั้นเทส
| ชั้น | เมื่อไหร่ | หลักฐานตัวอย่าง |
|------|----------|-----------------|
| Unit | business logic / โดเมน | ผลเทสผ่าน (`npm test`) |
| Integration / Contract | API, DB, ขอบโมดูล | เทสหรือสคริปต์เรียกจริงผ่าน |
| Security negative | authz, ข้อมูลผู้ใช้, input อันตราย | เคสถูกปฏิเสธ/ไม่รั่ว |
| Regression | แก้บั๊กสำคัญ | เคสที่เคยพังถูกครอบ |
| **Cloudflare DO / workerd** | แตะ `cloud/worker.mjs`, DO SQLite adapter, หรือโค้ดที่พึ่งผล `prepare().run().changes` | `npm run test:do` (Miniflare/workerd) **และ** `wrangler dev --local` + `npm run qa:wrangler-local` — **node SQLite อย่างเดียวไม่นับ** |
| E2E (Playwright) | เส้นทางลูกค้า/แอดมินสำคัญ | `npm run test:e2e` |
| Manual / Owner / Mark | UX บนร้านจริง | รายการรอผู้ใช้เทส — **ห้าม `qa:cloud` ร้านจริง** จนกว่า Mark/Owner สั่ง |

### กฎบังคับเมื่อแตะ Cloudflare path
- [ ] มีเทส workerd/Miniflare ที่พิสูจน์พฤติกรรมบน DO (ไม่ใช่แค่ `createCommerce` / node:sqlite)
- [ ] มีหลักฐาน `wrangler dev --local` สำหรับเส้นทางที่เคยพังหรือพึ่ง `run().changes` (เช่น deliver / replace)
- [ ] ห้ามปิด Task ว่า “ผ่าน” ถ้าเทสแค่ node แล้วสมมติว่า Cloudflare เหมือนกัน

## ความปลอดภัยเพิ่ม เมื่อแตะข้อมูลผู้ใช้หรือสิทธิ์
- [ ] Never trust the client
- [ ] Validate input ที่ขอบ
- [ ] ตรวจสิทธิ์หลายขั้น
- [ ] มีเคสข้ามผู้ใช้ / unauthorized
- [ ] ไม่มี secret ในโค้ดหรือ commit

## สิ่งที่ไม่นับว่าเสร็จ
- เขียนโค้ดระบบหลักก่อน Approve Roadmap (งานใหญ่)
- บอกว่าทำแล้วแต่ไม่มีคำสั่ง/ผลเทส/พฤติกรรมพิสูจน์
- เทสที่เขียนไว้แต่ไม่เคยรัน
- ทำเลย Task อื่นนอก Spec โดยไม่ได้รับสั่ง
- เอกสารไม่อัปเดตจนขัดกับโค้ด
