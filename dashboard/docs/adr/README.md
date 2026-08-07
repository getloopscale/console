# Decisões de arquitetura

Duas nomenclaturas convivem neste repositório, e confundi-las custa tempo de
quem lê. Este documento diz qual é qual e qual delas resolve.

## `ADR-000N` — os ADRs versionados. **Resolvem.**

Arquivos neste diretório: `0001-…` a `0009-…`. São a forma canônica. Toda
citação nova usa esta.

| ADR | Assunto |
|---|---|
| `ADR-0001` | Eixo de organização e regra de residência |
| `ADR-0002` | Orçamento de LoC por arquivo |
| `ADR-0003` | Split `@usetheo/ui` e `@theokit/ui` |
| `ADR-0004` | Service worker: requisito ou remoção |
| `ADR-0005` | Política de memoização com React Compiler |
| `ADR-0006` | Camada de acesso a dados e factory de query-key |
| `ADR-0007` | Modelo de consistência do estado de servidor |
| `ADR-0008` | ADRs versionados no repositório |
| `ADR-0009` | Autenticação dos streams SSE |

## `ADR D1`..`ADR D9` — decisões internas de planos. **Não resolvem, e não vão.**

234 comentários no código citam `ADR D1`..`ADR D9`. Elas são anteriores ao
`ADR-0008`, que foi justamente a decisão de versionar ADRs no repositório.

**Não são citações quebradas dos arquivos acima.** São referências à decisão
`D<n>` de um **plano específico** — a convenção do `/to-plan`, em que cada plano
numera as suas próprias decisões. `ADR D2` num arquivo e `ADR D2` noutro são, em
geral, decisões diferentes, de planos diferentes.

Isso tem duas consequências que vale escrever:

1. **Um mapa `D1..D9 → ADR-000N` é impossível**, não difícil. Não há função: o
   `D2` de um plano sobre a página de projetos não tem contrapartida no
   `ADR-0002`, que é sobre orçamento de LoC.
2. **Os planos citados não estão mais no disco.** Verificado em 2026-08-07:
   `2026-06-08-dashboard-screens-review-fixes`, `2026-05-27-backend-frontend-integration`,
   `2026-06-11-code-review-remediation` e `theo-memory-dashboard-full-integration`
   não existem em `.claude/knowledge-base/plans/`. Mesmo as 33 citações que
   nomeiam o plano não levam a lugar nenhum.

### Então o que fazer ao encontrar uma

Leia como **nota de proveniência**, não como referência: ela diz *"esta linha
existe porque uma decisão foi tomada"*, e não *"vá ler tal documento"*. O porquê,
quando importa, costuma estar no próprio comentário — é por isso que eles são
longos.

Reescrevê-las exigiria inventar conteúdo que ninguém pode recuperar, o que seria
pior que a ambiguidade: uma citação errada é mais convincente que uma citação que
não resolve.

### O que NÃO fazer

Acrescentar novas. `docs/adr/adr-nomenclature.test.ts` falha se a contagem de
`ADR D<n>` no código crescer. Ela só encolhe — naturalmente, à medida que os
arquivos que as carregam sejam reescritos por outros motivos.

## Escrevendo um ADR novo

Numere na sequência, use o formato dos existentes (contexto medido → decisão →
alternativas rejeitadas com o motivo) e cite-o como `ADR-000N`.
