package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/usetheoai/theo-cloud/internal/trust"
)

type stubTrustWriter struct {
	created, tested, deleted int
	deletedID                string
	gotBody                  string
	err                      error
}

func (s *stubTrustWriter) CreateValidator(_ context.Context, b json.RawMessage) (json.RawMessage, error) {
	s.created++
	s.gotBody = string(b)
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(`{"id":"v1"}`), nil
}
func (s *stubTrustWriter) TestValidator(_ context.Context, b json.RawMessage) (json.RawMessage, error) {
	s.tested++
	s.gotBody = string(b)
	if s.err != nil {
		return nil, s.err
	}
	return json.RawMessage(`{"action":"block","policy":"prohibited_content"}`), nil
}
func (s *stubTrustWriter) DeleteValidator(_ context.Context, id string) error {
	s.deleted++
	s.deletedID = id
	return s.err
}

func mountGuardrails(t *testing.T, w trustWriter, authed bool) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	h := NewTrustGuardrailsHandler(w, slog.New(slog.NewTextHandler(io.Discard, nil)))
	MountTrustGuardrails(r, h, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
			if !authed {
				rw.WriteHeader(http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(rw, req)
		})
	})
	return r
}

// M24 — sem sessao nao ha mutacao. O corte acontece ANTES do handler, entao o upstream nem e
// consultado: uma escrita disparada sem credencial nao pode nem ser tentada.
func TestMutationsAreBehindRequireJWT(t *testing.T) {
	w := &stubTrustWriter{}
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/v1/dashboard/trust/guardrails/"},
		{http.MethodPost, "/v1/dashboard/trust/guardrails/test"},
		{http.MethodDelete, "/v1/dashboard/trust/guardrails/abc"},
	} {
		rec := httptest.NewRecorder()
		mountGuardrails(t, w, false).ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, strings.NewReader("{}")))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: HTTP %d sem credencial; esperado 401", tc.method, tc.path, rec.Code)
		}
	}
	if w.created+w.tested+w.deleted != 0 {
		t.Errorf("o upstream foi consultado sem credencial (create=%d test=%d delete=%d)", w.created, w.tested, w.deleted)
	}
}

// O DRY-RUN e rota propria e NAO cria nada. Se testar criasse, o operador nao teria como
// experimentar uma regra sem coloca-la em producao — e o passo viraria teatro.
func TestDryRunDoesNotCreate(t *testing.T) {
	w := &stubTrustWriter{}
	rec := httptest.NewRecorder()
	mountGuardrails(t, w, true).ServeHTTP(rec, httptest.NewRequest(
		http.MethodPost, "/v1/dashboard/trust/guardrails/test",
		strings.NewReader(`{"spec":{"kind":"ban-list","terms":["x"],"action":"block"},"content":"contem x"}`)))

	if rec.Code != http.StatusOK {
		t.Fatalf("HTTP %d; esperado 200", rec.Code)
	}
	if w.created != 0 {
		t.Errorf("o dry-run CRIOU %d validator(es); ele nao pode criar nada", w.created)
	}
	if w.tested != 1 {
		t.Errorf("tested = %d; esperado 1", w.tested)
	}
	if !strings.Contains(rec.Body.String(), "block") {
		t.Errorf("o veredito do dry-run nao chegou a tela: %s", rec.Body.String())
	}
}

// O corpo chega ao upstream INTACTO: re-serializar no meio do caminho perderia campos que o
// dashboard ainda nao conhece e que o theo-trust ja aceita.
func TestSpecReachesUpstreamUnmodified(t *testing.T) {
	w := &stubTrustWriter{}
	const spec = `{"name":"sem-cpf","spec":{"kind":"ban-list","terms":["cpf"],"action":"modify","replacement":"[redigido]"}}`
	rec := httptest.NewRecorder()
	mountGuardrails(t, w, true).ServeHTTP(rec, httptest.NewRequest(
		http.MethodPost, "/v1/dashboard/trust/guardrails/", strings.NewReader(spec)))

	if w.gotBody != spec {
		t.Errorf("o corpo foi alterado no caminho:\n  enviado: %s\n  recebido: %s", spec, w.gotBody)
	}
}

// Remocao e destrutiva: o id precisa chegar exatamente como veio, e a rota so responde a DELETE.
func TestDeleteForwardsTheIDAndOnlyOnDelete(t *testing.T) {
	w := &stubTrustWriter{}
	rec := httptest.NewRecorder()
	mountGuardrails(t, w, true).ServeHTTP(rec, httptest.NewRequest(
		http.MethodDelete, "/v1/dashboard/trust/guardrails/val-42", nil))

	if rec.Code != http.StatusNoContent {
		t.Errorf("HTTP %d; esperado 204 numa remocao sem corpo", rec.Code)
	}
	if w.deletedID != "val-42" {
		t.Errorf("id encaminhado = %q; esperado val-42", w.deletedID)
	}
}

// Falha do upstream NAO pode virar 200: a tela mostraria "guardrail criada" para algo que nao
// existe, e o operador acreditaria estar protegido.
func TestUpstreamRejectionIsNotRenderedAsSuccess(t *testing.T) {
	w := &stubTrustWriter{err: errors.New(`upstream 422: {"code":"VALIDATOR_NAME_RESERVED"}`)}
	rec := httptest.NewRecorder()
	mountGuardrails(t, w, true).ServeHTTP(rec, httptest.NewRequest(
		http.MethodPost, "/v1/dashboard/trust/guardrails/", strings.NewReader(`{"name":"pii"}`)))

	if rec.Code == http.StatusOK || rec.Code == http.StatusNoContent {
		t.Fatalf("recusa do upstream virou HTTP %d — a tela diria 'criada' para algo que nao existe", rec.Code)
	}
}

// Corpo gigante e cortado antes de chegar ao upstream.
func TestOversizedSpecIsRejectedBeforeUpstream(t *testing.T) {
	w := &stubTrustWriter{}
	rec := httptest.NewRecorder()
	mountGuardrails(t, w, true).ServeHTTP(rec, httptest.NewRequest(
		http.MethodPost, "/v1/dashboard/trust/guardrails/", strings.NewReader(strings.Repeat("a", 70<<10))))

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("HTTP %d; esperado 413", rec.Code)
	}
	if w.created != 0 {
		t.Errorf("o corpo gigante chegou ao upstream (%d chamada[s])", w.created)
	}
}

// --- Review do M24: o codigo tipado do servico precisa CHEGAR ao operador -------------------
//
// Ate o review, `mutate` colapsava QUALQUER erro num 502 com frase propria — enquanto o
// comentario da funcao afirmava o contrario. O efeito: `INVALID_SPEC` ("seu termo esta vazio")
// virava "a camada de confianca recusou a operacao", e o operador tentava de novo identico.
// Os testes abaixo sao os que teriam pego isso.

func TestClientRefusalTravelsWithStatusAndBody(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"spec invalida", http.StatusUnprocessableEntity, `{"code":"INVALID_SPEC","message":"terms must not be empty"}`},
		{"nome reservado", http.StatusUnprocessableEntity, `{"code":"VALIDATOR_NAME_RESERVED","message":"name \"pii\" is reserved"}`},
		{"nome ja existe", http.StatusConflict, `{"code":"CONFLICT","message":"a validator with this name already exists"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := &stubTrustWriter{err: &trust.UpstreamError{
				Status: tc.status, Body: json.RawMessage(tc.body), Method: http.MethodPost, Path: "/v1/validators",
			}}
			rec := httptest.NewRecorder()
			mountGuardrails(t, w, true).ServeHTTP(rec, httptest.NewRequest(
				http.MethodPost, "/v1/dashboard/trust/guardrails/", strings.NewReader(`{"name":"x"}`)))

			if rec.Code != tc.status {
				t.Errorf("status = %d, quero %d (o do upstream)", rec.Code, tc.status)
			}
			if rec.Body.String() != tc.body {
				t.Errorf("corpo = %s, quero o do upstream intacto: %s", rec.Body.String(), tc.body)
			}
		})
	}
}

// 5xx do upstream NAO atravessa: o corpo ali fala de topologia interna, e o operador nao tem o
// que fazer com isso. A distincao entre "voce escreveu algo invalido" e "nosso lado falhou" e o
// ponto todo — colapsar as duas foi o defeito original, e inverte-lo seria o defeito espelhado.
func TestUpstreamServerErrorDoesNotLeakInternals(t *testing.T) {
	w := &stubTrustWriter{err: &trust.UpstreamError{
		Status: http.StatusInternalServerError,
		Body:   json.RawMessage(`{"code":"DB_DOWN","message":"pgbouncer at 10.0.3.7:6432 refused"}`),
	}}
	rec := httptest.NewRecorder()
	mountGuardrails(t, w, true).ServeHTTP(rec, httptest.NewRequest(
		http.MethodPost, "/v1/dashboard/trust/guardrails/", strings.NewReader(`{"name":"x"}`)))

	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, quero 502", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "pgbouncer") || strings.Contains(rec.Body.String(), "10.0.3.7") {
		t.Errorf("vazou topologia interna no corpo: %s", rec.Body.String())
	}
}

// Falha de transporte (sem resposta do upstream) tambem nao atravessa — nao ha status a repassar.
func TestTransportFailureIsNotRenderedAsClientRefusal(t *testing.T) {
	w := &stubTrustWriter{err: errors.New("dial tcp: connection refused")}
	rec := httptest.NewRecorder()
	mountGuardrails(t, w, true).ServeHTTP(rec, httptest.NewRequest(
		http.MethodDelete, "/v1/dashboard/trust/guardrails/val-1", nil))

	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, quero 502", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "connection refused") {
		t.Errorf("vazou detalhe de transporte: %s", rec.Body.String())
	}
}
