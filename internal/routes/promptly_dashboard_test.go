package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/usetheodev/theo-cloud/internal/promptly"
)

// Duble do cliente: cada metodo devolve o que o teste programou. Substitui a porta, nao o HTTP —
// e por isso que a porta e declarada pelo consumidor (ISP).
type promptlyFake struct {
	corpo  json.RawMessage
	err    error
	limite int    // o limite que a rota REPASSOU (o oraculo do teto explicito)
	label  string // o label que a rota repassou na promocao
	body   json.RawMessage
}

func (f *promptlyFake) Catalog(_ context.Context, limit int, _ string) (json.RawMessage, error) {
	f.limite = limit
	return f.corpo, f.err
}
func (f *promptlyFake) Prompt(context.Context, string) (json.RawMessage, error) {
	return f.corpo, f.err
}
func (f *promptlyFake) Revisions(_ context.Context, _ string, limit, _ int) (json.RawMessage, error) {
	f.limite = limit
	return f.corpo, f.err
}
func (f *promptlyFake) Labels(context.Context, string) (json.RawMessage, error) {
	return f.corpo, f.err
}
func (f *promptlyFake) Policy(context.Context, string, string) (json.RawMessage, error) {
	return f.corpo, f.err
}
func (f *promptlyFake) AssignLabel(_ context.Context, _, label string, body json.RawMessage) (json.RawMessage, error) {
	f.label, f.body = label, body
	return f.corpo, f.err
}

func montar(f *promptlyFake) http.Handler {
	h := NewPromptlyDashboardHandler(f, f, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r := chi.NewRouter()
	MountPromptlyDashboard(r, h, func(next http.Handler) http.Handler { return next })
	return r
}

func chamar(t *testing.T, f *promptlyFake, metodo, caminho, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if corpo != "" {
		body = strings.NewReader(corpo)
	}
	req := httptest.NewRequest(metodo, caminho, body)
	rec := httptest.NewRecorder()
	montar(f).ServeHTTP(rec, req)
	return rec
}

func TestPromptlyDashboard_catalogo_devolve_o_corpo_do_servico(t *testing.T) {
	f := &promptlyFake{corpo: json.RawMessage(`[{"name":"saudacao","latestVersion":3,"labels":[]}]`)}

	rec := chamar(t, f, http.MethodGet, "/v1/dashboard/promptly/prompts", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	// O oraculo e o CONTEUDO: um 200 com corpo vazio passaria num teste de status e falharia na tela.
	if !strings.Contains(rec.Body.String(), `"saudacao"`) {
		t.Errorf("o nome do prompt nao chegou ao navegador: %s", rec.Body.String())
	}
}

func TestPromptlyDashboard_revisoes_pedem_limite_pequeno_mesmo_sem_parametro(t *testing.T) {
	// A restricao MEDIDA que governa esta tela: cada revisao carrega o `content` integral, e o
	// default do servico e 100. Uma rota que nao impoe teto proprio herda esse default em silencio.
	f := &promptlyFake{corpo: json.RawMessage(`[]`)}

	chamar(t, f, http.MethodGet, "/v1/dashboard/promptly/prompts/saudacao/revisions", "")

	if f.limite <= 0 || f.limite > revisionsPageCeiling {
		t.Errorf("limite repassado = %d; a rota tem de impor teto proprio (≤ %d)", f.limite, revisionsPageCeiling)
	}
}

func TestPromptlyDashboard_revisoes_nao_aceitam_limite_acima_do_teto(t *testing.T) {
	// Negativo do par acima: um cliente pedindo 500 nao pode arrastar 500 corpos de prompt.
	f := &promptlyFake{corpo: json.RawMessage(`[]`)}

	chamar(t, f, http.MethodGet, "/v1/dashboard/promptly/prompts/saudacao/revisions?limit=500", "")

	if f.limite > revisionsPageCeiling {
		t.Errorf("limite = %d passou do teto %d", f.limite, revisionsPageCeiling)
	}
}

func TestPromptlyDashboard_politica_ausente_chega_como_404_tipado(t *testing.T) {
	// "Nenhuma politica governa este label" e um FATO — a tela renderiza "promocao livre". Se
	// virasse 502, ela diria "nao consegui ler", que leva o operador a investigar o servico.
	f := &promptlyFake{err: &promptly.UpstreamError{
		Status: http.StatusNotFound,
		Body:   json.RawMessage(`{"error":"policy_not_found","name":"saudacao","label":"prod"}`),
		Method: http.MethodGet, Path: "/prompts/saudacao/policies/prod",
	}}

	rec := chamar(t, f, http.MethodGet, "/v1/dashboard/promptly/prompts/saudacao/policies/prod", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, quer 404 (tipado, nao 502)", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "policy_not_found") {
		t.Errorf("codigo tipado nao chegou a tela: %s", rec.Body.String())
	}
}

func TestPromptlyDashboard_recusa_da_politica_na_promocao_chega_com_os_numeros(t *testing.T) {
	// O caso que o DoD do M25 exige: promocao recusada renderiza o TEXTO do servico, com o
	// limiar exigido e o obtido — nao "erro generico".
	f := &promptlyFake{err: &promptly.UpstreamError{
		Status: http.StatusConflict,
		Body:   json.RawMessage(`{"error":"promotion_blocked","message":"score 0.41 < 0.8","required":0.8,"actual":0.41}`),
		Method: http.MethodPut, Path: "/prompts/saudacao/labels/prod",
	}}

	rec := chamar(t, f, http.MethodPut, "/v1/dashboard/promptly/prompts/saudacao/labels/prod", `{"version":7}`)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, quer 409", rec.Code)
	}
	corpo := rec.Body.String()
	if !strings.Contains(corpo, "promotion_blocked") || !strings.Contains(corpo, "0.8") {
		t.Errorf("a razao da recusa nao chegou a tela: %s", corpo)
	}
}

func TestPromptlyDashboard_5xx_do_upstream_continua_502_opaco(t *testing.T) {
	// CONTROLE NEGATIVO obrigatorio. Sem esta metade o repasse vira matcher cego: tudo do upstream
	// atravessaria, inclusive corpo que fala de host, porta e DNS internos.
	f := &promptlyFake{err: &promptly.UpstreamError{
		Status: http.StatusInternalServerError,
		Body:   json.RawMessage(`{"error":"pq: connection refused to promptly-db:5432"}`),
		Method: http.MethodGet, Path: "/prompts",
	}}

	rec := chamar(t, f, http.MethodGet, "/v1/dashboard/promptly/prompts", "")

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, quer 502", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "5432") {
		t.Errorf("topologia interna vazou para o navegador: %s", rec.Body.String())
	}
}

func TestPromptlyDashboard_401_do_upstream_nao_desloga_o_operador(t *testing.T) {
	// A credencial que falhou e a do PLANO DE CONTROLE, nao a do operador. Repassar 401 ao
	// navegador faria alguem perfeitamente autenticado investigar a propria sessao.
	f := &promptlyFake{err: &promptly.UpstreamError{
		Status: http.StatusUnauthorized,
		Body:   json.RawMessage(`{"error":"unauthorized"}`),
		Method: http.MethodGet, Path: "/prompts",
	}}

	rec := chamar(t, f, http.MethodGet, "/v1/dashboard/promptly/prompts", "")

	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, quer 502 — 401 do upstream nao e 401 do operador", rec.Code)
	}
}

func TestPromptlyDashboard_promocao_repassa_versao_e_label(t *testing.T) {
	f := &promptlyFake{corpo: json.RawMessage(`{"name":"saudacao","label":"prod","version":7}`)}

	rec := chamar(t, f, http.MethodPut, "/v1/dashboard/promptly/prompts/saudacao/labels/prod", `{"version":7}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if f.label != "prod" {
		t.Errorf("label repassado = %q", f.label)
	}
	if !strings.Contains(string(f.body), `"version":7`) {
		t.Errorf("versao alvo nao viajou: %s", f.body)
	}
}

func TestPromptlyDashboard_promocao_com_corpo_invalido_para_antes_do_upstream(t *testing.T) {
	// Validar na FRONTEIRA: um corpo sem `version` nao vira requisicao de escrita. Deixar passar
	// gastaria uma promocao malformada contra o servico para receber de volta um 400 que ja
	// poderiamos ter dado.
	f := &promptlyFake{corpo: json.RawMessage(`{}`)}

	rec := chamar(t, f, http.MethodPut, "/v1/dashboard/promptly/prompts/saudacao/labels/prod", `{"versao":7}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, quer 400", rec.Code)
	}
	if f.label != "" {
		t.Error("a escrita foi emitida apesar do corpo invalido")
	}
}
