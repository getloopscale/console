---
status: proposed
date: 2026-08-06
decision-makers: time do dashboard theo-cloud
origem: tradeoff_decisions#18 · state_findings#9, #11 · scaling_findings#7 · system_design_findings#13
---

# ADR-0007 — Modelo de consistencia do estado de servidor cacheado

## Contexto e enunciado do problema

`DESIGN.md` declara requisitos que **dependem** de garantia de frescor sem nunca nomear a
garantia:

- `DESIGN.md:76` — *"If the user can break production, the UI slows the action down"*.
- `DESIGN.md:534-540` — tabela "Strategy by operation type": *"Read: optimistic"*, *"Background sync (revalidate on focus): Silent; only show indicator if data changed"*.
- `DESIGN.md:775` — *"Confiavel — Status truthful"*.

Nao existe politica escrita de `staleTime`, `refetchInterval` ou invalidacao por classe de
dado. O que existe (medido) e:

- Defaults globais centralizados e testados: `staleTime` 60s e `gcTime` 5min em `src/lib/query-client.ts:38-42`, com `retryGuard` que nao retenta 4xx e mutations com `retry: 0`. Isto e um ponto forte real.
- Polling resolvido **feature a feature**: 4 hooks com `refetchInterval` derivado do dado e parada em estado terminal (bom), e 2 paginas com `window.setInterval` manual sobre `useState` (`project-connect.tsx:170`, `billing.tsx:91`) fora do cache, da dedup e do pause-on-background.
- 130 query keys ad-hoc que podem escapar do `invalidate` (ADR-0006).
- Uma segunda camada de cache no service worker com `maxAge` de 3600s contra o `staleTime` de 60s (ADR-0004).

O risco concreto: um operador que faz rollback olhando um status cacheado stale age sobre
producao com informacao velha. E exatamente o que o contrato de UX promete evitar.

## Opcoes consideradas

1. Deixar cada feature decidir (estado atual).
2. Classificar os dados e fixar politica por classe no `QueryClient`, com override explicito por excecao.
3. Politica unica global mais agressiva (ex.: `staleTime: 0` em tudo).

## Decisao

Adotar a **opcao 2**. Classificar o estado de servidor em duas classes e fixar a politica
no `QueryClient`, permitindo override apenas com justificativa no call site:

| Classe | Exemplos | Politica |
|---|---|---|
| **Operacional volatil** — muda sozinho e o usuario age sobre ele | builds, deploys, status de dominio, signals, provisioning | `staleTime` curto + `refetchOnWindowFocus` + `refetchInterval` derivado do dado com parada em estado terminal |
| **Configuracao estavel** — so muda por acao do usuario | settings, team, billing, api-keys, domains (lista) | `staleTime` longo + invalidacao explicita pela mutation |

Os dois pollings manuais (`project-connect`, `billing`) migram para `useQuery` com
`refetchInterval` derivado, seguindo o padrao ja validado em
`src/hooks/use-provisioning-status.ts:52`. Ambos ja tem parada correta — o problema e onde
moram, nao a limitacao.

A opcao 3 e rejeitada: `staleTime: 0` global multiplica requests sem melhorar a garantia
que importa, que e a de **invalidacao apos mutation** (ADR-0006).

## Consequencias

- Bom: meia pagina de politica substitui tres resolucoes independentes de polling ja gastas.
- Bom: a promessa de "status truthful" passa a ter um mecanismo nomeado por tras.
- Ruim: classificar cada endpoint e trabalho manual pontual. Mitigacao: a classificacao acompanha a criacao de `features/<f>/api/paths.ts` do ADR-0006, onde o path ja e declarado uma vez.
- Ruim: dado volatil com `refetchOnWindowFocus` aumenta o trafego. Aceito: e o preco de um painel de operacao que promete verdade sobre producao.
