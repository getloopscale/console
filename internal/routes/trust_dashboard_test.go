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
func (s *stubTrustReader) EnforcementEvents(ctx context.Context, _ int) (json.RawMessage, error) {
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

// --- M24: auditoria de enforcement ---------------------------------------------------------

// A tela de auditoria mostra o que o enforcement inline BLOQUEOU. Se ela vazasse linha de outro
// tenant, exporia o conteudo redigido das conversas de terceiro — a mesma propriedade que o M23
// trava para violacoes, aqui sobre um dado mais sensivel.
func TestEnforcementEventsNeverReturnsAnotherTenantsRows(t *testing.T) {
	reader := &stubTrustReader{byTenant: map[string]string{
		"tn-alpha": `{"events":[{"id":"e-alpha","category":"credential_leak"}]}`,
		"tn-beta":  `{"events":[{"id":"e-beta","category":"pii"}]}`,
	}}

	for _, tc := range []struct{ tenant, want, forbidden string }{
		{"tn-alpha", "e-alpha", "e-beta"},
		{"tn-beta", "e-beta", "e-alpha"},
	} {
		rec := httptest.NewRecorder()
		mountForTest(t, reader, tc.tenant).ServeHTTP(rec,
			httptest.NewRequest(http.MethodGet, "/v1/dashboard/trust/enforcement-events", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("tenant %s: status = %d, quero 200", tc.tenant, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), tc.want) {
			t.Errorf("tenant %s: resposta nao traz %q", tc.tenant, tc.want)
		}
		if strings.Contains(rec.Body.String(), tc.forbidden) {
			t.Errorf("tenant %s: VAZOU linha de outro tenant (%q)", tc.tenant, tc.forbidden)
		}
	}
}

// Sem JWT nao ha tenant, e sem tenant nao pode haver leitura: o middleware corta antes do handler.
func TestEnforcementEventsRequiresAuth(t *testing.T) {
	reader := &stubTrustReader{byTenant: map[string]string{}}
	rec := httptest.NewRecorder()
	mountForTest(t, reader, "").ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/v1/dashboard/trust/enforcement-events", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, quero 401", rec.Code)
	}
	if len(reader.seen) != 0 {
		t.Errorf("houve %d chamada(s) upstream sem autenticacao; quero zero", len(reader.seen))
	}
}

// O `?limit` do usuario e capado no BFF. Sem teto, `?limit=10000000` na barra de enderecos vira
// consulta cara no plano de dados, disparada por qualquer usuario autenticado.
func TestEnforcementEventsCapsLimit(t *testing.T) {
	reader := &stubLimitRecorder{}
	rec := httptest.NewRecorder()
	mountForTest(t, reader, "tn-alpha").ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/v1/dashboard/trust/enforcement-events?limit=10000000", nil))

	if reader.gotLimit != maxLimit {
		t.Errorf("limit repassado = %d, quero o teto %d", reader.gotLimit, maxLimit)
	}
}

// Falha do upstream e 502 com corpo tipado — NUNCA 200 com lista vazia. Num painel de seguranca,
// "nenhum bloqueio" e "nao consegui perguntar" levam a decisoes opostas.
func TestEnforcementEventsUpstreamFailureIsNotAnEmptyList(t *testing.T) {
	reader := &stubTrustReader{err: errors.New("upstream indisponivel")}
	rec := httptest.NewRecorder()
	mountForTest(t, reader, "tn-alpha").ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/v1/dashboard/trust/enforcement-events", nil))

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, quero 502", rec.Code)
	}
	if strings.Contains(rec.Body.String(), `"events":[]`) {
		t.Error("falha de leitura foi renderizada como lista vazia — falso negativo")
	}
}

// stubLimitRecorder captura o limit que o handler repassou.
type stubLimitRecorder struct {
	stubTrustReader
	gotLimit int
}

func (s *stubLimitRecorder) EnforcementEvents(ctx context.Context, limit int) (json.RawMessage, error) {
	s.gotLimit = limit
	return json.RawMessage(`{"events":[]}`), nil
}
