# Task Spec Protocol — Agent (แชทเดียว)

ใช้หลัง Owner **Approve** Roadmap แล้วเท่านั้น  
ค่าเริ่มต้น: **หนึ่ง Task Spec = หนึ่ง Task**  
ในโหมดแชทเดียว ไม่ต้องคัดลอกไปแชทอื่น — Agent เขียนแล้วทำเองหลัง Owner โอเค Task นั้น (หรือทำต่อตาม Roadmap ที่ Approve แล้ว)

## โครง Task Spec

````markdown
[TASK]
ระบบ: [ชื่อระบบ]
แผนงาน: Phase [X] → Milestone [X.X]
Current Task: [Task ID] - [ชื่องาน]

**รายละเอียดเทคนิค:**
- **เป้าหมาย:** [...]
- **ศัพท์ที่ถูกต้อง:** [...]
- **Flow:** [...]
- **ไฟล์/โมดูลที่เกี่ยวข้อง:** [...] หรืออ่านของจริงในรีโปก่อน
- **Input / Output:** [...]
- **Security:** [...]
- **Constraints / Error Handling:** [...]
- **Config:** [...]
- **ข้อห้าม:** ห้ามทำนอก Task นี้
- **เกณฑ์ผ่าน:** [วัดได้]
- **หลักฐานที่ต้องมี:** [คำสั่งรัน / ผลเทส / พฤติกรรม / รายการไฟล์]
- **ชั้นเทสที่บังคับ:** [unit / integration / security negative / รอ Owner เทส]
- **Git:** commit หลังผ่านเกณฑ์; **ห้าม push** จนกว่า Owner สั่ง; push ได้เฉพาะโค้ด — ห้าม push docs/schema
````

## กฎ
- ทำทีละ Task ตามลำดับใน Roadmap
- รวมหลาย Task ใน Spec เดียวได้เฉพาะเมื่อ Owner อนุมัติและ Tasks ผูกแน่น
- ตั้งชื่อไฟล์ใน `docs/prompts/` ให้มี Task ID เช่น `P1-M1-T1-setup.md`
- Tech Note ใน Roadmap เป็นสรุปสั้น — Task Spec ต้องขยายเกณฑ์ผ่าน + หลักฐาน
