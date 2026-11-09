# D1 migrations (แทร็ก B)

โฟลเดอร์นี้เป็น schema เป้าหมายตาม brief NOTT + [erd-target.md](../../docs/architecture/erd-target.md)

- ของเดิมที่ยังใช้กับ DO/Node อยู่ที่ `server/migrations/` — **ห้ามลบ**
- ตั้งชื่อไฟล์แบบ Wrangler D1: `0001_*.sql`, `0002_*.sql`, …
- Apply local: ดู [adr-d1-migration-path.md](../../docs/architecture/adr-d1-migration-path.md)

```sh
npm run db:migrate:local
```
