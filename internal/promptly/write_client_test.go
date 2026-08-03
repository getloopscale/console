package promptly

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A PROMOCAO e o unico ato mutante deste BFF, e o mais perigoso do produto: ela troca, sem
// redeploy, o prompt que agentes em execucao resolvem. Um clique errado nao derruba nada — muda
// comportamento em silencio, que e pior de diagnosticar.

func TestWriteClient_promocao_envia_a_versao_alvo_no_corpo(t *testing.T) {
	var corpo, caminho, metodo string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		corpo, caminho, metodo = string(b), r.URL.EscapedPath(), r.Method
		_, _ = w.Write([]byte(`{"name":"saudacao","label":"prod","version":7}`))
	}))
	defer srv.Close()
	c := NewWriteClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "promptly_live_w", nil })

	_, err := c.AssignLabel(context.Background(), "saudacao", "prod", json.RawMessage(`{"version":7}`))

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if metodo != http.MethodPut {
		t.Errorf("metodo = %s, quer PUT (promocao e idempotente)", metodo)
	}
	if caminho != "/prompts/saudacao/labels/prod" {
		t.Errorf("caminho = %q", caminho)
	}
	if !strings.Contains(corpo, `"version":7`) {
		t.Errorf("versao alvo nao viajou no corpo: %q", corpo)
	}
}

func TestWriteClient_sem_resolver_nao_escreve(t *testing.T) {
	// Assimetria de risco: uma LEITURA disparada com a credencial errada VE dado de outro
	// inquilino; uma ESCRITA escreve nele.
	escreveu := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { escreveu = true }))
	defer srv.Close()
	c := NewWriteClient(srv.URL, srv.Client()) // resolver ausente

	_, err := c.AssignLabel(context.Background(), "saudacao", "prod", json.RawMessage(`{"version":7}`))

	if err == nil {
		t.Fatal("escrita sem resolver deveria falhar fechado")
	}
	if escreveu {
		t.Error("a escrita saiu sem credencial de inquilino")
	}
}

func TestWriteClient_recusa_da_politica_chega_tipada(t *testing.T) {
	// `409 promotion_blocked` carrega `required` e `actual` — os dois numeros que dizem ao
	// operador POR QUE a promocao foi barrada. Colapsados numa string, a tela mostra "erro" e
	// ele tenta de novo igual.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"promotion_blocked","required":0.8,"actual":0.41}`))
	}))
	defer srv.Close()
	c := NewWriteClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	_, err := c.AssignLabel(context.Background(), "saudacao", "prod", json.RawMessage(`{"version":7}`))

	ue, ok := AsUpstreamError(err)
	if !ok {
		t.Fatalf("recusa da politica nao saiu tipada: %v", err)
	}
	if ue.Status != http.StatusConflict || !strings.Contains(string(ue.Body), "promotion_blocked") {
		t.Errorf("status/corpo perdidos: %d %s", ue.Status, ue.Body)
	}
}

func TestWriteClient_label_com_barra_nao_escapa_do_segmento(t *testing.T) {
	// Numa rota de escrita, escapar do segmento significa repontar OUTRO label.
	var caminho string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caminho = r.URL.EscapedPath()
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	c := NewWriteClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	_, err := c.AssignLabel(context.Background(), "saudacao", "prod/../staging", json.RawMessage(`{"version":1}`))

	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if strings.Contains(caminho, "staging") && !strings.Contains(caminho, "%2F") {
		t.Errorf("label nao foi escapado — a promocao alcancaria outro ponteiro: %s", caminho)
	}
}
