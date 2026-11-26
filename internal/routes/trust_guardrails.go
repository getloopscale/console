// M24 — o caminho de MUTACAO do catalogo de guardrails: `/v1/dashboard/trust/guardrails*`.
//
// A porta `trustWriter` e SEPARADA de `trustReader` de proposito (ISP). Nao e organizacao: e o que
// permite que o handler de leitura receba um cliente cuja credencial cunhada NAO pode escrever. O
// menor privilegio passa a ser propriedade da CHAVE, nao de uma checagem de middleware que alguem
// pode esquecer de aplicar numa rota nova.
package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/getloopscale/loop-console/internal/trust"
)

// trustWriter e o subconjunto mutante que este handler consome.
type trustWriter interface {
	CreateValidator(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	TestValidator(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	DeleteValidator(ctx context.Context, id string) error
}

// maxSpecBytes limita o corpo que o dashboard pode enviar. Uma spec de guardrail e pequena por
// natureza; sem teto, o BFF vira um caminho barato para pressionar memoria do plano de controle.
const maxSpecBytes = 64 << 10 // 64 KiB

// TrustGuardrailsHandler serve a gestao do catalogo para o dashboard.
type TrustGuardrailsHandler struct {
	client trustWriter
	logger *slog.Logger
}

// NewTrustGuardrailsHandler constroi o handler.
func NewTrustGuardrailsHandler(c trustWriter, logger *slog.Logger) *TrustGuardrailsHandler {
	return &TrustGuardrailsHandler{client: c, logger: logger}
}

// readSpec le e limita o corpo da requisicao.
func readSpec(w http.ResponseWriter, r *http.Request) (json.RawMessage, bool) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxSpecBytes+1))
	if err != nil || len(body) > maxSpecBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
			"code": "SPEC_TOO_LARGE", "message": "a definição da guardrail excede o limite"})
		return nil, false
	}
	return json.RawMessage(body), true
}

// mutate centraliza a forma da resposta das mutacoes.
//
// Diferenca deliberada em relacao ao proxy de LEITURA: aqui o corpo de erro do upstream ATRAVESSA.
// O loopguardrails responde com codigo tipado (`INVALID_SPEC`, `VALIDATOR_NAME_RESERVED`, `CONFLICT`) e
// mensagem que diz O QUE corrigir. Esconde-lo transformaria "seu termo esta vazio" em "erro" — e o
// operador tentaria de novo igual. O risco de vazamento e menor aqui porque a falha e de VALIDACAO
// da spec que ele mesmo enviou, nao de topologia interna.
func (h *TrustGuardrailsHandler) mutate(w http.ResponseWriter, r *http.Request, op string, call func() (json.RawMessage, error)) {
	body, err := call()
	if err != nil {
		h.logger.ErrorContext(r.Context(), "trust guardrails: "+op+" failed", "error", err, "path", r.URL.Path)

		// Recusa de VALIDACAO (4xx) atravessa com status e corpo do upstream. E o codigo tipado
		// (`INVALID_SPEC`, `VALIDATOR_NAME_RESERVED`, `CONFLICT`) que diz ao operador O QUE
		// corrigir; colapsa-lo num 502 generico faz ele tentar de novo identico.
		//
		// 5xx e falha de transporte NAO atravessam: ali o corpo fala de topologia interna, e o
		// operador nao tem o que fazer com isso.
		if ue, ok := trust.AsUpstreamError(err); ok && ue.IsClientRefusal() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(ue.Status)
			_, _ = w.Write(ue.Body)
			return
		}

		writeJSON(w, http.StatusBadGateway, map[string]string{
			"code": "TRUST_UPSTREAM_UNAVAILABLE", "message": "a camada de confiança não respondeu; nada foi alterado"})
		return
	}
	if len(body) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body) // corpo do upstream intacto — nao re-serializar
}

// Create serve POST /v1/dashboard/trust/guardrails.
func (h *TrustGuardrailsHandler) Create(w http.ResponseWriter, r *http.Request) {
	spec, ok := readSpec(w, r)
	if !ok {
		return
	}
	h.mutate(w, r, "create", func() (json.RawMessage, error) {
		return h.client.CreateValidator(r.Context(), spec)
	})
}

// Test serve POST /v1/dashboard/trust/guardrails:test — o DRY-RUN.
//
// Existe como rota propria, e nao como flag do Create, porque o fluxo da tela depende de poder
// testar SEM criar. Uma flag convidaria alguem a pular o passo; uma rota separada torna o teste
// uma etapa, nao uma opcao.
func (h *TrustGuardrailsHandler) Test(w http.ResponseWriter, r *http.Request) {
	spec, ok := readSpec(w, r)
	if !ok {
		return
	}
	h.mutate(w, r, "test", func() (json.RawMessage, error) {
		return h.client.TestValidator(r.Context(), spec)
	})
}

// Delete serve DELETE /v1/dashboard/trust/guardrails/{id}.
func (h *TrustGuardrailsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "validatorID")
	h.mutate(w, r, "delete", func() (json.RawMessage, error) {
		return nil, h.client.DeleteValidator(r.Context(), id)
	})
}

// MountTrustGuardrails registra a gestao sob `requireJWT`.
func MountTrustGuardrails(r chi.Router, h *TrustGuardrailsHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/trust/guardrails", func(r chi.Router) {
		r.Use(requireJWT)
		r.Post("/", h.Create)
		r.Post("/test", h.Test)
		r.Delete("/{validatorID}", h.Delete)
	})
}
