# Review: dashboard-audit-2026-08-06

**Data:** 2026-08-06
**Alvo:** 98 commits em `workspace`, base `b80cf73` (merge-base com `develop`)
**Veredito:** `NEEDS_FIXES` — 1 BLOCKER

## O review multi-agente NAO rodou, e por que

`skills/review/SKILL.md § Step 1` recusa quando nao existe plano em
`.claude/knowledge-base/plans/{slug}-plan.md`, e a regra inviolavel do proprio
skill diz: *"NEVER reviews without the plan as ground truth — review without plan
is vibes."*

Nao existe plano. **A causa e o proprio BLOCKER abaixo**: os 27 planos foram
apagados. O gate recusou por falta de um artefato que o diff sob revisao remove.

O que rodou, e passou: os hard gates mecanizaveis de `cycle-review.md` —
sem `Co-Authored-By` em nenhum dos 98 commits, HEAD em `workspace`, nenhum
arquivo de segredo no diff, `CHANGELOG.md` atualizado, suite verde
(298 arquivos / 2603 testes), e `/code-quality` em `PASS` (score 100, `go` e
`typescript` auditados).

## BLOCKER

### F1 — A promocao apagaria a trilha de auditoria e o ROADMAP de `develop`

- **Severidade:** BLOCKER
- **Commit:** `8cbc8e7` *"chore: remove outdated release notes and review documents"*, autoria `paulohenriquevn`, 2026-08-05 23:53 — anterior a esta sessao
- **Escala real:** 565 arquivos, 75.488 linhas. A mensagem descreve "release notes e review documents"; o commit tambem removeu tudo abaixo.

Medido comparando `origin/develop` (`33808ba`) com `HEAD`:

| Artefato | Em `develop` hoje | Depois da promocao |
|---|---|---|
| `.claude/knowledge-base/plans/` | 27 | 0 |
| `.claude/knowledge-base/reviews/` | 45 | 0 |
| `.claude/knowledge-base/audits/` | 23 | 0 |
| `.claude/knowledge-base/adrs/` | 2 | 0 |
| `.claude/knowledge-base/releases/` | 21 | 0 |
| `.claude/knowledge-base/discoveries/` | 15 | 0 |
| `ROADMAP.md` | 1006 linhas | apagado |

- **Regra violada:** `rules/audit-trail-rotation.md § What NEVER rotates` lista
  `knowledge-base/plans/{slug}-plan.md` ("kept indefinitely; the canonical record
  of *what we agreed to build*"), `knowledge-base/discoveries/blueprints/` e
  `knowledge-base/adrs/` como artefatos que **nunca** rotacionam. A politica de
  retencao permite arquivar `reviews`/`audits` apos janela — nunca apagar planos,
  ADRs ou blueprints.
- **Consumidores que quebram:** `cycle-acceptance` le `ROADMAP.md` para extrair os
  criterios de aceite e para o flip do checkbox; `cycle-maintenance` le
  `knowledge-base/roadmap-runs/`; `/review` le `knowledge-base/plans/` — foi
  exatamente por isso que este review recusou.
- **As skills sobreviveram** (35 `SKILL.md` hoje contra 32 antes): o commit tambem
  removeu diretorios de skill, mas uma reinstalacao posterior os repos. A perda
  liquida e a trilha de conhecimento, nao a ferramenta.
- **Recuperavel:** sim, integralmente. Tudo esta intacto em `8cbc8e7^`.

**Acao recomendada:** restaurar os artefatos que a regra marca como nao-rotacionaveis
(`plans/`, `adrs/`, `discoveries/`) e o `ROADMAP.md` num commit novo sobre
`workspace` — `git restore --source=8cbc8e7^ -- <caminhos>`. `reviews/`, `audits/`
e `releases/` sao rotacionaveis pela politica e podem ficar de fora, se a intencao
era limpeza; a decisao e do dono. **Nao usar `git revert`** (Regra 4).

**Por que isto nao foi resolvido sozinho:** e um commit deliberado do dono do
projeto, ja em `origin/workspace`. Restaurar por conta propria desfaria uma decisao
dele; promover apagaria a trilha de `develop`. As duas sao acoes de mao unica, e a
escolha entre elas nao e tecnica.

## HIGH / MEDIUM / LOW

Nao avaliados. O review por agentes independentes — que cobriria arquitetura,
testes, wiring e cross-validation sobre os 116 arquivos de `dashboard/src`, 86 de
`internal/` e 11 de `cmd/` — nao pode rodar sem o contrato, e o contrato e o que o
BLOCKER remove. Rodar so os gates mecanizaveis e chamar de review seria dar por
coberto o que ninguem olhou.

Substituto disponivel quando o BLOCKER for resolvido: os itens fechados de
`BACKLOG.md` (47 com `[x]`) declaram `dod:` verificavel e servem de ground truth no
lugar do plano, para o trabalho desta sessao.

## Gates de qualidade

| Gate | Resultado |
|---|---|
| `npm run build` (inclui `tsc -b`) | PASS |
| `npm run lint` | PASS (0 avisos) |
| `npm test` | PASS — 298 arquivos, 2603 testes, 9 skipped |
| `go build ./...` | PASS |
| `/code-quality` | `PASS` — score 100, 0 findings, `go` + `typescript` |
| Co-Authored-By nos 98 commits | 0 |
| Segredos no diff | nenhum |
| CHANGELOG atualizado | sim |

## Handoff

`NEEDS_FIXES`. A promocao `workspace → develop` fica bloqueada ate F1 ser
decidido. Nenhum PR foi aberto.
