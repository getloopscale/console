---
status: proposed
date: 2026-08-06
decision-makers: time do dashboard theo-cloud
consulted: auditoria loop-system-design (fase 2, fase 5)
origem: tradeoff_decisions#1 · boundary_findings#5, #7, #10, #13 · system_design_findings#1
---

# ADR-0001 — Eixo de organizacao do codigo e regra de residencia

## Contexto e enunciado do problema

A decisao arquitetural mais consequente do repositorio — o eixo pelo qual 63.756 LOC
de producao sao particionados — nunca foi registrada. `src/` e organizado
**package-by-layer** no primeiro nivel (`pages/` 246 arquivos, `components/` 243,
`hooks/` 79, `lib/` 89), com a feature aparecendo como subpasta dentro de cada camada.

Varredura de documentacao (medido): `DESIGN.md` (803 linhas) e contrato de UX/UI e nao
contem clausula sobre layout de codigo; `.llms.txt` documenta o pacote `@usetheo/ui`, nao
o dashboard; `TESTING.md` cobre apenas colocacao de teste; `docs/governance/dashboard.md`
so fixa a localizacao da secao Memory por jornada. `DESIGN.md:8` declara que o artefato
`architecture` foi *removido do versionamento* e `DESIGN.md:797` aponta para
`.claude/knowledge-base/architecture/dashboard/`, que nao existe.

Consequencias medidas da ausencia de regra:

- Dispersao: `deploy` em 4 camadas / 25 arquivos; `lens` em 3 camadas / 57; `promptly` 3/23; `rag` 2/22.
- 33 dos 44 hooks tem **uma unica** feature consumidora; 20 tem exatamente um arquivo importador.
- Apenas 7 dos 39 modulos de `src/lib/` sao consumidos por 2+ features.
- Deriva sem regra: `src/components/scale/` e `src/components/scaling/` coexistem; `AddSecretSheet` existe duas vezes.
- Zero `index.ts` nas 30 subpastas de `src/components/` — nao existe distincao entre API publica e detalhe interno de nenhuma feature.

Calibragem que muda a prescricao (`boundary_findings#17`, info): o acoplamento medido e
**baixo** — 1.084 arestas internas, 90 cross-feature, 70 delas para `use-auth`
(cross-cutting legitimo); nenhuma feature excede 25% de razao cross-boundary contra o
limiar heuristico de 30%; zero arestas ascendentes de `components`/`hooks`/`lib` para
`pages`. O custo hoje e **cognitivo**, nao tecnico — e por isso a migracao e barata.

## Motivadores da decisao

- Pedido explicito do time: "organizar melhor o sistema e estruturas claras de pastas e componentizacao".
- Um novo contribuidor decide onde colocar um arquivo copiando o commit anterior.
- Uma fronteira sem regra escrita nao pode ser verificada; uma sem verificacao so se degrada.

## Opcoes consideradas

1. **Manter package-by-layer** e apenas documentar a regra atual.
2. **Migrar para package-by-feature** (`src/features/<dominio>/`) com regra de residencia explicita.
3. Reescrita para micro-frontends / divisao em pacotes.

## Decisao

Adotar a **opcao 2**: eixo primario = feature. `src/features/<dominio>/` passa a conter
`routes.tsx`, `pages/`, `components/`, `hooks/`, `api/` e `index.ts` (a unica API publica
da feature). `src/components/`, `src/hooks/` e `src/lib/` ficam reservados ao que for
genuinamente cross-feature.

**Regra de residencia (a parte que torna a migracao sustentavel):**

> Um hook, componente ou modulo com **um unico consumidor** mora com a feature que o
> consome. `src/components/`, `src/hooks/` e `src/lib/` so aceitam artefato com
> **>= 2 features consumidoras**. Import entre features so pelo `index.ts` da feature
> alvo — caminho profundo entre features e proibido.

A opcao 3 e explicitamente rejeitada: o acoplamento medido nao justifica divisao em
pacotes, e a auditoria registra isso como calibragem.

## Consequencias

- Bom: uma feature passa a caber num diretorio; uma delecao de feature vira `rm -rf` de um diretorio; o teste viaja com o modulo sem mudanca de convencao (`tradeoff_decisions#17`).
- Bom: a regra de residencia e mecanizavel (`import/no-restricted-paths`), entao a fronteira deixa de ser preferencia (ADR-0003 do backlog / `tradeoff_decisions#3`).
- Ruim: a migracao toca `src/app.tsx` a cada dominio movido enquanto o roteamento estiver centralizado — mitigado migrando um dominio por PR e fatiando `routes.tsx` por feature na mesma passada.
- Ruim: durante a transicao convivem duas arvores. Mitigacao: ordem declarada — `lens` e `deploy` primeiro (maior espalhamento medido), e nenhum dominio novo nasce na arvore antiga.

## Verificacao

`import/no-restricted-paths` na config de ESLint negando (a) import de
`src/features/A/**` a partir de `src/features/B/**` exceto via `src/features/A`, e
(b) qualquer import de `src/lib/**` ou `src/components/**` para `src/features/**`.
