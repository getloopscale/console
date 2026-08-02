---
slug: theo-cloud-promptly-dashboard
generated_by: roadmap-feature
date: 2026-08-02
status: completed
target_roadmap: theo-cloud/ROADMAP.md
new_milestone_id: M25
---

# Grill — UI mínima do theo-promptly no dashboard

## Pré-flight (Step 0)

`ROADMAP.md` presente · `knowledge-base/grills` gravável · git + gh autenticados ·
`CHANGELOG.md` presente · 25 milestones parseáveis, último `M24 [x]` → **M25 livre**.

**Árvore suja:** `internal/skills/upstream_error.go` (+ teste) não rastreados — trabalho da
sessão `theo-skills`. Por Step 6.6, **o auto-commit é pulado** e nada dela é estagiado.

## Step 3 — Cross-check de escopo, nos DOIS roadmaps

**`theo-cloud/ROADMAP.md`** (onde o milestone entra) — três exclusões:
`account_members`/RBAC multi-usuário; bump maior de JWT; mudar a semântica de workspace do
data-plane. **Zero sobreposição:** este milestone consome o mint Model B existente e não toca
o invariante `workspace_id == tenant_id`.

**`theo-promptly/ROADMAP.md`** (onde vive a exclusão que o coordenador apontou):

> **UI rica/colaborativa no V1** (editor em tempo real, diff visual) — *why excluded:* V1 é
> API-first + **UI mínima opcional**; os mockups em `../MODELOS/` são visão futura, não V1.

**Veredito: cabe na distinção, a exclusão NÃO é revisada.** Ela barra UI **rica**; a própria
razão dela **prevê** UI mínima opcional. Este milestone entrega o mínimo e declara editor em
tempo real e diff visual fora — ver `## Não entra neste milestone`.

`out_of_scope_overlap_false_positive: "UI rica/colaborativa no V1 (editor em tempo real, diff
visual)"` — a sobreposição é de palavra ("UI"), não de escopo.

**Anti-drift (instrução 3 do coordenador).** A nota de reconciliação do `theo-promptly`
registra que `b95552e` acrescentou M9–M11 *"com 57 inserções e zero remoções, sem tocar na
exclusão que ele contradizia"*, e que por cinco semanas o documento afirmou coisas
incompatíveis. Aqui **não há contradição a reconciliar** — mas os dois documentos passam a
falar do mesmo assunto em repositórios diferentes, e é assim que a divergência começa. Um
ponteiro de uma linha vai para o `theo-promptly/ROADMAP.md`, sob a exclusão, dizendo onde a UI
mínima é entregue. **Não é revisão da exclusão** (ela continua valendo); é o cross-reference
que faltou em `b95552e`.

## Q1 — O que é, e por que AGORA?

UI mínima do `theo-promptly` no dashboard do `theo-cloud`: catálogo de prompts → detalhe com
revisões e labels → promover um label de ambiente.

**Por que agora:** o `OBJETIVO-2.md` (firmado pelo dono em 2026-08-02) sucede a corrida de
live-test e nomeia o eixo B. Medido: `dashboard/src/pages/` tem diretório para `lens`,
`memory`, `rag` e `trust` — **não tem** para `promptly`. O serviço está `ok develop-43215ef`; o
que falta dele é UI e o MCP na borda.

**O que mudou:** até aqui a única forma de operar prompts era `curl`/SDK/MCP. O produto promete
*"promover revisões entre ambientes sem redeploy"* — e o ato de promover não tinha superfície
para quem opera.

## Q2 — Quais milestones precisam estar `[x]` antes?

**`M24 [x]`** — *Operar guardrails pelo dashboard*. É a referência: estabeleceu data client +
write client + `upstream_error` + rotas BFF + padrão de tela (DataTable, EmptyState que
distingue falha de vazio, ConfirmDialog em zona destrutiva). Sem ele, este milestone
reimplementaria a mesma camada. Está `[x]`.

**Dependência CROSS-REPO, e ela é a razão de o milestone não poder começar hoje:** dois
endpoints que as telas exigem **não existem** no `theo-promptly`. Medidos, não supostos — ver
Q3. Vivem em outro repositório, logo em outro plano (`umbrella-scope.md`: um `target_project`
por plano).

## Q3 — Definition of Done verificável

Derivada **tela a tela, por medição** contra `develop=43215ef`, como o dono pediu ("deve
incluir todos os endpoints necessários para criar todas as telas"):

| tela | precisa de | medido |
|---|---|---|
| catálogo | `GET /prompts` | **404 — não existe** |
| detalhe | `GET /prompts/:name/revisions` | 200, paginado |
| detalhe | `GET /prompts/:name/labels` | 200 |
| detalhe | `GET /prompts/:name?version=N` | 200 |
| promover | `PUT /prompts/:name/labels/:label` | 200 |
| promover | `GET /prompts/:name/policies/:label` | **404 — não existe** |

**Duas lacunas, não uma.** A segunda só apareceu porque a lista foi derivada por tela: a
política de promoção pode ser **escrita** (`PUT`) e **não lida**. E ela **barra de verdade** —
`assign-label.ts:43` faz `findPolicy` e, havendo política, exige `findBestRunScore`. Sem o
`GET`, o operador recebe uma recusa e não consegue ver a regra que o recusou.

Ver `## Definition of done` no milestone.

## Q4 — Os dois riscos NOVOS

1. **A tela move o ponteiro que serve produção.** Promover um label troca, sem redeploy, o
   prompt que agentes em execução resolvem — a promessa do produto é também o perigo dele. Um
   clique errado não derruba nada: ele muda o comportamento em silêncio, que é pior de
   diagnosticar. *Mitigação:* a política vigente é mostrada **antes** do ato (daí o `GET` de
   políticas entrar no escopo, e não ficar para depois), e a confirmação nomeia **qual revisão
   deixa de servir aquele label** — não "o item será alterado".

2. **O catálogo é o primeiro índice que este produto terá.** Um índice sem teto nasce com a
   dívida que o `#47` custou nas revisões. *Mitigação:* paginado e **sem `content`** desde o
   primeiro commit, com validação de fronteira igual à que as revisões já têm (`limit` 1..500,
   `400 invalid_limit` fora disso — medido funcionando lá).

## Step 5 — SOTA delta

**Não.** A referência é interna e já está clonada de fato: `theo-trust` no mesmo repositório
(M23/M24). Nenhum peer novo; `_catalog.md` intocado.

## Restrição de projeto que o briefing trazia — desfeita por medição

> *"o `/prompts/:name/revisions` NÃO pagina e traz o content integral (`#48`) — ou a tela pagina
> no cliente assumindo o custo, ou o `#48` entra no escopo"*

**A paginação existe.** `#47`/`#48` estão `OPEN`, mas o código foi corrigido em `efefdd1`, que
está em `develop`. Medido contra `43215ef`:

```
?limit=2          -> 2 itens, versões [1,2]
?limit=2&after=2  -> 2 itens, versões [3,4]        (cursor)
?limit=999        -> 400 {"error":"invalid_limit"}  (fronteira validada)
Link: </prompts/pag-probe/revisions?after=2&limit=2>; rel="next"
```

**Declaração:** a tela **pagina no servidor**, com `limit` pequeno e explícito. Nem paginação no
cliente, nem `#48` no escopo — a terceira opção é a que a medição abriu.

O que **continua** verdadeiro: cada item traz `content` integral (campos medidos: `content`,
`createdAt`, `createdBy`, `id`, `name`, `variables`, `version`) e o default é 100. Por isso o
`limit` explícito é DoD, não preferência. E é a razão de o **catálogo** nascer sem `content`.

**Ação separada:** fechar `#47`/`#48` com esta evidência — issue aberto sobre defeito corrigido
faz a próxima pessoa projetar em volta de um problema que não existe. Aconteceu duas vezes hoje.
