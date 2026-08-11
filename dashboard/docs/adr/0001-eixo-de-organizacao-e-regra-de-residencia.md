---
status: accepted
date: 2026-08-06
revised: 2026-08-07
decision-makers: dono do projeto theo-cloud
consulted: auditoria loop-system-design (fase 2, fase 5); revisão de promoção do PR #469
origem: tradeoff_decisions#1 · boundary_findings#5, #7, #10, #13 · system_design_findings#1
supersedes: a versão `proposed` de 2026-08-06, que decidia `src/features/<domínio>/` com roteamento fatiado por feature
---

# ADR-0001 — Eixo de organização do código e regra de residência

## Contexto

A decisão arquitetural mais consequente do repositório — o eixo pelo qual 63.756 LOC
de produção são particionados — nunca foi registrada. `src/` é organizado
**package-by-layer** no primeiro nível, com a feature aparecendo como subpasta dentro
de cada camada.

O incômodo relatado pelo dono do projeto é **densidade de arquivos soltos**, e a
medição confirma que é ali que a dor mora:

| Camada | Soltos na raiz | Em subpasta | Subpastas |
|---|---|---|---|
| `src/hooks/` | **40** | 7 | 1 |
| `src/pages/` | **40** | 98 | 9 |
| `src/lib/` | **29** | 21 | 4 |
| `src/components/` | 2 | 119 | 28 |

`src/components/` já é o exemplo bom. O problema é que as outras três camadas nunca
receberam a mesma disciplina.

A segunda medição é a que muda a prescrição. Contando, para cada módulo das camadas
compartilhadas, **quantos domínios distintos o consomem**:

| Camada | Total | 1 domínio consumidor | 2+ domínios | Sem consumidor atribuível |
|---|---|---|---|---|
| `components/` | 121 | 61 | **6** | 54 |
| `hooks/` | 47 | 26 | **7** | 14 |
| `lib/` | 50 | 25 | **8** | 17 |

**Apenas 21 de 218 módulos (~10%) são genuinamente compartilhados.** O resto está numa
pasta compartilhada sem ser compartilhado.

*Limite honesto desta medição:* o balde "sem consumidor atribuível" (85 módulos) é
majoritariamente consumido por páginas na **raiz** de `pages/`, que não têm subpasta e
portanto não têm domínio atribuível pelo caminho. Eles não são código morto — são a
mesma dívida vista de outro ângulo, e se resolvem quando `pages/` for agrupado.

## Motivadores

- Pedido explícito do dono: *"organizar melhor o sistema e estruturas claras de pastas
  e componentização"*, e depois: *"o que está incomodando é a quantidade de arquivos
  inline"* e *"`lib` é um nome genérico sem representatividade"*.
- `.claude/rules/architecture.md § 6` já proíbe `utils`, `helpers`, `common`, `misc`,
  `shared` como god modules. `lib` é a mesma classe e escapou da lista por tradição.
- Um contribuidor novo decide onde pôr um arquivo copiando o commit anterior.
- Uma fronteira sem regra escrita não pode ser verificada; uma sem verificação só se
  degrada.

## Opções consideradas

1. **Manter package-by-layer** e apenas documentar a regra atual.
2. **Migrar para `src/features/<domínio>/`** com roteamento fatiado por feature — a
   decisão da versão anterior deste ADR.
3. **Micro-frontends / divisão em pacotes.**
4. **Manter o esqueleto de camadas para o que é global, e esvaziar as camadas
   compartilhadas do que não é compartilhado.**

## Decisão

Adotar a **opção 4**.

### D1 — Rotas e macro-componentes permanecem globais

`src/app.tsx` continua sendo o manifesto de rotas único, e `src/components/ui/`,
`src/components/layout/` e afins continuam globais. A opção 2 fatiava o roteamento por
feature, e o próprio ADR anterior registrava o custo disso: *"a migração toca
`src/app.tsx` a cada domínio movido"*. Manter o roteamento centralizado **elimina esse
custo por completo** — `app.tsx` é tocado uma vez, mecanicamente, quando os caminhos de
import mudam.

### D2 — `lib/` morre por esvaziamento, não por renomeação

Renomear `lib/` para `shared/` ou `core/` muda o problema de lugar: o conteúdo continuaria
sendo oito contextos diferentes sob um nome só. Medido, o que mora lá hoje:

| Contexto | Arquivos |
|---|---|
| Cliente HTTP | `api.ts` (444 LOC), `config.ts`, `query-client.ts` |
| Autenticação | `auth.ts`, `kratos.ts`, `oidc-form.ts`, `auth-policy.ts` |
| Telemetria e traces | `rum.ts`, `otel-attributes.ts`, `error-reporter.ts`, `span-status.ts`, `trace-layout.ts` (370 LOC), `lens-error.ts`, `grafana-deep-link.ts` |
| Formatação | `format.ts` (308 LOC), `money.ts`, `ansi.tsx`, `domain.ts` |
| Exportação e download | `csv.ts`, `audit-csv.ts`, `download.ts`, `log-download.ts`, `clipboard.ts`, `traces-export.ts` |
| Uso e cobrança | `usage-series.ts`, `usage-summary.ts` |
| Entrada e validação | `validation.ts`, `dotenv.ts` |
| Só desenvolvimento | `dev-mocks.ts` (462 LOC) |

Duas incoerências que a própria lista denuncia: `dev-mocks.ts` está solto **ao lado de
uma pasta `mocks/` que já existe**, e `trace-layout.ts` são 370 linhas de geometria de
span consumidas apenas por lens — não é compartilhado, é do domínio.

A decisão é: **os módulos de consumidor único descem para o domínio que os consome**, e
o que sobrar — genuinamente compartilhado — recebe um nome que diz o que é (`http/`,
`auth/`, `formatting/`). O nome genérico morre porque o balde esvazia, não porque
trocou de etiqueta.

### D3 — Regra de residência

> Um hook, componente ou módulo com **um único domínio consumidor** mora no diretório
> desse domínio. `src/components/`, `src/hooks/` e as pastas de contexto que
> substituem `lib/` só aceitam artefato com **≥ 2 domínios consumidores**.

### D4 — Definição operacional de "domínio" (a parte que a versão anterior não tinha)

A versão anterior declarava a regra "contável, e é isso que a torna verificável em vez
de opinativa" — mas a unidade contada (`src/features/`) não existia. Uma revisão
independente pegou isso. Definição que fecha a lacuna:

> **Domínio é um grupo de rota de primeiro nível declarado em `src/app.tsx`.**

É contável hoje, sem criar diretório nenhum: extraindo os `path=` de `app.tsx` saem 25
grupos que colapsam no conjunto abaixo. Nove já existem como subpasta em `pages/`.

| Domínio | Existe em `pages/`? |
|---|---|
| `auth` (login, register, recovery, verification, device-verify, device-success, check-email) | não |
| `projects` (projects, project-detail, project-connect, project-readiness, project-scale, project-status) | não |
| `deploy` (deployments, deployment-detail-layout, runtime-logs) | parcial (`deployment-tabs/`) |
| `infra` (domains, environments, secrets) | não |
| `settings` (settings, api-keys, billing, team, audit, profile) | sim |
| `lens` · `memory` · `promptly` · `rag` · `skills` · `trust` · `workspace` | sim |
| `overview` (overview, status, not-found) | não |

Um artefato consumido por `pages/lens/**` e por `components/lens/**` tem **um** domínio
consumidor — `lens` —, não dois. A contagem é por domínio, não por diretório.

### D4.1 — Quando domínio e camada discordam, a camada decide

*Aprendido na execução, 2026-08-07.* `trace-layout.ts` tem um único domínio
consumidor (`lens`), então a regra D3 mandava descê-lo para o domínio. Ao movê-lo
para `pages/lens/`, o lint reprovou: `components/lens/ask-thread.tsx` também o
consome, e a direção de camada proíbe `components/` importar de `pages/`.

> Um módulo de domínio único consumido por **mais de uma camada** mora na **camada
> mais baixa** entre as que o consomem — não na pasta de páginas do domínio.

`trace-layout.ts` foi para `components/lens/`. A regra de residência diz *qual
domínio*; a direção de camada diz *qual altura*. As duas se aplicam, e quando
colidem a camada vence — porque violar a direção fecha ciclo, e violar a
residência só custa navegabilidade.

O episódio também é evidência a favor de D5: a regra executável pegou o erro na
mesma hora. Sem ela, `components → pages` teria entrado silenciosamente.

### D5 — Verificação, com o que existe hoje

A versão anterior prescrevia `import/no-restricted-paths`. Isso é
`eslint-plugin-import`, que **não está instalado** neste projeto — verificado em
`package.json`. Foi exatamente por isso que a regra de direção de camada (B-070) usou o
`no-restricted-imports` nativo.

A verificação usa o que existe:

1. **Import profundo entre domínios é erro de lint** — `no-restricted-imports` nativo,
   com um bloco por domínio negando `@/pages/<outro>/**`. É a direção onde a dívida
   real está: uma revisão mediu que **100% dos 8 ciclos de import fechados eram
   intra-`pages/` ou intra-`lib/`**, nenhum era ascendente.
2. **A regra de residência é medida por teste**, não por lint — um teste que constrói o
   grafo de import e falha quando um módulo em pasta compartilhada tem menos de 2
   domínios consumidores, com allowlist justificada item a item. O repositório já tem
   esse padrão funcionando em `src/lib/test-only-module-guard.test.ts`.

Adotar `eslint-plugin-import` fica como decisão separada, com seu próprio custo
(plugin + resolver de TypeScript), e não é pré-requisito desta.

## Consequências

**Bom**

- Um arquivo declara seu domínio pela localização; a pergunta *"a que isto pertence?"*
  passa a ter resposta sem grep.
- `app.tsx` é tocado **uma vez**, não a cada domínio migrado.
- A regra é verificável com as ferramentas já instaladas.
- Cada movimentação é independente: um domínio por PR, sem árvore intermediária.

**Ruim**

- `lib/api.ts` tem **200 importadores**. É genuinamente compartilhado, então não desce
  para domínio nenhum — mas renomeá-lo para `http/api.ts` toca 200 arquivos. Fica
  **por último e isolado**: misturá-lo com a reorganização torna o diff ilegível, e o
  risco não é da mesma natureza.
- Durante a transição convivem arquivos agrupados e soltos na mesma camada. Mitigação:
  nenhum arquivo novo nasce solto, e a ordem é declarada abaixo.
- Não entrega o benefício de *"apagar uma feature é `rm -rf` de um diretório"* que a
  opção 2 daria. É o preço consciente de manter o roteamento global.

**Rejeitada explicitamente:** a opção 3. O acoplamento medido não justifica divisão em
pacotes — 1.084 arestas internas, 90 cross-feature, 70 delas para `use-auth`
(cross-cutting legítimo), nenhuma feature acima de 25% de razão cross-boundary contra
o limiar heurístico de 30%.

## Ordem de execução

Do mais barato para o mais caro, por custo de import medido:

1. `dev-mocks.ts` → `mocks/` — **1 importador**. Corrige uma incoerência óbvia de graça.
2. `trace-layout.ts`, `span-status.ts`, `lens-error.ts`, `traces-export.ts`,
   `grafana-deep-link.ts` → domínio `lens` — **17 importadores**, todos de lens.
3. Agrupar os 40 soltos de `pages/` e os 40 de `hooks/` nos domínios de D4.
4. Criar as pastas de contexto para o que sobrou compartilhado em `lib/`.
5. `lib/api.ts` → `http/api.ts` — **200 importadores**, PR mecânico próprio.

## Correções factuais em relação à versão anterior

Números que a versão `proposed` afirmava e que a medição refutou:

- *"zero `index.ts` nas 30 subpastas de `src/components/`"* — são **28** subpastas e
  existe **um** (`components/layout/index.ts`, anterior a esta discussão).
- *"zero arestas ascendentes de `components`/`hooks`/`lib` para `pages`"* — refutado
  pela própria promoção: ao virar regra executável, o lint encontrou
  `components/lens/ask-thread.tsx` importando de `pages/`. A medição da auditoria
  estava errada, e o episódio é a tese deste ADR em um exemplo: **uma métrica sem
  verificação é um palpite.**

## Referências

- Itens de backlog cobertos: B-002, B-004, B-006, B-008, B-041, B-052 (plano P1)
- Regra de god module: `.claude/rules/architecture.md § 6`
- Precedente de verificação por teste: `src/lib/test-only-module-guard.test.ts`
- ADRs dependentes: 0002 (orçamento de LOC), 0006 (camada de acesso a dados), 0008
