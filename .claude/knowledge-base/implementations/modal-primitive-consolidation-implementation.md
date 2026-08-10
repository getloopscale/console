# Implementação: modal-primitive-consolidation

**Plano:** `.claude/knowledge-base/plans/modal-primitive-consolidation-plan.md`
**Branch:** `workspace`
**Data:** 2026-08-09 → 2026-08-10

> **Escrito depois, e o registro diz isso.** O halt-loop do `/implement` não rodou nesta
> fatia — a migração foi conduzida direto, e nem o `.progress-{slug}.json` nem os logs por
> iteração existem. O agente de cross-validation do `/review` mediu a ausência
> (`knowledge-base/implementations/` vazio → 5 SKIPs na validação, incluindo `wiring_triad`)
> e é por isso que este arquivo existe.
>
> Reconstruir o registro depois **não é o mesmo** que tê-lo produzido durante. O que segue é
> reconstruído do git e de medições feitas agora; onde a evidência não existe, está dito que
> não existe, em vez de preenchido.

## O que mudou

Dois wrappers locais de `@radix-ui/react-dialog` coexistiam:

| | `ui/dialog.tsx` | `ui/app-modal.tsx` |
|---|---|---|
| API | composta (`Dialog.Root/Content/Header/…`) | declarativa (`<AppModal size=… />`) |
| Largura | `max-w-lg` fixo + `className` por call site | escala de tokens `sm`/`md`/`lg`/`xl` |
| Espaçamento | `gap-3` | `gap-4` |
| Call sites | 17 | 13 |
| Doc-comment | — | *"the system-wide standardized modal primitive"* |

O que se declarava padrão era o menos usado. **`ui/dialog.tsx` foi deletado**; os 17 call
sites migraram; exatamente um arquivo de produção compõe o Radix dialog hoje.

## Commits

| SHA | O quê |
|---|---|
| `59c4866b` | Os 3 modais compartilhados adotam o `AppModal` (Fase 1) |
| `18017351` | Os call sites de página (Fase 2) |
| `26c7976b`, `4e48b7fb` | Deleção do primitivo + limpeza que o `knip` acusou |
| `a8124007` | Critérios de aceite e DoD |
| `3074fb05` | Emenda do D4 pela medição do `gap` |
| (não commitado no momento deste registro) | guard, testes de submit, correções de espaço em branco, retratação do D3 |

## Os três defeitos que a implementação encontrou, e como

**1. Submit fora do form — o mais caro.** O `AppModal` renderiza `footer` como IRMÃO dos
children. Um `type="submit"` movido para lá sai do `<form>` do corpo: **a tela renderiza
idêntica e o clique não faz nada.** Numa confirmação destrutiva é o pior modo de falha
possível, porque não há erro para ver.

Pego por `delete-environment-dialog.test.tsx` ("Number of calls: 0"), não por revisão.
Resolvido com o atributo nativo `form="id"` — idioma que `create-project-sheet.tsx` **já
usava** antes desta migração (ladder de parcimônia, degrau 3: a plataforma já resolvia).

Hoje é quantificado por `modal-primitive.test.ts`, sobre TODO call site, validado por sonda
(remover um `form=` faz falhar).

**2. `gap-3` → `gap-4`.** Os dois primitivos tinham espaçamentos diferentes; trocar um pelo
outro muda o espaçamento **por construção**. O `D4` original afirmava paridade visual e
rejeitava uniformizar espaçamento — uma intenção correta e impossível de cumprir. Eu afirmei
paridade tendo medido **largura**. O review de arquitetura mediu o resto. `D4` emendado;
CHANGELOG corrigido; 16 modais ficam ~8 px mais altos, e isso é visível ao usuário.

**3. `max-w-sm` que não existia.** O `D3` decidia como tratar uma largura que **nenhum modal
declara**: o levantamento leu o ARQUIVO `pages/memory/skills.tsx` e atribuiu ao modal um
`max-w-sm` do `<div>` de layout da página. Retratado.

**Os três, e mais dois, são a mesma classe: medir o ARQUIVO em vez do CONSTRUTO.** O mesmo
erro pôs a escala de tokens do próprio `AppModal` na tabela de "larguras ad-hoc" do
levantamento, e fez o primeiro guard de rodapé acusar um `<form>` do corpo de uma página.
Cinco ocorrências. É a lição desta fatia, e está escrita nos comentários dos guards para que
sobreviva a este documento.

## Tríade de wiring

| Pilar | Estado |
|---|---|
| (a) Caller | **Sim** — 17 call sites de produção usam o `AppModal`; nenhum símbolo novo ficou sem chamador (`knip` limpo) |
| (b) Teste de integração | **Sim** — 31 casos em `components/dialogs/`, mais os co-locados de página; `promote-to-production` e `rollback` ganharam o caso de submit que faltava |
| (c) Métrica de runtime | **Não se aplica** — a fatia não acrescenta comportamento observável em produção; ela remove um primitivo. Não instrumentar é a decisão, e é declarada em vez de omitida |

## O que NÃO foi verificado

- **Aparência renderizada** — espaçamento e tipografia dos 11 modais que não foram abertos
  um a um. O `D4` declara a convergência de `gap`; o resto continua sem cobertura.
- **`wiring_triad` pelo script** — `run_validation.py` deu SKIP por ausência do
  `.progress-{slug}.json`. A tabela acima é medição manual, não saída de gate.

## Cross-references

- Plano: `plans/modal-primitive-consolidation-plan.md`
- Review: `reviews/modal-primitive-consolidation-review-2026-08-10.md`
- Guard: `dashboard/src/components/ui/modal-primitive.test.ts`
- Regra: `rules/cycle-implement.md`, `rules/parsimony-ladder.md`
