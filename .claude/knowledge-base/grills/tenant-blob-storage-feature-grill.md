---
slug: tenant-blob-storage
date: 2026-07-14
generated_by: roadmap-feature
questions_asked: 4
decisions_resolved: 4
status: completed
new_milestone_id: M7
---

# Feature grill: tenant-blob-storage → M7 (theo-cloud/ROADMAP.md)

> Grill focado do `/roadmap-feature` (why-now / deps / DoD / risks). As 8 decisões de PRODUTO já foram grilladas em `theo/.claude/knowledge-base/grills/tenant-blob-storage-grill.md` (READY_FOR_PLAN); a arquitetura está no blueprint `theo/.claude/knowledge-base/discoveries/blueprints/tenant-blob-storage-blueprint.md` (SHIPPABLE 100.0, 4 ADRs). Sponsor: paulohenriquevn.

## Out-of-scope cross-check (Step 3)

Nenhum overlap: os 3 itens out-of-scope do roadmap (account_members RBAC, JWT major bump, data-plane workspace semantics) não intersectam "tenant blob storage / files / S3". `out_of_scope_overlap: none`.

## SOTA delta (Step 5)

**No** — referências existentes suficientes. Os 4 peers de storage (supabase/storage Apache-2.0, nhost/hasura-storage Apache-2.0, pocketbase MIT, google/go-cloud Apache-2.0) já estão clonados e catalogados em `theo/.claude/knowledge-base/references/_catalog.md` (added_by: discover-plan tenant-blob-storage, com pins de SHA). Nenhum peer novo clonado; nenhuma entrada existente tocada.

## Q&A log

### Q1: O que é a feature e por que AGORA?
**Recommended**: (pré-respondida pelo sponsor na sessão — registrada sem re-perguntar)
**User decision (verbatim da sessão 2026-07-14)**: "Uma feature que os clientes estão pedindo é storage files onde ele (pode ser wrapper S3)" — demanda direta de clientes; apps deployados hoje precisariam contratar S3 externo para guardar arquivos. Mandato adicional do sponsor: "DEVE TER TODAS AS JORNADAS, UI, SDK, TUDO — SOLUÇÃO COMPLETA".

### Q2: Quais milestones precisam estar [x] antes?
**Recommended**: M1 + M3 — storage reusa exatamente o que eles entregaram: M1 (broker per-Account-scoped mint — as theo_live_* keys com scopes são o ÚNICO acesso ao storage) e M3 (enforce + propagate — a cadeia de enforcement per-Account onde os caps 402 plugam). M5 [ ] NÃO é dependência (fix ortogonal de project-cap no deploy-path).
**User decision**: "Aceito a recomendação" → **deps: M1, M3** (ambos [x] — M7 imediatamente elegível).

### Q3: Definition of Done verificável?
**Recommended**: 7 bullets cobrindo a solução completa (API + CLI + SDK + UI + jornadas + testes + docs).
**User decision**: "Aceito a recomendação" → DoD com 7 itens (ver bloco M7 no ROADMAP.md — cópia canonical lá).

### Q4: Top 2 riscos NOVOS?
**Recommended**: (1) proxy data path = custo/gargalo no cloud-API compartilhado com os outros verticais — mitigação: caps ÷10 + MetricStorageBytes/egress metering + timeouts + escape-hatch Nhost SigV4-rewrap documentado; (2) SigV4 hand-rolled é código de segurança de autoria própria (presign+multipart novos) — mitigação: test-vectors pocketbase + round-trip mint→redeem contra MinIO real + erros tipados. Risco 3 consciente já aceito no grill de produto: namespace tenant-global (staging↔prod por convenção de prefixo).
**User decision**: "Aceito a recomendação".

## Artefatos upstream (input do futuro /auto-plan M7)

- Grill de produto (8 decisões): `theo/.claude/knowledge-base/grills/tenant-blob-storage-grill.md`
- Blueprint (4 ADRs + 8 recomendações): `theo/.claude/knowledge-base/discoveries/blueprints/tenant-blob-storage-blueprint.md`
- Reviews da chain discover: `theo/.claude/knowledge-base/reviews/tenant-blob-storage-*.{md,json}`
