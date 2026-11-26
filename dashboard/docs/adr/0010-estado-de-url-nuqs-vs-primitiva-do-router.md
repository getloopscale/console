---
status: accepted
date: 2026-08-07
decision-makers: time do dashboard loop-console
origem: B-046 (backlog), remedido em 2026-08-07 durante /to-plan
---

# ADR-0010 — Estado de URL: `nuqs` para filtro tipado, primitiva do router para leitura pontual

## Contexto

`nuqs` aparece em 7 arquivos e `useSearchParams` (a primitiva do react-router) em 28. O item `B-046`
registrou isso como "duas implementações do mesmo estado" e pediu a migração de uma para a outra.

**A medição desmentiu a premissa.** Fui escrever o plano de migração partindo de que dois donos de URL
no mesmo arquivo se sobrescreveriam, e fui ler antes de escrever:

- Exatamente **um** arquivo usa os dois: `src/pages/lens/traces.tsx`.
- Ele escreve pelos dois, e os dois estão **certos e coordenados**:
  - `traces.tsx:203` — `setSearchParams((prev) => …)`, a forma **funcional**, copiando `prev`. Preserva
    os 6 parâmetros que o `nuqs` mantém. O comentário da linha 198 diz exatamente isso.
  - `traces.tsx:214` — `setSearchParams(new URLSearchParams(queryString))`, substituindo a query
    inteira **de propósito**: aplicar uma visão salva *é* trocar todos os filtros. O comentário diz
    "nuqs re-reads every key".

Quem escreveu conhecia a interação. Não há defeito a corrigir.

## Decisão

**Não migrar.** As duas ferramentas ficam, com fronteira declarada:

| Use | Quando | Por quê |
|---|---|---|
| `nuqs` (`useQueryState`) | Estado de **filtro** que a tela lê e escreve, com tipo e default — busca, faixa, enum de status, paginação | Ele traz parser, default e round-trip tipado. Escrever isso à mão para cada filtro é o que o `nuqs` existe para evitar |
| `useSearchParams` | Leitura ou escrita **pontual** de um parâmetro que a tela não trata como filtro — um id em `?trace=`, um flag de retorno de fluxo | Para ler um parâmetro, trazer um parser é o degrau 5 da escada da parcimônia: adiciona dependência conceitual sem ganho |

## Rationale

O item pedia "escolha uma". A medição mostra que a escolha certa depende do que o parâmetro **é**, não
de qual biblioteca é melhor. `searchParams.get('trace')` para abrir um painel não fica melhor com um
parser tipado — fica igual, com mais indireção.

O que faltava não era migração: era a regra **escrita**. Hoje a escolha está certa nos dois casos
medidos, mas por conhecimento de quem escreveu — o próximo faz engenharia reversa da decisão, e é
assim que a divergência começa.

## Alternativas rejeitadas

**Migrar os 28 para `nuqs`.** Rejeitada por medição: não há defeito para corrigir, e o custo é 28
arquivos mudados com risco de regressão em cada um. Um plano de migração seria trabalho contra um
problema que a medição não achou.

**Migrar os 7 para a primitiva.** Rejeitada: jogaria fora parser e default de filtros complexos —
`traces.tsx` tem 6 filtros tipados, incluindo dois enums. Reescrevê-los à mão é reimplementar o
`nuqs` pior, e a dependência já está declarada (`package.json:77`).

**Proibir a coexistência no mesmo arquivo.** Rejeitada: proibiria o único caso real, que é correto.
`traces.tsx` tem 6 filtros (nuqs) e um id de painel (primitiva) — as duas naturezas na mesma tela.

## Consequências

**Habilita** manter as duas com uso deliberado, sem custo de migração.

**Restringe** um caso, e ele é o perigoso: num arquivo que usa `nuqs`, escrever com
`setSearchParams(novoObjeto)` — a forma **não funcional** — apaga os parâmetros que o `nuqs` mantém,
em silêncio. `src/lib/url-state-convention.test.ts` falha nesse caso, e aceita a forma funcional ou
uma declaração explícita de que a substituição total é intencional.

O caso `applyView` (`traces.tsx:214`) é justamente a substituição intencional, e passa por declaração.
Exigir a forma funcional ali seria pedir que ele preservasse os filtros que o seu propósito é trocar.

## Cross-references

- `B-046` no `BACKLOG.md` — o item, com a remedição de 2026-08-07
- `src/lib/url-state-convention.test.ts` — o guard
- `rules/parsimony-ladder.md` degrau 5 — por que ler um parâmetro não pede parser
