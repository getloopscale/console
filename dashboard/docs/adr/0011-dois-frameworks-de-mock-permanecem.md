---
status: accepted
date: 2026-08-08
decision-makers: dono do projeto (decisão explícita, 2026-08-08)
origem: B-067 (backlog) — medido em 2026-08-08
---

# ADR-0011 — Os dois frameworks de mock permanecem

## Contexto

`src/lib/mocks/` contém dois conjuntos independentes de respostas falsas, ambos
condicionados ao mesmo `VITE_USE_MOCKS`:

| | LoC | Cobre | Entra por |
|---|---|---|---|
| `dev-mocks.ts` | 463 | Fluxos do Kratos (sessão, registro, verificação, recuperação) | Import **estático** em `lib/auth/session.ts:22` (`getMockSession`) |
| `mocks/` (12 arquivos) | 2.952 | `/api/v1/*`, `/v1/dashboard/*`, SSE | Import **dinâmico** em `main.tsx`, atrás do flag |

O item `B-067` registrou a coexistência como duplicação a consolidar.

## Decisão

**Os dois permanecem.** Decisão explícita do dono do projeto em 2026-08-08.

## Rationale

A medição feita antes da decisão mostrou que a pergunta era menos urgente do que
o item sugeria, e que o risco real estava noutro lugar.

**O risco de produção está fechado e vigiado.** `scripts/check-mocks-tree-shaken.mjs`
prova que nenhum dos dois embarca no bundle, com marca própria por framework —
justamente porque os caminhos de eliminação são diferentes. O gate anterior era
tautologia (procurava o caminho do módulo, que o empacotador apaga) e dizia PASS
com os mocks dentro do bundle; isso foi corrigido em 2026-08-08, antes desta
decisão.

Com o risco fechado, o que sobra é conveniência de desenvolvimento — e aí a
coexistência tem uma justificativa que a leitura de "duplicação" não enxerga: os
dois cobrem **superfícies diferentes por natureza**. Um dubla um provedor de
identidade externo com máquina de estados própria; o outro dubla a nossa API.
Fundi-los produziria um módulo que serve a dois protocolos.

## Alternativas rejeitadas

**Consolidar num framework só.** Rejeitada pelo dono. O custo seria reescrever
3.415 linhas de conveniência de desenvolvimento — trabalho sem entrega visível,
com risco de perder casos que só aparecem quando alguém desenvolve offline, para
um ganho que a medição mostrou ser de organização e não de risco.

**Apagar o `dev-mocks.ts`.** Rejeitada: ele é o único caminho para desenvolver os
fluxos de autenticação sem um Kratos rodando, e `lib/auth/session.ts` depende
dele por import estático.

## Consequências

**Habilita** desenvolver offline tanto os fluxos de identidade quanto os de API,
sem esperar uma consolidação que ninguém pediu.

**Restringe** o gate: qualquer framework de mock novo — ou um `cacheName` de
dado novo no service worker — precisa de marca própria em
`check-mocks-tree-shaken.mjs`. O verificador tem uma auto-checagem para isso: se
a marca sumir do fonte, ele falha dizendo que parou de provar, em vez de
continuar verde sem cobertura.

**Aceita** 3.415 linhas de código de desenvolvimento no repositório, o que é
6,2% de `src/`. O número está registrado para que a decisão possa ser revista com
dado, e não com impressão.

## Cross-references

- `B-067` no `BACKLOG.md` — o item, com a medição de 2026-08-08
- `scripts/check-mocks-tree-shaken.mjs` — o gate que torna esta decisão segura
- `ADR-0008` — ADRs versionados no repositório
