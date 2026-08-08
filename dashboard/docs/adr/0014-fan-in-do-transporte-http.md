---
status: accepted
date: 2026-08-08
decision-makers: time do dashboard theo-cloud
origem: B-029 (backlog) — medido em 2026-08-08
---

# ADR-0014 — O fan-in de `lib/http/api.ts`, e por que a divisão prescrita não é a saída

## Contexto

`B-029` registra que `lib/http/api.ts` é inexcisável: **141 importadores** medidos
hoje (eram 151 quando o item foi aberto, antes do módulo descer para `lib/http/`),
espalhados por dezenas de diretórios, puxando mais de doze símbolos distintos.

O item prescreve a saída: *"separar por razão-de-mudar — mover o ciclo de vida do
token para um módulo próprio e manter o transporte no módulo de entrada"*.

A prescrição é razoável no papel. Ciclo de vida de token muda quando a
autenticação muda; transporte muda quando o contrato da API muda. São razões
diferentes, e o SRP diz para separá-las.

## O que a medição achou

Contando **quais símbolos cada importador puxa**, e não quantos importadores há:

| Grupo | Importadores |
|---|---|
| só símbolos de transporte (`cloudFetch`, `engineFetch`, `ApiError`, …) | **136** |
| só símbolos de sessão (`exchangeSessionToken`, `hasValidToken`, …) | **5** |
| ambos | **0** |

A divisão prescrita levaria o fan-in de **141 para 136**. Uma queda de 3,5%.

O fan-in não é causado pelo ciclo de vida do token estar misturado. Ele é causado
por **136 arquivos chamando o transporte diretamente** — e nenhum deles sairia de
lugar com a divisão.

## E o custo da divisão é de segurança

`accessToken` é uma variável de módulo, privada, e o comentário ao lado dela diz
por quê: *"nunca em localStorage — risco de XSS"*. Hoje o transporte a lê
diretamente porque mora no mesmo arquivo, e o único acessor exportado é o
`ensureSSEToken`.

Separar os dois obriga a exportar o que o transporte usa: ler o token, invalidá-lo
antes do refresh, disparar o refresh, e perguntar se a sessão expirou em
definitivo. **De um acessor exportado para cinco**, no valor mais sensível da
aplicação, para ganhar 3,5% numa métrica de acoplamento.

O `parsimony-ladder.md` é explícito em nunca trocar segurança por simplicidade
estrutural, e esta é exatamente essa troca.

## Decisão

**O módulo não é dividido.** Ele fica em 444 linhas, abaixo do orçamento de 500 do
`ADR-0002`, com o token e o transporte que o consome no mesmo escopo privado.

O que É feito:

1. **`logout` do transporte foi renomeado para `clearTokenAcrossTabs`.** Havia
   dois `logout` exportados — este e o de `auth/session.ts` — e um é o primeiro
   passo do outro. Importar o errado limpa o token local e deixa a sessão **viva
   no servidor**, com a pessoa acreditando que saiu. O único chamador já apelidava
   para `apiLogout` na importação, que é o sintoma de um nome que não diz o que
   faz.

2. **O alvo real fica registrado onde ele é trabalhado.** Reduzir o fan-in
   significa reduzir os 136 chamadores diretos do transporte, e isso é a camada de
   acesso a dados do `ADR-0006`: a página chama um hook de domínio, o hook chama o
   transporte. Os três domínios migrados até agora tiraram 19 telas desse caminho.

## Alternativas rejeitadas

**Dividir mesmo assim, pelo SRP.** Rejeitada pela medição: o ganho declarado não
existe, e o custo em superfície de segredo é real. SRP é um meio, não um fim — e
`architecture.md` reconhece que módulos que mudam juntos podem morar juntos.

**Criar um barril `lib/http/index.ts` para esconder o fan-in.** Rejeitada: baixaria
o número sem mudar nada. O acoplamento continuaria, medido pelo instrumento
errado — e o `B-001` existe justamente porque barris nesta base já fecharam ciclos.

**Fechar `B-029` como inválido.** Rejeitada: a preocupação do item é real e está
medida. O que não se sustenta é a prescrição, e isso é diferente de o problema não
existir.

## Consequências

- Bom: o segredo continua com uma superfície de um acessor.
- Bom: o número que importa passa a ser rastreado onde é movido, em vez de num item
  cuja receita não o move.
- Bom: some um par de nomes que podia deixar alguém logado achando que saiu.
- Ruim: `lib/http/api.ts` segue com duas razões-de-mudar no mesmo arquivo. Aceito e
  registrado: se ele ultrapassar o orçamento de 500 linhas, a divisão volta à mesa
  — e aí o critério será tamanho, que é mensurável, e não fan-in, que a medição
  mostrou não responder a ela.
