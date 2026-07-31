package routes

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// stubTrustReader implementa a porta que o handler consome. Guarda o tenant que o resolver
// entregou em cada chamada — e isso que torna o isolamento verificavel.
type stubTrustReader struct {
	byTenant map[string]string // tenant -> corpo devolvido
	seen     []string
	err      error
}

func (s *stubTrustReader) read(ctx context.Context) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	t := trustTestTenantOf(ctx)
	s.seen = append(s.seen, t)
	body, ok := s.byTenant[t]
	if !ok {
		body = `{"items":[]}`
	}
	return json.RawMessage(body), nil
}

func (s *stubTrustReader) Trends(ctx context.Context, _ string) (json.RawMessage, error) {
	return s.read(ctx)
}
func (s *stubTrustReader) PolicyViolations(ctx context.Context, _ int) (json.RawMessage, error) {
	return s.read(ctx)
}
func (s *stubTrustReader) Conversation(ctx context.Context, _ string) (json.RawMessage, error) {
	return s.read(ctx)
}
func (s *stubTrustReader) Validators(ctx context.Context) (json.RawMessage, error) {
	return s.read(ctx)
}

// tenantOf le o tenant que o teste injetou no contexto, emulando o que o resolver Model B faz a
// partir do JWT.
type trustTestTenantKey struct{}

func trustTestTenantOf(ctx context.Context) string {
	v, _ := ctx.Value(trustTestTenantKey{}).(string)
	return v
}

// mountForTest monta o BFF com um "requireJWT" que injeta o tenant informado — o dobre do
// middleware real, que o deriva do JWT.
func mountForTest(t *testing.T, reader trustReader, tenant string) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	h := NewTrustDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil)))
	MountTrustDashboard(r, h, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if tenant == "" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, req.WithContext(context.WithValue(req.Context(), trustTestTenantKey{}, tenant)))
		})
	})
	return r
}

// M23 DoD-4 — "dois tenants distintos, a resposta de um nunca contem linha do outro".
//
// A propriedade nao e sobre filtrar depois: o handler nunca ve os dados do outro tenant, porque a
// credencial que busca os dados e cunhada POR TENANT. Este teste falha se alguem introduzir cache
// compartilhado entre requisicoes — o modo mais comum de reintroduzir vazamento cruzado.
func TestPolicyViolationsNeverReturnsAnotherTenantsRows(t *testing.T) {
	reader := &stubTrustReader{byTenant: map[string]string{
		"tn-alpha": `{"violations":[{"id":"a1","tenant":"tn-alpha"}]}`,
		"tn-beta":  `{"violations":[{"id":"b1","tenant":"tn-beta"}]}`,
	}}

	for _, tc := range []struct{ tenant, want, forbidden string }{
		{"tn-alpha", "a1", "b1"},
		{"tn-beta", "b1", "a1"},
	} {
		rec := httptest.NewRecorder()
		mountForTest(t, reader, tc.tenant).ServeHTTP(rec,
			httptest.NewRequest(http.MethodGet, "/v1/dashboard/trust/policy-violations", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("tenant %s: HTTP %d, esperado 200", tc.tenant, rec.Code)
		}
		body := rec.Body.String()
		if !strings.Contains(body, tc.want) {
			t.Errorf("tenant %s: resposta nao tem a propria linha %q: %s", tc.tenant, tc.want, body)
		}
		if strings.Contains(body, tc.forbidden) {
			t.Errorf("VAZAMENTO ENTRE TENANTS — tenant %s recebeu a linha %q do outro tenant: %s",
				tc.tenant, tc.forbidden, body)
		}
	}
	if len(reader.seen) != 2 || reader.seen[0] == reader.seen[1] {
		t.Errorf("o handler consultou %v; esperado um tenant distinto por requisicao", reader.seen)
	}
}

// Sem JWT nao ha tenant, e sem tenant nao ha requisicao. O middleware corta antes do handler.
func TestRoutesAreBehindRequireJWT(t *testing.T) {
	reader := &stubTrustReader{byTenant: map[string]string{}}
	for _, path := range []string{
		"/v1/dashboard/trust/trends",
		"/v1/dashboard/trust/policy-violations",
		"/v1/dashboard/trust/conversations/abc",
	} {
		rec := httptest.NewRecorder()
		mountForTest(t, reader, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: HTTP %d sem credencial; esperado 401", path, rec.Code)
		}
	}
	if len(reader.seen) != 0 {
		t.Errorf("o reader foi consultado %d vez(es) sem credencial; esperado 0", len(reader.seen))
	}
}

// Uma falha do broker (cunhagem indisponivel) nao pode virar 200 com corpo vazio: a tela mostraria
// "nenhuma violacao" quando a verdade e "nao consegui perguntar". Falso negativo num painel de
// seguranca e pior que erro visivel.
func TestUpstreamFailureIsNotRenderedAsEmptySuccess(t *testing.T) {
	reader := &stubTrustReader{err: errors.New("broker indisponivel")}
	rec := httptest.NewRecorder()
	mountForTest(t, reader, "tn-alpha").ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/v1/dashboard/trust/policy-violations", nil))

	if rec.Code == http.StatusOK {
		t.Fatalf("falha upstream virou HTTP 200 com corpo %q — a tela leria como 'sem violacoes'", rec.Body.String())
	}
	if rec.Code < 500 {
		t.Errorf("HTTP %d; uma falha de dependencia e 5xx, nao erro do chamador", rec.Code)
	}
}

// O erro que chega ao dashboard nao pode carregar detalhe interno do upstream.
func TestErrorBodyDoesNotLeakUpstreamDetail(t *testing.T) {
	reader := &stubTrustReader{err: errors.New("dial tcp 10.42.0.7:18085: connection refused")}
	rec := httptest.NewRecorder()
	mountForTest(t, reader, "tn-alpha").ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/v1/dashboard/trust/trends", nil))

	if strings.Contains(rec.Body.String(), "10.42.0.7") {
		t.Errorf("o corpo de erro vazou topologia interna: %s", rec.Body.String())
	}
}
