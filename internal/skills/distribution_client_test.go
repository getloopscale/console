package skills

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// M35 — o cliente da superfície de DISTRIBUIÇÃO (bundles, tokens delegados, adoção).
//
// Por que os testes olham o MÉTODO e o CAMINHO, e não só o corpo devolvido: o defeito que o M35
// caçou do outro lado foi exatamente esse — um método correto apontando para lugar nenhum. Um
// cliente que devolve o JSON esperado porque o servidor de teste responde qualquer coisa em
// qualquer rota não prova nada sobre a integração real.

func novoServidorDeDistribuicao(t *testing.T, registrar func(w http.ResponseWriter, r *http.Request)) (*httptest.Server, *[]string) {
	t.Helper()
	vistos := &[]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// `EscapedPath()`, não `Path`: o segundo já vem DECODIFICADO pelo servidor, e um teste que
		// o inspeciona mede o que o servidor Go entendeu — não o que o cliente transmitiu. Foi o
		// que quase me fez reportar um defeito inexistente: `url.PathEscape` escapa corretamente
		// (`..%2F..%2F`), `URL.String()` transmite o escapado, e só o receptor decodifica.
		*vistos = append(*vistos, r.Method+" "+r.URL.EscapedPath())
		registrar(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, vistos
}

func clienteDeDistribuicao(srv *httptest.Server) *DataClient {
	return NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "chave-de-publicacao", nil })
}

func TestListBundles_bateNaRotaCerta(t *testing.T) {
	srv, vistos := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"bundles":[{"bundle_id":"bdl_1","name":"pacote"}]}`))
	})

	raw, err := clienteDeDistribuicao(srv).ListBundles(context.Background())
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if got := (*vistos)[0]; got != "GET /v1/bundles" {
		t.Fatalf("rota errada: %q", got)
	}
	if !strings.Contains(string(raw), "bdl_1") {
		t.Fatalf("corpo do upstream não atravessou: %s", raw)
	}
}

func TestCreateBundle_enviaONomeNoCorpo(t *testing.T) {
	var corpo string
	srv, vistos := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		corpo = string(b)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"bundle_id":"bdl_novo"}`))
	})

	if _, err := clienteDeDistribuicao(srv).CreateBundle(context.Background(), "meu pacote"); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if got := (*vistos)[0]; got != "POST /v1/bundles" {
		t.Fatalf("rota errada: %q", got)
	}
	var enviado map[string]string
	if err := json.Unmarshal([]byte(corpo), &enviado); err != nil {
		t.Fatalf("corpo não é JSON: %q", corpo)
	}
	if enviado["name"] != "meu pacote" {
		t.Fatalf("o nome não chegou ao upstream: %v", enviado)
	}
}

func TestListTokens_escapaOIdentificadorNoCaminho(t *testing.T) {
	// Um bundleId com `../` sairia do caminho pretendido e leria outro recurso. O escape é o que
	// mantém o alvo da requisição igual ao que a tela mostrou ao operador.
	//
	// A asserção é sobre o que ATRAVESSA a rede (`EscapedPath`). Medir o caminho decodificado
	// reprovaria um cliente correto: quem desfaz o `%2F` é o receptor, não o emissor.
	srv, vistos := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"bundle_id":"x","tokens":[]}`))
	})

	if _, err := clienteDeDistribuicao(srv).ListTokens(context.Background(), "../../v1/skills"); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	got := (*vistos)[0]
	if !strings.HasPrefix(got, "GET /v1/bundles/") || !strings.HasSuffix(got, "/tokens") {
		t.Fatalf("a rota não é a pretendida: %q", got)
	}
	// As barras do identificador viajam escapadas — logo NÃO viram separadores de caminho.
	if strings.Contains(got, "../") || strings.Contains(got, "/v1/skills") {
		t.Fatalf("o identificador escapou do caminho: %q", got)
	}
	if !strings.Contains(got, "%2F") {
		t.Fatalf("esperava as barras escapadas na rede: %q", got)
	}
}

func TestMintToken_enviaTtlELabel(t *testing.T) {
	var corpo string
	srv, vistos := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		corpo = string(b)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"token_id":"dtk_1","token":"segredo"}`))
	})

	raw, err := clienteDeDistribuicao(srv).MintToken(context.Background(), "bdl_1", 30, "ci")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if got := (*vistos)[0]; got != "POST /v1/bundles/bdl_1/tokens" {
		t.Fatalf("rota errada: %q", got)
	}
	var enviado map[string]any
	if err := json.Unmarshal([]byte(corpo), &enviado); err != nil {
		t.Fatalf("corpo não é JSON: %q", corpo)
	}
	if enviado["ttl_days"] != float64(30) || enviado["label"] != "ci" {
		t.Fatalf("ttl/label não chegaram: %v", enviado)
	}
	// O valor do token atravessa NESTA resposta e só nesta — é a única vez que ele existe em claro.
	if !strings.Contains(string(raw), "segredo") {
		t.Fatalf("o valor cunhado precisa atravessar na criação: %s", raw)
	}
}

func TestMintToken_omiteLabelVazio(t *testing.T) {
	// Mandar `"label":""` faria o registro gravar um rótulo vazio em vez de nenhum — e a tela
	// passaria a exibir uma linha em branco onde deveria dizer "sem rótulo".
	var corpo string
	srv, _ := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		corpo = string(b)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"token_id":"dtk_1"}`))
	})

	if _, err := clienteDeDistribuicao(srv).MintToken(context.Background(), "bdl_1", 7, ""); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if strings.Contains(corpo, "label") {
		t.Fatalf("label vazio não deveria ser enviado: %q", corpo)
	}
}

func TestRevokeToken_usaDeleteNoCaminhoDoToken(t *testing.T) {
	srv, vistos := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"revoked":true}`))
	})

	if _, err := clienteDeDistribuicao(srv).RevokeToken(context.Background(), "bdl_1", "dtk_9"); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if got := (*vistos)[0]; got != "DELETE /v1/bundles/bdl_1/tokens/dtk_9" {
		t.Fatalf("rota errada: %q", got)
	}
}

func TestAdoption_carregaAJanelaNaQuery(t *testing.T) {
	var query string
	srv, vistos := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"total_installs":7,"adoption":[]}`))
	})

	raw, err := clienteDeDistribuicao(srv).Adoption(context.Background(), "bdl_1", 90)
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if got := (*vistos)[0]; got != "GET /v1/bundles/bdl_1/adoption" {
		t.Fatalf("rota errada: %q", got)
	}
	if query != "days=90" {
		t.Fatalf("a janela não chegou ao upstream: %q", query)
	}
	// O denominador é o que a tela usa para calcular proporção — se sumir, o gráfico mente calado.
	if !strings.Contains(string(raw), `"total_installs":7`) {
		t.Fatalf("o denominador não atravessou: %s", raw)
	}
}

func TestDistribuicao_chaveSemPublishERecusadaComErroTipado(t *testing.T) {
	// A recusa por escopo precisa chegar DISTINGUÍVEL de indisponibilidade, senão a tela oferece
	// "tente de novo" sobre algo que nunca vai funcionar com aquela credencial.
	srv, _ := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"forbidden","details":"scope skills:publish required"}`))
	})

	_, err := clienteDeDistribuicao(srv).ListBundles(context.Background())
	ue, ok := AsUpstreamError(err)
	if !ok || ue.Status != http.StatusForbidden {
		t.Fatalf("esperava UpstreamError 403 tipado, veio %v", err)
	}
	if !strings.Contains(string(ue.Body), "skills:publish") {
		t.Fatalf("o motivo da recusa precisa sobreviver para a tela explicar: %s", ue.Body)
	}
}

func TestDistribuicao_semResolverNaoEmiteRequisicao(t *testing.T) {
	// Fail-closed: sem credencial de inquilino, ZERO requisição — em vez de uma emitida com a
	// credencial errada, que é como um vazamento entre inquilinos começa.
	srv, vistos := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	})

	semResolver := NewDataClient(srv.URL, srv.Client())
	if _, err := semResolver.ListBundles(context.Background()); err == nil {
		t.Fatal("cliente sem resolver deveria falhar antes da rede")
	}
	if len(*vistos) != 0 {
		t.Fatalf("emitiu requisição sem credencial: %v", *vistos)
	}
}

func TestSetBundleItems_substituiAListaInteira(t *testing.T) {
	// O registro SUBSTITUI, não mescla — e o cliente precisa refletir isso, porque "adicionar sem
	// poder remover" produz pacotes que só crescem, e um item esquecido lá dentro é acesso que
	// ninguém pretendeu conceder.
	var corpo string
	srv, vistos := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		corpo = string(b)
		_, _ = w.Write([]byte(`{"bundle_id":"bdl_1","items":[]}`))
	})

	itens := []BundleItem{{SkillID: "sk_a", Channel: "stable"}, {SkillID: "sk_b", Channel: "beta"}}
	if _, err := clienteDeDistribuicao(srv).SetBundleItems(context.Background(), "bdl_1", itens); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if got := (*vistos)[0]; got != "PUT /v1/bundles/bdl_1/items" {
		t.Fatalf("rota errada: %q", got)
	}

	var enviado struct {
		Items []struct {
			SkillID string `json:"skill_id"`
			Channel string `json:"channel"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(corpo), &enviado); err != nil {
		t.Fatalf("corpo não é JSON: %q", corpo)
	}
	if len(enviado.Items) != 2 || enviado.Items[0].SkillID != "sk_a" || enviado.Items[1].Channel != "beta" {
		t.Fatalf("os itens não chegaram na forma do contrato: %q", corpo)
	}
}

func TestSetBundleItems_listaVaziaEsvaziaOPacote(t *testing.T) {
	// Esvaziar é uma operação LEGÍTIMA — é como se revoga o conteúdo de um pacote sem apagá-lo.
	// Um cliente que omitisse `items` ao receber lista vazia faria o registro recusar com 400, e
	// a tela ficaria sem como desfazer o que montou.
	var corpo string
	srv, _ := novoServidorDeDistribuicao(t, func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		corpo = string(b)
		_, _ = w.Write([]byte(`{"bundle_id":"bdl_1","items":[]}`))
	})

	if _, err := clienteDeDistribuicao(srv).SetBundleItems(context.Background(), "bdl_1", nil); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(corpo, `"items":[]`) {
		t.Fatalf("lista vazia precisa viajar como `[]`, não omitida nem `null`: %q", corpo)
	}
}
