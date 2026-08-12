# Oportunidade: o dashboard endereça o mesmo recurso por dois caminhos

**Item:** `B-113` · **Modo:** `review` · **Data:** 2026-08-10 · **Baseline:** `6d1b77f5`

## Corner 1 — Evidence

### Primeiro: a evidência que EU registrei no intake estava inflada

O item afirma "49 chamadas usam `fetch(` cru contra 21 `cloudFetch` e 20 `engineFetch`". Aquele
grep **não excluía testes e mocks**. Medido agora só sobre produção:

| | intake (errado) | produção (medido) |
|---|---|---|
| `fetch(` cru | 49 | **19** |
| `builds` por dois caminhos | 5 / 33 | 3 / 9 |
| `domains` por dois caminhos | 3 / 18 | 1 / 9 |
| `environments` por dois caminhos | 2 / 22 | 0 / 7 |

E dos 19 `fetch(` crus, **18 têm razão de existir**: 11 falam com o Kratos (servidor de
identidade separado, que por desenho não passa pelo cliente do produto), 4 são o próprio
`lib/http/api.ts`, 2 são telemetria fire-and-forget e 1 é o transporte SSE que o `B-088`
construiu. Corrigir isto importa: metade da justificativa que eu escrevi não existia.

**O que sobrou é menor e pior do que o que eu registrei.**

### O defeito vivo: uma lista, dois endereços, duas chaves de cache

```
hooks/projects/use-projects.ts:71-73
  queryKey: [...queryKeys.projects.list(), { limit }]     →  ['projects','list',{limit}]
  cloudFetch('/engine/api/v1/projects?limit=…')

pages/infra/components/add-domain-sheet.tsx:40
pages/infra/components/create-environment-sheet.tsx:53
  useEngineApi('/api/v1/projects')                        →  ['engine','/api/v1/projects']
```

A mesma lista de projetos, servida pelo mesmo backend, sob **duas chaves que não se falam**. E
existe quem invalide apenas uma:

```
hooks/projects/use-bulk-delete-projects.ts:52
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
                                                                  // ['projects']
```

`['projects']` não alcança `['engine','/api/v1/projects']`. Com `staleTime: 60_000`
(`lib/http/query-client.ts:41`), **apagar um projeto e abrir "Add domain" dentro de um minuto
oferece o projeto apagado no seletor** — e o usuário pode apontar um domínio para ele.

### O segundo: uma mutação, duas implementações, dois endereços

```
hooks/mutations/use-promote.ts:40        POST /engine/api/v1/projects/{name}/promote
hooks/mutations/use-environments.ts:113  POST /api/v1/projects/{name}/promote
```

Ambas vivas, em telas diferentes: `promote-to-production-dialog.tsx` (deploy) usa a primeira,
`promote-dialog.tsx` (infra) usa a segunda. Promover é a mesma operação de negócio; o
conhecimento está duplicado, e as duas invalidam conjuntos diferentes de chave.

### O terceiro, latente: uma chamada que ignora a base configurada

`pages/auth/device-verify.tsx:42` chama `fetch('/v1/auth/device/accept')` com path relativo.
`cloudFetch` usa `${API_BASE}${path}`, e `API_BASE` vem de `window.__THEO_CONFIG__.API_URL`,
injetado pelo `docker-entrypoint.sh`.

Honesto sobre o que isto é: **não é um bug hoje.** Não encontrei nenhum ambiente que defina
`VITE_API_URL`, então a base é `""` em todos eles e o path relativo acerta. É uma chamada que
funciona porque a configuração que existe justamente para variar nunca variou.

### O que NÃO é evidência, e eu conferi antes de afirmar

O item sugeria risco de cache do service worker entre tenants. Conferido: `ADR-0004`/`B-055`
removeram o cache de API do build, e `lib/auth/logout-cache-purge.ts` cobre os service workers
antigos ainda instalados. **Esse risco está fechado** e não sustenta este item.

## Corner 2 — Constraint relation

**`unknown`.** `rules/current-constraint.md` está `status: undeclared`, e o ecossistema não
instrumenta fluxo.

## Corner 3 — Blast radius

Contido no dashboard. Nenhuma mudança de contrato de API: os dois endereços de cada recurso já
são servidos hoje, e a correção é escolher um no cliente.

- `hooks/projects/use-projects.ts` — passa a ter mais dois consumidores
- `pages/infra/components/{add-domain-sheet,create-environment-sheet}.tsx`
- `hooks/mutations/{use-promote,use-environments}.ts`

O risco real não é técnico: é que a correção feche estes três casos e o quarto entre amanhã. Um
guard que quantifique sobre a classe é o que muda isso.

## Corner 4 — Verification

Ligada à DoD do `B-113`:

1. **Um teste que falha no estado atual** — apagar um projeto e ler a lista pela folha de
   domínio devolve o projeto apagado. É a prova do defeito antes do conserto.
2. **Um guard que reprove o mesmo recurso endereçado por dois prefixos** — a classe, não os
   casos. Sem ele, os três casos consertados não impedem o quarto.
3. **Uma fonte por recurso** — as folhas leem pelo hook que já existe, e não por um segundo
   endereço.

**Onde o limite se move depois:** com um endereço por recurso no cliente, a pergunta seguinte
passa a ser a do `B-114` — por que o backend expõe dois.

## Verdict

`SHIPPABLE_WITH_CAVEATS` — a hipótese se confirma, mas **por evidência diferente da que eu
registrei no intake**, e num escopo menor. O caveat carregado para o plano: a DoD-2 do item
("toda chamada de rede de produção passa pelo cliente que carrega auth") está **factualmente
satisfeita hoje** — os 19 `fetch(` crus são Kratos, telemetria, SSE e o próprio cliente. Ela deve
ser reescrita como um guard que impeça a regressão, não como um trabalho de migração que não tem
o que migrar.
