package skills

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// O escopo da chave É a fronteira, e este par é o que prova isso — NAO uma metade dele.
//
// Uma chave so-leitura tem de receber 403 na promocao E 200 numa leitura. Sem a segunda metade o
// teste passaria com um gate que recusa TUDO, e ninguem notaria que o caminho legitimo quebrou:
// recusa cega e indistinguivel de seguranca. Foi a inversao que o LT-077 do promptly custou.
func TestPromoteChannel_chaveSoLeituraERecusadaMasContinuaLendo(t *testing.T) {
	var vistos []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vistos = append(vistos, r.Method+" "+r.URL.Path)
		// O registro real decide pelo ESCOPO da chave: `skills:publish` promove, `skills:read` nao.
		if r.Method == http.MethodPut {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"forbidden","details":"scope skills:publish required"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"channels":[]}`))
	}))
	defer srv.Close()

	soLeitura := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "chave-somente-leitura", nil })

	// Metade 1 — a promocao e RECUSADA, com o codigo do registro preservado.
	_, err := soLeitura.PromoteChannel(context.Background(), "sk_1", "stable", "rev_nova")
	if err == nil {
		t.Fatal("a chave so-leitura promoveu; o escopo nao esta sendo a fronteira")
	}
	ue, ok := AsUpstreamError(err)
	if !ok || ue.Status != http.StatusForbidden {
		t.Fatalf("esperava UpstreamError 403 tipado, veio %v", err)
	}

	// Metade 2 — e a MESMA chave continua lendo. Sem esta asserção, um gate que recusasse tudo
	// passaria no teste enquanto tivesse quebrado o produto.
	body, err := soLeitura.Channels(context.Background(), "sk_1")
	if err != nil {
		t.Fatalf("a chave so-leitura perdeu a LEITURA — o gate virou recusa cega: %v", err)
	}
	if !strings.Contains(string(body), "channels") {
		t.Fatalf("leitura devolveu corpo inesperado: %s", body)
	}

	if len(vistos) != 2 {
		t.Fatalf("esperava exatamente duas requisicoes (uma recusada, uma servida), vi %v", vistos)
	}
}

// A promocao usa PUT no caminho do canal, com `revision_id` no corpo — a forma MEDIDA em
// `packages/api/src/server/handlers/publishing.ts`, nao inferida do nome do metodo.
func TestPromoteChannel_usaOVerboEOCorpoDoContrato(t *testing.T) {
	var gotMethod, gotPath, gotBody, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotAuth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"skill_id":"sk_1","channel":"stable","revision_id":"rev_nova"}`))
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "chave-publish", nil })

	out, err := c.PromoteChannel(context.Background(), "sk_1", "stable", "rev_nova")
	if err != nil {
		t.Fatalf("promocao: %v", err)
	}

	if gotMethod != http.MethodPut {
		t.Errorf("metodo = %s; o contrato e PUT", gotMethod)
	}
	if gotPath != "/v1/skills/sk_1/channels/stable" {
		t.Errorf("path = %s; esperado /v1/skills/sk_1/channels/stable", gotPath)
	}
	if !strings.Contains(gotBody, `"revision_id":"rev_nova"`) {
		t.Errorf("corpo = %s; o contrato exige revision_id", gotBody)
	}
	if gotAuth != "Bearer chave-publish" {
		t.Errorf("a credencial do inquilino nao foi enviada: %q", gotAuth)
	}
	var got map[string]any
	if err := json.Unmarshal(out, &got); err != nil || got["channel"] != "stable" {
		t.Errorf("resposta do registro nao atravessou intacta: %s", out)
	}
}

// Identificador e canal sao ESCAPADOS na URL. Sem isso, um canal chamado `../../admin` sairia do
// caminho pretendido — e o alvo do PUT deixaria de ser o que a tela mostrou ao operador.
func TestPromoteChannel_escapaIdentificadorECanal(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.EscapedPath()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	_, _ = c.PromoteChannel(context.Background(), "sk/../x", "ca nal", "rev_1")

	if strings.Contains(gotPath, "sk/../x") {
		t.Fatalf("identificador nao escapado — o PUT saiu do caminho pretendido: %s", gotPath)
	}
	if strings.Contains(gotPath, "ca nal") {
		t.Fatalf("canal nao escapado: %s", gotPath)
	}
}

// Fail-closed ANTES da rede, igual ao caminho de leitura: sem resolver, nenhuma requisicao sai.
// Numa MUTACAO isto e ainda mais grave que na leitura — uma promocao emitida sem credencial de
// inquilino e uma escrita potencialmente no acervo errado.
func TestPromoteChannel_semResolverNaoEmiteRequisicao(t *testing.T) {
	chamado := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { chamado = true }))
	defer srv.Close()

	c := NewDataClient(srv.URL, srv.Client()) // sem WithKeyResolver

	if _, err := c.PromoteChannel(context.Background(), "sk_1", "stable", "rev_1"); err == nil {
		t.Fatal("esperava erro de fiacao")
	}
	if chamado {
		t.Fatal("a requisicao de MUTACAO saiu sem credencial de inquilino")
	}
}

// M32 — depreciar uma skill. Mesmo cliente do caminho de promoção, e por isso mesmo motivo: a
// credencial dele carrega `skills:publish`, que é o escopo que o registro exige nas DUAS rotas.
func TestSetLifecycle_bateNaRotaComOMotivo(t *testing.T) {
	var corpo string
	var visto string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		visto = r.Method + " " + r.URL.EscapedPath()
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		corpo = string(b)
		_, _ = w.Write([]byte(`{"skill_id":"sk_1","lifecycle":"deprecated"}`))
	}))
	defer srv.Close()

	cli := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "chave-de-publicacao", nil })

	if _, err := cli.SetLifecycle(context.Background(), "sk_1", "deprecated", "substituída pela v2", "sk_2"); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if visto != "PUT /v1/skills/sk_1/lifecycle" {
		t.Fatalf("rota errada: %q", visto)
	}

	var enviado map[string]string
	if err := json.Unmarshal([]byte(corpo), &enviado); err != nil {
		t.Fatalf("corpo não é JSON: %q", corpo)
	}
	// `reason` é o nome do campo NO CONTRATO — medido em `handlers/lifecycle.ts`, não inferido do
	// nome do conceito. Mandar `deprecation_reason` faria o registro recusar com 400.
	if enviado["lifecycle"] != "deprecated" || enviado["reason"] != "substituída pela v2" {
		t.Fatalf("lifecycle/reason não chegaram na forma do contrato: %v", enviado)
	}
	if enviado["superseded_by"] != "sk_2" {
		t.Fatalf("a sucessora não atravessou: %v", enviado)
	}
}

func TestSetLifecycle_omiteCamposVazios(t *testing.T) {
	// Sucessora é OPCIONAL. Mandar `""` gravaria uma sucessora vazia em vez de nenhuma, e a tela
	// exibiria um link para lugar nenhum.
	var corpo string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(b)
		corpo = string(b)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	cli := NewDataClient(srv.URL, srv.Client()).
		WithKeyResolver(func(context.Context) (string, error) { return "k", nil })

	if _, err := cli.SetLifecycle(context.Background(), "sk_1", "active", "", ""); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if strings.Contains(corpo, "superseded_by") || strings.Contains(corpo, "reason") {
		t.Fatalf("campos vazios não deveriam ser enviados: %q", corpo)
	}
}
