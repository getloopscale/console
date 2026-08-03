# Edge Case Review — trust-guardrails-operation (plano de implementação)

Date: 2026-07-31
Plano analisado: `.claude/knowledge-base/plans/trust-guardrails-operation-plan.md` (v1.0, SHIPPABLE 99.2)
Tasks analisadas: 9 (T1.1, T2.1, T3.1, T4.1, T4.2, T5.1, T6.1, T7.1, T8.1)
Edge cases encontrados: 6 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: o e2e cria uma guardrail que bloqueia tráfego real e pode não removê-la

- **Task afetada:** T8.1
- **Família:** Efeito colateral em produção
- **Cenário:** o DoD exige provar o bloqueio real no `/v1/guard` contra a instância implantada. Para isso o e2e **cria um validator de verdade** no tenant. Se o spec falhar no meio (asserção quebrada, timeout, ambiente lento), o `afterEach` pode não rodar — e fica no ar uma regra ativa que **bloqueia conversas reais daquele tenant** por tempo indeterminado. O plano manda criar e não diz nada sobre limpar.
- **Impacto:** um teste de qualidade vira incidente de produção. É a materialização exata do risco R1 que o próprio plano declara.
- **Correção sugerida:** T8.1 passa a exigir (a) termo de bloqueio deliberadamente improvável e namespaced (ex.: `zzz-e2e-<runId>`), que não aparece em conversa humana; (b) limpeza em `afterEach` **e** verificação idempotente no início do spec que remove sobras de execuções anteriores; (c) asserção final de que o validator criado não existe mais no catálogo.

### EC-2: "alterar o rascunho invalida o veredito" pode ser implementado por comparação de referência

- **Task afetada:** T5.1
- **Família:** Teste que passa com implementação errada
- **Cenário:** o plano exige que alterar o rascunho depois do dry-run remova a ação de gravar. Se a implementação comparar **referência de objeto** (ou um contador de renders) em vez do conteúdo, o teste escrito como está passa — mas um caminho que reconstrói o objeto com os mesmos valores invalidaria à toa, e pior, um caminho que muta o objeto no lugar **não** invalidaria. O DoD diz "grava a spec testada"; sem critério explícito, "testada" fica ambíguo.
- **Impacto:** o operador testa a spec A e grava a spec B — exatamente o que a fase inteira existe para impedir.
- **Correção sugerida:** T5.1 declara que a invalidação compara a **serialização** da spec (os mesmos bytes enviados ao dry-run), e ganha um teste que muta um campo do rascunho **para o mesmo valor** (não deve invalidar) e outro que muta para valor diferente (deve invalidar).

### EC-3: duas CVEs HIGH em dependências de produção, numa superfície que este milestone amplia

- **Task afetada:** nova (Fase 0)
- **Família:** Segurança de dependência
- **Cenário:** `npm audit --omit=dev` no dashboard reporta **2 HIGH + 4 MODERATE**. As duas HIGH: `react-router` 7.17.0 — *"Open redirect via backslash in `<Link>` and `useNavigate`"* + *"RSCErrorHandler Missing Protocol Validation (XSS)"* — e `postcss` ≤ 8.5.17 (path traversal em source map). O plano adiciona três telas novas que usam `<Link>`/`useNavigate` para navegar entre catálogo, criação e auditoria: **amplia a superfície da CVE de open redirect**, num painel onde o usuário está autenticado.
- **Impacto:** o `deps-audit-golden-rule.md § 2` classifica HIGH CVE em dep declarada como `FAIL_INSECURE` (cap 49), que bloqueia o `/plan-confidence`. Ignorar seria entregar o milestone sobre uma base que o próprio gate do projeto reprova.
- **Correção sugerida:** adicionar **Fase 0 — pré-requisito de segurança**, com um bump que cabe **dentro do semver já declarado** (`react-router-dom: ^7.0.0` → o fix é `react-router` > 7.17.0; `postcss: ^8.4.0` → o fix é > 8.5.17). Não é troca de major, é refazer o lockfile. Verificação: `npm audit --omit=dev` sem HIGH, mais typecheck/lint/testes verdes.

## SHOULD TEST

### EC-4: o DoD exige "chave só de leitura recebe 403 no DELETE" e a Coverage Matrix delega isso a um commit anterior

- **Task afetada:** T8.1 / Coverage Matrix item 1
- **Checkpoint sugerido:** antes de fechar o milestone, **abrir** `internal/routes/trust_guardrails_test.go` e confirmar que o teste de escopo existe de fato para os três verbos. A matriz diz "já entregue em `2da373b`" — o commit menciona 10 testes novos, mas o plano não deve herdar por confiança um item de DoD verificável em segundos. Se faltar, vira task.

### EC-5: a tela de auditoria não declara o limite que pede ao servidor

- **Task afetada:** T7.1
- **Checkpoint sugerido:** T7.1 declara explicitamente o `limit` usado. O upstream aceita `?limit=` com teto `MAX_ROWS` e, na ausência, devolve `MAX_ROWS` inteiro (`packages/api/src/server/handlers/enforcement-events.ts:55`). Uma tela que não pede limite herda o teto do servidor sem saber — e a primeira renderização lenta será atribuída à tela, não à escolha implícita.

## DOCUMENT

### EC-6: `app.tsx` e `app-sidebar.tsx` seguem acima do orçamento de LoC

- **Risco aceito:** já registrado como R3 no plano, com a mitigação correta (acrescentar apenas as linhas de rota/menu e não refatorar aqui). Refatorar dois arquivos de ~600 linhas dentro do M24 misturaria escopo e inflaria o diff de revisão sem relação com guardrails. Fica como dívida declarada, não como surpresa.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| T5.1 | 1 | 1 (EC-2) | 0 | 0 |
| T7.1 | 1 | 0 | 1 (EC-5) | 0 |
| T8.1 | 2 | 1 (EC-1) | 1 (EC-4) | 0 |
| (plano) | 2 | 1 (EC-3) | 0 | 1 (EC-6) |

**Verdict:** PLAN NEEDS ADJUSTMENT — três MUST FIX. Nenhum deles muda a arquitetura do plano: EC-1 e EC-2 apertam tasks existentes, EC-3 acrescenta uma fase curta de pré-requisito. Absorvidos, o plano volta ao `/plan-confidence`.
