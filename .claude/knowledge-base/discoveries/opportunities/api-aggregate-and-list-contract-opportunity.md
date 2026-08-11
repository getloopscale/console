# Oportunidade: seis listas truncam em silêncio

**Item:** `B-114` · **Modo:** `review` · **Data:** 2026-08-10 · **Baseline:** `c97a213c`
**Reclassificado:** a hipótese que eu filei mede a fronteira errada. Ver § Reclassificação.

## Reclassificação — o item, como eu o filei, não é acionável aqui

O `B-114` afirma que "a API nomeia o mesmo conceito de quatro formas" e que "as listas têm três
contratos", e roteia para `control-plane` / `theo-cloud`. Medido:

**Os quatro nomes não são escolhas do theo-cloud.** Ele é um BFF, e espelha o nome que cada
serviço a montante escolheu:

| nome que o dashboard vê | de onde vem |
|---|---|
| `lens/observability` | `internal/thelens/data_client.go:141` → theo-lens `/v1/metrics/observability` |
| `rag/analytics` | `internal/rag/data_client.go:146` → theo-rag `/v1/analytics` |
| `memory/metrics` | `internal/themory/client.go:608` → theo-memory `/v1/scopes/user/{id}/metrics` |
| `storage/usage` | `internal/storageproxy/client.go:298` → theo-storage `/v1/storage/usage` |

Espelhar o nome do upstream é o que um BFF deve fazer — renomear cria uma tradução a manter, e
a divergência continuaria existindo um salto adiante.

**Os três contratos de lista são todos servidos pela engine**, não pelo theo-cloud:
`{projects,total?}`, `{members}` e `{entries,total,next_page_token}` chegam por `/api/v1/*`
(repo `theo`, domínio `engine-go`).

**Dentro do theo-cloud o padrão é consistente:** toda lista própria responde `{<plural>}`.

Logo, o item como filado atravessa `engine-go` e `data-plane-ts` — gate G3, descoberto tarde. O
que sobra para este domínio é o que a medição encontrou na mesma vizinhança, abaixo.

## Corner 1 — Evidence

### Seis listas aplicam um teto que ninguém declara

| rota | cap no SQL | resposta |
|---|---|---|
| `GET /v1/dashboard/lens/dashboards` | `LIMIT 100` (`lens_dashboards.go:183`) | `{dashboards}` |
| `GET /v1/dashboard/lens/alert-rules` | `LIMIT 200` (`lens_alert_rules.go:393`) | `{alert_rules}` |
| `GET /v1/dashboard/lens/saved-views` | `LIMIT 100` (`lens_saved_views.go:122`) | `{saved_views}` |
| `GET /v1/dashboard/memory/webhooks/list` | `LIMIT 100` (`memory_webhooks.go:161`) | `{webhooks}` |
| `GET /v1/dashboard/workspace/webhooks` | `LIMIT 100` (`workspace_webhooks.go:156`) | `{webhooks}` |
| `GET /v1/api-keys` | `LIMIT 100` (`api_keys.go:703`) | `{keys}` |

Nenhuma devolve `total`, `has_more` ou cursor. **A 101ª linha some, e nada na resposta diz que
sumiu.**

### O cliente pede um teto, e o servidor aplica outro

`pages/lens/traces/saved-views.tsx:52` chama:

```
cloudFetch(`/v1/dashboard/lens/saved-views?limit=${LIST_SAFETY_CEILING}`)
```

`lens_saved_views.go:112` nunca lê `limit`. O cliente declara um teto — como o guard
`request-ceiling.test.ts` do dashboard exige — e o servidor ignora, aplicando o seu.

Aquele guard diz, no seu próprio cabeçalho, o que não consegue provar: *"Que o servidor HONRA o
`limit`. Vários endpoints vivem na engine, outro repositório, e daqui não dá para verificar."*
**Estes seis vivem aqui.** Daqui dá.

### O padrão certo já existe neste repositório, um arquivo ao lado

`lens_alert_rules.go:214` responde:

```go
writeJSON(w, http.StatusOK, map[string]any{"firings": out, "total": total, "limit": limit, "offset": offset})
```

Não é um padrão a inventar — é um padrão a seguir. As seis são as que não o seguiram.

### O que NÃO é evidência, e eu conferi antes de afirmar

`GET /metrics` (Prometheus, `cmd/main.go:1136`) convive com `/v1/memory/metrics` e
`/v1/dashboard/memory/metrics`. São **caminhos distintos**, sem colisão de rota: um `curl
$HOST/metrics` recebe Prometheus. É ambiguidade de vocabulário sem dano medido, e não sustenta
trabalho.

## Corner 2 — Constraint relation

**`unknown`.** `rules/current-constraint.md` está `status: undeclared`.

## Corner 3 — Blast radius

Seis handlers em `internal/routes/`, mais as telas que os consomem
(`pages/lens/dashboards.tsx`, `pages/lens/monitors.tsx`, `pages/lens/traces/saved-views.tsx`,
`pages/memory/webhooks.tsx`, `pages/settings/webhooks.tsx`, `pages/settings/api-keys.tsx`).

**Aditivo por construção:** acrescentar um campo à resposta não quebra consumidor nenhum. O SDK
e a CLI podem ignorá-lo até quererem usá-lo.

## Corner 4 — Verification

1. **Um teste que falha hoje** — pedir mais linhas que o cap e verificar que a resposta não diz
   que truncou.
2. **Um guard sobre a classe** — uma lista nova com `LIMIT` fixo e sem sinal de truncamento
   reprova. Sem ele, as seis viram sete.
3. **A tela diz.** Um campo que o servidor manda e nenhuma tela mostra não fecha o dano: o
   usuário continua sem saber que há mais.

**Onde o limite se move depois:** com o truncamento declarado, a pergunta seguinte passa a ser
se estas listas precisam de paginação de verdade — e aí o `{total, limit, offset}` de `firings`
é o destino.

## Verdict

`SHIPPABLE_WITH_CAVEATS` — a hipótese original é **refutada** na fronteira que ela escolheu, e a
medição encontrou um defeito real e acionável na mesma vizinhança. O item é reclassificado em vez
de morto porque a evidência é do mesmo domínio, do mesmo repo, e cobre o custo que o filer
descrevia: um contrato de lista que não diz o que faz.

**Caveat:** os quatro nomes de agregado e os três contratos da engine continuam existindo, em
`data-plane-ts` e `engine-go`. Não são deste item nem deste domínio, e ficam registrados aqui em
vez de silenciosamente absorvidos.
