---
status: proposed
date: 2026-08-07
decision-makers: dono do projeto theo-cloud
consulted: revisão de promoção do PR #469; medição direta do middleware Go
origem: B-088 · B-015 (revertido por causa deste achado)
---

# ADR-0009 — Autenticação dos streams SSE

## Contexto

Quatro streams do dashboard autenticam pondo o JWT de sessão na query string:

```
src/hooks/deploy/use-sse-stream.ts:165
  const baseUrl = `${API_URL}${path}${separator}token=${encodeURIComponent(token)}`;
```

Consumidores: `use-log-stream`, `use-deploy-timeline`, `use-deployments-list-stream`,
`use-deployment-stream`.

**O token não é efêmero nem escopado.** `ensureSSEToken()` devolve o MESMO bearer
que autentica toda a API (`src/lib/http/api.ts`). Numa URL, ele chega a quatro
lugares onde uma credencial de sessão não deveria estar: access log do servidor,
log de proxy, histórico do navegador e header `Referer`.

A razão técnica original é legítima e continua verdadeira: **o `EventSource` do
navegador não aceita cabeçalhos customizados.** O que faltava não era a razão —
era a decisão consciente sobre o preço dela.

### Como isto foi descoberto

B-015 unificou `use-status-stream` na primitiva `useSSEStream`, ganhando refresh
de token e reconexão com backoff — e, sem que ninguém percebesse na hora,
trocando autenticação por **cookie** por JWT em query string. A unificação foi
revertida quando o dono do projeto pediu que "mais seguro possível" fosse lido
sob a lente de cybersecurity. O quinto stream não entrou; os quatro seguem.

## Medições que restringem as opções

Feitas em 2026-08-07 contra o código, não presumidas:

| Fato | Onde |
|---|---|
| O middleware da API cloud aceita `Authorization: Bearer` **ou** `?token=`, e **não** lê cookie | `internal/auth/middleware.go:143` (`extractBearerOrQueryToken`) |
| `use-status-stream` autentica por cookie porque fala com **outro serviço** (`/engine/api/v1/...`), não com a API cloud | `src/hooks/projects/use-status-stream.ts:193` |
| A primitiva **já reimplementa** reconexão: backoff exponencial com teto de 30 s e jitter | `use-sse-stream.ts:73, 228-234` |
| O único recurso que ela herda do `EventSource` nativo é o resume por `Last-Event-ID` | `use-sse-stream.ts:14` |

A terceira e a quarta linha mudam a economia da decisão: a objeção natural à
saída (c) — "perde a reconexão nativa" — **não se aplica**, porque a reconexão
nativa já foi substituída por uma manual. O que se perderia é só o resume
automático, e `Last-Event-Id` é um cabeçalho que o cliente pode enviar sozinho.

## Opções

### (a) Cookie httpOnly + SameSite

O que `use-status-stream` faz hoje. **Exige mudança de backend**: o middleware da
API cloud não lê cookie. E aceitar cookie numa API que hoje é imune a CSRF por
usar Bearer introduz superfície de CSRF em todas as rotas, não só nas de stream —
trocaria uma exposição por outra.

### (b) Token efêmero, escopado ao stream

Um endpoint dedicado mint um JWT de vida curta (segundos) válido só para aquele
stream. Mitiga sem mudar o transporte: o que vaza para o log deixa de ser a
sessão inteira. **Exige mudança de backend** (endpoint novo + validação de
escopo).

### (c) SSE sobre `fetch` + `ReadableStream`

Aceita `Authorization: Bearer` como qualquer outra chamada, e elimina a classe —
nenhuma credencial na URL. **Só cliente.** Custo real, medido acima: reimplementar
o resume por `Last-Event-ID`, que é enviar um cabeçalho na reabertura. A
reconexão já é nossa.

Custo verdadeiro e não trivial: reescrever uma primitiva de 264 linhas da qual
quatro consumidores dependem, tocando streaming, reconexão e autenticação ao
mesmo tempo. Não é trabalho de varredura — é uma fatia com plano e revisão
próprios.

## Decisão

**Proposta: (c)**, com implementação em fatia dedicada.

É a única que elimina a classe em vez de mitigá-la, é a única que não depende do
backend, e a objeção que historicamente a bloqueava foi medida e não se sustenta.

Enquanto ela não acontece, **o espalhamento fica travado por teste**:
`src/hooks/sse-token-in-url.test.ts` falha se um stream novo puser credencial na
URL. Os quatro atuais estão numa allowlist nomeada, com este ADR citado.

## Consequências

- **Bom:** nenhuma credencial em log de acesso, log de proxy, histórico ou `Referer`.
- **Bom:** independe de mudança no control plane; o dashboard resolve sozinho.
- **Ruim:** reescrita de risco concentrado. Precisa de plano, testes de reconexão e revisão.
- **Ruim:** perde o resume automático até `Last-Event-Id` ser reimplementado. Um
  stream que reconecta sem resume repete ou perde eventos — e para log de build
  isso é visível ao usuário.

## Verificação

1. `grep -rn 'token=' src/hooks` não retorna nenhuma construção de URL de stream.
2. `sse-token-in-url.test.ts` verde com a allowlist vazia.
3. Um teste de reconexão prova que o stream retoma do último evento recebido.

## Referências

- Item: `B-088` no `BACKLOG.md`, com as três saídas e o custo de cada uma
- Item revertido por causa disto: `B-015`
- Middleware que restringe (a): `internal/auth/middleware.go:143`
