# Arquitetura do dashboard

Este documento existe porque o código o citava e ele não existia.

Três módulos — `src/pages/lens/trace-detail.tsx:5`, `src/pages/lens/trace-detail/helpers.ts:5`
e `src/pages/use-workspace-selection.ts:12` — justificavam decisões de refactor apontando
para um orçamento de 500 LoC definido em `architecture.md`. `DESIGN.md:8` registra que o
artefato foi *removido do versionamento*. O resultado medido pela auditoria de 2026-08-06:
**236 referências a `ADR D<n>` em `src/`** e um diretório de ADRs vazio. Uma regra citada e
não localizável tem o pior dos custos — cara de cumprir, impossível de auditar, e
indistinguível de folclore.

## Estado atual, medido (2026-08-06)

Nada aqui é estimativa. Os números vêm da auditoria `/loop-system-design`, cujo relatório
está em `system-design-output/final_report.md`.

| Métrica | Valor |
|---|---|
| LOC de produção (ts/tsx) | 63.756 |
| LOC de teste | 43.297 |
| Arquivos de produção | 375 (mediana 113 LOC, p90 401, máx 955) |
| Arestas de import internas | 1.084 |
| Arestas cross-feature | **90** — 70 delas para `use-auth` |
| Arestas ascendentes (`components`/`hooks`/`lib` → `pages`) | **0** |
| Ciclos de import | **1** (eram 8 antes de B-001/B-037/B-038/B-039) |

**A leitura que importa:** o acoplamento é baixo e a direção das camadas está correta. O
problema desta base de código é **físico** — onde os arquivos moram — e não lógico. Isso
muda a prescrição: a reorganização é investimento em navegabilidade, não correção de
acoplamento, e é barata justamente por isso.

## O eixo de organização

O eixo primário é **feature**, não camada. A decisão, com as alternativas consideradas e a
evidência que a sustenta, está em [`adr/0001-eixo-de-organizacao-e-regra-de-residencia.md`](adr/0001-eixo-de-organizacao-e-regra-de-residencia.md).

Estado da migração: **declarada, não executada.** `src/` ainda é package-by-layer no topo.
Escrever a regra antes de mover arquivos é deliberado — mover primeiro é exatamente como a
árvore atual foi produzida.

## A regra de residência

> Um hook, componente ou módulo com **um único consumidor** mora com a feature que o
> consome. `src/components/`, `src/hooks/` e `src/lib/` só aceitam artefato com **≥ 2
> features consumidoras**. Import entre features acontece exclusivamente pelo `index.ts` da
> feature alvo; caminho profundo entre features é proibido.

A regra é contável, e é isso que a torna verificável em vez de opinativa. Ela responde às
três perguntas que hoje não têm resposta escrita:

- **Quando um domínio vira pasta?** Sempre.
- **O que é API pública de uma feature?** O `index.ts`. Hoje existem **zero** deles nas 30
  subpastas de `src/components/`.
- **O que pode morar em `lib/`?** Só o que 2+ features consomem. Hoje são 7 de 39 módulos.

## Fronteiras que hoje NÃO são verificadas

Ser honesto sobre isso importa mais do que declarar a regra: **uma fronteira sem
verificação é uma preferência, não uma fronteira.**

| Ferramenta | Estado real |
|---|---|
| `madge` | Existe apenas como binário **global** na máquina do dev. Não é devDependency, não roda em CI. |
| `dependency-cruiser` | Idem. A auditoria tentou usá-lo e obteve `modules: 0`. |
| `import/no-restricted-paths` | **Não configurado.** |
| `no-restricted-imports` (`eslint.config.js:89`) | Única regra de fronteira executável — e bane exatamente **um** símbolo de terceiro por causa de um bug upstream. |

Enquanto isso não mudar, este documento é intenção, não contrato. O passo que o converte em
contrato está em ADR-0001 § Consequências: adicionar `dependency-cruiser` às
devDependencies, criar `.dependency-cruiser.cjs` com as regras e plugá-lo no CI.

## Camadas e direção de dependência

```
pages/            ← rotas; podem importar tudo abaixo
  components/     ← UI cross-feature (layout, error, loading, ui)
  hooks/          ← kernel real: use-auth, use-page-meta, use-api, use-sse-stream
  lib/            ← utilidades e ACL do backend (api/types.ts não importa nada)
```

Regra de direção, hoje respeitada em 100% das 1.084 arestas: **nada abaixo importa de
`pages/`**. Quando uma página exporta domínio que seus filhos consomem, o ciclo é
inevitável — foi essa a causa dos quatro ciclos fechados em 2026-08-06. O padrão de
correção é sempre o mesmo: o domínio desce para um módulo folha e a página passa a
**importar** o que antes exportava, re-exportando para preservar a superfície pública.

## Orçamento de LoC por arquivo

Ver [`adr/0002-orcamento-de-loc-por-arquivo.md`](adr/0002-orcamento-de-loc-por-arquivo.md).
A incoerência que ele resolve: `app.tsx` tem 729 linhas — 49 a mais que o `trace-detail.tsx`
que foi refatorado inteiro por "estourar o orçamento de 500". Ou a regra vale para a raiz
também, ou não vale para ninguém.

Sobre **componentização**, a medição corrige a intuição usual: o problema não é empacotar
muitos componentes num arquivo — só 4 arquivos têm 5 ou mais. É **um componente fazendo
tudo**: 18 dos 30 maiores `.tsx` declaram exatamente um. O caso extremo é
`pages/promptly/detail.tsx`, 916 LOC num único componente com 15 `useState` e 9 `useQuery`.
O padrão de correção já foi validado pelo próprio time em `pages/lens/trace-detail/`:
`helpers.ts` puro + subcomponentes + `index.tsx` como composition root.

## Onde as decisões vivem

`docs/adr/`. Oito ADRs em `status: proposed`, aguardando aceite do time — promovidos ao
repositório em 2026-08-06 (B-078) precisamente para que uma referência `per ADR X` num
docblock volte a ser verificável.

Um ADR proposto vale mais que uma decisão não escrita, e menos que uma aceita. O aceite é
do time, não de quem escreveu o rascunho.

## Procedência

Auditoria `/loop-system-design`, 2026-08-06 — 6 fases, 91 achados com evidência `file:line`,
gate de qualidade adversarial (score 0.90) que verificou 106 ponteiros contra o disco.
Relatório completo em `system-design-output/final_report.md`; itens rastreados em
`BACKLOG.md` (`B-001`..`B-087`).
