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

	"github.com/usetheoai/theo-cloud/internal/skills"
)

// Reusa o logger silencioso e o stub de leitura já usados por `skills_dashboard_test.go` — o
// segundo é o que torna o teste de sombreamento possível sem um segundo dublê equivalente.
func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// M35 — o BFF da superfície de distribuição.
//
// O teste que mais importa aqui é o de SOMBREAMENTO. Este arquivo monta as rotas novas no MESMO
// roteador das de leitura e promoção, porque essa interação só existia no `main.go` — e foi
// exatamente onde a regressão de 2026-08-02 nasceu: um `r.Route` criou subtree e a leitura de
// canais passou a devolver `404 page not found` em produção, com teste nenhum reprovando.

type distribuidorFalso struct {
	chamadas []string
	erro     error
	resposta json.RawMessage
}

func (d *distribuidorFalso) registra(op string) (json.RawMessage, error) {
	d.chamadas = append(d.chamadas, op)
	if d.erro != nil {
		return nil, d.erro
	}
	if d.resposta == nil {
		return json.RawMessage(`{}`), nil
	}
	return d.resposta, nil
}

func (d *distribuidorFalso) ListBundles(context.Context) (json.RawMessage, error) {
	return d.registra("ListBundles")
}
func (d *distribuidorFalso) CreateBundle(_ context.Context, name string) (json.RawMessage, error) {
	return d.registra("CreateBundle:" + name)
}
func (d *distribuidorFalso) ListTokens(_ context.Context, b string) (json.RawMessage, error) {
	return d.registra("ListTokens:" + b)
}
func (d *distribuidorFalso) MintToken(_ context.Context, b string, ttl int, label string) (json.RawMessage, error) {
	return d.registra("MintToken:" + b + ":" + strings.TrimSpace(label))
}
func (d *distribuidorFalso) RevokeToken(_ context.Context, b, tk string) (json.RawMessage, error) {
	return d.registra("RevokeToken:" + b + ":" + tk)
}
func (d *distribuidorFalso) Adoption(_ context.Context, b string, days int) (json.RawMessage, error) {
	return d.registra("Adoption:" + b)
}
func (d *distribuidorFalso) SetBundleItems(_ context.Context, b string, items []skills.BundleItem) (json.RawMessage, error) {
	nomes := make([]string, 0, len(items))
	for _, i := range items {
		nomes = append(nomes, i.SkillID+"@"+i.Channel)
	}
	return d.registra("SetBundleItems:" + b + ":" + strings.Join(nomes, ","))
}

func semJWT(next http.Handler) http.Handler { return next }

func montaDistribuicao(t *testing.T, d *distribuidorFalso) chi.Router {
	t.Helper()
	r := chi.NewRouter()
	MountSkillsDistribution(r, NewSkillsDistributionHandler(d, discardLogger()), semJWT)
	return r
}

func pede(t *testing.T, r chi.Router, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *strings.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	} else {
		rdr = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestDistribuicao_listaBundles(t *testing.T) {
	d := &distribuidorFalso{resposta: json.RawMessage(`{"bundles":[]}`)}
	w := pede(t, montaDistribuicao(t, d), http.MethodGet, "/v1/dashboard/bundles", "")

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, corpo %s", w.Code, w.Body.String())
	}
	if len(d.chamadas) != 1 || d.chamadas[0] != "ListBundles" {
		t.Fatalf("chamadas: %v", d.chamadas)
	}
}

func TestDistribuicao_criaBundleValidandoNaFronteira(t *testing.T) {
	// Nome vazio é recusado AQUI. Encaminhar devolveria o mesmo 400 do upstream, ao custo de uma
	// requisição e de um mint de credencial por erro de digitação — e com a mensagem escrita para
	// quem consome a API, não para quem está na tela.
	d := &distribuidorFalso{}
	r := montaDistribuicao(t, d)

	vazio := pede(t, r, http.MethodPost, "/v1/dashboard/bundles", `{"name":"   "}`)
	if vazio.Code != http.StatusBadRequest {
		t.Fatalf("nome vazio deveria ser 400, veio %d", vazio.Code)
	}
	if len(d.chamadas) != 0 {
		t.Fatalf("não deveria ter chamado o upstream: %v", d.chamadas)
	}

	ok := pede(t, r, http.MethodPost, "/v1/dashboard/bundles", `{"name":"pacote"}`)
	if ok.Code != http.StatusOK && ok.Code != http.StatusCreated {
		t.Fatalf("status %d, corpo %s", ok.Code, ok.Body.String())
	}
	if len(d.chamadas) != 1 || d.chamadas[0] != "CreateBundle:pacote" {
		t.Fatalf("chamadas: %v", d.chamadas)
	}
}

func TestDistribuicao_tokensEAdocao(t *testing.T) {
	d := &distribuidorFalso{}
	r := montaDistribuicao(t, d)

	pede(t, r, http.MethodGet, "/v1/dashboard/bundles/bdl_1/tokens", "")
	pede(t, r, http.MethodPost, "/v1/dashboard/bundles/bdl_1/tokens", `{"ttl_days":30,"label":"ci"}`)
	pede(t, r, http.MethodDelete, "/v1/dashboard/bundles/bdl_1/tokens/dtk_9", "")
	pede(t, r, http.MethodGet, "/v1/dashboard/bundles/bdl_1/adoption?days=90", "")

	esperado := []string{"ListTokens:bdl_1", "MintToken:bdl_1:ci", "RevokeToken:bdl_1:dtk_9", "Adoption:bdl_1"}
	if len(d.chamadas) != len(esperado) {
		t.Fatalf("chamadas: %v", d.chamadas)
	}
	for i, e := range esperado {
		if d.chamadas[i] != e {
			t.Fatalf("chamada %d: esperava %q, veio %q", i, e, d.chamadas[i])
		}
	}
}

func TestDistribuicao_ttlInvalidoNaoChegaAoUpstream(t *testing.T) {
	// `ttl_days` ausente ou não-positivo geraria um token já expirado — ou um erro do registro
	// escrito para quem lê a API. A fronteira recusa antes.
	d := &distribuidorFalso{}
	r := montaDistribuicao(t, d)

	for _, corpo := range []string{`{}`, `{"ttl_days":0}`, `{"ttl_days":-5}`} {
		w := pede(t, r, http.MethodPost, "/v1/dashboard/bundles/bdl_1/tokens", corpo)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("corpo %s deveria ser 400, veio %d", corpo, w.Code)
		}
	}
	if len(d.chamadas) != 0 {
		t.Fatalf("não deveria ter chamado o upstream: %v", d.chamadas)
	}
}

// O teste que a regressão de 2026-08-02 ensinou a escrever.
//
// Monta as TRÊS famílias no mesmo roteador — leitura de skills, promoção e distribuição — e
// verifica que nenhuma sombreia as outras. Um `r.Route` na distribuição criaria subtree e mataria
// rotas vizinhas; um caminho `/v1/dashboard/skills/bundles` faria o chi tratar `bundles` como um
// `{skillID}`. Nenhum dos dois defeitos aparece testando cada família isolada.
func TestDistribuicao_naoSombreiaAsRotasDeSkills(t *testing.T) {
	leitor := &stubSkillsReader{}
	distribuidor := &distribuidorFalso{}

	r := chi.NewRouter()
	MountSkillsDashboard(r, NewSkillsDashboardHandler(leitor, discardLogger()), semJWT)
	MountSkillsDistribution(r, NewSkillsDistributionHandler(distribuidor, discardLogger()), semJWT)

	// A leitura de uma skill continua funcionando — a rota de bundles não a engoliu.
	if w := pede(t, r, http.MethodGet, "/v1/dashboard/skills/sk_1", ""); w.Code != http.StatusOK {
		t.Fatalf("leitura de skill quebrou: %d %s", w.Code, w.Body.String())
	}
	// E a de canais, que foi a que quebrou em produção da última vez.
	if w := pede(t, r, http.MethodGet, "/v1/dashboard/skills/sk_1/channels", ""); w.Code != http.StatusOK {
		t.Fatalf("leitura de canais quebrou: %d %s", w.Code, w.Body.String())
	}
	// E a distribuição responde no seu próprio caminho.
	if w := pede(t, r, http.MethodGet, "/v1/dashboard/bundles", ""); w.Code != http.StatusOK {
		t.Fatalf("distribuição quebrou: %d %s", w.Code, w.Body.String())
	}
}

func TestDistribuicao_editaOsItensDoPacote(t *testing.T) {
	d := &distribuidorFalso{}
	r := montaDistribuicao(t, d)

	w := pede(t, r, http.MethodPut, "/v1/dashboard/bundles/bdl_1/items",
		`{"items":[{"skill_id":"sk_a","channel":"stable"}]}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, corpo %s", w.Code, w.Body.String())
	}
	if len(d.chamadas) != 1 || d.chamadas[0] != "SetBundleItems:bdl_1:sk_a@stable" {
		t.Fatalf("chamadas: %v", d.chamadas)
	}
}

func TestDistribuicao_esvaziarOPacoteEOperacaoLegitima(t *testing.T) {
	// Esvaziar é como se revoga o conteúdo de um pacote sem apagá-lo. Recusar aqui deixaria a
	// tela sem como desfazer o que o operador montou.
	d := &distribuidorFalso{}
	w := pede(t, montaDistribuicao(t, d), http.MethodPut, "/v1/dashboard/bundles/bdl_1/items", `{"items":[]}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, corpo %s", w.Code, w.Body.String())
	}
	if len(d.chamadas) != 1 || d.chamadas[0] != "SetBundleItems:bdl_1:" {
		t.Fatalf("chamadas: %v", d.chamadas)
	}
}

func TestDistribuicao_itemSemCanalNaoChegaAoUpstream(t *testing.T) {
	// Um item sem canal não é um item: o canal é o que torna o pacote vivo, e sem ele o registro
	// não sabe qual revisão servir. Recusar na fronteira poupa a ida e escreve a mensagem para
	// quem está na tela.
	d := &distribuidorFalso{}
	r := montaDistribuicao(t, d)

	for _, corpo := range []string{
		`{"items":[{"skill_id":"sk_a"}]}`,
		`{"items":[{"skill_id":"","channel":"stable"}]}`,
		`{"nao_e_items":[]}`,
	} {
		if w := pede(t, r, http.MethodPut, "/v1/dashboard/bundles/bdl_1/items", corpo); w.Code != http.StatusBadRequest {
			t.Fatalf("corpo %s deveria ser 400, veio %d", corpo, w.Code)
		}
	}
	if len(d.chamadas) != 0 {
		t.Fatalf("não deveria ter chamado o upstream: %v", d.chamadas)
	}
}
