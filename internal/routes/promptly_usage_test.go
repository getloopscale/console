package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// M15 (theo-promptly) — o agregado de uso por revisão chega ao navegador.
//
// A porta é separada da de leitura de prompts de propósito: este dado vem do
// `theo-lens`, não do `theo-promptly`, e é servido por outra credencial. Uma porta
// só, com os dois, sugeriria um privilégio que não existe.

type usoFake struct {
	corpo      json.RawMessage
	err        error
	nomeVisto  string
	janelaVista int
	chamadas   int
}

func (f *usoFake) PromptUsage(_ context.Context, nome string, janelaDias int) (json.RawMessage, error) {
	f.chamadas++
	f.nomeVisto, f.janelaVista = nome, janelaDias
	return f.corpo, f.err
}

func montarComUso(f *promptlyFake, u *usoFake) http.Handler {
	h := NewPromptlyDashboardHandler(f, f, slog.New(slog.NewTextHandler(io.Discard, nil))).WithUsageReader(u)
	r := chi.NewRouter()
	MountPromptlyDashboard(r, h, func(next http.Handler) http.Handler { return next })
	return r
}

func chamarUso(t *testing.T, u *usoFake, caminho string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	montarComUso(&promptlyFake{}, u).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, caminho, nil))
	return rec
}

func TestPromptlyUsage_o_agregado_atravessa(t *testing.T) {
	u := &usoFake{corpo: json.RawMessage(
		`{"promptName":"saudacao","windowDays":7,"rows":[{"revision":6,"resolutions":12,"totalTokens":1500,"costUsd":0.031}]}`)}

	rec := chamarUso(t, u, "/v1/dashboard/promptly/prompts/saudacao/usage")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, corpo = %s", rec.Code, rec.Body.String())
	}
	// O oráculo é o CONTEÚDO: um 200 vazio passaria num teste de status e falharia na tela.
	if !strings.Contains(rec.Body.String(), `"resolutions":12`) {
		t.Errorf("o número de resoluções não chegou ao navegador: %s", rec.Body.String())
	}
	if u.nomeVisto != "saudacao" {
		t.Errorf("nome repassado = %q", u.nomeVisto)
	}
	if u.janelaVista <= 0 {
		t.Errorf("janela repassada = %d; a rota tem de impor um default próprio", u.janelaVista)
	}
}

func TestPromptlyUsage_indisponibilidade_e_distinguivel_de_agregado_vazio(t *testing.T) {
	// DoD-3: "não consegui ler" ≠ "não há dado". Se os dois corpos forem iguais, a tela
	// mostra zeros sobre uma falha — e o operador conclui que ninguém usou o prompt.
	falha := &usoFake{err: errors.New("lens fora do ar")}
	recFalha := chamarUso(t, falha, "/v1/dashboard/promptly/prompts/saudacao/usage")

	vazio := &usoFake{corpo: json.RawMessage(`{"promptName":"saudacao","windowDays":7,"rows":[]}`)}
	recVazio := chamarUso(t, vazio, "/v1/dashboard/promptly/prompts/saudacao/usage")

	if recFalha.Code == recVazio.Code {
		t.Fatalf("falha e vazio têm o mesmo status (%d) — indistinguíveis", recFalha.Code)
	}
	if recFalha.Body.String() == recVazio.Body.String() {
		t.Fatal("falha e vazio têm o mesmo corpo — a tela não consegue diferenciar")
	}
	if recVazio.Code != http.StatusOK {
		t.Errorf("agregado vazio é resposta legítima: status = %d", recVazio.Code)
	}
	// E o corpo da falha NÃO pode conter um zero que a tela renderize como contagem.
	if strings.Contains(recFalha.Body.String(), `"rows"`) {
		t.Errorf("o corpo de falha carrega linhas: %s", recFalha.Body.String())
	}
}

func TestPromptlyUsage_janela_invalida_e_recusada_nao_silenciosamente_trocada(t *testing.T) {
	// Fail-fast na fronteira: trocar em silêncio faria o chamador atribuir o resultado
	// a uma janela diferente da que pediu.
	u := &usoFake{corpo: json.RawMessage(`{"promptName":"x","windowDays":7,"rows":[]}`)}

	rec := chamarUso(t, u, "/v1/dashboard/promptly/prompts/saudacao/usage?windowDays=9999")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if u.chamadas != 0 {
		t.Error("a requisição saiu para o lens com uma janela inválida")
	}
}

func TestPromptlyUsage_sem_leitor_de_uso_a_rota_recusa_em_vez_de_entrar_em_panico(t *testing.T) {
	// O handler é construído sem `WithUsageReader` quando o operador não configurou o lens.
	// Recusar com uma razão é o contrato; um nil-pointer derrubaria a tela inteira.
	h := NewPromptlyDashboardHandler(&promptlyFake{}, &promptlyFake{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r := chi.NewRouter()
	MountPromptlyDashboard(r, h, func(next http.Handler) http.Handler { return next })

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/dashboard/promptly/prompts/saudacao/usage", nil))

	if rec.Code < 500 || rec.Code > 599 {
		t.Fatalf("status = %d; sem leitor configurado a rota tem de recusar com 5xx legível", rec.Code)
	}
	if rec.Body.Len() == 0 {
		t.Error("a recusa não diz nada — é o silêncio que custou três rodadas no M14")
	}
}

// M17 — o BFF repassa os campos da intenção SEM remodelar.
//
// Medido no EC-5 do edge-case review: `CreateRevision` recebe `json.RawMessage` e a envia
// crua, então os campos novos já atravessam. Este teste existe para que continue assim: um
// refactor que passasse a decodificar o corpo num struct descartaria em silêncio todo campo
// que o struct não declara, e a descrição da revisão sumiria sem nenhum teste ficar vermelho.
func TestPromptlyCreate_repassa_os_campos_do_M17_sem_remodelar(t *testing.T) {
	f := &promptlyFake{corpo: json.RawMessage(`{"version":4}`)}

	corpo := `{"name":"saudacao","content":"oi","changeDescription":"encurtei o preambulo","modelConfig":{"temperature":0}}`
	rec := chamar(t, f, http.MethodPost, "/v1/dashboard/promptly/prompts", corpo)

	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, corpo = %s", rec.Code, rec.Body.String())
	}
	visto := string(f.body)
	for _, campo := range []string{`"changeDescription":"encurtei o preambulo"`, `"temperature":0`} {
		if !contains(visto, campo) {
			t.Errorf("o campo %s nao atravessou o BFF: %s", campo, visto)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
