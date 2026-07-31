# Review — trust-guardrails-operation (M24)

Date: 2026-07-31
Plano: `.claude/knowledge-base/plans/trust-guardrails-operation-plan.md`
Commits auditados: `2da373b`, `a27d432..ab6d2f7`
Agentes: cross-validation (plano×implementação) + segurança/tenancy, em paralelo e independentes

## Veredito

**READY_TO_MERGE** — com um item do DoD explicitamente pendente de verificação em ambiente real (ver § Pendência declarada).

Os dois agentes convergiram, independentemente, no mesmo defeito central; ele foi corrigido em `ab6d2f7` e os testes que o teriam pego foram escritos. Nenhum BLOCKER permanece aberto.

## Achados e desfecho

| # | Achado | Severidade | Desfecho |
|---|---|---|---|
| 1 | **O código tipado do serviço morria no BFF.** `sendRaw` embutia status+corpo numa string de erro; `mutate` respondia `502` genérico. `422 INVALID_SPEC` chegava como "a camada de confiança recusou a operação" — o "erro genérico" que o DoD proíbe. Os ramos `VALIDATOR_NAME_RESERVED`/`CONFLICT` da tela eram inalcançáveis. **Os comentários de ambas as funções afirmavam o oposto do que o código fazia.** | BLOCKER | **CORRIGIDO** (`ab6d2f7`) — `trust.UpstreamError` estruturado; 4xx atravessa com status+corpo, 5xx e falha de transporte não; testes nos dois sentidos, incluindo um que falha se topologia interna vazar |
| 2 | **Testes exercitavam um contrato que o sistema não produzia** — mocks e dobres modelavam o `theo-trust`, pulando o BFF que de fato responde. 84 testes verdes sobre uma ficção. | BLOCKER | **RESOLVIDO pela correção de #1** — o BFF agora produz o contrato que os testes assumiam; a realidade foi alinhada aos testes, não o inverso |
| 3 | **Comentário falso sobre menor privilégio** — afirmava que o broker intersecta com os grants do chamador; na verdade cruza com a config estática do gateway, e o `want` é literal. Todo usuário autenticado recebe chave com `trust:delete`. | BLOCKER (cross-val) / HIGH (segurança) | **CORRIGIDO** — comentário reescrito dizendo a verdade. Não é regressão do M24: os BFFs irmãos (`lens`, `storage`) também são `requireJWT`-only, e RBAC multi-usuário está declarado **fora do escopo V1** no ROADMAP. A separação real — dois clientes, duas chaves — é verdadeira e testada |
| 4 | **Resolver de mutação sem teste algum** (o de leitura tinha três) — justamente o caminho que altera produção. | MEDIUM | **CORRIGIDO** — escopos exatos, fail-closed com zero cunhagem sem tenant, propagação de falha do broker |
| 5 | **`canSave` liberava o salvar sem veredito legível** quando `verdictSummary` devolvia `null`. | MEDIUM | **CORRIGIDO** — `canSave` exige o resumo |
| 6 | Tipagem estrutural permite passar o cliente de escrita ao handler de leitura (uma linha de wiring). | MEDIUM | **ACEITO** — não alcançável por atacante; é superfície de regressão futura. Registrado |
| 7 | O BFF repassa o corpo de auditoria íntegro; a redação é garantia do upstream. | LOW | **ACEITO e documentado** — o agente verificou no schema do `theo-trust` que a tabela **não tem coluna de conteúdo**; `enforcement-rows.ts` é defesa em profundidade genuína |
| 8 | Superfície do BFF usa `/guardrails` para mutação e `/validators` para leitura. | MEDIUM | **ACEITO** — inconsistência de nomenclatura, sem efeito funcional; renomear agora ampliaria o diff sem ganho |
| 9 | `app.tsx` / `app-sidebar.tsx` acima do teto de LoC. | LOW | **ACEITO** — risco R3 do plano, dívida pré-existente e declarada |

## Verificado sem achado (agente de segurança)

- **Isolamento por tenant** — tenant vem só do JWT; sem cache compartilhado; broker com chave `account\0tenant\0scopes` e singleflight na mesma chave; `queryClient.clear()` na troca de time.
- **Vazamento de conteúdo** — projeção por allowlist de sete campos nomeados, com teste que injeta `content`/`rawContent`/`message` e prova que não atravessam.
- **Path traversal** — testado **empiricamente** contra a rota chi real: `../validators` não casa a rota (404); formas percent-encoded chegam como literal e `url.PathEscape` as re-escapa. Dupla camada com `encodeURIComponent` no cliente.
- **CSRF** — não aplicável: auth é `Authorization: Bearer` de token em memória, não cookie ambiente.
- **Limites** — `?limit` capado em 200 no BFF, com defesa em profundidade no upstream (422 fora de 1..200) e corpo capado em 64 KiB.
- **Ação destrutiva** — frase verbatim, sem remoção otimista, botão `destructive`; testada inclusive a degradação por nome vazio.

## Pendência declarada

O item 7 do DoD — *"criar → testar → salvar → **bloquear de verdade pelo `/v1/guard`** → aparecer na auditoria, contra a instância implantada"* — **não está cumprido por teste automatizado**. O e2e roda hermético (mocks) e prova a jornada da interface; o cabeçalho do próprio spec declara isso. A metade que falta é verificação no ambiente real, e é o próximo passo do ciclo (deploy + validação no browser), não algo que um mock possa provar.

Enquanto essa evidência não existir, o milestone **não deve ser marcado `[x]`**.

## Gates

| Gate | Resultado |
|---|---|
| `go build ./...` | exit 0 |
| `go test ./...` | 15 pacotes, 0 falhas |
| `go test -race` (pacotes tocados) | ok |
| `npx tsc --noEmit` | limpo |
| `npx eslint` | 0 erros |
| `npx vitest run` (dashboard) | 257 arquivos, 2014 testes, 0 falhas |
| `playwright` (jornada) | 4/4 chromium |
| `knip` | nenhum export morto nos módulos do M24 |
