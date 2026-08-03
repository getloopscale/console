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

func (f *promptlyFake) CreateRevision(_ context.Context, body json.RawMessage) (json.RawMessage, error) {
	f.body = body
	return f.corpo, f.err
}
func (f *promptlyFake) Rollback(_ context.Context, name string, body json.RawMessage) (json.RawMessage, error) {
	f.label, f.body = name, body
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

// ---------------------------------------------------------------------------
// O PAR DO REPASSE DE ERRO, exercitado com o CLIENTE REAL — não com o dublê.
//
// Os testes acima injetam `*promptly.UpstreamError` direto na porta, o que prova o
// handler e assume o cliente. Aqui a cadeia inteira roda: um upstream HTTP de
// verdade responde, o `promptly.DataClient` real constrói (ou não) o erro tipado, e
// o handler decide. É a diferença entre "o handler sabe repassar" e "o repasse
// funciona ponta a ponta".
//
// O 5xx é o lado que não se mede no ar: provocá-lo exigiria derrubar o serviço de
// prompts, e a instância é compartilhada. Aqui ele é provocável com uma linha.
// ---------------------------------------------------------------------------

func montarComUpstream(t *testing.T, status int, corpo string) http.Handler {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(corpo))
	}))
	t.Cleanup(srv.Close)

	dc := promptly.NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "promptly_live_fake", nil })
	wc := promptly.NewWriteClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "promptly_live_fake", nil })

	h := NewPromptlyDashboardHandler(dc, wc, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r := chi.NewRouter()
	MountPromptlyDashboard(r, h, func(next http.Handler) http.Handler { return next })
	return r
}

func TestRepasse_4xx_tipado_atravessa_o_cliente_real(t *testing.T) {
	// A metade JÁ medida no ar (`404 policy_not_found`), aqui com o cliente real.
	app := montarComUpstream(t, http.StatusNotFound, `{"error":"policy_not_found","name":"p","label":"prod"}`)
	rec := httptest.NewRecorder()
	app.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/dashboard/promptly/prompts/p/policies/prod", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, quer 404 — o erro tipado tem de atravessar", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "policy_not_found") {
		t.Errorf("codigo tipado nao chegou: %s", rec.Body.String())
	}
}

func TestRepasse_5xx_continua_502_opaco_com_cliente_real(t *testing.T) {
	// O CONTROLE NEGATIVO. Sem ele o repasse vira matcher cego: tudo do upstream
	// atravessaria, inclusive corpo que fala de host, porta e DNS internos.
	interno := `{"error":"pq: connection refused to promptly-db.internal:5432 (pool exhausted)"}`
	app := montarComUpstream(t, http.StatusInternalServerError, interno)
	rec := httptest.NewRecorder()
	app.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/dashboard/promptly/prompts?limit=5", nil))

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, quer 502 — 5xx do upstream nao e recusa do cliente", rec.Code)
	}
	corpo := rec.Body.String()
	if !strings.Contains(corpo, "PROMPTLY_UPSTREAM_UNAVAILABLE") {
		t.Errorf("corpo opaco esperado, veio: %s", corpo)
	}
	for _, vazamento := range []string{"5432", "promptly-db", "pool exhausted", "pq:"} {
		if strings.Contains(corpo, vazamento) {
			t.Errorf("TOPOLOGIA INTERNA VAZOU para o navegador (%q): %s", vazamento, corpo)
		}
	}
}

func TestRepasse_401_do_upstream_nao_desloga_o_operador_cliente_real(t *testing.T) {
	// A terceira faixa: a credencial que falhou e a do PLANO DE CONTROLE.
	app := montarComUpstream(t, http.StatusUnauthorized, `{"error":"unauthorized"}`)
	rec := httptest.NewRecorder()
	app.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/dashboard/promptly/prompts?limit=5", nil))

	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, quer 502 — repassar 401 deslogaria quem esta autenticado", rec.Code)
	}
}


// ── M12 — as duas escritas da autoria ───────────────────────────────────────────────────────
//
// Existem porque o /review as achou AUSENTES: a tela de criar ja disparava `POST /prompts` e o
// roteador nao conhecia o verbo. O e2e ficava verde porque o mock do navegador respondia 201 —
// provando o mock, nao o produto. Estes testes olham para o ROTEADOR.

func TestPromptlyDashboard_criar_revisao_repassa_o_corpo_opaco(t *testing.T) {
	f := &promptlyFake{corpo: json.RawMessage(`{"name":"boas-vindas","version":1}`)}

	rec := chamar(t, f, http.MethodPost, "/v1/dashboard/promptly/prompts", `{"name":"boas-vindas","content":"Ola {{nome}}"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d — a rota POST /prompts precisa existir", rec.Code)
	}
	// O corpo segue OPACO ate o produto: validar `name`/`content` aqui duplicaria a regra que o
	// servico ja aplica, e as duas copias divergiriam.
	if !strings.Contains(string(f.body), `"content":"Ola {{nome}}"`) {
		t.Errorf("o corpo nao chegou intacto ao cliente de escrita: %s", string(f.body))
	}
	if !strings.Contains(rec.Body.String(), `"boas-vindas"`) {
		t.Errorf("a resposta do servico nao chegou ao navegador: %s", rec.Body.String())
	}
}

func TestPromptlyDashboard_reverter_repassa_o_nome_no_caminho(t *testing.T) {
	f := &promptlyFake{corpo: json.RawMessage(`{"version":3,"labelsMoved":[]}`)}

	rec := chamar(t, f, http.MethodPost, "/v1/dashboard/promptly/prompts/saudacao/rollback", `{"toVersion":1}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d — a rota POST .../rollback precisa existir", rec.Code)
	}
	if f.label != "saudacao" {
		t.Errorf("o nome do prompt nao foi repassado: %q", f.label)
	}
	// `labelsMoved: []` PRECISA chegar a tela: e o dado que separa "revertido" de "revisao criada
	// e nada em producao mudou". Um BFF que o filtrasse recriaria o defeito LT-030.
	if !strings.Contains(rec.Body.String(), `"labelsMoved":[]`) {
		t.Errorf("labelsMoved vazio nao chegou ao navegador: %s", rec.Body.String())
	}
}

func TestPromptlyDashboard_recusa_do_rollback_chega_com_os_labels_disponiveis(t *testing.T) {
	// O par que discrimina: sem a lista, a recusa e um beco; com ela, vira escolha.
	f := &promptlyFake{err: &promptly.UpstreamError{
		Status: http.StatusBadRequest,
		Body:   json.RawMessage(`{"error":"label_required","availableLabels":["prod","staging"]}`),
		Method: http.MethodPost,
		Path:   "/prompts/saudacao/rollback",
	}}

	rec := chamar(t, f, http.MethodPost, "/v1/dashboard/promptly/prompts/saudacao/rollback", `{"toVersion":1}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d — a recusa 4xx do servico tem de ser preservada", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"availableLabels"`) {
		t.Errorf("a lista de labels nao chegou a tela: %s", rec.Body.String())
	}
}

func TestPromptlyDashboard_falha_5xx_na_escrita_NAO_vaza_o_corpo_do_servico(t *testing.T) {
	// O CONTROLE NEGATIVO. Sem ele o repasse de 4xx vira matcher cego e o endereco interno do
	// servico chega ao navegador do cliente.
	f := &promptlyFake{err: &promptly.UpstreamError{
		Status: http.StatusBadGateway,
		Body:   json.RawMessage(`{"error":"dial tcp 10.0.0.4:8080: connect: refused"}`),
		Method: http.MethodPost,
		Path:   "/prompts",
	}}

	rec := chamar(t, f, http.MethodPost, "/v1/dashboard/promptly/prompts", `{"name":"x","content":"y"}`)

	if strings.Contains(rec.Body.String(), "10.0.0.4") {
		t.Errorf("o endereco interno do servico vazou para a tela: %s", rec.Body.String())
	}
}
