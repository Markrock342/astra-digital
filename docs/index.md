# ASTRA — สารบัญกลาง (Master Index)

สารบัญนี้**เพิ่ม**โครงกระบวนการทำงาน — **ไม่แทนที่**เอกสารเดิมของผลิตภัณฑ์

## สถานะ / กระบวนการ (ใหม่)

| รายการ | ไฟล์ |
|--------|------|
| สถานะล่าสุด | [status/CURRENT.md](status/CURRENT.md) |
| NOTT Sprint 1 Delivery | [status/NOTT-SPRINT1-DELIVERY.md](status/NOTT-SPRINT1-DELIVERY.md) |
| Workflow (Owner + Agent รวมแชท) | [process/workflow.md](process/workflow.md) |
| Task Spec / handoff | [process/handoff.md](process/handoff.md) |
| Definition of Done | [process/definition-of-done.md](process/definition-of-done.md) |
| Architecture ระดับกระบวนการ | [architecture/overview.md](architecture/overview.md) · [architecture/security.md](architecture/security.md) · [architecture/auth-rbac.md](architecture/auth-rbac.md) · [architecture/erd-target.md](architecture/erd-target.md) · [architecture/erd-sprint1.md](architecture/erd-sprint1.md) · [architecture/adr-d1-migration-path.md](architecture/adr-d1-migration-path.md) · [architecture/payment-fulfillment.md](architecture/payment-fulfillment.md) |
| Roadmaps | [roadmaps/README.md](roadmaps/README.md) · [NOTT Sprint 1](roadmaps/NOTT-SPRINT1.md) (Approved) · [NOTT DB Architecture](roadmaps/NOTT-DB-ARCHITECTURE.md) (Approved) |
| Database Review Pack (NOTT → Mark) | [database/README.md](database/README.md) · Audit · ERD · Schema · Integrity · Migration Plan · Test Plan |
| Task Specs | [prompts/TASK-PROMPT-TEMPLATE.md](prompts/TASK-PROMPT-TEMPLATE.md) |
| Changelog กระบวนการ | [changelog.md](changelog.md) |

## Requirement / Ownership (intake)

| เอกสาร | ไฟล์ |
|--------|------|
| Prompt pack LCS×FIFA (Mark/Nott/Bank) | [requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md](requirements/LCS_FIFA_AI_Prompts_MARK_NOTT_BANK_20261109.md) |
| แผนรายสัปดาห์ NOTT/Bank/Mark | [requirements/NOTT_BANK_MARK_WEEKLY_TH.md](requirements/NOTT_BANK_MARK_WEEKLY_TH.md) |
| Roadmap NOTT Weekly | [roadmaps/NOTT-WEEKLY.md](roadmaps/NOTT-WEEKLY.md) |
| Module: Backend NOTT (ขอบเขตทีมนี้) | [modules/backend-nott.md](modules/backend-nott.md) |
| Catalog API contract (Phase 3) | [modules/api-contract-catalog.md](modules/api-contract-catalog.md) |
| NOTT backend inventory (Task 0.1.1) | [modules/nott-backend-inventory.md](modules/nott-backend-inventory.md) |
| NOTT Gap Map (Task 0.1.2) | [modules/nott-gap-map.md](modules/nott-gap-map.md) |

## เอกสารผลิตภัณฑ์เดิม (คงไว้)

| เอกสาร | ไฟล์ |
|--------|------|
| Architecture (ผลิตภัณฑ์) | [architecture.md](architecture.md) |
| Continuous deployment | [continuous-deployment.md](continuous-deployment.md) |
| Demo guide | [demo-guide.md](demo-guide.md) |
| Feature matrix | [feature-matrix.md](feature-matrix.md) |
| Production gap | [production-gap.md](production-gap.md) |
| Reference analysis | [reference-analysis.md](reference-analysis.md) |
| Release | [RELEASE.md](RELEASE.md) |

## แผนที่บทบาท

```
Owner
  └─ Agent แชทเดียว (PM + Coder)
       ├─ Sub-agents (วิจัย / สำรวจ)
       └─ commit ท้องถิ่น → push โค้ดเมื่อ Owner สั่ง (ห้าม push docs/schema)
```

## Cursor Rules

- `.cursor/rules/role-agent.mdc` — รวม PM+Coder
- `.cursor/rules/project-docs.mdc` — โครง docs
- `.cursor/rules/architecture-security.mdc` — ชั้นระบบ + security
