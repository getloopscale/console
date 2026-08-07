---
slug: theo-cloud-trust-dashboard
generated_by: roadmap-feature
date: 2026-07-31
status: completed
target_milestone: M23, M24
roadmap: theo-cloud/ROADMAP.md
---

# Focused grill — `theo-cloud-trust-dashboard`

## Provenance of answers

Este grill **não** foi conduzido como quatro turnos interativos. As respostas vêm de duas fontes,
rotuladas individualmente abaixo: (a) **medição direta** contra a instância implantada e contra os
dois repositórios, feita em 2026-07-31; (b) **três decisões de escopo** que o operador declarou
explicitamente. Derivar vence re-perguntar quando a evidência medida já responde; inventar uma
resposta que a medição não sustenta seria o oposto do que este grill existe para impedir.

## Desvio registrado — duas milestones nesta invocação

O `SKILL.md` de `/roadmap-feature` acrescenta **um** milestone por invocação. Esta invocação
acrescenta **dois** (M23 e M24). Justificativa: o operador respondeu *"pode recortar da forma que
desejar, mas deve estar com o sistema 100% integrado e funcional e2e"*. Essa restrição elimina o
recorte por camada (um milestone só de BFF não entrega nada verificável ponta a ponta) e exige que
cada milestone seja e2e-completo sozinho. O recorte por caminho de uso — leitura primeiro, mutação
depois — é o único que satisfaz a restrição com DoDs de perfil de risco distinto. Precedente na
mesma casa: M10 (explorador GraphRAG básico) e M13 (explorador rico) recortaram uma capacidade em
dois milestones pelo mesmo motivo.

Segundo desvio: o pré-voo do skill parseia `^## M<N> — [x]`. Este roadmap aninha milestones como
`### M<N>` sob `## Milestones` — 23 encontrados com `###`, zero com `##`. O roadmap não está
malformado; a convenção é outra. Parse adaptado, nenhum milestone existente tocado.

---

## Q1 — O que é esta feature e por que AGORA (o que mudou)?

**Fonte: medição direta (2026-07-31).**

O `theo-trust` está implantado, servindo e verificado ponta a ponta pela borda pública com a chave
real do operador — `GET /v1/trust/version` → `200 develop-6f17600`, `GET /v1/trust/policy-violations`
→ `200` com dados reais, `POST /v1/trust/guard` → `422 POLICY_BLOCKED credential_leak`. **E não há
uma única tela.** A capacidade produz sinal que ninguém consegue ver sem `curl`.

O que mudou e torna o custo pequeno agora: o **broker Model B por tenant já existe e está testado**
em `internal/trust/broker.go` (cunhagem por tenant, cache, TTL, interseção de escopo de menor
privilégio, fail-closed sem fallback master) mais `internal/trust/admin_client.go`. Medido:
`grep -rn "internal/trust" internal/routes/` retorna **zero** — nenhuma rota BFF consome o broker
ainda. A parte difícil (isolamento por tenant, CWE-441) está pronta; falta o data client de leitura,
as rotas e as telas.

O padrão de travessia já é rotina nesta casa: `internal/thelens/data_client.go` prova as três
camadas para o lens, e o M8 entregou exatamente esta forma para o RAG (página + proxy BFF + broker).

## Q2 — Quais milestones precisam estar `[x]` antes?

**Fonte: decisão explícita do operador (2026-07-31).**

**M21 e M22.** O operador escolheu incluir M22 quando ofereci M21 sozinho como suficiente.

Consequência registrada com honestidade: **M22 está aberto**, então `cycle-roadmap` não selecionará
M23 até M22 fechar. A dependência não é técnica — nada em M22 bloqueia o data client ou as telas — é
uma decisão de sequência: o painel de status deve ser confiável antes de somar mais uma capacidade a
ele.

## Q3 — Definition of done verificável

**Fonte: derivada da superfície medida da API + do `DESIGN.md` travado.**

Superfície real do `theo-trust`, extraída de `packages/api/src/server/app.ts`:

| plano | endpoints |
|---|---|
| Observação (leitura) | `GET /v1/trends` · `/v1/policy-violations` · `/v1/themes` · `/v1/conversations/:id` |
| Guardrails | `GET/POST /v1/validators` · `GET/DELETE /v1/validators/:id` · `POST /v1/validators:test` · `POST /v1/guard` |
| Auditoria | `GET /v1/enforcement-events` |

O DoD de cada milestone está no bloco do próprio milestone em `ROADMAP.md`. O critério que atravessa
os dois, por exigência do operador: **cada milestone entrega o sistema funcional e2e** — chave real
do dashboard → tela → BFF → broker → API do theo-trust implantada → dado real na tela. Um milestone
que compile e teste, mas cuja tela não mostre dado real vindo do serviço implantado, não fecha.

## Q4 — Os dois principais riscos NOVOS

**Fonte: derivada da arquitetura medida.**

**Risco 1 — o BFF vira um segundo caminho de autorização para o mesmo serviço.** Hoje o `theo-trust`
é **Level 1** na borda: o comentário em `dev/traefik/dynamic.yml:82` diz *"theo-trust authenticates
its OWN trust_live_* bearer keys ... so NO forward-auth at the edge (Level 1)"*. Somar o BFF cria um
segundo caminho, com regra de escopo própria. Dois caminhos que divergem em autorização é a classe de
defeito que produziu o CWE-441 que o Model B fechou. **Mitigação:** o BFF exige o mesmo escopo que o
serviço exige (`trust:read` para leitura, `trust:delete` para remoção), e o broker cunha pela
interseção de menor privilégio — nunca uma chave mais forte que a do chamador.

**Risco 2 (M24) — o dashboard passa a criar guardrails que bloqueiam tráfego inline do tenant.** Um
validator mal configurado pela tela não é um erro de UI: é enforcement inline derrubando conversas em
produção. **Mitigação:** `POST /v1/validators:test` (dry-run) obrigatório antes de salvar, e o
contrato `422 INVALID_SPEC` — que passou a existir em `usetheoai/theo-trust#35` justamente porque uma
guardrail de moderação sem classificador era aceita e virava no-op silencioso — renderizado com a
mensagem do serviço, nunca como "erro genérico".

---

## Cross-check de fora-de-escopo (Passo 3)

Sobreposição de palavras-chave detectada com:

> *"**Changing data-plane workspace semantics** — o invariante `workspace_id == tenant_id` e o mint
> Model B por tenant (fechamento de CWE-441) são preservados; nenhuma mudança no theo-memory está em
> escopo."*

**Decisão do operador: falso positivo, continuar.** A feature **consome** o broker Model B existente
e preserva `workspace_id == tenant_id`; o item proíbe *mudar* a semântica de tenancy, não reusá-la.
Nenhuma linha do item foi removida do `### Explicitly out of scope`.

`out_of_scope_overlap_false_positive: "Changing data-plane workspace semantics"`
