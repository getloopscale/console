# Discover Edge Case Review — trust-guardrails-operation

Date: 2026-07-31
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/trust-guardrails-operation-plan.md` (v1.0)
Research questions analyzed: 7
Edge cases found: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

Todo achado abaixo foi **medido contra os clones que existem**, não inferido do nome do arquivo. Os três MUST FIX vêm de Fase A que eu executei parcialmente para validar o plano — e dois deles teriam feito o halt-loop girar em falso.

Versão dos clones no momento desta análise (registrada porque o checklist a exige e porque um clone `--depth 1` não tem histórico para reconstruir depois):

| Projeto | SHA | Data |
|---|---|---|
| `posthog` | `b5da0869` | 2026-07-22 |
| `langfuse` | `6f84672` | 2026-06-30 |
| `phoenix` | `b932e69` | 2026-06-30 |

## MUST FIX

### EC-1: Q4 aponta para um e2e de feature flag que não existe no clone

- **Affected question:** Q4 (tests)
- **Family:** Reference path
- **Scenario:** a Fase A de Q4 busca em `.claude/knowledge-base/references/posthog/playwright/` o spec e o page-model de criação de flag. Medido: `playwright/page-models/` contém `cohortPage.ts`, `dashboardPage.ts`, `insightPage.ts`, `loginPage.ts` — **não há `featureFlagPage`**, e `playwright/e2e/` não tem spec de flag. O PostHog testa flag por **teste de componente/lógica** (`defaultReleaseConditionsLogic.test.ts`, `BulkCopyFlagsModal.test.ts`, `FeatureFlagReleaseConditions.flagDependencyLabel.test.tsx`), não por e2e de browser.
- **Impact:** três variantes de query retornariam vazio e Q4 fecharia BLOCKED — perdendo a resposta que o M24 mais precisa (como testar o fluxo de autoria), quando a resposta **existe**, só que em outra camada da pirâmide.
- **Suggested fix:** reescrever a Fase A de Q4 para varrer `posthog/frontend/src/scenes/feature-flags/*.test.ts*` e reformular a pergunta para "em que **camada da pirâmide** o PostHog cobre o ciclo de autoria, e o que ele deliberadamente NÃO leva a e2e?" — pergunta que os arquivos existentes respondem e que é mais útil ao `testing.md` (e2e poucos e representativos).

### EC-2: Q5 aponta para um diretório de testes do Phoenix com um único arquivo não relacionado

- **Affected question:** Q5 (tests)
- **Family:** Reference path
- **Scenario:** Q5 declara `.claude/knowledge-base/references/phoenix/app/__tests__/` como alvo para "teste de erro tipado do backend na UI". Medido: aquele diretório contém **exatamente um arquivo — `authFetch.test.ts`**. Não há teste de formulário nem de erro 422/409.
- **Impact:** Fase A esgota em Phoenix; Q5 perde metade das fontes e fica com uma só (langfuse), violando a regra de ≥ 2 referências independentes do `cycle-discover.md` para a resposta dessa questão.
- **Suggested fix:** trocar o alvo Phoenix de Q5 por `phoenix/app/src/__tests__/` (existe, verificado) e adicionar `posthog/frontend/src/scenes/feature-flags/*.test.ts*` como segunda fonte — mantendo duas referências independentes.

### EC-3: Q6 pode "achar" uma dependência que a superfície de autoria não usa

- **Affected question:** Q6 (deps)
- **Family:** Method
- **Scenario:** o método de Q6 é grep por `react-hook-form|formik|zod|yup` no `package.json` dos peers. PostHog é um monorepo com centenas de dependências; encontrar `zod` ali **não prova** que o formulário de feature flag a usa — o PostHog usa `kea` para estado de formulário (visível nos imports de `FeatureFlagTestingTab.tsx:1`).
- **Impact:** conclusão invertida no rung 4 da parsimony ladder — adotaríamos uma dependência de formulário por evidência falsa, quando a decisão correta pode ser manter lógica pura (que é o que `guardrail-draft.ts` já faz).
- **Suggested fix:** a Fase B de Q6 deve ler os **imports do componente de autoria real** (`FeatureFlagReleaseConditions.tsx`, `langfuse/.../NewPromptForm`) e responder pelo que é importado ali — o `package.json` vira no máximo confirmação de versão, nunca a evidência primária.

## SHOULD TEST

### EC-4: "Default" no PostHog pode significar valor-inicial-de-formulário, não herança de plataforma

- **Affected question:** Q2
- **Suggested halt-loop checkpoint:** antes de fechar Q2, asseverar que `DefaultReleaseConditions.tsx` trata de **configuração herdada de um nível superior** (projeto/organização) e não de "valor pré-preenchido do formulário". Se for valor-inicial, a analogia com plataforma-vs-tenant não se sustenta e a resposta de Q2 deve vir de `FeatureFlagReleaseConditionsReadonly.tsx` (que é inequivocamente sobre exibir sem permitir editar) — registrando a correção, não escondendo.

### EC-5: Q7 depende de Q4 e o plano não declara a ordem

- **Affected question:** Q7 (depende de Q4)
- **Suggested halt-loop checkpoint:** executar Q4 antes de Q7. Se Q4 concluir que o PostHog não cobre autoria por e2e (o que EC-1 torna provável), Q7 deve responder pelo `playwright.config.ts` que **existe** (verificado) — descrevendo o tooling disponível — e declarar explicitamente que a receita de e2e do M24 não terá espelho direto no peer, em vez de inventar um.

### EC-6: `feature-flags/` tem dezenas de arquivos e convida a scope creep

- **Affected question:** Q1, Q2, Q3
- **Suggested halt-loop checkpoint:** por questão, no máximo **4 arquivos** lidos integralmente na Fase B. Ao atingir o quarto sem resposta fechada, marcar a questão BLOCKED por budget em vez de continuar puxando o fio — D1 já prevê o mecanismo, este checkpoint dá o número.

## DOCUMENT

### EC-7: Os clones são fotografias de junho/julho de 2026

- **Accepted risk:** `langfuse` e `phoenix` estão em 2026-06-30 e `posthog` em 2026-07-22. Um padrão pode ter mudado no upstream depois disso. Aceito conscientemente: a alternativa (re-clonar antes de cada discovery) custa banda e tempo para mitigar um risco que **não afeta a decisão de design** — estamos atrás da forma da experiência, que muda em anos, não em semanas. O blueprint registra o SHA de cada clone para que qualquer releitura futura saiba exatamente o que foi lido.

### EC-8: PostHog usa `kea`; a transferência de padrão é conceitual, não literal

- **Accepted risk:** o dashboard do `theo-cloud` usa `@tanstack/react-query` + estado local; o PostHog usa `kea` (visível em `FeatureFlagTestingTab.tsx:1`). Nenhum código será portado — e não deve ser (`reference-provenance.md`: ler para aprender, escrever o nosso). O que se transfere é **decisão de produto** (onde o teste entra no fluxo, o que é readonly, o que a confirmação exige), que independe da biblioteca de estado. Registrado para que o blueprint não caia na tentação de recomendar "façam como o PostHog" no nível de implementação.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| Q1 | 1 | 0 | 1 (EC-6) | 0 |
| Q2 | 2 | 0 | 2 (EC-4, EC-6) | 0 |
| Q3 | 1 | 0 | 1 (EC-6) | 0 |
| Q4 | 1 | 1 (EC-1) | 0 | 0 |
| Q5 | 1 | 1 (EC-2) | 0 | 0 |
| Q6 | 1 | 1 (EC-3) | 0 | 0 |
| Q7 | 1 | 0 | 1 (EC-5) | 0 |
| (plano) | 2 | 0 | 0 | 2 (EC-7, EC-8) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT — três MUST FIX, todos de mira (a pergunta é boa, o alvo está errado). Nenhum exige nova questão nem novo projeto de referência; os três se resolvem trocando o caminho da Fase A. Após a v1.1, o plano está pronto para `/discover-plan-confidence`.
