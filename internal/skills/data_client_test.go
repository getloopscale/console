package skills

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// O que estes testes protegem, em ordem de gravidade:
//
//  1. ISOLAMENTO — o cliente nao guarda credencial. A chave sai de um resolvedor ligado ao
//     CONTEXTO, entao nao existe parametro por onde a tela peca dados de outro inquilino. Sem
//     resolvedor, ou com resolvedor em erro, NENHUMA requisicao sai: e assim que comeca um
//     vazamento entre clientes, e um 401 do upstream mandaria investigar autenticacao quando o
//     defeito e de fiacao.
//  2. RECUSA TIPADA — um 422 do registro tem de chegar como DADO, nao como texto. A referencia
//     (`internal/trust/data_client.go:144-149`) faz `fmt.Errorf` e perde o codigo; o comentario
//     dela ate reconhece que o codigo "e diagnostico util" antes de o transformar em string.
//  3. SEGREDO — o bearer nunca aparece em mensagem de erro nenhuma.

// servidorFalso devolve um servidor e um ponteiro para o numero de requisicoes recebidas, que e
// como se prova que uma requisicao NAO saiu (contador == 0), em vez de so verificar que houve erro.
func servidorFalso(t *testing.T, status int, corpo string) (*httptest.Server, *int, *[]string) {
	t.Helper()
	chamadas := 0
	caminhos := []string{}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chamadas++
		// EscapedPath(), nao Path: o servidor entrega `Path` ja DECODIFICADO, entao um `%2F`
		// corretamente escapado reaparece ali como `/` e a assercao de escape fica incapaz de
		// distinguir escapado de nao-escapado. Foi o que me fez ler uma falha inexistente.
		caminhos = append(caminhos, r.URL.EscapedPath())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(corpo))
	}))
	t.Cleanup(s.Close)
	return s, &chamadas, &caminhos
}

func clienteCom(t *testing.T, s *httptest.Server, chave string, erroDaChave error) *DataClient {
	t.Helper()
	return NewDataClient(s.URL, s.Client()).WithKeyResolver(
		func(context.Context) (string, error) { return chave, erroDaChave },
	)
}

func TestDataClient_semResolvedorNENHUMARequisicaoSai(t *testing.T) {
	// Falha FECHADO. A assercao que discrimina e o CONTADOR: uma implementacao que fizesse a
	// requisicao sem Authorization e devolvesse o 401 do upstream tambem retornaria erro — e
	// passaria num teste que so verificasse `err != nil`. So o contador separa as duas.
	s, chamadas, _ := servidorFalso(t, 200, `{}`)
	c := NewDataClient(s.URL, s.Client()) // sem WithKeyResolver

	_, err := c.List(context.Background(), 20, "")
	if err == nil {
		t.Fatal("sem resolvedor o cliente deveria recusar — nao recusou")
	}
	if *chamadas != 0 {
		t.Errorf("SAIU requisicao sem credencial de inquilino (%d chamadas) — isto e como comeca um vazamento", *chamadas)
	}
}

func TestDataClient_resolvedorEmErroNaoCaiParaChaveMestra(t *testing.T) {
	s, chamadas, _ := servidorFalso(t, 200, `{}`)
	c := clienteCom(t, s, "", errors.New("tenant sem chave cunhada"))

	_, err := c.Get(context.Background(), "sk_1")
	if err == nil {
		t.Fatal("resolvedor em erro deveria falhar fechado")
	}
	if *chamadas != 0 {
		t.Errorf("houve fallback: %d requisicao(oes) sairam apesar do resolvedor em erro", *chamadas)
	}
}

func TestDataClient_recusaTipadaDoRegistroChegaComoDado(t *testing.T) {
	// A ASSERÇÃO CENTRAL do T1.1+T1.2. A versao com `fmt.Errorf` passa em "a mensagem contem
	// INVALID_FRONTMATTER" e FALHA aqui, porque aqui o codigo e extraido e comparado como campo.
	s, _, _ := servidorFalso(t, 422, `{"code":"INVALID_FRONTMATTER","message":"campo 'version' ausente"}`)
	c := clienteCom(t, s, "sk_tenant", nil)

	_, err := c.Get(context.Background(), "sk_1")
	if err == nil {
		t.Fatal("422 do upstream deveria virar erro")
	}
	ue, ok := AsUpstreamError(err)
	if !ok {
		t.Fatalf("a recusa colapsou em erro nao-tipado (%T): a tela nao consegue decidir sobre o codigo", err)
	}
	if ue.Status != 422 {
		t.Errorf("status perdido: %d", ue.Status)
	}
	var d struct{ Code, Message string }
	if e := json.Unmarshal(ue.Body, &d); e != nil {
		t.Fatalf("corpo nao navegavel: %v", e)
	}
	if d.Code != "INVALID_FRONTMATTER" || d.Message == "" {
		t.Errorf("codigo/mensagem acionaveis perdidos: %+v", d)
	}
	if !ue.IsClientRefusal() {
		t.Error("422 deveria ser recusa do cliente — acionavel por ele")
	}
}

func TestDataClient_erroDoRegistroNaoEhRecusaDoCliente(t *testing.T) {
	// 5xx tambem vira UpstreamError (para o log ter status+corpo), mas NAO e acionavel pelo
	// operador — e essa diferenca e que decide o que a tela mostra.
	s, _, _ := servidorFalso(t, 503, `{"error":"database unavailable"}`)
	c := clienteCom(t, s, "sk_tenant", nil)

	_, err := c.List(context.Background(), 20, "")
	ue, ok := AsUpstreamError(err)
	if !ok {
		t.Fatalf("503 deveria chegar tipado para o log: %T", err)
	}
	if ue.IsClientRefusal() {
		t.Error("503 marcado como recusa do cliente — o operador nao tem o que corrigir")
	}
}

func TestDataClient_bearerNuncaAparecEmMensagemDeErro(t *testing.T) {
	const segredo = "sk_live_naodeveaparecer_9f3a"
	s, _, _ := servidorFalso(t, 500, `{"error":"boom"}`)
	c := clienteCom(t, s, segredo, nil)

	_, err := c.Get(context.Background(), "sk_1")
	if err == nil {
		t.Fatal("esperava erro")
	}
	// Cobre a cadeia inteira, nao so a camada de cima: um %w mais abaixo poderia carregar o
	// segredo mesmo com a mensagem do topo limpa.
	if msg := fmt.Sprintf("%v / %+v", err, err); strings.Contains(msg, segredo) {
		t.Error("o bearer do inquilino vazou na mensagem de erro")
	}
}

func TestDataClient_cadaLeituraBateNoCaminhoRealDaAPI(t *testing.T) {
	// Impede caminho FABRICADO. Os literais abaixo foram medidos em
	// loopskills/packages/api/src/server/app.ts — nao inferidos do nome do metodo.
	casos := []struct {
		nome    string
		chamar  func(*DataClient) error
		caminho string
	}{
		{"List", func(c *DataClient) error { _, e := c.List(context.Background(), 20, ""); return e }, "/v1/skills"},
		{"Get", func(c *DataClient) error { _, e := c.Get(context.Background(), "sk_1"); return e }, "/v1/skills/sk_1"},
		{"Versions", func(c *DataClient) error { _, e := c.Versions(context.Background(), "sk_1"); return e }, "/v1/skills/sk_1/versions"},
		{"Channels", func(c *DataClient) error { _, e := c.Channels(context.Background(), "sk_1"); return e }, "/v1/skills/sk_1/channels"},
		{"Instructions", func(c *DataClient) error { _, e := c.Instructions(context.Background(), "sk_1"); return e }, "/v1/skills/sk_1/instructions"},
	}
	for _, caso := range casos {
		t.Run(caso.nome, func(t *testing.T) {
			s, _, caminhos := servidorFalso(t, 200, `{"ok":true}`)
			c := clienteCom(t, s, "sk_tenant", nil)
			if err := caso.chamar(c); err != nil {
				t.Fatalf("chamada falhou: %v", err)
			}
			if len(*caminhos) != 1 || (*caminhos)[0] != caso.caminho {
				t.Errorf("caminho errado: quero %q, bateu em %v", caso.caminho, *caminhos)
			}
		})
	}
}

func TestDataClient_idDoRecursoEhEscapadoNaURL(t *testing.T) {
	// Um id com barra montaria um caminho diferente do pretendido. Nao e teorico: ids vem da
	// URL da tela, e a tela recebe o que o navegador mandar.
	s, _, caminhos := servidorFalso(t, 200, `{}`)
	c := clienteCom(t, s, "sk_tenant", nil)

	_, _ = c.Get(context.Background(), "sk_1/../../admin")
	if len(*caminhos) == 1 && strings.Contains((*caminhos)[0], "/admin") {
		t.Errorf("id nao escapado — o caminho virou %q", (*caminhos)[0])
	}
}

func TestDataClient_corpoGiganteNaoEhLidoInteiro(t *testing.T) {
	// O plano de controle serve TODOS os inquilinos: uma resposta anomala do registro nao pode
	// virar pressao de memoria aqui.
	enorme := strings.Repeat("a", 12<<20) // 12 MiB > teto de 8 MiB
	s, _, _ := servidorFalso(t, 200, `{"x":"`+enorme+`"}`)
	c := clienteCom(t, s, "sk_tenant", nil)

	raw, err := c.List(context.Background(), 20, "")
	if err == nil && len(raw) > (9<<20) {
		t.Errorf("leu %d bytes — o teto de %d nao foi aplicado", len(raw), maxBodyBytes)
	}
}

func TestDataClient_respostaAtravessaSemRemodelagem(t *testing.T) {
	// O BFF e proxy, nao tradutor. Re-tipar aqui criaria um segundo schema para manter em
	// sincronia com o registro, e toda divergencia viraria bug silencioso de renderizacao.
	original := `{"skills":[{"id":"sk_1","name":"pdf-summarizer","unknown_future_field":42}]}`
	s, _, _ := servidorFalso(t, 200, original)
	c := clienteCom(t, s, "sk_tenant", nil)

	raw, err := c.List(context.Background(), 20, "")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	var a, b any
	_ = json.Unmarshal([]byte(original), &a)
	if e := json.Unmarshal(raw, &b); e != nil {
		t.Fatalf("resposta nao e JSON: %v", e)
	}
	if fmt.Sprint(a) != fmt.Sprint(b) {
		t.Errorf("a resposta foi re-modelada no caminho:\n quero %s\n tenho %s", original, raw)
	}
}

// M31 — a descoberta: a razão de existir do produto, e a única jornada sem tela.
func TestRetrieve_levaAConsultaEOsFiltrosNaQuery(t *testing.T) {
	var query string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"skills":[{"skill_id":"sk_a","score":0.87,"matched":["lexical"]}]}`))
	}))
	defer srv.Close()

	cli := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	raw, err := cli.Retrieve(context.Background(), "converter moeda", 5, true, true)
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	// A consulta precisa chegar ESCAPADA: um espaço cru quebraria a URL, e um `&` na intenção do
	// operador viraria outro parâmetro.
	if !strings.Contains(query, "query=converter+moeda") && !strings.Contains(query, "query=converter%20moeda") {
		t.Fatalf("a consulta não atravessou escapada: %q", query)
	}
	if !strings.Contains(query, "top_k=5") {
		t.Fatalf("top_k não atravessou: %q", query)
	}
	// Os filtros de ciclo de vida são o que torna a tela capaz de mostrar o que a descoberta
	// ESCONDE por padrão — sem eles o operador não consegue verificar que uma deprecada sumiu.
	if !strings.Contains(query, "include_draft=true") || !strings.Contains(query, "include_deprecated=true") {
		t.Fatalf("os filtros de ciclo de vida não atravessaram: %q", query)
	}
	// `score` e `matched` atravessam intactos: são as DUAS informações que a DoD exige na tela, e
	// re-tipá-las aqui criaria um segundo schema para divergir do registro.
	if !strings.Contains(string(raw), `"score":0.87`) || !strings.Contains(string(raw), `"matched":["lexical"]`) {
		t.Fatalf("score/matched não atravessaram: %s", raw)
	}
}

func TestRetrieve_semFiltrosNaoOsEnvia(t *testing.T) {
	// Mandar `include_deprecated=false` é diferente de não mandar: o primeiro afirma uma escolha,
	// o segundo herda o default do serviço. A tela só deve afirmar o que o operador marcou.
	var query string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"skills":[]}`))
	}))
	defer srv.Close()

	cli := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	if _, err := cli.Retrieve(context.Background(), "algo", 3, false, false); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if strings.Contains(query, "include_draft") || strings.Contains(query, "include_deprecated") {
		t.Fatalf("filtros não marcados não deveriam ser enviados: %q", query)
	}
}

func TestList_pedeOTamanhoDePaginaComONomeQueORegistroLE(t *testing.T) {
	// MEDIDO no app-dev em 2026-08-04: `GET /v1/dashboard/skills?limit=3` devolveu as 10 skills
	// do acervo e NENHUM `next_page_token`.
	//
	// O registro le `page_size` (`handlers/skills.ts:320`); este cliente enviava `limit`. Como
	// nomes divergentes nao produzem erro — a query so e ignorada —, o pedido da tela sumia em
	// silencio e o registro aplicava seu proprio default de 50.
	//
	// Consequencia pratica: a tela pede 100 e recebe 50, entao gasta o dobro de idas ao servidor
	// para varrer o mesmo acervo. Pior que o custo e o diagnostico: o handler do BFF aplica um
	// `maxLimit` que sugere governar o tamanho da pagina, e ele nao governava coisa alguma.
	var query string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"skills":[],"next_page_token":null}`))
	}))
	defer srv.Close()

	cli := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	if _, err := cli.List(context.Background(), 3, ""); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(query, "page_size=3") {
		t.Fatalf("o tamanho de pagina precisa viajar como `page_size`, que e o nome que o registro le: %q", query)
	}
	if strings.Contains(query, "limit=") {
		t.Fatalf("`limit` nao existe no contrato do registro — enviar o nome errado e ser ignorado em silencio: %q", query)
	}
}

func TestList_semTamanhoNaoInventaUm(t *testing.T) {
	// Nao enviar e diferente de enviar o default: o primeiro deixa o registro escolher, o segundo
	// congela aqui um numero que so o registro deveria conhecer.
	var query string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"skills":[]}`))
	}))
	defer srv.Close()

	cli := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	if _, err := cli.List(context.Background(), 0, ""); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if strings.Contains(query, "page_size") {
		t.Fatalf("sem tamanho pedido, nada deveria viajar: %q", query)
	}
}
