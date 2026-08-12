# ADR — O metering de builds reconcilia da fonte da verdade, e não acumula de um stream

- **Status:** accepted
- **Data:** 2026-08-09
- **Origem:** B-090 (backlog) · [#471](https://github.com/usetheoai/theo-cloud/issues/471)
- **Decisores:** dono do projeto theo-cloud

## Contexto

`usage_records` estava **vazia para builds desde que a métrica foi definida**. As
consequências eram três, e só a primeira estava no issue:

1. O `Reporter` roda, lê a tabela e **reporta nada ao Stripe**.
2. `getUsageForTenant` lê a mesma tabela e alimenta a tela de Overview, que
   mostrava **"0 de 100 builds" para toda conta** — um número falso, exibido ao
   usuário.
3. O limite `builds_per_month: 100` declarado nos planos nunca teve como vincular.

Existiam **dois** caminhos de escrita, e a medição mostrou que o desligado era o
frágil e o ligado era o certo:

| | Como funciona | Estado |
|---|---|---|
| `metering.Tracker` | incrementa `usage_records` a cada build concluído | **nunca construído** — zero chamadores de produção |
| `metering.Reconciler` | conta `builds` na fonte e corrige `usage_records` | **ligado** em `cmd/main.go:1825`, roda periodicamente |

## O defeito

O reconciler decidia por porcentagem:

```go
driftPct := math.Abs(float64(recordedCount-actualCount)) / float64(actualCount) * 100
if driftPct > 0 && driftPct <= DriftThresholdPct { autoCorrect() }
else if driftPct > DriftThresholdPct { warn() }
```

Com `recordedCount == 0` — o estado de toda conta — a divergência é **100%** para
qualquer `actual` maior que zero. Como `100 > 5`, a auto-correção nunca executava.

O reconciler rodava, media **certo**, avisava *"usage drift exceeds threshold —
requires manual review"* a cada ciclo para cada conta, e não escrevia.

**A proteção contra corromper o dado era exatamente o que impedia o dado de
existir.**

## Decisão

**Reconciliar da fonte da verdade é o mecanismo de metering; o incremento ao vivo
sai.**

1. `recordedCount == 0` é tratado como **ausência**, não como divergência, e a
   linha é semeada com a contagem real.
2. O teto de 5% **continua valendo** onde já existe valor gravado.
3. `metering.Tracker` foi **removido**, com seus testes.

## Rationale

**Por que reconciliar, e não acumular.** Um contador alimentado por eventos perde
receita quando um evento se perde e cobra a mais quando um evento chega duas
vezes. Uma reconciliação contra o sistema de registro **converge**: erra num ciclo
e acerta no seguinte, sem estado próprio a corromper. `SELECT COUNT(*) FROM builds
WHERE created_at >= period_start AND status IN ('SUCCEEDED','FAILED')` é
autoritativo por construção — é a mesma tabela que a UI e o engine leem.

**Por que a distinção ausência-vs-divergência não é um detalhe.** Semear escreve
onde não havia linha: não existe valor a perder. Sobrescrever um valor existente
que diverge 100% é outra coisa — pode ser a *reconciliação* que está errada, e o
resultado seria uma fatura corrompida. O teto foi escrito para esse caso e
continua cobrindo-o.

**Por que o Tracker sai em vez de ficar como otimização.** Dois escritores da
mesma tabela agregada é o problema que o teto tentava remediar. Com a
reconciliação convergindo, o incremento ao vivo não acrescenta correção — apenas
uma segunda regra de agregação que pode divergir da primeira. Um escritor.

Os dois métodos dele estavam cobertos:

- `RecordBuildCompletion` — superado pela reconciliação.
- `RecordStorageSnapshot` — fora de escopo por decisão de produto já registrada em
  `internal/storage/meter.go`: *"the MVP has NO overage billing, so storage usage
  is MEASURED but NOT written"*.

## Alternativas rejeitadas

**Ligar o Tracker ao `deploy.succeeded` que já chega pelo outbox.** Parecia custar
zero — o evento já é drenado por `deploy_event_enqueuer`. Rejeitada por medição: o
engine documenta em `deploy_event_store.go:30` que *"a Release re-enters ACTIVE
after rollback recovery and each entry is a distinct `deploy.succeeded`"*. Um
rollback contaria como build, **cobrando a mais**. E o payload que chega
(`deploy_id`, `environment`, `status`, `occurred_at`) não carrega duração, que
`RecordBuildCompletion` exige.

**Endpoint interno chamado pelo engine ao concluir o build.** Põe uma ida à rede
no instante faturável; falhando depois do build ter terminado, a receita some — a
menos que se acrescente retry durável, que **é** um outbox. Converge para a
alternativa acima, com uma superfície de autenticação serviço-a-serviço nova.

**Engine escrevendo `usage_records` direto.** Grava um *agregado*, não um
*evento*: sem trilha para mostrar quais builds produziram a fatura quando o
cliente contestar, e com a regra de agregação em dois repositórios.

**Um evento `build.completed` novo no outbox.** É o desenho correto **se** a fonte
da verdade não estivesse ao alcance. Está: o banco é compartilhado e o reconciler
já consulta `builds` com sucesso. Acrescentar um stream para derivar o que uma
consulta já responde é infraestrutura sem necessidade — degrau 1 da
`parsimony-ladder`.

## Consequências

- Bom: `usage_records` passa a ser populada da fonte autoritativa, o que corrige o
  Stripe e a tela pelo mesmo caminho.
- Bom: um escritor, uma regra de agregação.
- Bom: o modo de falha some por construção — não há evento a perder.
- Ruim: o uso aparece com a latência do ciclo de reconciliação, não em tempo real.
  Aceito: a cobrança é mensal, e o `Reporter` já era assíncrono.
- Ruim: um build que a fonte não registre (falha de escrita no engine) não é
  faturado. Isso é correto — cobrar por um build que o sistema de registro não
  reconhece seria pior.

## Verificação

- `tests/unit/metering_db_test.go::TestReconcile_SeedsWhenNothingRecorded` — falha
  no estado anterior.
- `tests/unit/metering_db_test.go::TestReconcile_NaoSobrescreveQuandoDriftExcedeOTeto`
  — fixa o que o teto ainda protege. Ele **não existia**: o caso de proteção do
  guard nunca tivera teste, o que é parte de por que o defeito sobreviveu.
