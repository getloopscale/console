---
slug: platform-overview-covers-all-capabilities
item: B-112
date: 2026-08-10
generated_by: backlog-item
status: completed
---

# Intake — a Overview da plataforma cobre só um subsistema

## Proveniência das respostas

O grill de quatro perguntas **não foi conduzido pergunta-a-pergunta**, e o motivo fica
registrado em vez de omitido: as quatro respostas já existiam na conversa que originou o item.
O dono descreveu o problema, eu medi a tela e o registro de capacidades, propus o desenho e ele
respondeu *"Sim confirmado"*.

Re-perguntar o que já foi respondido é re-litigar uma decisão tomada — e o grill existe para
extrair o que falta, não para encenar um protocolo. As respostas abaixo são transcritas da
conversa, com a medição que as sustenta.

## Q1 — O que é, e o que mudou no NOSSO sistema para levantar isto agora

**Resposta (dono).** A Overview principal deve considerar todas as features da plataforma —
Sistema de Aplicações, Memory, Observabilidade, Trust — e não só o sistema de aplicações.

**Medição (2026-08-10, modo mock).** `src/pages/overview/overview.tsx` consome exatamente
`useProjects`, `useBuildStats` e `useCloudApi` (billing). O texto renderizado da página é:

```
PROJECTS 4 · DEPLOYS (7D) 19 · ACTIVE ENVS 0 · PLAN USD 20/mo
USAGE (this billing period) · DEPLOY ACTIVITY (last 7 days)
PROJECTS (acme-web, acme-payments, acme-marketing) · QUICK ACTIONS
```

O menu lateral declara, sob `CAPABILITIES`: **Memory, Knowledge Base, Databases (Soon),
Workspace, Observability, Trust, Skills, Prompts**. Nenhuma delas aparece na Overview.

**O que mudou:** a plataforma cresceu sete capacidades, e cada uma ganhou a **sua própria**
página de overview — `lens/overview.tsx`, `memory/overview.tsx`, `promptly/overview.tsx`,
`rag/overview.tsx`. A overview da PLATAFORMA nunca foi atualizada junto. Hoje existem sete
overviews de capacidade e nenhuma de plataforma.

**G5 — sem prior art.** A justificativa é inteiramente local: uma tela deste produto que não
representa este produto. Nenhuma referência a como outro projeto resolve.

## Q2 — Repo e domínio

`theo-cloud/dashboard` → domínio **`frontend-dashboard`**. Um domínio só; G3 não dispara.

## Q3 — Modo sugerido

**`evolve`** — o custo do status quo é mensurável (quantas capacidades a tela omite, e o que um
usuário novo conclui a partir dela), e o trabalho é evolução de uma tela existente, não a
reprodução de um defeito. *Sugestão; `/discover` pode reclassificar.*

## Q4 — Definição de pronto

Discutida na conversa e transcrita no bloco do item. Os três critérios foram escolhidos para
falharem de verdade:

1. **Quantificar sobre o registro, não sobre uma lista fixa.** Um teste que enumerasse as
   capacidades à mão passaria verde no dia em que a nona fosse criada e esquecida — que é
   exatamente o defeito de hoje, repetido um nível acima. O precedente está no próprio código:
   `LENS_CAPABILITIES` foi criado para que *"a barra lateral e a grade da Overview nunca
   divirjam"*.
2. **Três estados, nunca colapsados.** "não adotada" ≠ "zero" ≠ "não consegui ler". Esta é a
   disciplina que o repositório já aplica em toda tela de leitura, e ela é mais importante aqui
   do que em qualquer outra: uma capacidade que aparece vazia por falha de leitura convida o
   usuário a concluir que ela não serve para nada.
3. **Custo por carregamento declarado.** A tela mais visitada do produto não pode passar a
   disparar uma requisição por capacidade sem que isso seja uma decisão registrada.

## Decisão de arquitetura levantada no intake (não resolvida aqui)

Medido: **não existe endpoint de resumo por capacidade** — o único agregado no dashboard é
`/api/v1/builds/stats`. Então o número de cada capacidade viria de uma de duas formas:

| Caminho | Custo |
|---|---|
| Chamar a lista de cada capacidade | ~9 requisições no primeiro carregamento da tela mais visitada, algumas paginadas. Entrega hoje e paga todo dia |
| Pedir um agregado ao backend | Uma requisição, mas depende de trabalho fora do dashboard |

**Recomendação registrada:** o agregado. Enquanto ele não existe, os cards mostram a capacidade
e o caminho de entrada **sem número** — o que já resolve o problema central (a plataforma não se
anunciar) sem comprar um custo permanente. A decisão final é de `/to-plan`, com ADR.
