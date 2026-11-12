# Roadmap — Admin FR งาน 5 · ระบบอัปโหลดรูป (W5-UP)

**Brief:** `BRIEF-20261112-admin-fr-w5-uploads`  
**สเปกเต็ม:** [docs/prompts/ADMIN-FR-WORK5-uploads.md](../prompts/ADMIN-FR-WORK5-uploads.md)  
**สถานะ:** **Approved** · UP-1 merge แล้ว · **Current = UP-2** (avatar + logo)  
**ฐาน:** `main` หลัง #40 + money/auth-hardening  
**Deploy:** ห้ามจนกว่ามาร์คสั่ง

- Phase 1 UP-1: แกนกลาง + รูปสินค้า — **done** (PR #40)
- Phase 2 UP-2: avatar + logo — **กำลังทำ** (สาขา `feat/admin-fr-w5-up2-avatar-logo`)
- Phase 3 UP-3: รูปแชท/สลิป — **ล็อก** ห้ามทำจนกว่ามาร์คยืนยัน

## Backlog หลัง UP-2 (PR ทีละข้อ — ยังไม่ทำในสาขานี้)

1. ต้นทุน + กำไร — `inventory.cost`, รายงานกำไร, ตัดเงินทดลองผ่าน `money.mjs`, เห็นเฉพาะ ADMIN
2. วันหมดอายุบัญชีในสต็อก — `inventory.expires_at`, ไม่ขายใกล้หมดประกัน, แจ้งผ่าน notify ในเว็บ
3. PDPA — ลูกค้าขอ JSON / ขอลบ; แอดมินอนุมัติ anonymize; ห้ามแตะ append-only ledger/audit triggers
4. ความเร็วที่ 10k ออเดอร์ — สคริปต์จำลอง + วัด p95 + index &lt; 500ms
5. หน้าตรวจระบบ + อัปเดต `docs/architecture/api-contract-shop.md` ให้ครบ endpoint ใหม่
