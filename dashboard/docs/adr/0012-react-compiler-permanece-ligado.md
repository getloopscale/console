---
status: accepted
date: 2026-08-08
decision-makers: time do dashboard loop-console
origem: B-075 (backlog) — medido em 2026-08-08
---

# ADR-0012 — O React Compiler permanece ligado, com o custo medido

## Contexto

`vite.config.ts` roda `babel-plugin-react-compiler` em todo o build desde T0.2. O
item `B-075` pergunta se ele deve continuar ligado, e o comentário do próprio
config afirmava **"build-time only, zero runtime overhead"** — uma afirmação sem
número, que é exatamente o tipo de coisa que sobrevive por anos sem ninguém
conferir.

## Medição (2026-08-08)

| | com | sem | delta |
|---|---|---|---|
| Componentes memoizados | **170 de 207** `.tsx` | — | — |
| `TOTAL EAGER` (brotli) | 306,47 kB | 301,00 kB | **+5,5 kB** |
| Tempo de build | 34,0 s | 22,7 s | **+50%** |

Como foi medido: o `babel-plugin-react-compiler` foi rodado sobre cada `.tsx` de
`src/` procurando `useMemoCache`/`_c(` na saída (a marca da memoização emitida);
o bundle e o tempo, com dois builds completos, ligando e desligando o plugin.

**A afirmação de "zero runtime overhead" estava errada.** Há 5,5 kB de código de
memoização emitido nos componentes, no chunk eager. O que não existe é
dependência de runtime: `react-compiler-runtime` não está no `package.json`, e o
helper `useMemoCache` vem do próprio React 19.

## Decisão

**Permanece ligado.** O comentário do config foi corrigido para carregar os
números em vez da afirmação.

## Rationale

170 de 207 componentes memoizados é cobertura real — o plugin não é enfeite. Essa
era a hipótese que motivava desligá-lo ("custo sem retorno"), e a medição a
desmente.

O custo é conhecido e cabe: 5,5 kB contra um teto de 320 kB, com 13,5 kB de folga
sobrando. Os 50% de build são pagos por quem constrói, não por quem usa.

E há um custo de reverter que não aparece na tabela: 170 componentes deixariam de
ser memoizados de uma vez. Recuperar isso à mão exigiria decidir, componente a
componente, onde pôr `useMemo`/`memo()` — e a literatura do próprio React
desaconselha essa memoização manual difusa justamente porque ela erra mais do
que acerta.

## Alternativas rejeitadas

**Desligar.** Rejeitada pela medição: devolveria 5,5 kB e 11 s de build ao custo
de perder memoização em 170 componentes. A troca não fecha.

**Ligar só em produção.** Rejeitada: o desenvolvimento passaria a exercitar um
código diferente do que se publica, e a classe de bug que isso cria (o que
funciona no dev e quebra no build) é mais cara que 11 s de build.

**Ligar por diretório.** Rejeitada por YAGNI (`parsimony-ladder.md` degrau 1): não
há medição mostrando que os 5,5 kB se concentram numa parte do código, e sem essa
medição a seleção seria arbitrária.

## Consequências

**Habilita** escrever componentes sem memoização manual, que é o motivo de o
plugin existir.

**Restringe** o orçamento de bundle em 5,5 kB permanentes. Se o `TOTAL EAGER`
chegar perto do teto de 320 kB, este plugin é um suspeito **legítimo** — e agora
com número, em vez do "zero" que faria alguém descartá-lo da lista sem medir.

## Cross-references

- `B-075` no `BACKLOG.md` — o item, com a medição
- `vite.config.ts` — os números moram no comentário, junto da configuração
- `rules/parsimony-ladder.md` — degrau 1, aplicado à alternativa de ligar por diretório
