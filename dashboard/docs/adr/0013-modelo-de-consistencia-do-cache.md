---
status: accepted
date: 2026-08-08
decision-makers: time do dashboard theo-cloud
origem: B-077 (backlog) — medido em 2026-08-08
---

# ADR-0013 — O modelo de consistência do cache, e por que um override tem de divergir

## Contexto

O item `B-077` registra que "nenhum modelo de consistência foi declarado para o
estado de servidor cacheado num dashboard operacional".

**A medição desmente a premissa.** `src/lib/http/query-client.ts` declara o
modelo inteiro, com justificativa por default:

| Default | Valor | Razão registrada no arquivo |
|---|---|---|
| `staleTime` | 60 s | espelha o TTL manual que existia antes da migração |
| `gcTime` | 5 min | o cache sobrevive 5 min após o último consumidor desmontar |
| `refetchOnWindowFocus` | `true` | trocar de aba revalida |
| `refetchOnReconnect` | `true` | idem para a rede voltar |
| `retry` | `retryGuard` | repete só falha transitória |
| `mutations.retry` | `0` | ação do usuário nunca é repetida sozinha |

O `retryGuard` não é preferência: ele nasceu do Red Team `theo-cloud#93`. O
`retry: 1` anterior repetia **tudo**, inclusive 404 e 403 — que não se recuperam
por repetição e ainda gastam uma ida à rede atrasando o "não encontrado" que a
pessoa está esperando.

## O que a medição achou de verdade

**32 overrides locais**, e dois deles repetiam exatamente o default global:

- `pages/memory/scope-switcher.tsx:42` — `staleTime: 60_000`
- `hooks/overview/use-build-stats.ts:41` — `staleTime: 60_000`

Ambos com comentário justificando a escolha. O valor está certo hoje, e é por
isso que passava despercebido.

## Decisão

**O modelo global permanece como está.** A regra que faltava é sobre os
overrides:

> Um override de política de cache existe para **divergir** do default. Se ele
> concorda com o default, ele é apagado — o default é que deve ser lido.

Enforçada por `src/lib/cache-policy.test.ts`.

## Rationale

Repetir o default parece inofensivo e não é. No dia em que o default global
mudar, cada linha redundante fica **congelada sozinha**, sem que nada acuse — e
o comentário ao lado continuará afirmando uma intenção ("manter o seletor ágil
sem martelar o BFF") que a linha deixou de entregar. Quem ler vai acreditar no
comentário.

Isso é a mesma classe do `ADR-0010` sobre estado de URL: a escolha estava certa,
mas por conhecimento de quem escreveu, e não por regra que o próximo possa
aplicar.

## Alternativas rejeitadas

**Proibir override.** Rejeitada: `use-whoami` precisa de `staleTime: Infinity`
(o whoami só muda em troca de time ou logout) e `use-project-status` precisa de
polling de 5 s (é tela de runtime). Os dois divergem de propósito, e é para isso
que o override existe.

**Centralizar todos os overrides numa tabela.** Rejeitada por YAGNI
(`parsimony-ladder.md` degrau 1): a política de uma query pertence a quem a
declara. Uma tabela central obrigaria a ler dois arquivos para entender uma
tela, e as 30 divergências legítimas viraram divergências por bom motivo, não
por descuido.

**Declarar um modelo novo.** Rejeitada: já existe um, e ele é deliberado.
Escrever outro criaria dois.

## Consequências

**Habilita** mudar um default global e ter certeza de que ele alcança todas as
queries que não divergem de propósito.

**Restringe** overrides a valores que de fato divergem. Um `staleTime` igual ao
default falha o teste com a explicação do porquê.

**Não cobre** overrides de `refetchInterval` (18 ocorrências) nem
`refetchOnWindowFocus` (2): eles não têm default numérico comparável — o
`refetchInterval` global é `false`, então qualquer valor já é divergência.

## Cross-references

- `B-077` no `BACKLOG.md` — o item, com a medição
- `src/lib/http/query-client.ts` — o modelo e a justificativa de cada default
- `src/lib/cache-policy.test.ts` — o guard
- `ADR-0010` — mesma classe: a escolha estava certa, faltava a regra escrita
