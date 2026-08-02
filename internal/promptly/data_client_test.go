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

	_, err := c.Catalog(context.Background(), 0, "")

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

	_, err := c.Catalog(context.Background(), 0, "")

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

	_, err := c.Catalog(context.Background(), 25, "saudacao")

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

	_, err := c.Catalog(context.Background(), 0, "")

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
		{"catalogo", func(c *DataClient) error { _, e := c.Catalog(context.Background(), 0, ""); return e }, "/prompts"},
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
