package trust

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
)

// M24 — o caminho de MUTACAO herda o mesmo contrato fail-closed do de leitura: resolver falhando
// produz zero requisicao upstream. Aqui o risco e maior: uma escrita disparada com a credencial
// errada nao le dado de outro tenant, ESCREVE nele.
func TestWriteVerbsProduceZeroUpstreamRequestsWhenResolverFails(t *testing.T) {
	srv, hits := countingServer(t, okJSON(`{}`))
	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "", errors.New("broker fora") })

	if _, err := c.CreateValidator(context.Background(), json.RawMessage(`{"name":"x"}`)); err == nil {
		t.Error("CreateValidator devolveu nil com resolver falhando")
	}
	if _, err := c.TestValidator(context.Background(), json.RawMessage(`{}`)); err == nil {
		t.Error("TestValidator devolveu nil com resolver falhando")
	}
	if err := c.DeleteValidator(context.Background(), "abc"); err == nil {
		t.Error("DeleteValidator devolveu nil com resolver falhando")
	}
	if n := hits.Load(); n != 0 {
		t.Errorf("%d requisicao(oes) de ESCRITA sairam com resolver falhando; esperado 0", n)
	}
}

// O id vem da URL do usuario. Numa rota de DELETE, escapar do segmento significa apagar outra
// coisa — com o Bearer do tenant ja anexado.
func TestDeleteValidatorIDIsPathEscaped(t *testing.T) {
	var gotPath, gotMethod string
	srv, _ := countingServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		w.WriteHeader(http.StatusNoContent)
	})
	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	_ = c.DeleteValidator(context.Background(), "../conversations")

	if strings.Contains(gotPath, "/v1/conversations") {
		t.Errorf("o id escapou do segmento e alcancou outra rota: %q", gotPath)
	}
	if gotMethod != http.MethodDelete {
		t.Errorf("metodo = %q; esperado DELETE", gotMethod)
	}
}

// O dry-run e o que separa "configurei uma regra" de "derrubei o trafego do tenant". Ele precisa
// chegar ao endpoint certo, com o corpo intacto.
func TestTestValidatorHitsTheDryRunEndpoint(t *testing.T) {
	var gotPath, gotBody string
	srv, _ := countingServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"action":"block"}`))
	})
	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	_, err := c.TestValidator(context.Background(), json.RawMessage(`{"spec":{"kind":"ban-list"},"content":"x"}`))
	if err != nil {
		t.Fatalf("TestValidator: %v", err)
	}
	if !strings.HasSuffix(gotPath, "/v1/validators:test") {
		t.Errorf("path = %q; esperado terminar em /v1/validators:test", gotPath)
	}
	if !strings.Contains(gotBody, "ban-list") {
		t.Errorf("o corpo nao chegou intacto: %q", gotBody)
	}
}

// Um 422 do upstream carrega o motivo tipado (INVALID_SPEC, VALIDATOR_NAME_RESERVED) — e esse
// motivo PRECISA sobreviver ate a tela, senao o operador ve "erro" e nao sabe o que corrigir.
func TestUpstreamRejectionPreservesTheTypedReason(t *testing.T) {
	srv, _ := countingServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"code":"VALIDATOR_NAME_RESERVED","message":"'pii' collides with a reserved platform validator name"}`))
	})
	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	_, err := c.CreateValidator(context.Background(), json.RawMessage(`{"name":"pii"}`))
	if err == nil {
		t.Fatal("esperado erro em 422")
	}
	if !strings.Contains(err.Error(), "VALIDATOR_NAME_RESERVED") {
		t.Errorf("erro = %q; o codigo tipado do upstream precisa sobreviver para a tela poder "+
			"dizer ao operador O QUE corrigir", err)
	}
}
