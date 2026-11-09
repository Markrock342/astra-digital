# Architecture Overview (กระบวนการ)

เอกสารนี้เป็นชั้น**กระบวนการ/หลักการ** — รายละเอียดผลิตภัณฑ์ดูที่ [../architecture.md](../architecture.md) (ของเดิม ไม่ถูกแทนที่)

## ชั้นระบบ (เป้าหมาย)
| ชั้น | หน้าที่ |
|------|---------|
| UI | แสดงผล รับ intent จากผู้ใช้ |
| Application / Domain | กฎธุรกิจ orchestration |
| Data | การเข้าถึงและคงข้อมูล |
| Infra | โครงข่าย แพลตฟอร์ม ภายนอก |

## หลักการ
- แยก concern ตามชั้นและโดเมน
- UI ไม่ตัดสินสิทธิ์คนเดียว — server/domain เป็นแหล่งความจริง
- ค่าที่จูนได้อยู่ที่ config/env
- Secrets ไม่อยู่ในรีโป

## เอกสารที่เกี่ยวข้อง
- Auth/RBAC design: [auth-rbac.md](auth-rbac.md) (Approved)
- ERD เป้าหมาย: [erd-target.md](erd-target.md)
- Payment/Fulfillment: [payment-fulfillment.md](payment-fulfillment.md)
- Security policy: [security.md](security.md)
- ผลิตภัณฑ์: [../architecture.md](../architecture.md)
