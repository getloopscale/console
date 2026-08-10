# Review: modal-primitive-consolidation

**Date:** 2026-08-10
**Verdict:** NEEDS_FIXES
**Reviewers (spawned agents):** 5 (review-modal-primitive-consolidation-architecture, review-modal-primitive-consolidation-cross-validation, review-modal-primitive-consolidation-domain-frontend, review-modal-primitive-consolidation-tests, review-modal-primitive-consolidation-wiring)
**Total findings:** 43

> ## ⚠️ Este veredito mede o estado de QUANDO os agentes rodaram
>
> `NEEDS_FIXES` acima é o que os cinco agentes mediram. As correções vieram depois, e
> estão re-verificadas na seção **§ Re-verificação dirigida** ao final deste arquivo —
> com o comando que prova cada uma e a ressalva do que essa re-verificação NÃO cobre.
> O `NEEDS_FIXES` fica: um veredito não se reescreve por ter sido atendido, ele ganha
> um sucessor.

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 1 |
| HIGH | 5 |
| MEDIUM | 18 |
| LOW | 13 |
| INFO | 6 |

## BLOCKER findings (1)

### F-xval-1: O plano AINDA afirma que `pages/memory/skills.tsx` declara um modal `max-w-sm` sem token equivalente. A afirmação é falsa e foi medida como falsa pelo próprio implementador; o plano foi editado duas vezes desde então sem ser corrigido.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 165
- **Plan reference:** D3 — "`max-w-sm` decide-se na migração, não antes" (+ mapa T2.1 linha 399, Deep Dive linha 414, Coverage Matrix linha 525; Q2 foi DELETADA, não corrigida — ver F-xval-14)
- **Evidence:**

  O plano, na linha 165 (texto em HEAD=3074fb05):
    "A única sem token (`max-w-sm`, em `pages/memory/skills.tsx`) é resolvida
     quando se chegar no arquivo"
  
  A medição, no estado PRÉ-migração (`git show 18017351^:dashboard/src/pages/memory/skills.tsx`):
    linha 200:  <div className="max-w-sm">          ← div de LAYOUT da página
    linha 262:  <Dialog.Content>                    ← o modal, SEM className
  
  E no estado atual (dashboard/src/pages/memory/skills.tsx):
    linha 200:  <div className="max-w-sm">
    linha 261:  <AppModal                            ← sem contentClassName
  
  O próprio commit 18017351 retrata a medição, textualmente:
    "Reportei que `pages/memory/skills.tsx` tinha um modal `max-w-sm` sem token
     equivalente, e isso virou o D3/Q2 do plano. O `max-w-sm` esta num <div> de
     layout na linha 200 — NAO no modal."
  
  A retratação ficou SÓ na mensagem do commit. O plano foi editado depois em
  `a8124007` (Global DoD) e em `3074fb05` (D4) — nas duas vezes a falsidade
  passou intocada em D3.
  
  Pior: `3074fb05` DELETOU a `Q2` que dependia dessa premissa
  ("- Q2 — `max-w-sm` (1 ocorrência): adota `sm` ou justifica um token `xs`?")
  junto com a seção inteira de `## Unresolved Questions` — ver F-xval-14. A
  pergunta sumiu; a afirmação falsa que a motivava ficou.

- **Recommended action:** Emendar D3 do mesmo modo que D4 foi emendado em 3074fb05: manter o texto original como citação, registrar a medição que o desmente, e declarar que a decisão contratada não precisou ser tomada porque a largura fora de escala não existia. Corrigir junto Q2 (linha 203), a linha 399 do mapa, a linha 414 e a linha 525 da Coverage Matrix.


## HIGH findings (5)

### F-xval-2: Uma das 7 células da Coverage Matrix mapeia uma tarefa a um requisito que NÃO EXISTE. A cobertura declarada de 100% conta um gap fantasma, então o número que o `plan-confidence` usa como cap estrutural está inflado.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 525
- **Plan reference:** Coverage Matrix, linha 5 — "`max-w-sm` sem token equivalente" → T2.1 (via D3); e o total "Coverage: 7/7 (100%)" na linha 529
- **Evidence:**

  Linha 525:
    | 5 | `max-w-sm` sem token equivalente | T2.1 (via D3) | Decidido ao migrar o arquivo, registrado no commit |
  Linha 529:
    **Coverage: 7/7 (100%)**
  
  O gap #5 não existe — ver a medição em F-xval-1. Os 14 call sites de página são,
  medidos um a um sobre `18017351^`, 13 sem largura declarada + 1 (`rag/graphrag.tsx`,
  `max-w-2xl` → token `lg`). Nenhuma largura de modal está fora da escala.
  
  A coluna "Resolution" dessa linha ("Decidido ao migrar o arquivo") também não
  descreve o que aconteceu: nada foi decidido, a premissa foi retirada.

- **Recommended action:** Reescrever a célula 5 como um gap RETIRADO com o motivo medido, e recontar o total honestamente (6 gaps reais, 6/6). Um "7/7" que inclui um requisito inexistente é mais frágil que um "6/6" verdadeiro.

### F-xval-3: O critério da revisão visual teve o TEXTO reescrito antes de ser marcado `[x]`. A versão original pedia que cada modal migrado fosse aberto e comparado; a versão marcada pede uma amostra. É o critério movido depois de ver o resultado — e neste caso a consequência não é teórica: a conclusão que a amostra sustentou ("nenhuma tela mudou de aparência") era falsa e teve de ser retratada.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 548
- **Plan reference:** Global Definition of Done — item "Revisão visual"
- **Evidence:**

  Texto original, no commit que criou o plano (43387f1e), item hoje na linha 548:
    - [ ] **Revisão visual**: cada modal migrado foi aberto e comparado com o
          estado anterior — a métrica automatizada não cobre aparência (D4)
  
  Texto após `a8124007` (git show a8124007 -- <plano>), agora marcado:
    - [x] **Revisão visual** — feita por amostra dirigida ao risco; o que a
          amostra não cobre virou guard. Ver abaixo
  
  A amostra cobriu 3 dos 14 arquivos (linhas 557-560: `bulk-delete-projects-dialog`,
  `api-key-dialogs`, `graphrag`; a quarta linha da tabela é uma propriedade do
  primeiro, não um quarto arquivo). O plano DIZ isso, na linha 562 — a prosa é
  honesta sobre a amostragem, e isso é registrado a favor.
  
  O que a prosa NÃO sustenta é o `[x]`. A amostra mediu LARGURA em dois viewports
  e o plano concluiu paridade de aparência; quatro horas depois, `3074fb05` teve
  de retratar: `dialog.tsx` usava `flex-col gap-3` e `app-modal.tsx` usa
  `flex-col gap-4`, e 16 dos 17 modais migrados mudaram de espaçamento. A própria
  mensagem de 3074fb05: "EU AFIRMEI PARIDADE TENDO VERIFICADO LARGURA."
  
  O guard que "ocupou o lugar" da amostra (`modal-primitive.test.ts`) quantifica
  sobre alcançabilidade de `form=`, não sobre aparência — ele não cobria, e não
  podia cobrir, o defeito que a amostra deixou passar.

- **Recommended action:** Ou (a) restaurar o critério original e deixá-lo `[ ]` com a nota de que a cobertura conseguida foi 3/14, ou (b) manter o critério amostral mas marcá-lo com a ressalva medida — que a amostra provadamente NÃO pegou a mudança de espaçamento, encontrada depois por outra via. A linha 564 ("o plano já declarava isso em `D4`") ficou obsoleta com a emenda do D4 e precisa cair junto.

### F-xval-14: A emenda do D4 (`3074fb05`) apagou QUATRO seções do plano por acidente: `## Drawbacks & Risks`, `## Unresolved Questions` (Q1, Q2 e Q3 juntas), `## Dependency Graph` e o cabeçalho `## Phase 1`. T1.1 e T1.2 ficaram pendurados como `###` dentro de `## ADRs`, ao lado de D1..D4.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 139
- **Plan reference:** plan-confidence-golden-rule.md § Rules that cannot be bent — "Drawbacks & Risks section missing OR < 2 entries → score ≤ 89"; "Unresolved Questions section missing AND no explicit (none) marker → score ≤ 89"
- **Evidence:**

  Seções `## ` presentes em HEAD=3074fb05:
    16 Goal · 23 Context · 43 Baseline Context · 112 Prior Art · 121 Dependencies
    131 Objective · 139 ADRs · 360 Phase 2 · 455 Phase 3 · 517 Coverage Matrix
    535 Global DoD · 566 Failure scenarios
  Não há `## Drawbacks & Risks`, `## Unresolved Questions`, `## Dependency Graph`
  nem `## Phase 1`.
  
  Cabeçalhos `###` entre a linha 139 (`## ADRs`) e a 360 (`## Phase 2`):
    141 D1 · 153 D2 · 163 D3 · 175 D4 · 221 T1.1 · 294 T1.2
  T1.1 e T1.2 são hoje irmãos dos ADRs.
  
  O hunk que causou: `git show 3074fb05 -- <plano>` remove as linhas de
  "**Consequences.** … divergências visuais reais …" até "## Phase 1: Os modais
  compartilhados adotam o padrão que o código declara" e as substitui pelo corpo
  novo de D4. O texto novo é bom; o corte engoliu 4 fronteiras de seção.
  
  O que se perdeu, concretamente:
    - 5 linhas de riscos com severidade, mitigação e dono
    - Q1 — "Algum dos 14 call sites precisa da API compound por razão real? … Se
      sim, D1 ganha uma exceção nomeada e `ui/dialog` não é deletado" — a válvula
      de escape do plano, que a migração RESPONDEU (nenhum precisou) e que agora
      não está registrada em lugar nenhum
    - Q3 — o inventário de testes de `components/dialogs/`, que T1.1 executou
    - o grafo de dependência entre as 3 fases
  
  Impacto mecânico: `skills/implement/scripts/check_phase_completeness.py` e o
  mini review de fronteira de fase leem cabeçalhos `## Phase N`. Com a Phase 1
  ausente, um re-run desses gates vê 2 fases onde o plano tem 3.

- **Recommended action:** Restaurar as quatro seções a partir de `git show 4e48b7fb:<plano>`, mantendo o corpo novo do D4, e responder Q1/Q3 em vez de deletá-las ("Q1 — respondida pela migração: nenhum dos 14 precisou da API compound"). Um plano que perde a seção de riscos durante o próprio review perde o registro do que se decidiu aceitar.

### F-dom-1: The migration lost the JSX-significant whitespace around {sha}, corrupting BOTH the dialog's accessible name and its body copy. The screen reader announces "Promote abcdef1to production"; the visible description reads "This will make abcdef1the production deploy of web". This is the one modal in the set whose accessible NAME is damaged, not just its prose — it is the production promotion confirmation.


- **Found by:** review-modal-primitive-consolidation-domain-frontend
- **File:** `dashboard/src/pages/deploy/components/promote-to-production-dialog.tsx` line 162
- **Plan reference:** Phase 2 — migrar os 14 call sites restantes; Global DoD 'paridade visual'
- **Domain anchor:** WAI-ARIA dialog contract — the accessible name is the Title subtree text (app-modal.tsx:84-86 renders it into RadixDialog.Title)
- **Evidence:**

  Before (43387f1e:promote-to-production-dialog.tsx:162-172) — newline between the
  expression and the following word, which JSX collapses to a single space:
    <Dialog.Title className="inline-flex items-center gap-2">
      <ArrowUpToLine className="size-5 text-primary" aria-hidden="true" />
      Promote {sha} to production
    </Dialog.Title>
    <Dialog.Description>
      This will make <span className="font-mono">{sha}</span> the
      production deploy of{' '}
  
  After (HEAD:162-163) — the space is gone:
    title={<span className="inline-flex items-center gap-2"><ArrowUpToLine className="size-5 text-primary" aria-hidden="true" />Promote {sha}to production</span>}
    description={<>This will make <span className="font-mono">{sha}</span>the
          production deploy of{' '}<span className="font-mono">{projectName}</span>. …
  
  MEASURED (vitest + jsdom, commit_sha "abcdef1234567890", environment "production"):
    accessible-name="Promote abcdef1to production"
    <h2> "Promote abcdef1to production"
    <p>  "This will make abcdef1the production deploy of web. Visitors will see …"

- **Recommended action:** Restore the spaces: `Promote {sha} to production` and `<span …>{sha}</span> the`. Then add a rendered-text assertion (not a source grep) for the three deploy confirmations — the existing modal-primitive.test.ts quantifies over structure and is blind to this class entirely.


### F-tests-1: O guard nao tem piso de nao-vacuidade e ancora no literal `<AppModal`: com o tag renomeado por alias, ele passa 4/4 sobre uma arvore com um submit comprovadamente morto.

- **Found by:** review-modal-primitive-consolidation-tests
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 175
- **Plan reference:** Global DoD § 'A revisão visual, e o que ela cobriu de verdade' — o guard é o SUBSTITUTO declarado da revisão visual de 11 dos 14 call sites
- **Evidence:**

  modal-primitive.test.ts:89   `if (!src.includes('<AppModal')) continue;`   (caso 2)
  modal-primitive.test.ts:132  `if (!src.includes('<AppModal')) continue;`   (caso 3)
  modal-primitive.test.ts:175-184  o caso que se declara anti-vacuidade le APENAS
    `join(SRC, PRIMITIVO)` e confere os tokens `sm:`/`md:`/`lg:`/`xl:` no proprio
    primitivo. Nao ha nenhuma assercao sobre QUANTOS call sites foram varridos.
  
  SONDA P2 (executada, arvore restaurada):
    1. removi `form="promote-to-production-form"` do submit do footer  -> guard REPROVA (P1) ✔
    2. mantive o defeito e troquei para `import { AppModal as Modal }` + `<Modal`
       -> `Test Files 1 passed (1) | Tests 4 passed (4)`
    Ou seja: o defeito mais caro da migracao, presente na arvore, com a suite verde.
  
  Hoje sao 30 arquivos de producao com `<AppModal` (grep -rl '<AppModal' src --include='*.tsx'
  = 32, menos app-modal.tsx e app-modal.test.tsx). O guard nao registra esse numero em
  lugar nenhum, entao a queda de 30 para 0 e indistinguivel de um repo saudavel.

- **Recommended action:** Coletar os arquivos varridos numa lista e asserir o piso antes das asseroes de ausencia (`expect(varridos.length, 'o guard varreu zero call sites').toBeGreaterThanOrEqual(25)`). Complementarmente, derivar o nome do tag do proprio import (`/import\s*\{[^}]*\bAppModal\b(?:\s+as\s+(\w+))?/`) em vez de fixar `<AppModal`.


## MEDIUM findings (18)

### F-arch-1: The surviving primitive splits the form owner (`children`) from its submit control (`footer`) as DOM siblings, and the prop that creates the hazard documents none of it. The migration answered with detection (a repo-wide regex guard) instead of prevention (an affordance on the primitive), so the next author meets the same trap.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/components/ui/app-modal.tsx` line 91
- **Plan reference:** D1 Consequences / Unresolved Question Q1
- **Evidence:**

  `app-modal.tsx:90-91` — `children` and `footer` are siblings; a `<form>` in the body
  cannot own a `type="submit"` in the footer without the native `form="id"` attribute:
  ```tsx
  <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
  {footer ? <div className="flex items-center justify-end gap-2">{footer}</div> : null}
  ```
  `app-modal.tsx:45-46` — the whole contract the call site must honour, at the API surface:
  ```ts
  /** Footer actions (e.g. Cancel + primary). Omitted → no footer region. */
  readonly footer?: ReactNode;
  ```
  The constraint is written down only in a different file, inside a test:
  `modal-primitive.test.ts:113-116` — "O `AppModal` renderiza o `footer` FORA do container
  dos children. […] a tela renderiza IDÊNTICA e o clique não faz nada." and
  `modal-primitive.test.ts:118-120` — "Foi o defeito mais caro desta migração."
  This is a real defect class, already hit once during the migration (the plan's Global DoD
  § "revisão visual" records `delete-environment` failing with "Number of calls: 0").

- **Recommended action:** Move the contract to the API surface and close the affordance gap: add `readonly formId?: string` to `AppModalProps`, have `AppModal` inject `form={formId}` into the footer region (or render the footer inside a `<form id={formId}>` it owns), and state the sibling-DOM constraint in the `footer` JSDoc. A primitive that makes the correct wiring the default removes the class; a guard only reports it.

### F-arch-2: All three guard assertions are gated on the literal string `<AppModal` appearing in the file, so they only see DIRECT call sites. Any modal reached through the shared-wrapper layer — the exact layer D2 calls "a referência que o resto do produto copia" — is structurally invisible to the guard that replaced the visual review.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 132
- **Plan reference:** D2 (compartilhados são a referência que o resto copia) + Global DoD § 'o que a amostra NÃO cobriu'
- **Evidence:**

  The same file-level gate opens two of the three assertions:
  ```ts
  modal-primitive.test.ts:89    if (!src.includes('<AppModal')) continue;
  modal-primitive.test.ts:132   if (!src.includes('<AppModal')) continue;
  ```
  Today `footer` is declared in exactly one place, so nothing escapes yet:
  `grep -rn "readonly footer|footer\?:" dashboard/src/components` → one hit,
  `components/ui/app-modal.tsx:46`.
  But the guard's own header argues against name-based checks ("Um teste que procurasse
  `ui/dialog.tsx` verificaria a FORMA", `modal-primitive.test.ts:23-27`) and then gates
  itself on a form — the literal tag name — for the assertion whose failure mode is silent.
  The first shared modal that forwards `footer?: ReactNode` to `AppModal` takes all of its
  call sites out of coverage, and nothing fails when that happens.

- **Recommended action:** Resolve the gate transitively instead of lexically: build the set of files that reach `AppModal` through imports (one pass over `from '@/components/ui/app-modal'` plus the components that re-expose a `footer` prop), and scan that closure. Cheaper interim alternative: assert that `footer?: ReactNode` is declared ONLY in `app-modal.tsx`, which turns the current accident into a checked invariant and fails loudly the day it changes.

### F-arch-3: The two primitives were treated as equivalent modulo WIDTH, and only width was mapped. They also differ in panel gap (`gap-3` → `gap-4`) and in whether the body gets a scroll container — and the second difference applies to 12 of the 17 migrated files. D4's paridade claim is therefore broader than what was actually verified.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/components/ui/app-modal.tsx` line 77
- **Plan reference:** D4 — 'A migração preserva aparência: mesma largura efetiva, mesmo overlay, mesmo comportamento de foco'
- **Evidence:**

  Old primitive (`git show 59c4866b~1:dashboard/src/components/ui/dialog.tsx:37`):
  ```
  '… -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-2xl …'
  ```
  Surviving primitive (`app-modal.tsx:77`):
  ```
  '… -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-2xl …'
  ```
  The scroll container was OPT-IN before (`Dialog.Body`, old `dialog.tsx:61`
  `'min-h-0 flex-1 overflow-y-auto'`) and is now unconditional (`app-modal.tsx:90`).
  Measured over the 17 files that imported `ui/dialog` at 59c4866b~1: **12 used no
  `Dialog.Body` at all** (confirm-dialog, plan-limit-upgrade-modal, redeploy-dialog,
  cancel-build, promote-to-production, rollback, delete-environment, delete-secret,
  promote, rotate-secret, bulk-delete-projects, graphrag) and **1 of the 17** carried an
  explicit `gap-4` (`confirm-dialog.tsx`, old `Dialog.Content className="max-w-md gap-4"`).
  That the gap difference is real and already bit someone is independently attested by a
  call site that PRE-dates this migration: `pages/rag/wiki-search.tsx:71` passes
  `contentClassName="gap-3"` — an escape hatch spent restoring the old primitive's spacing.
  The plan's migration map (§ T2.1 Evidence) has exactly three rows, all about `max-w-*`.

- **Recommended action:** Either narrow the D4 claim in the plan to what was verified ("same effective width, same overlay, same focus behaviour — panel gap and body overflow intentionally converge on the AppModal box model"), or produce the second mapping row-by-row the way the width map was produced. Do not leave a paridade claim that the diff contradicts on 16 of 17 files.

### F-xval-4: O plano foi editado duas vezes depois do início da implementação, a segunda já com o /review em curso. A revisão compara os commits com um contrato que absorveu parte do próprio resultado.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 1
- **Plan reference:** cycle-review.md § Anti-patterns — "o plano deve ser a verdade de base, não revisada"
- **Evidence:**

  git log --format='%h %ad %s' --date=iso -- <plano>:
    3074fb05  2026-08-09 22:31:53  docs(plan): o D4 afirmava paridade visual que a medicao desmente
    a8124007  2026-08-09 18:42:18  test(dashboard): a revisao visual do DoD, e o guard que substitui a amostra
    43387f1e  2026-08-09 12:24:13  docs(dashboard): o levantamento contava a solucao como parte do problema
  
  Implementação: 59c4866b (12:30) e 18017351 (18:08) — ambas ANTES de a8124007.
  Este /review foi aberto sobre os 5 commits do slice; 3074fb05 entrou depois.

- **Recommended action:** Nenhuma reversão. Registrar as duas emendas no corpo do PR como emendas pós-implementação, com data e motivo, para que o leitor futuro não leia o plano como o contrato que existia quando o código foi escrito.

### F-xval-5: O caso (b) — "com `open={false}`, nada renderiza" — não existe em `redeploy-dialog.test.tsx`. O helper de render fixa `open` e nenhum teste o desliga.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `dashboard/src/components/dialogs/redeploy-dialog.test.tsx` line 30
- **Plan reference:** T1.1 Acceptance Criteria, linha 282 — "Cada um dos 3 componentes tem ao menos os 4 casos descritos"; casos definidos em Deep Dives, linha 253
- **Evidence:**

  dashboard/src/components/dialogs/redeploy-dialog.test.tsx:30-46 — o único helper:
    function renderDialog(build: Build = makeBuild(), onOpenChange = vi.fn()) {
      ...
          <RedeployDialog
            open                       ← literal, nunca false
            onOpenChange={onOpenChange}
  
  Os 5 casos do arquivo (linhas 53, 61, 81, 101, 108): shows_sha_and_environment,
  confirm_posts_redeploy, renders_error, ESC, botão de fechar. Nenhum `open={false}`,
  nenhum `queryBy*`/`not.toBeInTheDocument` (grep por `open={false}|queryBy|
  not.toBeInTheDocument` no arquivo não retorna nada).
  
  Comparação: `confirm-dialog.test.tsx:33` tem "omits content when open=false" e
  `plan-limit-upgrade-modal.test.tsx:12` tem "test_closed_by_default" — os outros
  dois cumprem o caso (b).
  
  Simétrico e menor: `plan-limit-upgrade-modal.test.tsx` não tem o caso (c) ("o
  callback primário dispara no clique") porque o componente não tem ação primária —
  `test_upgrade_link_targets_billing` (linha 38) é o análogo honesto. O commit
  59c4866b declara essa adaptação; a de redeploy não é declarada em lugar nenhum.

- **Recommended action:** Acrescentar um caso `open={false}` a `redeploy-dialog.test.tsx` (4 linhas, mesmo formato do de `confirm-dialog`), ou registrar no plano por que o componente é exceção. A ausência hoje é silenciosa.

### F-xval-6: T1.1 (a rede) e T1.2 (a troca de primitivo) estão no MESMO commit. Não existe no histórico nenhum estado em que os testes existam sobre o código não migrado, então o DoD que dá sentido à tarefa é inverificável por qualquer auditor.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 289
- **Plan reference:** T1.1 DoD — "Os 3 arquivos de teste existem e passam contra o código **não migrado**"
- **Evidence:**

  git show 59c4866b --stat: o commit contém, juntos,
    components/dialogs/confirm-dialog.test.tsx            (+43)   ← T1.1
    components/dialogs/confirm-dialog.tsx                 (+61/-…) ← T1.2
    components/dialogs/plan-limit-upgrade-modal.test.tsx  (+24)   ← T1.1
    components/dialogs/plan-limit-upgrade-modal.tsx       (+42/-…) ← T1.2
    components/dialogs/redeploy-dialog.test.tsx           (+24)   ← T1.1
    components/dialogs/redeploy-dialog.tsx               (+100/-…) ← T1.2
  
  A mensagem afirma "A REDE VEIO ANTES" — plausível e provavelmente verdadeiro,
  mas é exatamente o tipo de afirmação que o histórico existe para tornar
  verificável, e aqui não torna.
  
  Colide com `cycle-implement.md § Anti-patterns`: "Commits que misturam várias
  tarefas. Cada commit referencia um task ID."

- **Recommended action:** Não reescrever histórico. Para as próximas fatias, commitar RED e GREEN separadamente. Aqui, registrar no PR que T1.1 e T1.2 não são separáveis e que a verificação disponível é a suíte verde no estado final.

### F-xval-7: Não existe nenhum artefato de implementação. `knowledge-base/implementations/` está VAZIO — sem `{slug}-implementation.md`, sem logs por iteração, sem `.progress-modal-primitive-consolidation.json`. A pré-condição declarada do próprio `cycle-review` não está satisfeita.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/implementations/` line 1
- **Plan reference:** cycle-implement.md § Output; cycle-review.md § Pre-conditions
- **Evidence:**

  ls -la .claude/knowledge-base/implementations/  →  total 8, só `.` e `..`
  find .claude/knowledge-base -name "*modal-primitive*" retorna apenas:
    .claude/knowledge-base/reviews/modal-primitive-consolidation-implement-validate-2026-08-10.md
    .claude/knowledge-base/plans/modal-primitive-consolidation-plan.md
    .claude/knowledge-base/audits/modal-primitive-consolidation-code-quality-2026-08-10.md
  
  A consequência é medida e está no próprio relatório de validação
  (.claude/knowledge-base/reviews/modal-primitive-consolidation-implement-validate-2026-08-10.md):
    Overall: PARTIAL — 11 checks (PASS: 4, FAIL: 0, SKIP: 5)
    checkpoint_consistency — SKIP — "no progress checkpoint — implement may not have run"
    wiring_triad         — SKIP — "no progress file found — implement may not have been invoked"
  
  Ou seja: o triádico de wiring nunca foi verificado nesta fatia, e a razão é a
  ausência do checkpoint, não uma decisão.

- **Recommended action:** Escrever `knowledge-base/implementations/modal-primitive-consolidation-implementation.md` com o resumo por tarefa antes do merge. Para o wiring: nesta fatia o "caller" de cada migração é a própria página que renderiza o modal, e isso é demonstrável — mas precisa ser escrito, não presumido pela ausência do gate.

### F-xval-8: Dois dos cinco commits do slice mudam arquivos que o plano nunca autorizou. As mudanças são honestas e foram forçadas por gates, mas nenhum ADR as cobre e elas viajam no mesmo slice de revisão que a migração de modais.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/skills/implement/scripts/run_validation.py` line 1
- **Plan reference:** T1.1/T1.2/T2.1/T3.1 § Files to edit — nenhuma delas declara estes arquivos
- **Evidence:**

  26c7976b — "remove os seis exports mortos que o gate acusou":
    dashboard/src/hooks/lens/use-datasets.ts
    dashboard/src/hooks/lens/use-trace.ts
    dashboard/src/hooks/promptly/promptly-api.ts
    dashboard/src/hooks/promptly/use-promptly.ts
    dashboard/src/hooks/rag/use-collections.ts
    dashboard/src/lib/http/list-ceiling.ts
  A própria mensagem admite a origem: "Nenhum dos seis vem do plano de modais —
  sao residuo do trabalho anterior da camada de dados".
  
  4e48b7fb — "o gate de validacao era cego a monorepo":
    .claude/skills/implement/scripts/run_validation.py  (+55/-… — muda o MOTOR do ciclo)
    dashboard/eslint.config.js                          (+14 — globais de Node para scripts/**)
    dashboard/cortar-tmp.mjs                            (-40 — arquivo apagado)
  
  Também fora do declarado, embora dentro do espírito: 18017351 mexe em
  `dashboard/eslint.config.js` (catraca de LoC 561→555 e 534→521) e cria
  `dashboard/src/components/ui/modal-primitive.test.ts` (185 linhas) — o guard não
  consta de nenhum "Files to edit".

- **Recommended action:** Não reverter — a correção do `run_validation.py` é o achado mais valioso da sessão (quatro gates saíam SKIP com motivo falso). Separar em PR próprio, ou declarar no corpo do PR os três blocos ("migração", "dívida herdada exposta pelo gate", "conserto do gate") para que a rastreabilidade não se perca.

### F-dom-2: Same whitespace loss in the rollback confirmation's description: the environment name is glued to the next word. The user is asked to confirm a destructive rollback while reading "current release in productionwith the build from commit abcdef1".


- **Found by:** review-modal-primitive-consolidation-domain-frontend
- **File:** `dashboard/src/pages/deploy/components/rollback-dialog.tsx` line 139
- **Plan reference:** Phase 2 — migrar os 14 call sites restantes
- **Domain anchor:** JSX whitespace semantics — a newline adjacent to a tag is trimmed, a newline between text is collapsed to one space
- **Evidence:**

  Before (43387f1e:rollback-dialog.tsx:143):
    This will replace the current release in <span className="font-mono">{targetBuild.environment}</span> with the build from commit <span className="font-mono">{sha}</span>.
  After (HEAD:139):
    description={<>This will replace the current release in <span className="font-mono">{targetBuild.environment}</span>with the build from commit <span className="font-mono">{sha}</span>.</>}
                                                                                                                      ^ space removed
  MEASURED (vitest + jsdom):
    <p> "This will replace the current release in productionwith the build from commit abcdef1."

- **Recommended action:** Re-insert the space before `with`.

### F-dom-3: Same defect in the cancel-build confirmation: "The active release in productionis unaffected." The `{' '}` before the <span> survived the fold; the newline after the closing </span> did not.


- **Found by:** review-modal-primitive-consolidation-domain-frontend
- **File:** `dashboard/src/pages/deploy/components/cancel-build-dialog.tsx` line 62
- **Plan reference:** Phase 2 — migrar os 14 call sites restantes
- **Domain anchor:** JSX whitespace semantics
- **Evidence:**

  Before (43387f1e:cancel-build-dialog.tsx:66-67):
    discarded. The active release in{' '}
    <span className="font-mono">{build.environment}</span> is unaffected.
  After (HEAD:61-62):
    description={<>This stops the build at the current step. Any partial work is
          discarded. The active release in{' '}<span className="font-mono">{build.environment}</span>is unaffected.</>}
  MEASURED (vitest + jsdom):
    <p> "This stops the build at the current step. Any partial work is discarded. The active release in productionis unaffected."

- **Recommended action:** Re-insert the space. All three of F-dom-1/2/3 come from one automated fold (dashboard/migrar-modal.mjs, untracked at the start of this branch) — worth a single sweep over every `title=`/`description=` the script rewrote rather than three patches.


### F-dom-4: `description` is typed `ReactNode` and rendered straight into `RadixDialog.Description`, which is a `<p>`. Seven live call sites pass a `<div>` with `<p>` children into it, producing `<p><div><p>…</p></p>` — React logs a hydration-class error and a real browser's parser auto-closes the outer `<p>`, detaching the rest of the copy from the element `aria-describedby` points at. HONEST SCOPE: this is NOT introduced by this migration (the deleted `Dialog.Description` was the same `RadixDialog.Description`). It is raised here because the plan makes `AppModal` the single door, its new guard (`modal-primitive.test.ts`) does not look at this, and the prop's `ReactNode` type actively invites it.


- **Found by:** review-modal-primitive-consolidation-domain-frontend
- **File:** `dashboard/src/components/ui/app-modal.tsx` line 87
- **Plan reference:** Global DoD — `components/ui/app-modal.tsx` é o único primitivo de modal
- **Domain anchor:** HTML content model — <p> may contain phrasing content only; Radix renders Description as <p>
- **Evidence:**

  app-modal.tsx:87
    <RadixDialog.Description className="text-sm text-muted-foreground">{description}</RadixDialog.Description>
  
  Call sites passing block content (all reach AppModal via ConfirmDialog):
    dashboard/src/pages/memory/webhooks.tsx:229
    dashboard/src/pages/memory/webhooks.tsx:388
    dashboard/src/pages/memory/skills.tsx:304
    dashboard/src/pages/settings/webhooks.tsx:260
    dashboard/src/pages/settings/components/api-key-dialogs.tsx:57
    dashboard/src/pages/settings/components/api-key-dialogs.tsx:374
    dashboard/src/pages/projects/components/scale-confirm-dialog.tsx:67
  
  MEASURED (vitest + jsdom, ConfirmDialog with the memory/webhooks.tsx:229 shape):
    aria-describedby -> <p>
    descEl.outerHTML="<p id=\"radix-_r_5_\" class=\"text-sm text-muted-foreground\"><div class=\"space-y-2 text-sm\"><p>Permanently removed.</p><p class=\"text-muted-foreground\">This cannot be undone.</p></div></p>"
    react console.error: "In HTML, %s cannot be a descendant of <%s>. This will cause a hydration error."
    react console.error: "<%s> cannot contain a nested %s."

- **Recommended action:** Give AppModal an escape hatch that is honest about the content model — e.g. render Description `asChild` over a `<div>` when the caller needs block content, or accept `descriptionAs`. Whatever the fix, add the case to `modal-primitive.test.ts`: it is exactly the "quantify over the construct" style that file already argues for.


### F-dom-5: The doc-comment that survives this consolidation — and that the plan quotes as the reason the dashboard hand-rolls a Radix wrapper at all — describes a bug in `@usetheo/ui@0.28.2`. The INSTALLED version is `0.35.1` (declared `^0.35.1` since 2026-08-04, e165688a), and in it `Dialog` and `Sheet` are distinct objects with distinct Content components; `Dialog.Content` is centered. The stated justification for the primitive no longer describes the dependency the app ships with. This does not make the consolidation wrong (one primitive still beats two) — it makes the surviving primitive's rationale unverified, and the migration re-published it.


- **Found by:** review-modal-primitive-consolidation-domain-frontend
- **File:** `dashboard/src/components/ui/app-modal.tsx` line 12
- **Plan reference:** Plan § Baseline / ADR — 'Why not the @usetheo/ui Dialog?'
- **Domain anchor:** Unbreakable Rule 9 (Don't Reinvent) + Rule 3 (honesty) — a hand-rolled wrapper needs a justification that is still true
- **Evidence:**

  app-modal.tsx:12-17 (HEAD):
    * Why not the `@usetheo/ui` `Dialog`? In `@usetheo/ui@0.28.2` both `Dialog` and `Sheet`
    * are the SAME object (`DialogPrimitive.Root`), and `Sheet.Content = <drawer>` runs after
    * `Dialog.Content = <centered>`, clobbering it …
  
  dashboard/package.json:72  "@usetheo/ui": "^0.35.1"
  node -e require('@usetheo/ui/package.json').version  ->  0.35.1
  
  node_modules/@usetheo/ui/dist/index.js:1732-1743 — Dialog is Root7 + Content3
    var Root7 = (props) => jsx(DialogPrimitive.Root, {...props});
    var Dialog = Object.assign(Root7, { …, Content: Content3, … });
  node_modules/@usetheo/ui/dist/index.js:3069-3081 — Sheet is a DIFFERENT object
    var Root23 = (props) => jsx(DialogPrimitive.Root, {...props});
    var Sheet = Object.assign(Root23, { …, Content: Content10, … });
  node_modules/@usetheo/ui/dist/index.js:1658-1668 — Content3 is CENTERED, not a drawer
    "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 w-full max-w-lg"

- **Recommended action:** Re-measure the claim against 0.35.1 and rewrite the comment to say what is true today. If the library Dialog now serves, that is a separate backlog item (delete a local primitive), not a change to make inside this migration. What must not survive is a doc that cites a version the repo stopped using five months of releases ago.


### F-tests-2: Unico dos 14 call sites com submit de footer e ZERO cobertura comportamental: nenhum teste renderiza o componente. A fiacao `form=` dele depende so do guard de F-tests-1.

- **Found by:** review-modal-primitive-consolidation-tests
- **File:** `dashboard/src/pages/deploy/components/promote-to-production-dialog.tsx` line 174
- **Plan reference:** T2.1 § TDD — 'a suíte existente é a rede'; e o registro honesto de que a rede pode se mostrar insuficiente
- **Evidence:**

  promote-to-production-dialog.tsx:174  `type="submit" form="promote-to-production-form"`
  promote-to-production-dialog.tsx:180  `<form id="promote-to-production-form" onSubmit={handleSubmit}`
  (o footer, l.167, e irmao do corpo — a separacao exata que o commit 18017351 descreve
   como "renderiza IDENTICA e o clique nao faz nada")
  
  grep -rn 'PromoteToProduction|deployment-detail-layout' --include='*.test.*' src ->
    pages/pages.smoke.test.ts:102          `await import('./deploy/deployment-detail-layout')`  (smoke de import)
    pages/deploy/components/build-header.test.tsx:31,123,132  (props do PAI, nao o modal)
    hooks/deploy/use-mutation-in-flight.test.tsx:3  (comentario)
  promote-to-production-dialog-format.test.ts:9  `import { formatPromoteError } from './...'`
    — funcao pura, nao renderiza nada.
  
  Comparacao medida: o defeito identico em delete-environment-dialog FOI pego pelo teste
  co-locado ("Number of calls: 0", relatado em 18017351). Este arquivo nao tem esse guarda-costas.

- **Recommended action:** Criar promote-to-production-dialog.test.tsx com um caso que submeta de ponta a ponta e assere a chamada de rede (o mesmo formato de delete-environment-dialog.test.tsx:110), mais um caso negativo de falha do submit.

### F-tests-3: Dois call sites migrados com submit de footer tem teste co-locado que NUNCA submete — a mesma exposicao de F-tests-2, com a aparencia de estarem cobertos.

- **Found by:** review-modal-primitive-consolidation-tests
- **File:** `dashboard/src/pages/deploy/components/rollback-dialog.test.tsx` line 43
- **Plan reference:** T2.1 § Deep Dives — 'Critério de parada' e o registro de que a suíte existente é a rede
- **Evidence:**

  rollback-dialog.tsx:143  `type="submit" form="rollback-form"`
  rollback-dialog.test.tsx tem 2 casos, ambos de PORTA (`grep -nE '^\s*it\('`):
    l.43 'non-production rollback is blocked until the user acknowledges'
    l.51 'production rollback keeps the stricter type-to-confirm phrase'
    Nenhum clica no submit. Um `form=` quebrado ali passa na suite.
  
  memory/webhooks.tsx:502  `type="submit" form="add-webhook-form"`
  memory/webhooks.test.tsx:73 'Add webhook dialog opens + form fields render' — abre o
    modal e assere `findByLabelText`; nao ha clique de submit em nenhum dos 4 casos.
  
  Contraste (medido) nos que SIM cobrem o caminho de risco:
    infra/promote-dialog.test.tsx:62-63        fireEvent.click no submit do footer
    infra/delete-environment-dialog.test.tsx:110  assere o DELETE
    projects/bulk-delete-projects-dialog.test.tsx:42  submit + fechamento
    settings/webhooks.test.tsx:83               click em /^add webhook$/i -> POST
    lens/traces.test.tsx:503                    submit do saved-views -> POST

- **Recommended action:** Um caso de submit por arquivo (clique no botao do footer + assercao da chamada de rede). Sao 9 dos 14 call sites com submit de footer; 6 ja estao cobertos, faltam estes 2 mais o de F-tests-2.

### F-tests-4: O caso de largura so casa `contentClassName` como literal entre aspas duplas; a forma de expressao — que e o modo natural de compor className — passa com um token escrito a mao.

- **Found by:** review-modal-primitive-consolidation-tests
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 90
- **Plan reference:** Global DoD — 'Nenhum call site de modal contém max-w-*'; Objective — 'toda largura de modal vem de um token'
- **Evidence:**

  modal-primitive.test.ts:90  `for (const m of src.matchAll(/contentClassName="([^"]*)"/g))`
  
  SONDA P3 (executada, arvore restaurada):
    pages/rag/wiki-search.tsx:71
      contentClassName="gap-3"  ->  contentClassName={"max-w-2xl gap-3"}
    `max-w-2xl` e literalmente o token `lg` escrito a mao — o caso EXATO que o teste
    descreve nos seus proprios comentarios (l.72-74) — e a suite ficou verde:
      `Test Files 1 passed (1) | Tests 4 passed (4)`
    `contentClassName={cn(...)}` e template literal tem o mesmo destino.
  
  Contexto que aumenta a importancia: hoje so 2 arquivos de producao usam
  `contentClassName` (wiki-search.tsx:71 e wiki.tsx:247) e NENHUM deles veio desta
  migracao — o caso 2 varre 2 ocorrencias benignas. Ele e fino hoje e furado amanha.

- **Recommended action:** Casar a prop inteira ate o fecho balanceado (`contentClassName=(?:"[^"]*"|\{[^}]*\})`) e aplicar o mesmo teste de `max-w-(?!none)` sobre o conteudo, seja literal ou expressao.

### F-tests-5: O componente de confirmacao destrutiva com 29 consumidores fecha SO no sucesso — e essa regra nao tem teste. Os 5 casos novos da fatia sao todos de fechamento bem-sucedido.

- **Found by:** review-modal-primitive-consolidation-tests
- **File:** `dashboard/src/components/dialogs/confirm-dialog.tsx` line 67
- **Plan reference:** .claude/rules/testing.md § 4.1 (casos negativos) e § 6 ('testar só o happy path')
- **Evidence:**

  confirm-dialog.tsx:67-76
    const confirm = async () => {
      if (!canConfirm) return;
      try { setBusy(true); await onConfirm(); onOpenChange(false); }
      finally { setBusy(false); }
    };
  A linha 72 so roda se `onConfirm()` resolver. Nao ha `catch`.
  
  grep por sinal negativo nos 3 arquivos de teste da fatia: nenhum `mockRejected` foi
  adicionado. Os 2 unicos casos negativos de submit da area sao PRE-EXISTENTES
  (redeploy-dialog.test.tsx:81, bulk-delete-projects-dialog.test.tsx:56).
  
  SONDA P6 (teste temporario, removido): rendendo ConfirmDialog com
  `onConfirm: vi.fn().mockRejectedValue(new Error('boom'))` e clicando no confirmar,
  a assercao `expect(onOpenChange).not.toHaveBeenCalledWith(false)` PASSA — mas o vitest
  reporta `Errors 1`, porque a rejeicao sobe sem tratamento (nao ha catch em l.69-75).
  Ou seja: o caso negativo esta ausente E escrevê-lo revela um segundo defeito.

- **Recommended action:** Adicionar a `confirm-dialog.test.tsx` o par negativo das duas asseroes de fechamento: "o modal permanece aberto quando onConfirm rejeita" com a mensagem/erro tipado assertado (rules/testing.md § 4.1 — o caso negativo assere o erro especifico, nao so "lanca"), o que forcara tratar a rejeicao em vez de deixa-la escapar (rules/error-handling.md § 2).

### F-wire-1: Deleting `CATALOG_QUERY_KEY` left its doc-comment behind, describing a constant that no longer exists — the exact orphan-comment defect the same commit says it took care to avoid for PAGE_SIZE, missed one file over.


- **Found by:** review-modal-primitive-consolidation-wiring
- **File:** `dashboard/src/hooks/promptly/promptly-api.ts` line 22
- **Plan reference:** commit 26c7976b — removal of the six dead exports
- **Evidence:**

  Current file, lines 20-25:
    20: export const CATALOG_PAGE_LIMIT = 100;
    21:
    22: /** A chave de cache do catálogo — uma só, porque o recurso é um só. */
    23:
    24: /** Uma página do catálogo mais a informação de que ela pode não ser tudo. */
    25: export interface CatalogPage<T> {
  The comment on L22 now documents nothing: L23 is blank and L24 opens an unrelated
  doc-block. `git show 26c7976b -- dashboard/src/hooks/promptly/promptly-api.ts`:
      /** A chave de cache do catálogo — uma só, porque o recurso é um só. */
    - export const CATALOG_QUERY_KEY = ['cloud', '/v1/dashboard/promptly/prompts'] as const;
  Only the declaration was removed. The commit message states, for the PAGE_SIZE case:
  "apaga-lo deixaria o doc-comment do modulo descrevendo uma constante que nao existe
  mais, que e o defeito de comentario orfao que este repositorio ja pagou" — the care
  was applied to lib/http/list-ceiling.ts and not to this file.
  No tool caught it: tsc, eslint and knip are all clean, because an orphan comment is
  valid code.

- **Recommended action:** Delete line 22. If the sentence is worth keeping as history, fold it into the migration note in src/lib/api/query-keys.ts where the key now lives, instead of leaving it attached to nothing.


### F-wire-2: The single modal primitive for the whole dashboard imports `tailwind-merge`, which is not declared in dashboard/package.json. It resolves today only because two other packages hoist it. Pre-existing, but this slice concentrated the blast radius onto one file that every modal in the product now goes through.


- **Found by:** review-modal-primitive-consolidation-wiring
- **File:** `dashboard/src/components/ui/app-modal.tsx` line 4
- **Plan reference:** Phase 3 — ui/dialog.tsx deleted, AppModal becomes the single modal primitive
- **Evidence:**

  app-modal.tsx:4 — `import { twMerge } from 'tailwind-merge';`
  `grep -n "tailwind-merge" dashboard/package.json` -> no match (only @tailwindcss/postcss,
  @tailwindcss/typography, tailwindcss are declared).
  knip: "Unlisted dependencies (4) ... src/components/ui/app-modal.tsx: tailwind-merge".
  The only declarers in the tree are node_modules/@usetheo/ui/package.json and
  node_modules/@theokit/ui/package.json — i.e. it is present by npm hoisting of a
  transitive dependency, not by our own manifest.
  Honest scoping: NOT introduced here. The deleted ui/dialog.tsx used the same import
  (git show 59c4866b~1:dashboard/src/components/ui/dialog.tsx line 4), and
  pages/lens/traces/peek-sheet.tsx still does. What changed is concentration: 17 call
  sites plus the 4 shared modals now render through this one file, so a @usetheo/ui bump
  that drops tailwind-merge takes out every modal at once rather than some of them.

- **Recommended action:** Add `tailwind-merge` to dashboard/package.json dependencies at the version currently hoisted. One line, and it converts a silent build-time cliff into a declared edge.



## LOW findings (13)

### F-arch-4: The new guard is the fifth bespoke source-tree walker in this repo, and it is the only one whose definition of "production file" disagrees with the other four — it keeps `*.stories.tsx` in scope and drops `mocks/` and `vendor/`. Five walkers that disagree mean five different answers to "what is production code" inside one codebase.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 38
- **Plan reference:** T3.1 (o guard que substitui a amostra)
- **Evidence:**

  New walker (`modal-primitive.test.ts:36-44`):
  ```ts
  if (entrada === 'node_modules' || entrada === 'vendor' || entrada === 'mocks') continue;
  … else if (/\.tsx?$/.test(entrada) && !/\.(test|spec)\.tsx?$/.test(entrada)) out.push(caminho);
  ```
  Four pre-existing siblings, each with its own `function arquivos(dir, out)`:
  - `src/lib/residence-rule.test.ts:97` — excludes `test|spec|stories`
  - `src/lib/data-access-layer.test.ts:62` — excludes `test|spec`
  - `src/lib/cache-policy.test.ts:49` — excludes `test|spec`
  - `src/lib/parent-barrel-import.test.ts:44` — excludes nothing
  Only the new one skips directories, and only the new one treats a Storybook story as
  production. Two stories exist today (`components/layout/team-switcher.stories.tsx`,
  `pages/projects/components/project-health-card.stories.tsx`); neither imports
  `@radix-ui/react-dialog`, so no false positive fires yet — a story that composes the
  dialog to document it would be reported as "a second modal primitive".
  Honest scoping: the duplication is PRE-EXISTING; this commit adds the fifth copy and the
  first divergent ignore-set, it did not start the pattern.

- **Recommended action:** Extract one `listarArquivosDeProducao()` into `src/test/` (next to `arvore-estavel.ts`, which is already the shared home for suite-wide helpers) and have the new guard consume it. Per Rule 12, the duplicated knowledge here is the DEFINITION of "production file", not the four lines of recursion — and it is already inconsistent across five copies.

### F-arch-5: A repo-wide architectural fitness function was placed in `components/ui/`, while the repository's eleven sibling guards — and the precedent ADR-0001 § D5 explicitly names — live in `src/lib/`. The file is co-located with the primitive it protects but quantifies over the entire tree, so its blast radius and its address disagree.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 5
- **Plan reference:** T3.1 · ADR-0001 § D5 item 2
- **Evidence:**

  ```ts
  modal-primitive.test.ts:5    const SRC = resolve(__dirname, '../..');   // = src/
  ```
  Siblings of the same class, all under `src/lib/`: `residence-rule.test.ts`,
  `data-access-layer.test.ts`, `cache-policy.test.ts`, `parent-barrel-import.test.ts`,
  `adr-nomenclature.test.ts`, `query-key-convergence.test.ts`, `deprecation-marker.test.ts`,
  `env-terminology.test.ts`, `request-ceiling.test.ts`, `url-state-convention.test.ts`,
  `test-only-module-guard.test.ts`.
  ADR-0001 § D5 item 2 names the convention by name: "O repositório já tem esse padrão
  funcionando em `src/lib/test-only-module-guard.test.ts`", and § Referências repeats it as
  "Precedente de verificação por teste".
  No import edge is created (the guard reads from disk via `node:fs`), so this is
  navigability, not dependency direction — which is why it is LOW and not higher.

- **Recommended action:** Move it to `src/lib/modal-primitive.test.ts` to join the eleven guards of its class, or — if co-location with the primitive is the deliberate call — record that choice in one line inside the file's header, so the next person adding a fitness function knows there are two sanctioned homes and which one applies.

### F-xval-9: Três critérios de aceite são LITERALMENTE falsos como escritos e só passam por reinterpretação. A reinterpretação foi feita no Global DoD, mas os critérios das tarefas nunca foram reconciliados — quem os re-executar tal como estão vai medir vermelho.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 509
- **Plan reference:** T3.1 AC linha 509 e linha 505; T1.2 AC linha 347
- **Evidence:**

  Linha 509 — T3.1: "`grep -rl \"@radix-ui/react-dialog\" dashboard/src` retorna
  **apenas** `components/ui/app-modal.tsx`".
  Medido agora: 3 arquivos casam —
    src/components/ui/app-modal.tsx        (produção — o primitivo)
    src/components/ui/modal-primitive.test.ts  (teste — CITA a string para asseri-la)
    src/build/manual-chunks.test.ts        (teste — pré-existente, 978f8739)
  
  Linha 505 — T3.1: "`grep -rl \"ui/dialog\" dashboard/src` retorna vazio".
  Medido agora: 4 arquivos casam, todos em COMENTÁRIOS —
    src/components/dialogs/confirm-dialog.test.tsx:138
    src/components/dialogs/redeploy-dialog.test.tsx:99
    src/components/dialogs/redeploy-dialog.tsx:63
    src/components/ui/modal-primitive.test.ts:13,19,24
  
  Linha 347 — T1.2: "`grep -l \"ui/dialog\" dashboard/src/components/dialogs/`
  retorna vazio". Medido: `redeploy-dialog.tsx` e os dois `.test.tsx` casam (mesmos
  comentários acima).
  
  A INTENÇÃO — nenhum import, nenhum segundo primitivo — está satisfeita, e eu
  confirmo: `dialog.tsx` não existe e exatamente um arquivo de produção compõe o
  Radix. O Global DoD (linha 544) argumenta essa reinterpretação para o primeiro
  caso; os outros dois nem isso.

- **Recommended action:** Reescrever os três critérios para medirem o que querem dizer — por exemplo `grep -rl "from '@/components/ui/dialog'"`, ou simplesmente delegar ao guard `modal-primitive.test.ts`, que já quantifica sobre o efeito. Um critério que só passa depois de explicado deixa de ser um critério.

### F-xval-10: Três números do mapa T2.1 não fecham com a medição, e o mapa se anuncia explicitamente como "medido, não estimado".

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 397
- **Plan reference:** T2.1 Evidence — "Mapa de migração completo dos 14 call sites de página — medido, não estimado"; e T2.1 Deep file dependency analysis, linhas 407-408
- **Evidence:**

  (a) Linha 397 diz "sem largura declarada … **12**". Medido arquivo a arquivo em
      `18017351^`, são **13** — `pages/memory/skills.tsx` entra aqui, porque o
      `max-w-sm` dele é um `<div>` de layout (F-xval-1), não o modal.
  
  (b) Linhas 407-408: "11 dos 14 são componentes de modal dedicados (`*-dialog.tsx`)"
      e "3 são páginas com modal inline" — mas a própria linha 408 lista QUATRO
      arquivos, e 11+4=15≠14. Medido sobre a lista dos 14: 9 dedicados
      (`api-key-dialogs`, `promote-dialog`, `promote-to-production-dialog`,
      `rollback-dialog`, `delete-environment-dialog`, `rotate-secret-dialog`,
      `delete-secret-dialog`, `bulk-delete-projects-dialog`, `cancel-build-dialog`)
      e 5 páginas (`memory/webhooks`, `settings/webhooks`, `rag/graphrag`,
      `memory/skills`, `lens/traces/saved-views`).
  
  (c) Coverage Matrix linha 524 ainda descreve o gap 4 como "5 valores, 8 ocorrências",
      número que o próprio `## Context` do plano (linha 39) já refuta: "São **3
      ocorrências em 3 arquivos**".

- **Recommended action:** Corrigir os três junto com a emenda de D3 (F-xval-1) — todos vêm da mesma raiz: medir o ARQUIVO em vez do CONSTRUTO.

### F-xval-11: Todos os checkboxes de nível de tarefa e todos os do `## Objective` seguem `[ ]`, enquanto o Global DoD declara as fases concluídas. Verifiquei: quase todos estão de fato satisfeitos — o defeito é de registro, não de execução.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 133
- **Plan reference:** ## Objective (linhas 133-137) e todos os blocos Acceptance Criteria / DoD das 4 tarefas
- **Evidence:**

  Linhas 133-137 (`## Objective`), todas `[ ]`, embora eu tenha medido as cinco:
    - [ ] Os 3 modais compartilhados usam `AppModal`          → satisfeito
    - [ ] Os 14 call sites de página usam `AppModal`          → satisfeito
    - [ ] Toda largura de modal vem de um token da escala     → satisfeito
    - [ ] `components/ui/dialog.tsx` não existe mais          → satisfeito
    - [ ] Os 8 testes de `app-modal.test.tsx` continuam …     → satisfeito (suíte verde)
  
  Linha 539 (`Global DoD`): "- [x] Todas as fases concluídas".
  
  A assimetria importa porque o relatório de validação já a apanhou como risco:
  "23 acceptance criterion(s) cannot be machine-verified and need explicit evidence
  in review (not a silently-ticked box)".

- **Recommended action:** Marcar os critérios com a evidência ao lado (como foi feito no Global DoD), ou deixar explícito que os blocos de tarefa não são mantidos. Um plano com 24 critérios não marcados e um DoD global todo marcado não deixa o leitor saber qual dos dois é o registro.

### F-xval-12: Não existe PR. O critério é inverificável hoje, e o mapa que ele pede vive apenas na mensagem de `18017351`.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md` line 451
- **Plan reference:** T2.1 DoD — "Mapa largura→token completo no corpo do PR"
- **Evidence:**

  `gh pr list` não foi consultado por mim, mas o plano declara na linha 549 que o
  arquivamento está "bloqueado por desenho: só após `/review` READY_TO_MERGE **e**
  merge" — ou seja, o próprio plano reconhece que o PR ainda não passou.
  O mapa existe e está completo na mensagem de 18017351 ("treze usam o default e um
  (`graphrag`) usa `lg`"), o que satisfaz a substância.

- **Recommended action:** Copiar o mapa largura→token das mensagens de 59c4866b e 18017351 para o corpo do PR quando ele for aberto, e então marcar o critério.

### F-dom-6: Two production modals are not modelled by the guard because they never import Radix directly — they use `@usetheo/ui`'s `Dialog`. The guard's message ("Mais de um arquivo de produção compõe @radix-ui/react-dialog") is accurate; the plan's headline claim ("um primitivo de modal") is broader than what is enforced. Pre-existing (both files already imported `@usetheo/ui` at 43387f1e) and, per F-dom-5, no longer a rendering hazard — so LOW, recorded so the claim is not read as stronger than the gate.


- **Found by:** review-modal-primitive-consolidation-domain-frontend
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 49
- **Plan reference:** Global DoD — 'um primitivo de modal, e só um'
- **Domain anchor:** The guard quantifies over `from '@radix-ui/react-dialog'` importers, by its own stated design
- **Evidence:**

  dashboard/src/components/command/command-palette.tsx:2       import { Dialog } from '@usetheo/ui';
  dashboard/src/pages/infra/components/domain-troubleshoot-sheet.tsx:1  import { Card, Dialog } from '@usetheo/ui';
  Both identical at 43387f1e — not introduced by this branch.
  modal-primitive.test.ts:47-56 (HEAD), filter at :49 —
    .filter((f) => /from '@radix-ui\/react-dialog'/.test(readFileSync(f, 'utf8')))
  i.e. it quantifies over Radix importers only, by design; a modal built on the
  library's own Dialog is outside what it can see.

- **Recommended action:** Either extend the guard to also count `Dialog`/`Sheet` imported from `@usetheo/ui` in production files, or narrow the prose in the plan/DoD to what the guard actually asserts. Do not silently leave the two readings apart.


### F-tests-6: redeploy-dialog nao tem o caso `open={false}` (nada renderiza), que o plano lista como caso (b).

- **Found by:** review-modal-primitive-consolidation-tests
- **File:** `dashboard/src/components/dialogs/redeploy-dialog.test.tsx` line 52
- **Plan reference:** T1.1 § Acceptance Criteria — 'Cada um dos 3 componentes tem ao menos os 4 casos descritos'
- **Evidence:**

  redeploy-dialog.test.tsx:30-46  `renderDialog()` fixa `open` como literal — nao ha
    parametro de abertura e nenhum dos 5 casos renderiza fechado.
  Comparacao: confirm-dialog.test.tsx:33 'omits content when open=false';
              plan-limit-upgrade-modal.test.tsx:12 'test_closed_by_default'.
  O AC do plano fala em "ao menos os 4 casos descritos" para os TRES componentes.

- **Recommended action:** Um caso de 3 linhas: renderizar com open={false} e asserir queryByRole('dialog') nulo.

### F-tests-7: Dos tres caminhos de saida que o proprio primitivo documenta (ESC / overlay / X), o clique no overlay nao tem teste — nem no primitivo, nem na rede nova.

- **Found by:** review-modal-primitive-consolidation-tests
- **File:** `dashboard/src/components/ui/app-modal.test.tsx` line 78
- **Plan reference:** T1.1 § Deep Dives — 'Por que ESC importa aqui... é delegado ao Radix pelos dois primitivos'
- **Evidence:**

  app-modal.tsx:22   "Controlled only: pass `open` + `onClose`. All exits (ESC / overlay / X) call `onClose`."
  app-modal.tsx:37   "Called on every close path (ESC / overlay / close button)."
  app-modal.test.tsx:78  ESC coberto
  app-modal.test.tsx:89  botao X coberto
  overlay: nenhum caso. `grep -n 'overlay\|Overlay' app-modal.test.tsx` -> vazio.
  A rede nova (confirm/redeploy/plan-limit) tambem cobre so ESC e X.

- **Recommended action:** Um caso no primitivo (fireEvent.pointerDown fora do content, ou o `onPointerDownOutside` do Radix) fecha a terceira porta. Risco baixo porque as tres saem do mesmo `onOpenChange` (app-modal.tsx:69-71), mas o contrato escrito promete tres e prova duas.

### F-tests-8: O guard resolve os `id` de `<form>` por ARQUIVO, nao por modal — num arquivo com varios modais, um submit apontando para o form de OUTRO modal passa.

- **Found by:** review-modal-primitive-consolidation-tests
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 134
- **Plan reference:** Global DoD § 'A revisão visual' — o guard como quantificação sobre TODO arquivo de produção
- **Evidence:**

  modal-primitive.test.ts:134
    const ids = new Set([...src.matchAll(/<form[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
  O conjunto e do arquivo inteiro; a validacao em l.158 (`!ids.has(alvo)`) nao amarra o
  form a MESMA arvore do `<AppModal>` cujo footer contem o botao.
  Arquivo real com 4 modais no mesmo arquivo: pages/settings/components/api-key-dialogs.tsx
    l.158 AppModal (CreateApiKeyDialog, form `create-api-key-form` em l.179)
    l.308 AppModal (RevealedSecretDialog, sem form)
  Nao ha defeito hoje — so um form existe ali. E um falso negativo latente, e vale
  registrar porque o proprio guard nasceu de "medir o ARQUIVO em vez do CONSTRUTO"
  (comentario em l.141-144) e este ponto ainda mede o arquivo.

- **Recommended action:** Restringir os `id` candidatos a regiao do mesmo `<AppModal …>` (mesma varredura de chaves balanceadas ja usada para o `footer={…}`), em vez do arquivo inteiro.

### F-wire-3: The primitive's own test suite covers the footer slot only as "footer content renders". The dangerous property that footer is rendered OUTSIDE the children container — the defect the plan itself calls the most expensive of the migration — is never asserted in the primitive that causes it.


- **Found by:** review-modal-primitive-consolidation-wiring
- **File:** `dashboard/src/components/ui/app-modal.test.tsx` line 60
- **Plan reference:** Global DoD — "o defeito mais caro desta migração" (submit outside the form)
- **Evidence:**

  app-modal.test.tsx declares 9 cases (L19-L103): title/body, open=false, size xl, size
  default, footer slot, description, ESC, X click, hideCloseButton. The footer case is
  L60-L62 and asserts only that `<button>Create folder</button>` renders.
  Where the contract IS proven: statically for all 12 call sites by
  modal-primitive.test.ts L119-L177 (text scan), and at runtime by exactly 2 call-site
  tests (V-3). So the primitive's most failure-prone design decision is guarded
  everywhere except in the primitive.
  Coverage of the call sites is also uneven — 4 of the 12 footer-submit files have no
  co-located test at all and rest solely on the static guard:
    pages/deploy/components/promote-to-production-dialog.tsx
    pages/infra/components/add-domain-sheet.tsx
    pages/lens/traces/saved-views.tsx
    pages/settings/components/api-key-dialogs.tsx

- **Recommended action:** Add one case to app-modal.test.tsx: render an AppModal whose children hold `<form id="x" onSubmit={spy}>` and whose footer holds `<Button type="submit" form="x">`, click it, assert the spy fired. It pins the contract at the primitive, in ~8 lines, and would fail if the portal or the footer placement were ever restructured in a way the text scan cannot see.


### F-wire-4: Stale file:line citation — the comment points at `promptly-api.ts:23` for `CATALOG_QUERY_KEY`, which that commit deleted. Line 23 of that file is now blank.


- **Found by:** review-modal-primitive-consolidation-wiring
- **File:** `dashboard/src/lib/api/query-keys.ts` line 143
- **Plan reference:** commit 26c7976b — removal of the six dead exports
- **Evidence:**

  query-keys.ts:142-143:
    // B-052 — promptly era o unico dos tres com UMA chave declarada
    // (`CATALOG_QUERY_KEY`, promptly-api.ts:23) e o resto escrito a mao nas telas.
  promptly-api.ts:23 is now an empty line (see F-wire-1). The prose is in the past tense
  and remains true as history; only the pointer is dead.
  Same class in src/lib/data-access-layer.test.ts:96, which describes promptly as having
  "UMA chave local (`CATALOG_QUERY_KEY`)" in the present tense — that sentence is now
  false, though the constant it feeds (DOMINIOS_COM_API_PARCIAL, L98) is unaffected.

- **Recommended action:** Drop the ":23" from the citation, or point it at src/lib/api/query-keys.ts where the key now lives. Fix the tense in data-access-layer.test.ts:96 in the same pass.


### F-wire-6: Harness defect surfaced while filing this report: the consolidator reads only `*.yml`, but this agent was instructed to write `wiring.yaml`. An agent that followed the instruction literally would have its entire findings file silently dropped from the consolidated review.


- **Found by:** review-modal-primitive-consolidation-wiring
- **File:** `.claude/skills/review/scripts/consolidate_findings.py` line 247
- **Plan reference:** cycle-review — per-agent findings consolidation
- **Evidence:**

  consolidate_findings.py:247 — `for yml_path in sorted(args.findings_dir.glob("*.yml")):`
  The agent definition at
  .claude/agents/review-modal-primitive-consolidation-2026-08-10/wiring.md:77 says
  `findings/wiring.yml`; the dispatching instruction for this run said
  `findings/wiring.yaml`. The two disagree, and only one of them is read.
  Mitigation applied here: I wrote BOTH paths with identical content. Because the glob
  matches only `.yml`, this does not double-count today — but it would the moment the
  glob is widened to `*.y*ml`.
  This is not hypothetical. Listing the findings dir at 22:36 during this very review
  run shows a sibling agent already caught by it:
    architecture.yaml    architecture.yml     (both -> will be read)
    tests.yaml           tests.yml            (both -> will be read)
    domain-frontend.yaml (NO .yml twin        -> will be SILENTLY DROPPED)
    wiring.yaml          wiring.yml           (both -> will be read)
  So the consolidated review for this plan is, as things stand, missing the entire
  domain-frontend agent's findings, and nothing in the pipeline reports the omission.

- **Recommended action:** Widen the glob to `*.y*ml` AND de-duplicate by agent name, or fix the dispatch text to say `.yml`. A consolidator that silently skips an unreadable/unmatched agent file is the meta-defect class cycle-judge-codex `:final` exists to catch.



## INFO findings (6)

### F-arch-6: Dependency direction — no issues found. No ascending edge was introduced; every migrated module imports strictly downward, and the consolidation removes a peer from the primitive layer rather than adding one.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/components/dialogs/confirm-dialog.tsx` line 18
- **Plan reference:** Baseline Context § Architecture boundaries affected
- **Evidence:**

  Measured, not assumed:
  ```
  grep -rnE "from '(@/pages|\.\./.*pages)" --include='*.ts' --include='*.tsx' \
       dashboard/src/{components,hooks,lib}   →  0 matches
  ```
  The three shared modals import only downward or sideways-within-layer:
  `confirm-dialog.tsx:18` → `@/components/ui/app-modal`;
  `redeploy-dialog.tsx:6-9` → `ui/app-modal`, `ui/alert-guard`, `hooks/mutations/use-redeploy`,
  `lib/api/types`.
  `app-modal.tsx:1-4` imports only `react`, `@radix-ui/react-dialog`, `lucide-react`,
  `tailwind-merge` — a true leaf, so no cycle is reachable through the primitive.
  The eslint layer bans (`eslint.config.js:157-179`, B-070) still apply unchanged to every
  file touched, and `dashboard/eslint.config.js` was modified in this range only to add
  Node globals for `scripts/**` and to lower two entries of the LoC ratchet.


### F-arch-7: Fan-in — no issues found, and the generic >5-importer heuristic is reported here as NOT applicable rather than mechanically flagged. `AppModal` now has 30 production importers; for a UI primitive that number IS the objective of the plan, not a god-object signal.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/components/ui/app-modal.tsx` line 55
- **Plan reference:** Goal · Coverage Matrix row 2 (4 portas de entrada → 1)
- **Evidence:**

  ```
  grep -rl "components/ui/app-modal" dashboard/src --include='*.ts*' | grep -v '\.test\.' | wc -l  → 30
  ```
  `app-modal.tsx` is 104 LoC, exports one component plus its props/size types, holds no
  state, performs no I/O, and has a single reason to change (how a centered modal is
  composed). High fan-in on a leaf with one responsibility is centralization, which is what
  SRP and § 3 of `rules/architecture.md` ask for — a second primitive with 17 importers was
  the defect.


### F-arch-8: Naming and module hygiene — no issues found across the changed set. Files kebab-case, components PascalCase, size tokens UPPER_SNAKE (`SIZE_MAX_WIDTH`), ES modules only, and the diff introduces no `any` and no `console.log`.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 34
- **Plan reference:** Global DoD
- **Evidence:**

  ```
  git diff 59c4866b~1..HEAD -- dashboard/src | grep -nE '^\+.*(: any|console\.log)'  → no matches
  ```
  New file is `components/ui/modal-primitive.test.ts` (kebab-case, `<name>.test.<ext>` per
  `rules/architecture.md § 5` and the repo's co-located convention);
  `app-modal.tsx:27` `const SIZE_MAX_WIDTH: Record<AppModalSize, string>`;
  `app-modal.tsx:55` `export function AppModal(`.
  Parsimony ladder (`rules/parsimony-ladder.md`): rung 4 was honoured — the migration adds no
  dependency and consolidates onto what was already installed (plan § Dependencies), and
  rung 1 is what deleting the second primitive implements.


### F-arch-9: Diff cohesion — commit 26c7976b edits six symbols in `hooks/` and `lib/http/` that appear in no task of this plan. Recorded as INFO, not as scope creep: the edit was forced by a `/code-quality` FAIL_HARD on the current tree, and the commit message declares the deviation and the reasoning instead of hiding it.

- **Found by:** review-modal-primitive-consolidation-architecture
- **File:** `dashboard/src/lib/http/list-ceiling.ts` line 1
- **Plan reference:** Baseline Context § Files that will be touched (does not list these files)
- **Evidence:**

  Files outside the plan's touch table, changed in 26c7976b:
  `hooks/lens/use-datasets.ts`, `hooks/lens/use-trace.ts`, `hooks/promptly/promptly-api.ts`,
  `hooks/promptly/use-promptly.ts`, `hooks/rag/use-collections.ts`,
  `lib/http/list-ceiling.ts`.
  The commit body states the cause and separates the three natures of the finding:
  "/code-quality reprovou FAIL_HARD com `dead_code_unallowlisted_typescript`. Nenhum dos seis
  vem do plano de modais — sao residuo do trabalho anterior da camada de dados".
  Architecturally the change is subtractive and direction-preserving (three constants lost
  only the `export` keyword and remain used in-file), so it opens no boundary.


### F-xval-13: CONFIRMADO E JÁ REMEDIADO. Medi independentemente que a migração muda o espaçamento interno de 16 dos 17 modais (`gap-3` → `gap-4`), contradizendo o D4 original. O commit `3074fb05` — que entrou durante esta revisão, a partir do review de arquitetura — emendou D4 e corrigiu o CHANGELOG. Registro como corroboração independente, não como achado aberto.

- **Found by:** review-modal-primitive-consolidation-cross-validation
- **File:** `dashboard/src/components/ui/app-modal.tsx` line 77
- **Plan reference:** D4 — antes da emenda: "A migração preserva aparência"; Alternatives considered rejeitava "uniformizar espaçamento interno"
- **Evidence:**

  Primitivo removido (git show 18017351^:dashboard/src/components/ui/dialog.tsx:37):
    'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg
     -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden …'
  
  Primitivo que fica (dashboard/src/components/ui/app-modal.tsx:77):
    'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)]
     -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden …'
  
  Único call site que já anulava a diferença, pré-migração
  (git show 59c4866b^:dashboard/src/components/dialogs/confirm-dialog.tsx:80):
    <Dialog.Content className="max-w-md gap-4">
  Os outros 16 herdavam `gap-3`.
  
  As demais regiões são idênticas byte a byte entre os dois primitivos — header
  `flex flex-col gap-1.5 pr-6`, corpo `min-h-0 flex-1 overflow-y-auto`, rodapé
  `flex items-center justify-end gap-2`, overlay `fixed inset-0 z-50 bg-black/60
  backdrop-blur-sm animate-fade-in`. A divergência é exclusivamente o `gap` do
  container.
  
  Estado em HEAD: plano linha 175 ("D4 — Paridade de LARGURA, e convergência
  declarada de espaçamento") e CHANGELOG.md:29 ("**O espaçamento interno mudou em
  dezesseis deles**") já descrevem o fato.

- **Recommended action:** Nenhuma. Fica registrado que o defeito foi encontrado por duas vias independentes (arquitetura e cross-validation) e que a amostra visual do DoD não o pegou — o que sustenta F-xval-3.

### F-wire-5: The guard that now stands in for the visual review is a filesystem scanner, so it inherits the B-099 concurrent-mutation flake class. It failed in my first full-suite run and passed in the second. Environment, not product — recorded rather than resolved toward the more interesting explanation.


- **Found by:** review-modal-primitive-consolidation-wiring
- **File:** `dashboard/src/components/ui/modal-primitive.test.ts` line 45
- **Plan reference:** Plan § "O que a amostra NÃO cobriu" — the guard that replaced the visual sample review

- **Evidence:**

  Run 1 (22:23:21, 183s): "Test Files 1 failed | 326 passed", the failure being
  modal-primitive.test.ts § "só o `app-modal` compõe o Radix dialog" at the
  `.toEqual([PRIMITIVO])` assertion. The same run printed the B-099 detector warning
  "`src/` MUDOU DURANTE A EXECUÇÃO DA SUÍTE", naming 5 files including 3 AppModal call
  sites (confirm-dialog.tsx, plan-limit-upgrade-modal.tsx, redeploy-dialog.tsx,
  promote-to-production-dialog.tsx, wiki-search.tsx).
  Corroboration that the mutation was real and external: `stat` shows those 5 files with
  mtimes of 22:24:43-22:26:23, inside the run window, while `git status --porcelain` is
  clean — i.e. rewritten with byte-identical content mid-run.
  Run 2 (immediately after, tree quiet): 327/327 files, 2760/2760 tests, no warning, all
  4 modal-primitive cases green. In isolation the file also passes (4/4, 1.17s).
  Honest attribution: most likely a sibling agent of this same /review run touching the
  tree; I did not observe the writer, so I am not claiming which. Nothing in the repo
  writes to src/ during tests (the only test writer, env-terminology.test.ts:97, writes
  to /tmp). The detector did its job — it named the cause instead of leaving an
  unresolvable import error.

- **Recommended action:** No product change. If CI ever runs the suite on a tree that something else can touch, have the guard snapshot the file list once (or read via `git ls-files`) rather than stat-walking live. On CI's clean checkout the mechanism does not occur, as the B-099 module already documents.



## Handoff decision

Implementation has BLOCKER and/or > 2 HIGH findings. Loop back to `/implement` to address.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-modal-primitive-consolidation-2026-08-10/review-modal-primitive-consolidation-architecture.md`
- `.claude/agents/review-modal-primitive-consolidation-2026-08-10/review-modal-primitive-consolidation-cross-validation.md`
- `.claude/agents/review-modal-primitive-consolidation-2026-08-10/review-modal-primitive-consolidation-domain-frontend.md`
- `.claude/agents/review-modal-primitive-consolidation-2026-08-10/review-modal-primitive-consolidation-tests.md`
- `.claude/agents/review-modal-primitive-consolidation-2026-08-10/review-modal-primitive-consolidation-wiring.md`


---

## § Re-verificação dirigida (2026-08-10, pós-correções)

Os agentes mediram o estado de antes. Estas são as correções aplicadas depois, cada uma
verificada por asserção executável sobre o estado atual, não por afirmação minha.

| Achado | Sev | O que estava errado | O que fechou | Verificado por |
|---|---|---|---|---|
| `F-xval-1` | **BLOCKER** | O plano afirmava, em 4 lugares, um modal `max-w-sm` em `memory/skills.tsx`. Medido em `18017351^`: `:200` é um `<div>` de layout; o modal, em `:262`, não declara largura | `D3` **retratado** com a medição (não apagado); as 4 linhas derivadas marcadas | `"RETRATADO: o max-w-sm não é de um modal" in plano` |
| `F-xval-2` | HIGH | Coverage Matrix célula 5 mapeava T2.1 a um requisito inexistente; "7/7 (100%)" contava uma lacuna fantasma | Célula marcada **LACUNA FANTASMA**; cobertura real declarada **6/6**; a linha fica para que a contagem inflada não suma sem registro | `"LACUNA FANTASMA" and "**6/6**" in plano` |
| `F-xval-3` | HIGH | O critério da revisão visual foi **reescrito** (`a8124007`) e depois marcado `[x]` — alvo movido | Texto **original restaurado**, veredito **NÃO CUMPRIDO**, com o que ocupou o lugar descrito como outra coisa | `"cada modal migrado foi aberto e comparado" and "NÃO CUMPRIDO" in plano` |
| `F-xval-14` | HIGH | A emenda do `D4` (`3074fb05` — **meu** commit) apagou 4 seções por acidente, duas delas obrigatórias pelo template | As 4 restauradas; Q1/Q2/Q3 voltam **com as respostas** que a implementação deu | as 4 âncoras presentes |
| `F-dom-1` | HIGH | O transformer usou `getText()` (que come trivia) e colou 4 espaços JSX-significativos: `"Promote abcdef1to production"` era o nome acessível real | 4 espaços restaurados | `not re.search(r"</span>(?=[a-z])", …)` sobre os 3 arquivos |
| `F-tests-1` | HIGH | O guard ancorava em `src.includes('<AppModal')`: `import { AppModal as Modal }` fazia 4/4 passar **com o `form=` removido**. E não tinha piso de não-vacuidade | Resolve o nome local pelo **import**; piso `toBeGreaterThanOrEqual(20)` nos dois casos quantificados | `"nomeLocalDoPrimitivo" and "toBeGreaterThanOrEqual(20)" in guard` |

### Outros achados fechados no mesmo passo

| Achado | O que fechou |
|---|---|
| `F-wire-6` (meta-defeito) | `consolidate_findings.py:247` lia só `*.yml`. `domain-frontend.yaml` e `cross-validation.yaml` **não tinham gêmeo** e teriam sido descartados **em silêncio** — o HIGH do espaço em branco e o pilar inteiro de cross-validation. Corrigido para ler as duas extensões, dedup por stem, ordem determinística. **Este relatório é o primeiro que lê os 5 agentes.** |
| `F-wire-1` | Doc órfão de `CATALOG_QUERY_KEY` removido em `hooks/promptly/promptly-api.ts` |
| `F-arch-1/2` | A restrição do `footer` (irmão dos children → submit fora do form) agora está documentada **na prop**, onde quem a usa lê, e não só no teste |
| `F-dom-5` | O rationale Rule-9 citava `@usetheo/ui@0.28.2`. Medido no instalado `0.35.1`: existe `primitives/dialog/` próprio, e o bundle tem painel centralizado **e** sheet lateral separados — **o bug não existe mais**. O comentário passa a dizer o que sustenta o primitivo local hoje (a escala), e registra "adotar o upstream" como pergunta separada em vez de decidi-la dentro de um plano de consolidação |
| tests: lacuna de submit | `promote-to-production-dialog.test.tsx` (**NOVO** — nenhum teste renderizava o componente) e um caso em `rollback-dialog.test.tsx`. Ambos **sondados**: remover o `form=` faz falhar |
| xval: `implementations/` vazio | `implementations/modal-primitive-consolidation-implementation.md` escrito, declarando no topo que foi reconstruído depois e que isso não é o mesmo que tê-lo produzido durante |

### Followups REGISTRADOS (não mencionados em prosa)

O gate do `READY_TO_MERGE_WITH_FOLLOWUPS` exige que o débito reconhecido seja um item
registrado, nunca uma frase num relatório: *"um caveat que ninguém possui é um defeito com
modos melhores"*. Os dois achados abertos que sobrevivem a este ciclo:

| Item | Achado | Por que não foi corrigido aqui |
|---|---|---|
| **`B-104`** | `F-dom-4` — 13 call sites aninham bloco dentro do `<p>` do `RadixDialog.Description`, quebrando o `aria-describedby` | **Pré-existente**, medido em `59c4866b~1`: os call sites já passavam bloco antes, via `ConfirmDialog`. A consolidação só tornou visível. Corrigir aqui misturaria migração com correção de acessibilidade — exatamente o que torna impossível dizer depois se uma diferença é bug de migração ou decisão |
| **`B-105`** | `F-tests-5` — `ConfirmDialog` (29 consumidores) fecha só no sucesso, e a regra não tem teste | Comportamento correto e não coberto. Sobreviveu à troca de primitivo por leitura, não por medição |

Fechado neste ciclo em vez de registrado: **`F-wire-2`** — `tailwind-merge` era usada pelo
único primitivo de modal do dashboard e **não estava declarada** no `package.json`; vinha
transitivamente de `@theokit/ui` e `@usetheo/ui`. Qualquer um dos dois largando a
dependência quebraria o build. É uma linha, no artefato que este plano possui, e o risco é
de cadeia de suprimentos — não é débito a agendar.

### O que esta re-verificação NÃO cobre — e por quê o veredito não vira verde sozinho

- **Ela é dirigida ao BLOCKER e aos 5 HIGH.** Os 18 MEDIUM e 13 LOW não foram re-medidos um a um. Vários são reais e continuam abertos (T1.1/T1.2 colapsados num commit; scope creep não declarado em `26c7976b`/`4e48b7fb`; 24 checkboxes de tarefa em `[ ]` com o DoD global marcado).
- **Ela verifica asserções, não julgamento.** Um `grep` prova que o texto certo está lá; não prova que a decisão que ele descreve é boa.
- **Ninguém re-rodou os 5 agentes.** Isso é o que fecharia o ciclo de verdade, e custa o que custa.
- **Aparência renderizada continua sem cobertura** — 11 dos 14 modais nunca foram abertos, e o critério agora diz isso em vez de se marcar cumprido.

**Veredito sucessor: `READY_TO_MERGE_WITH_FOLLOWUPS`.** Sem BLOCKER (fechado e verificado);
os 5 HIGH fechados e verificados; o débito restante é MEDIUM/LOW, real, nomeado acima e
registrado. Per `cycle-review.md`, esse é exatamente o caso que este token existe para
descrever — em vez de esticar `READY_TO_MERGE` sobre débito reconhecido, ou de alegar
`NEEDS_FIXES` quando o trabalho bloqueante está demonstravelmente fechado.
