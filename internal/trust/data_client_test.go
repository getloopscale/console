package trust

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// countingServer devolve um servidor que conta CADA requisicao recebida. O contador e o oraculo
// dos testes fail-closed: "zero requisicao upstream" so e demonstravel observando o outro lado.
func countingServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		handler(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, &hits
}

func okJSON(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}
}

// M23 DoD-1 — "um resolver que falha produz zero requisicao upstream".
//
// Este e o invariante do Model B: o cliente NAO tem credencial permanente e NAO tem fallback
// para uma chave-mestra. Se a cunhagem por tenant falha, a requisicao nao acontece — em vez de
// acontecer com a credencial errada, que e como um vazamento entre tenants comeca.
func TestResolverFailureProducesZeroUpstreamRequests(t *testing.T) {
	srv, hits := countingServer(t, okJSON(`{"leaked":"este corpo nunca deveria ser buscado"}`))

	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) {
			return "", errors.New("broker indisponivel")
		})

	if _, err := c.Trends(context.Background(), "24h"); err == nil {
		t.Fatal("Trends devolveu nil com resolver falhando; esperado erro")
	}
	if n := hits.Load(); n != 0 {
		t.Errorf("o cliente fez %d requisicao(oes) upstream com resolver falhando; esperado 0", n)
	}
}

// Sem resolver ligado o cliente esta mal configurado — e mal configurado tambem nao fala com
// ninguem. Este ramo existe porque um `nil` silencioso enviaria a requisicao SEM Authorization,
// e o upstream a rejeitaria com 401 — transformando um erro de fiacao num erro de autenticacao,
// que manda o operador investigar o lugar errado.
func TestMissingResolverProducesZeroUpstreamRequests(t *testing.T) {
	srv, hits := countingServer(t, okJSON(`{}`))

	c := NewDataClient(srv.URL, srv.Client()) // sem WithKeyResolver

	_, err := c.PolicyViolations(context.Background(), 10)
	if err == nil {
		t.Fatal("esperado erro de configuracao sem resolver ligado")
	}
	if !strings.Contains(err.Error(), "resolver") {
		t.Errorf("erro = %q; deveria nomear o resolver ausente para que o operador saiba onde olhar", err)
	}
	if n := hits.Load(); n != 0 {
		t.Errorf("o cliente fez %d requisicao(oes) sem resolver; esperado 0", n)
	}
}

// O bearer e uma credencial de tenant. Ele nao pode aparecer em mensagem de erro, que vai para
// log estruturado e para o corpo de resposta de erro do BFF.
func TestBearerNeverAppearsInErrorMessages(t *testing.T) {
	// Montado em runtime a partir de pedacos: um literal com esta forma dispara — corretamente — o
	// detector de segredos do pre-commit, que nao tem como saber que este e sintetico.
	secret := strings.Join([]string{"trust", "live", "VALOR", "SINTETICO", "DE", "TESTE", "0000"}, "_")
	srv, _ := countingServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	})

	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return secret, nil })

	_, err := c.Trends(context.Background(), "24h")
	if err == nil {
		t.Fatal("esperado erro em 500 upstream")
	}
	if strings.Contains(err.Error(), secret) {
		t.Errorf("o bearer vazou na mensagem de erro: %q", err)
	}
}

// O bearer resolvido POR REQUISICAO precisa chegar no header — e o caminho feliz precisa
// devolver o corpo do upstream sem re-modelar. O BFF e proxy, nao tradutor.
func TestEachCallResolvesAndForwardsTheTenantBearer(t *testing.T) {
	var seen []string
	srv, hits := countingServer(t, func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Get("Authorization"))
		okJSON(`{"buckets":[{"t":"2026-07-31","total":3}]}`)(w, r)
	})

	var n int
	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) {
			n++
			return "key-" + string(rune('A'+n-1)), nil
		})

	for i := 0; i < 2; i++ {
		got, err := c.Trends(context.Background(), "7d")
		if err != nil {
			t.Fatalf("Trends: %v", err)
		}
		var probe struct {
			Buckets []struct{ Total int } `json:"buckets"`
		}
		if err := json.Unmarshal(got, &probe); err != nil {
			t.Fatalf("corpo nao e o JSON do upstream: %v", err)
		}
		if len(probe.Buckets) != 1 || probe.Buckets[0].Total != 3 {
			t.Errorf("corpo re-modelado; esperado passar o do upstream intacto, veio %s", got)
		}
	}
	if hits.Load() != 2 {
		t.Fatalf("hits = %d; esperado 2", hits.Load())
	}
	if seen[0] == seen[1] {
		t.Errorf("as duas chamadas usaram o MESMO bearer (%q): o resolver precisa ser consultado "+
			"por requisicao, senao a chave de um tenant sobrevive a troca de tenant", seen[0])
	}
}

// O id da conversa vem da URL do usuario. Ele nao pode escapar do path e alcancar outra rota
// do upstream.
func TestConversationIDIsPathEscaped(t *testing.T) {
	var gotPath string
	srv, _ := countingServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		okJSON(`{}`)(w, r)
	})
	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	_, _ = c.Conversation(context.Background(), "../policy-violations")

	if strings.Contains(gotPath, "/v1/policy-violations") {
		t.Errorf("o id escapou do path e alcancou outra rota: %q", gotPath)
	}
	if !strings.HasPrefix(gotPath, "/v1/conversations/") {
		t.Errorf("path = %q; esperado permanecer sob /v1/conversations/", gotPath)
	}
}
