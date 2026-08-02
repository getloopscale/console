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
	"github.com/usetheodev/theo-cloud/internal/skills"
)

// stubSkillsReader implementa a porta que o handler consome.
//
// Registra o tenant que o contexto carregava em cada chamada: e o que torna o isolamento
// VERIFICAVEL em vez de afirmado. Tambem registra o id pedido, para provar que o handler le o
// parametro de rota e nao um valor fixo.
type stubSkillsReader struct {
	byTenant map[string]string
	seenTenant []string
	seenID     []string
	err        error
}

func (s *stubSkillsReader) read(ctx context.Context, id string) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	t := skillsTestTenantOf(ctx)
	s.seenTenant = append(s.seenTenant, t)
	s.seenID = append(s.seenID, id)
	body, ok := s.byTenant[t]
	if !ok {
		body = `{"items":[]}`
	}
	return json.RawMessage(body), nil
}

func (s *stubSkillsReader) List(ctx context.Context, _ int, _ string) (json.RawMessage, error) {
	return s.read(ctx, "")
}
func (s *stubSkillsReader) Get(ctx context.Context, id string) (json.RawMessage, error) {
	return s.read(ctx, id)
}
func (s *stubSkillsReader) Versions(ctx context.Context, id string) (json.RawMessage, error) {
	return s.read(ctx, id)
}
func (s *stubSkillsReader) Channels(ctx context.Context, id string) (json.RawMessage, error) {
	return s.read(ctx, id)
}
func (s *stubSkillsReader) Instructions(ctx context.Context, id string) (json.RawMessage, error) {
	return s.read(ctx, id)
}

type skillsTestTenantKey struct{}

func skillsTestTenantOf(ctx context.Context) string {
	v, _ := ctx.Value(skillsTestTenantKey{}).(string)
	return v
}

// mountSkillsForTest monta o BFF com um dobre do `requireJWT` que injeta o tenant — o middleware
// real o deriva do JWT.
func mountSkillsForTest(t *testing.T, reader skillsReader, tenant string) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	h := NewSkillsDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil)))
	MountSkillsDashboard(r, h, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := context.WithValue(req.Context(), skillsTestTenantKey{}, tenant)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	return r
}

func getSkills(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// A jornada de leitura inteira existe: sem qualquer uma destas rotas a tela tem um beco sem saida.
func TestSkillsDashboard_asCincoLeiturasDaJornadaExistem(t *testing.T) {
	reader := &stubSkillsReader{byTenant: map[string]string{"acme": `{"items":[{"id":"sk_1"}]}`}}
	h := mountSkillsForTest(t, reader, "acme")

	for _, path := range []string{
		"/v1/dashboard/skills",
		"/v1/dashboard/skills/sk_1",
		"/v1/dashboard/skills/sk_1/versions",
		"/v1/dashboard/skills/sk_1/channels",
		"/v1/dashboard/skills/sk_1/instructions",
	} {
		rec := getSkills(t, h, path)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: esperava 200, veio %d", path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "sk_1") {
			t.Fatalf("%s: corpo do upstream nao chegou intacto: %s", path, rec.Body.String())
		}
	}
}

// O identificador vem do PARAMETRO DE ROTA, nao de um literal. Sem esta asserção, um handler que
// ignorasse o `{skillID}` e sempre lesse o mesmo item passaria nos testes de status.
func TestSkillsDashboard_leOIdentificadorDaRota(t *testing.T) {
	reader := &stubSkillsReader{}
	h := mountSkillsForTest(t, reader, "acme")

	getSkills(t, h, "/v1/dashboard/skills/sk_alpha/versions")

	if len(reader.seenID) != 1 || reader.seenID[0] != "sk_alpha" {
		t.Fatalf("esperava o cliente chamado com sk_alpha, veio %v", reader.seenID)
	}
}

// O tenant sai do CONTEXTO, nunca da requisicao. O handler nao tem parametro por onde recebe-lo —
// esta asserção trava essa forma.
func TestSkillsDashboard_aChaveEDoInquilinoDoContexto(t *testing.T) {
	reader := &stubSkillsReader{byTenant: map[string]string{
		"acme":  `{"items":[{"id":"da_acme"}]}`,
		"outra": `{"items":[{"id":"da_outra"}]}`,
	}}
	h := mountSkillsForTest(t, reader, "acme")

	// A tentativa de pedir o acervo alheio por parametro nao tem efeito algum.
	rec := getSkills(t, h, "/v1/dashboard/skills?workspaceId=outra&tenant=outra")

	if strings.Contains(rec.Body.String(), "da_outra") {
		t.Fatalf("VAZAMENTO entre inquilinos: %s", rec.Body.String())
	}
	if len(reader.seenTenant) != 1 || reader.seenTenant[0] != "acme" {
		t.Fatalf("esperava leitura no tenant do contexto (acme), veio %v", reader.seenTenant)
	}
}

// Sem principal, nenhuma leitura acontece. O que se assere aqui NAO e so o 401: e que o cliente
// upstream nunca foi chamado — falhar DEPOIS de perguntar ja teria custado a requisicao.
func TestSkillsDashboard_semPrincipalNaoLeNada(t *testing.T) {
	reader := &stubSkillsReader{}
	r := chi.NewRouter()
	h := NewSkillsDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil)))
	MountSkillsDashboard(r, h, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		})
	})

	rec := getSkills(t, r, "/v1/dashboard/skills")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("esperava 401, veio %d", rec.Code)
	}
	if len(reader.seenTenant) != 0 {
		t.Fatalf("o upstream foi consultado sem principal: %v", reader.seenTenant)
	}
}

// A RECUSA TIPADA do registro chega a tela com o codigo intacto.
//
// Esta e a mutacao que discrimina, e a razao pela qual este BFF NAO copia o `proxy` do trust:
// `internal/routes/trust_dashboard.go` colapsa TODO erro em 502 com corpo opaco. Um 422
// `INVALID_FRONTMATTER` viraria "a camada nao respondeu" — mentira sobre um servico que respondeu
// e disse exatamente o que estava errado. A tela precisa DECIDIR sobre o codigo; 502 nao permite.
func TestSkillsDashboard_recusaTipadaDoRegistroChegaComOCodigo(t *testing.T) {
	reader := &stubSkillsReader{err: &skills.UpstreamError{
		Status: http.StatusUnprocessableEntity,
		Body:   json.RawMessage(`{"code":"INVALID_FRONTMATTER","message":"campo name ausente"}`),
		Method: http.MethodGet,
		Path:   "/v1/skills/sk_1",
	}}
	h := mountSkillsForTest(t, reader, "acme")

	rec := getSkills(t, h, "/v1/dashboard/skills/sk_1")

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("esperava 422 preservado, veio %d", rec.Code)
	}
	var got struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("corpo nao e JSON: %s", rec.Body.String())
	}
	if got.Code != "INVALID_FRONTMATTER" {
		t.Fatalf("o codigo tipado nao sobreviveu ate a tela: %q (corpo %s)", got.Code, rec.Body.String())
	}
}

// Skill de OUTRO inquilino responde 404, nunca 403.
//
// 403 confirma que o recurso existe e apenas nao e seu — o proprio erro vira um oraculo de
// enumeracao. 404 e a resposta que nao confirma existencia.
func TestSkillsDashboard_skillDeOutroInquilinoDa404NaoDa403(t *testing.T) {
	reader := &stubSkillsReader{err: &skills.UpstreamError{
		Status: http.StatusNotFound,
		Body:   json.RawMessage(`{"code":"NOT_FOUND","message":"skill not found"}`),
		Method: http.MethodGet,
		Path:   "/v1/skills/sk_alheia",
	}}
	h := mountSkillsForTest(t, reader, "acme")

	rec := getSkills(t, h, "/v1/dashboard/skills/sk_alheia")

	if rec.Code == http.StatusForbidden {
		t.Fatal("403 confirma a existencia do recurso alheio — e um oraculo de enumeracao")
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("esperava 404, veio %d", rec.Code)
	}
}

// Um 401 do REGISTRO e falha da credencial do plano de controle, nao do operador.
//
// Repassa-lo ao navegador faria o dashboard deslogar quem esta perfeitamente autenticado, e o
// operador investigaria a propria sessao enquanto o defeito e de fiacao. Mesmo erro que o
// `CLAUDE.md` deste repo registra em "classificar um 401/403 de sonda como servico fora do ar".
func TestSkillsDashboard_401DoRegistroNaoDeslogaOOperador(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		reader := &stubSkillsReader{err: &skills.UpstreamError{
			Status: status,
			Body:   json.RawMessage(`{"code":"UNAUTHENTICATED","message":"Not authenticated. Run: theo login"}`),
			Method: http.MethodGet,
			Path:   "/v1/skills",
		}}
		h := mountSkillsForTest(t, reader, "acme")

		rec := getSkills(t, h, "/v1/dashboard/skills")

		if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
			t.Fatalf("upstream %d foi repassado ao navegador — o operador seria deslogado", status)
		}
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("upstream %d: esperava 502, veio %d", status, rec.Code)
		}
		// "Run: theo login" e texto de terminal para quem esta num navegador (CR-9).
		if strings.Contains(rec.Body.String(), "theo login") {
			t.Fatalf("instrucao de CLI chegou ao navegador: %s", rec.Body.String())
		}
	}
}

// 5xx do upstream vira 502 OPACO: ali o corpo fala da topologia interna do registro, nao do que o
// operador escreveu. Repassa-lo vazaria infraestrutura sem ajudar ninguem a corrigir nada.
func TestSkillsDashboard_5xxDoUpstreamNaoVazaTopologiaInterna(t *testing.T) {
	reader := &stubSkillsReader{err: &skills.UpstreamError{
		Status: http.StatusInternalServerError,
		Body:   json.RawMessage(`{"error":"dial tcp 10.42.0.7:8080: connect: connection refused"}`),
		Method: http.MethodGet,
		Path:   "/v1/skills",
	}}
	h := mountSkillsForTest(t, reader, "acme")

	rec := getSkills(t, h, "/v1/dashboard/skills")

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("esperava 502, veio %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "10.42.0.7") {
		t.Fatalf("endereco interno vazou para o navegador: %s", rec.Body.String())
	}
}

// Falha de transporte (nem chegou a haver resposta) tambem e 502 — e NUNCA 200 com lista vazia.
// "Nao ha skills" e "nao consegui perguntar" levam a decisoes opostas.
func TestSkillsDashboard_falhaDeTransporteNaoViraListaVazia(t *testing.T) {
	reader := &stubSkillsReader{err: errors.New("skills data client: no key resolver wired")}
	h := mountSkillsForTest(t, reader, "acme")

	rec := getSkills(t, h, "/v1/dashboard/skills")

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("esperava 502, veio %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), `"items":[]`) {
		t.Fatalf("falha renderizada como acervo vazio: %s", rec.Body.String())
	}
}

// O `limit` do usuario e capado. Sem teto, um `?limit=10000000` na barra de enderecos vira
// consulta cara no plano de dados, disparada por qualquer usuario autenticado.
func TestSkillsDashboard_limitAbsurdoECapado(t *testing.T) {
	var got int
	reader := &stubSkillsReader{}
	r := chi.NewRouter()
	h := NewSkillsDashboardHandler(&limitSpySkillsReader{stubSkillsReader: reader, limit: &got},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	MountSkillsDashboard(r, h, func(next http.Handler) http.Handler { return next })

	getSkills(t, r, "/v1/dashboard/skills?limit=10000000")

	if got > maxLimit {
		t.Fatalf("limit nao capado: %d (teto %d)", got, maxLimit)
	}
	if got == 0 {
		t.Fatal("limit foi descartado em vez de capado — a pagina viraria o default do upstream")
	}
}

type limitSpySkillsReader struct {
	*stubSkillsReader
	limit *int
}

func (s *limitSpySkillsReader) List(ctx context.Context, limit int, cursor string) (json.RawMessage, error) {
	*s.limit = limit
	return s.stubSkillsReader.List(ctx, limit, cursor)
}

// ---- M26 T3.5 — o caminho de MUTACAO: promover canal -------------------------------------

type stubSkillsPromoter struct {
	seenTenant  []string
	seenArgs    []string
	err         error
}

func (s *stubSkillsPromoter) PromoteChannel(ctx context.Context, skillID, channel, revisionID string) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seenTenant = append(s.seenTenant, skillsTestTenantOf(ctx))
	s.seenArgs = append(s.seenArgs, skillID+"|"+channel+"|"+revisionID)
	return json.RawMessage(`{"skill_id":"` + skillID + `","channel":"` + channel + `","revision_id":"` + revisionID + `"}`), nil
}

func mountPromoteForTest(t *testing.T, p skillsPromoter, tenant string) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	h := NewSkillsPromotionHandler(p, slog.New(slog.NewTextHandler(io.Discard, nil)))
	MountSkillsPromotion(r, h, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := context.WithValue(req.Context(), skillsTestTenantKey{}, tenant)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	return r
}

func putPromote(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	return rec
}

// A promocao chega ao registro com os TRES valores da rota e do corpo, e no tenant do contexto.
func TestSkillsPromotion_promoveComOsValoresDaRequisicao(t *testing.T) {
	p := &stubSkillsPromoter{}
	h := mountPromoteForTest(t, p, "acme")

	rec := putPromote(t, h, "/v1/dashboard/skills/sk_1/channels/stable", `{"revision_id":"rev_nova"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("esperava 200, veio %d (%s)", rec.Code, rec.Body.String())
	}
	if len(p.seenArgs) != 1 || p.seenArgs[0] != "sk_1|stable|rev_nova" {
		t.Fatalf("o registro foi chamado com %v", p.seenArgs)
	}
	if len(p.seenTenant) != 1 || p.seenTenant[0] != "acme" {
		t.Fatalf("tenant = %v; esperado o do contexto", p.seenTenant)
	}
}

// `revision_id` ausente ou vazio e RECUSADO NA FRONTEIRA, sem chegar ao registro.
//
// Sem esta guarda o BFF encaminharia um corpo invalido e devolveria o 400 do upstream — o mesmo
// resultado aparente, mas gastando uma requisicao e um mint de credencial por erro de cliente.
func TestSkillsPromotion_revisionIdAusenteERecusadoNaFronteira(t *testing.T) {
	for _, corpo := range []string{`{}`, `{"revision_id":""}`, `{"revision_id":"   "}`, `nao-e-json`} {
		p := &stubSkillsPromoter{}
		h := mountPromoteForTest(t, p, "acme")

		rec := putPromote(t, h, "/v1/dashboard/skills/sk_1/channels/stable", corpo)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("corpo %q: esperava 400, veio %d", corpo, rec.Code)
		}
		if len(p.seenArgs) != 0 {
			t.Errorf("corpo %q: chegou ao registro mesmo invalido: %v", corpo, p.seenArgs)
		}
	}
}

// A RECUSA POR ESCOPO chega a tela como 403 com o codigo do registro.
//
// E a metade que importa do par: se ela virasse 502, o operador leria "tente de novo" sobre algo
// que nunca vai funcionar com aquela credencial.
func TestSkillsPromotion_recusaPorEscopoChegaComo403(t *testing.T) {
	p := &stubSkillsPromoter{err: &skills.UpstreamError{
		Status: http.StatusForbidden,
		Body:   json.RawMessage(`{"error":"forbidden","details":"scope skills:publish required"}`),
		Method: http.MethodPut,
		Path:   "/v1/skills/sk_1/channels/stable",
	}}
	h := mountPromoteForTest(t, p, "acme")

	rec := putPromote(t, h, "/v1/dashboard/skills/sk_1/channels/stable", `{"revision_id":"rev_nova"}`)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("esperava 403 preservado, veio %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "skills:publish") {
		t.Fatalf("o motivo da recusa nao chegou: %s", rec.Body.String())
	}
}

// Sem principal, nenhuma MUTACAO acontece — e o registro nao e sequer consultado.
func TestSkillsPromotion_semPrincipalNaoPromove(t *testing.T) {
	p := &stubSkillsPromoter{}
	r := chi.NewRouter()
	h := NewSkillsPromotionHandler(p, slog.New(slog.NewTextHandler(io.Discard, nil)))
	MountSkillsPromotion(r, h, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		})
	})

	rec := putPromote(t, r, "/v1/dashboard/skills/sk_1/channels/stable", `{"revision_id":"rev_nova"}`)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("esperava 401, veio %d", rec.Code)
	}
	if len(p.seenArgs) != 0 {
		t.Fatalf("promoveu sem principal: %v", p.seenArgs)
	}
}
