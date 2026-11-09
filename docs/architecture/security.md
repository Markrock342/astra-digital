# Security Policy (กระบวนการ)

คู่กับ [../architecture.md](../architecture.md) ของผลิตภัณฑ์ — เอกสารนี้ย้ำนโยบายทีม

## เป้าหมาย
- ล้วงหรือดึงข้อมูลผู้ใช้โดยไม่ได้รับอนุญาตทำได้ยาก
- สิทธิ์และขอบเขตข้อมูลชัดเจน
- มีการตรวจสอบหลายขั้นตอนที่วัดได้

## ชั้นการป้องกัน
1. Transport / Session
2. Authentication
3. Authorization
4. Data scope (RLS / ACL / equivalent)
5. Input validation
6. Secrets ใน env/secret store เท่านั้น
7. Audit & errors — ไม่รั่วรายละเอียดภายใน

## Never trust the client
- Client ส่ง intent เท่านั้น
- ห้ามใช้ค่าจาก client เป็นแหล่งความจริงของ authorization / ราคา / สต็อก / บทบาท

## Checklist เส้นทางปลอดภัย
- [ ] ผู้ใช้เข้าถึงของตัวเองได้
- [ ] unauthorized / ข้ามผู้ใช้ถูกปฏิเสธ
- [ ] input ผิดรูปแบบไม่พังและไม่รั่ว
- [ ] ไม่มี secret ในโค้ดหรือ commit
