// M23 — o BFF de LEITURA da capacidade trust: `/v1/dashboard/trust/*`.
//
// Espelha o BFF do lens (`lens_dashboard.go`): rotas atras de `requireJWT`, o tenant vindo SEMPRE
// do contexto derivado do JWT — nunca de parametro de requisicao — e o corpo do upstream repassado
// sem re-modelagem.
//
// A porta `trustReader` e declarada AQUI, pelo consumidor, e nao no pacote que a implementa
// (ISP + DIP): o handler precisa de tres leituras e nao deve depender da superficie inteira do
// `trust.DataClient`. Isso tambem permite que o teste substitua a porta sem HTTP.
package routes

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// trustReader e o subconjunto de `*trust.DataClient` que este BFF consome.
type trustReader interface {
	Trends(ctx context.Context, timeRange string) (json.RawMessage, error)
	PolicyViolations(ctx context.Context, limit int) (json.RawMessage, error)
	Conversation(ctx context.Context, id string) (json.RawMessage, error)
	Validators(ctx context.Context) (json.RawMessage, error)
	EnforcementEvents(ctx context.Context, limit int) (json.RawMessage, error)
}

// TrustDashboardHandler serve as leituras do plano de observacao do trust para o dashboard.
type TrustDashboardHandler struct {
	client trustReader
	logger *slog.Logger
}

// NewTrustDashboardHandler constroi o handler.
func NewTrustDashboardHandler(c trustReader, logger *slog.Logger) *TrustDashboardHandler {
	return &TrustDashboardHandler{client: c, logger: logger}
}

// maxLimit teto do `limit` que o dashboard pode pedir. Sem ele, um `?limit=10000000` na barra de
// enderecos vira uma consulta cara no plano de dados, disparada por qualquer usuario autenticado.
const maxLimit = 200

// proxy centraliza a forma da resposta: corpo do upstream em caso de sucesso, erro OPACO em caso
// de falha.
//
// O detalhe do erro vai para o log estruturado, nunca para o corpo: a mensagem do upstream carrega
// host e porta internos, e o corpo de erro do BFF e visivel ao usuario do dashboard. E a falha e
// 502, nunca 200-com-corpo-vazio — num painel de seguranca, "nenhuma violacao" e "nao consegui
// perguntar" levam a decisoes opostas, e o segundo disfarcado do primeiro e um falso negativo.
func (h *TrustDashboardHandler) proxy(w http.ResponseWriter, r *http.Request, op string, call func() (json.RawMessage, error)) {
	body, err := call()
	if err != nil {
		h.logger.ErrorContext(r.Context(), "trust dashboard: "+op+" failed",
			"error", err, "path", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"code":"TRUST_UPSTREAM_UNAVAILABLE","message":"a camada de confiança não respondeu; nenhum dado foi lido"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// Trends serve GET /v1/dashboard/trust/trends.
func (h *TrustDashboardHandler) Trends(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "trends", func() (json.RawMessage, error) {
		return h.client.Trends(r.Context(), r.URL.Query().Get("range"))
	})
}

// PolicyViolations serve GET /v1/dashboard/trust/policy-violations.
func (h *TrustDashboardHandler) PolicyViolations(w http.ResponseWriter, r *http.Request) {
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = min(n, maxLimit)
		}
	}
	h.proxy(w, r, "policy violations", func() (json.RawMessage, error) {
		return h.client.PolicyViolations(r.Context(), limit)
	})
}

// Conversation serve GET /v1/dashboard/trust/conversations/{id}.
func (h *TrustDashboardHandler) Conversation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "conversationID")
	h.proxy(w, r, "conversation", func() (json.RawMessage, error) {
		return h.client.Conversation(r.Context(), id)
	})
}

// Validators serve GET /v1/dashboard/trust/validators — LEITURA do catalogo.
//
// A tela cruza este catalogo com as violacoes para mostrar o que e observado sem ser bloqueado.
// Somente leitura: criar e remover entram em M24 com trust:write / trust:delete.
func (h *TrustDashboardHandler) Validators(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "validators", func() (json.RawMessage, error) {
		return h.client.Validators(r.Context())
	})
}

// EnforcementEvents serve GET /v1/dashboard/trust/enforcement-events — a AUDITORIA do que o
// enforcement inline bloqueou.
//
// O corpo do upstream sai como veio: a redacao acontece na origem (conteudo bruto nunca chega a
// tabela do M17), e redigir de novo aqui criaria uma segunda fonte de verdade sobre o que e seguro
// exibir. O `limit` do usuario e capado pelo mesmo teto das demais leituras.
func (h *TrustDashboardHandler) EnforcementEvents(w http.ResponseWriter, r *http.Request) {
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = min(n, maxLimit)
		}
	}
	h.proxy(w, r, "enforcement events", func() (json.RawMessage, error) {
		return h.client.EnforcementEvents(r.Context(), limit)
	})
}

// MountTrustDashboard registra o BFF de leitura sob `requireJWT`.
//
// Apenas verbos de leitura: M23 e o caminho de observacao. Gestao de validators entra em M24, com
// escopo proprio (`trust:write` / `trust:delete`) — deixar um verbo mutante aqui daria ao caminho
// de leitura um poder que o milestone nao pediu.
func MountTrustDashboard(r chi.Router, h *TrustDashboardHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/trust", func(r chi.Router) {
		r.Use(requireJWT)
		r.Get("/trends", h.Trends)
		r.Get("/policy-violations", h.PolicyViolations)
		r.Get("/conversations/{conversationID}", h.Conversation)
		r.Get("/validators", h.Validators)
		r.Get("/enforcement-events", h.EnforcementEvents)
	})
}
