package promptly

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// errSemTenant e a falha do resolver: nenhum inquilino autenticado no contexto.
var errSemTenant = errors.New("promptly dashboard: no authenticated tenant in context")

// O contrato deste cliente tem tres invariantes, e cada um ja produziu (ou preveniu) um defeito
// real em algum vertical: fail-closed antes de qualquer I/O, erro do upstream TIPADO, e o
// identificador escapado no caminho.

func clienteContra(t *testing.T, h http.HandlerFunc) (*DataClient, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "promptly_live_x", nil }), srv
}

func TestDataClient_sem_resolver_nao_emite_requisicao(t *testing.T) {
	// Fail-closed ANTES da rede. Se a requisicao saisse, ela sairia SEM credencial de inquilino —
	// e o 401 do upstream mandaria o operador investigar autenticacao quando o defeito e de fiacao.
	saiu := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { saiu = true }))
	defer srv.Close()
	c := NewDataClient(srv.URL, srv.Client()) // resolver DELIBERADAMENTE ausente

	_, _, err := c.Catalog(context.Background(), 0, "")

	if err == nil {
		t.Fatal("cliente sem resolver deveria falhar fechado")
	}
	if saiu {
		t.Error("requisicao saiu sem credencial de inquilino — e o comeco de um vazamento entre tenants")
	}
}

func TestDataClient_resolver_em_erro_nao_emite_requisicao(t *testing.T) {
	saiu := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { saiu = true }))
	defer srv.Close()
	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) {
			return "", errSemTenant
		})

	_, _, err := c.Catalog(context.Background(), 0, "")

	if err == nil {
		t.Fatal("resolver em erro deveria propagar")
	}
	if saiu {
		t.Error("requisicao saiu apesar de o resolver ter falhado")
	}
}

func TestDataClient_catalogo_encaminha_limite_e_cursor(t *testing.T) {
	// O limite EXPLICITO e o que impede a tela de puxar o inquilino inteiro; se ele nao viajar,
	// a paginacao do servico existe e nao serve para nada.
	var visto string
	c, _ := clienteContra(t, func(w http.ResponseWriter, r *http.Request) {
		visto = r.URL.RequestURI()
		_, _ = w.Write([]byte(`[]`))
	})

	_, _, err := c.Catalog(context.Background(), 25, "saudacao")

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(visto, "limit=25") || !strings.Contains(visto, "after=saudacao") {
		t.Errorf("limite/cursor nao viajaram: %s", visto)
	}
}

func TestDataClient_revisoes_pedem_limite_pequeno_e_explicito(t *testing.T) {
	// Cada revisao carrega o CONTEUDO integral do prompt (medido). Sem `?limit`, o servico aplica
	// o teto dele (100) e a tela baixa ate 100 corpos de prompt para renderizar uma lista.
	var visto string
	c, _ := clienteContra(t, func(w http.ResponseWriter, r *http.Request) {
		visto = r.URL.RequestURI()
		_, _ = w.Write([]byte(`[]`))
	})

	_, err := c.Revisions(context.Background(), "saudacao", 10, 0)

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !strings.Contains(visto, "limit=10") {
		t.Errorf("a requisicao de revisoes precisa carregar ?limit explicito: %s", visto)
	}
}

func TestDataClient_nome_com_barra_nao_escapa_do_segmento(t *testing.T) {
	// Sem escape, um nome como `a/../b` alcancaria OUTRO recurso — com o Bearer do tenant ja
	// anexado. Vale para leitura; na escrita a mesma falha apagaria/moveria outra coisa.
	var caminho string
	c, _ := clienteContra(t, func(w http.ResponseWriter, r *http.Request) {
		caminho = r.URL.EscapedPath()
		_, _ = w.Write([]byte(`{}`))
	})

	_, err := c.Prompt(context.Background(), "a/b")

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if strings.Contains(caminho, "a/b") {
		t.Errorf("nome nao foi escapado — vazou para o caminho: %s", caminho)
	}
}

func TestDataClient_recusa_do_upstream_sai_tipada_e_nao_como_texto(t *testing.T) {
	// A DIVERGENCIA deliberada da referencia (`internal/trust/data_client.go:144` colapsa em
	// fmt.Errorf). A tela precisa DECIDIR sobre o codigo: `policy_not_found` significa "promocao
	// livre" e renderiza diferente de "nao consegui ler".
	c, _ := clienteContra(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"policy_not_found","name":"saudacao","label":"prod"}`))
	})

	_, err := c.Policy(context.Background(), "saudacao", "prod")

	ue, ok := AsUpstreamError(err)
	if !ok {
		t.Fatalf("erro nao saiu tipado: %v", err)
	}
	if ue.Status != http.StatusNotFound {
		t.Errorf("status = %d, quer 404", ue.Status)
	}
	var corpo map[string]any
	if e := json.Unmarshal(ue.Body, &corpo); e != nil || corpo["error"] != "policy_not_found" {
		t.Errorf("codigo tipado nao sobreviveu: %s", ue.Body)
	}
}

func TestDataClient_bearer_nunca_aparece_na_mensagem_de_erro(t *testing.T) {
	// Mensagem de erro vira log, e log vira ticket. O caminho ajuda; a credencial nao.
	c, _ := clienteContra(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	})

	_, _, err := c.Catalog(context.Background(), 0, "")

	if err == nil {
		t.Fatal("5xx deveria falhar")
	}
	if strings.Contains(err.Error(), "promptly_live_x") {
		t.Errorf("credencial vazou na mensagem: %v", err)
	}
}

func TestDataClient_labels_e_catalogo_batem_nos_caminhos_do_servico(t *testing.T) {
	// Os caminhos sao medidos contra a definicao de rotas do theo-promptly, nao inferidos do nome
	// do metodo: um caminho errado responde 404 e a tela renderiza "nao ha nada" para sempre.
	casos := []struct {
		nome    string
		chamar  func(*DataClient) error
		caminho string
	}{
		{"catalogo", func(c *DataClient) error { _, _, e := c.Catalog(context.Background(), 0, ""); return e }, "/prompts"},
		{"prompt", func(c *DataClient) error { _, e := c.Prompt(context.Background(), "s"); return e }, "/prompts/s"},
		{"revisoes", func(c *DataClient) error { _, e := c.Revisions(context.Background(), "s", 5, 0); return e }, "/prompts/s/revisions"},
		{"labels", func(c *DataClient) error { _, e := c.Labels(context.Background(), "s"); return e }, "/prompts/s/labels"},
		{"politica", func(c *DataClient) error { _, e := c.Policy(context.Background(), "s", "prod"); return e }, "/prompts/s/policies/prod"},
	}
	for _, caso := range casos {
		t.Run(caso.nome, func(t *testing.T) {
			var visto string
			c, _ := clienteContra(t, func(w http.ResponseWriter, r *http.Request) {
				visto = r.URL.Path
				_, _ = w.Write([]byte(`{}`))
			})
			if err := caso.chamar(c); err != nil {
				t.Fatalf("erro inesperado: %v", err)
			}
			if visto != caso.caminho {
				t.Errorf("caminho = %q, quer %q", visto, caso.caminho)
			}
		})
	}
}

// ---------------------------------------------------------------------------------------------
// M13 — o sinal de continuacao de pagina.
//
// O theo-promptly sinaliza proxima pagina por header RFC-5988 (`Link: <...>; rel="next"`, montado
// em packages/api/src/server/app.ts:594 pedindo limit+1 para nao gastar segunda consulta). Ate
// aqui este cliente devolvia so o corpo, e o sinal MORRIA nesta funcao — antes de qualquer decisao
// de produto. Enquanto ele morresse aqui, nenhuma camada acima podia ser honesta: toda contagem
// exibida no painel seria um limite inferior apresentado como total.
//
// A heuristica obvia (`len(linhas) == limit`) NAO serve, e o motivo e um falso positivo exato: o
// servico devolve no maximo `limit` linhas, entao um catalogo de exatamente `limit` prompts a
// satisfaz sem ter proxima pagina. Marcar esse caso de parcial ensina o operador a desconfiar de
// um numero correto — pior que nao marcar.
// ---------------------------------------------------------------------------------------------

func TestCatalog_reporta_continuacao_quando_o_servico_manda_Link_rel_next(t *testing.T) {
	c, _ := clienteContra(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Link", `</prompts?after=z&limit=100>; rel="next"`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"name":"a"}]`))
	})

	corpo, cont, err := c.Catalog(context.Background(), 100, "")

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !cont.TemMais {
		t.Error("header Link rel=next presente e temMais=false — o painel exibiria um total falso")
	}
	if string(corpo) != `[{"name":"a"}]` {
		t.Errorf("corpo alterado: %s", corpo)
	}
}

// O PAR QUE DISCRIMINA: mesmo corpo, decisao diferente. Sem este caso, uma implementacao que
// devolve `true` sempre passaria no teste acima.
func TestCatalog_nao_reporta_continuacao_sem_o_header(t *testing.T) {
	c, _ := clienteContra(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"name":"a"}]`)) // MESMO corpo do teste acima
	})

	corpo, cont, err := c.Catalog(context.Background(), 100, "")

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if cont.TemMais {
		t.Error("sem header Link, temMais deveria ser false")
	}
	if string(corpo) != `[{"name":"a"}]` {
		t.Errorf("corpo alterado: %s", corpo)
	}
}

func TestCatalog_ignora_Link_que_nao_e_rel_next(t *testing.T) {
	c, _ := clienteContra(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Link", `</prompts?after=a>; rel="prev"`)
		_, _ = w.Write([]byte(`[]`))
	})

	_, cont, err := c.Catalog(context.Background(), 100, "")

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if cont.TemMais {
		t.Error("rel=prev nao e continuacao")
	}
}

// EC-3 do /edge-case-plan — a RFC 5988 permite o valor SEM aspas. Nos emitimos com, mas um proxy
// que normalize o header o deixaria sem; uma leitura literal de `rel="next"` devolveria false e
// produziria um TOTAL FALSO, que e a unica saida que este milestone nao pode gerar.
func TestCatalog_reconhece_rel_next_sem_aspas(t *testing.T) {
	c, _ := clienteContra(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Link", `</prompts?after=z>; rel=next`)
		_, _ = w.Write([]byte(`[]`))
	})

	_, cont, err := c.Catalog(context.Background(), 100, "")

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if !cont.TemMais {
		t.Error("rel=next sem aspas e valido pela RFC 5988 e foi lido como ausencia de continuacao")
	}
}

// EC-4 — o cursor carrega um NOME DE PROMPT, e nomes nao tem restricao de caractere
// (`name: z.string().min(1)`, app.ts:206).
//
// HONESTIDADE SOBRE O QUE ESTE TESTE PROVA (corrigido pos-review, TA-04). A primeira versao
// passava o payload JA ESCAPADO e afirmava no comentario que reprovaria se a URL fosse
// concatenada crua — falso, porque o teste escreve o header ele mesmo e nunca exercita o escape.
// Ele provava apenas que `%3B%20rel%3D%22next%22` nao casa, o que e trivialmente verdadeiro.
//
// A versao abaixo assere o que o ancoramento DE FATO garante — que texto solto contendo
// `rel=next` nao e continuacao — e o limite conhecido fica dito, em vez de fingido:
//
// LIMITE MEDIDO. Este parser e um regex, nao um parser RFC-5988. Um `>` CRU dentro do alvo
// (`</p?after=x>; rel="next">; rel="prev"`) fecha o `<([^>]*)>` cedo e e lido como continuacao.
// Isso NAO e alcancavel pelos nossos emissores — `app.ts:596` usa `encodeURIComponent`, que emite
// `%3E` — e um header com `>` cru e malformado pela propria RFC, que exige a URI-Reference
// percent-encoded. Um parser completo resolveria um caso que nao temos (parsimony rung 1); o que
// nao se pode e afirmar uma garantia que o codigo nao da.
func TestCatalog_exige_o_enquadramento_do_link_e_nao_so_o_marcador(t *testing.T) {
	c, _ := clienteContra(t, func(w http.ResponseWriter, _ *http.Request) {
		// Texto solto com o marcador, SEM o enquadramento `<alvo>;` — o que o ancoramento rejeita.
		w.Header().Set("Link", `rel=next`)
		_, _ = w.Write([]byte(`[]`))
	})

	_, cont, err := c.Catalog(context.Background(), 100, "")

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if cont.TemMais {
		t.Error("texto sem o enquadramento `<alvo>;` foi lido como continuacao — o ancoramento nao esta valendo")
	}
}

func TestProximaPaginaQuery_isolada(t *testing.T) {
	casos := []struct {
		nome        string
		link        string
		querTemMais bool
		querQuery   string
	}{
		{"ausente", "", false, ""},
		{"com aspas", `</p?after=z>; rel="next"`, true, "after=z"},
		{"sem aspas", `</p?after=z>; rel=next`, true, "after=z"},
		{"aspas simples", `</p?after=z>; rel='next'`, true, "after=z"},
		{"prev", `</p?after=z>; rel="prev"`, false, ""},
		{"malformado", `<>; rel=`, false, ""},
		{"multiplos links numa linha", `</p?a=1>; rel="prev", </p?a=2>; rel="next"`, true, "a=2"},
		// TA-05 — o caso que MUDOU de expectativa: ha continuacao, e ela nao e enderecavel.
		// Antes isto devolvia "" e o painel exibia TOTAIS sobre uma pagina declarada truncada.
		{"next sem cursor", `</p>; rel="next"`, true, ""},
	}
	for _, caso := range casos {
		t.Run(caso.nome, func(t *testing.T) {
			h := http.Header{}
			if caso.link != "" {
				h.Set("Link", caso.link)
			}
			temMais, query := proximaPaginaQuery(h)
			if temMais != caso.querTemMais {
				t.Errorf("proximaPaginaQuery(%q) temMais = %v, quer %v", caso.link, temMais, caso.querTemMais)
			}
			if query != caso.querQuery {
				t.Errorf("proximaPaginaQuery(%q) query = %q, quer %q", caso.link, query, caso.querQuery)
			}
		})
	}
}
