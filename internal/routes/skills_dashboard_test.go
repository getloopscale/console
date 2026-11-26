package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/getloopscale/loop-console/internal/skills"
	"github.com/go-chi/chi/v5"
)

// stubSkillsReader implementa a porta que o handler consome.
//
// Registra o tenant que o contexto carregava em cada chamada: e o que torna o isolamento
// VERIFICAVEL em vez de afirmado. Tambem registra o id pedido, para provar que o handler le o
// parametro de rota e nao um valor fixo.
type stubSkillsReader struct {
	byTenant   map[string]string
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
func (s *stubSkillsReader) ValidateSkill(ctx context.Context, skillMd string) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seenID = append(s.seenID, "validate:"+strconv.Itoa(len(skillMd)))
	return json.RawMessage(`{"ok":true,"name":"x","description":"d","execution":"remote"}`), nil
}

func (s *stubSkillsReader) Discoverability(_ context.Context, name, description string, hasEmbedding bool) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seenID = append(s.seenID, "discoverability:"+name+":"+strconv.FormatBool(hasEmbedding))
	return json.RawMessage(`{"discoverable":false,"causes":["description_too_generic"],"hints":["escreva quando usar"],"embedder":"stub/stub"}`), nil
}

func (s *stubSkillsReader) Retrieve(ctx context.Context, query string, topK int, draft, deprecated bool) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seenID = append(s.seenID, "retrieve:"+query+":"+strconv.Itoa(topK)+":"+strconv.FormatBool(draft)+":"+strconv.FormatBool(deprecated))
	return json.RawMessage(`{"skills":[{"skill_id":"sk_a","score":0.9,"matched":["lexical","vector"]}]}`), nil
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
			Body:   json.RawMessage(`{"code":"UNAUTHENTICATED","message":"Not authenticated. Run: loopscale login"}`),
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
		// "Run: loopscale login" e texto de terminal para quem esta num navegador (CR-9).
		if strings.Contains(rec.Body.String(), "loopscale login") {
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
	seenTenant []string
	seenArgs   []string
	err        error
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

// REGRESSAO (medida em producao 2026-08-02): os dois mounts precisam COEXISTIR no MESMO roteador.
//
// Este teste faltava, e a ausencia dele deixou passar um defeito real: `MountSkillsPromotion`
// montava um subtree em `/v1/dashboard/skills/{skillID}/channels`, e no chi um subtree ali
// SOMBREIA o `GET /{skillID}/channels` registrado pelo roteador pai. Resultado no ar: a leitura de
// canais passou a devolver `404 page not found` — texto puro, nem JSON —, e a coluna de canais da
// tela de versoes parou de funcionar.
//
// Os testes anteriores nao podiam pegar isso: cada um montava UM roteador. A coexistencia so
// existia no `main.go`, que teste nenhum exercitava. Montar os dois juntos e o que torna a
// interacao verificavel — e a interacao era o defeito.
func TestSkillsRoutes_promocaoNaoSombreiaALeituraDeCanais(t *testing.T) {
	reader := &stubSkillsReader{byTenant: map[string]string{"acme": `{"channels":[{"channel":"stable"}]}`}}
	promoter := &stubSkillsPromoter{}

	r := chi.NewRouter()
	passthrough := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := context.WithValue(req.Context(), skillsTestTenantKey{}, "acme")
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}
	// A ORDEM importa e e a do main.go: leitura primeiro, promocao depois.
	MountSkillsDashboard(r, NewSkillsDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil))), passthrough)
	MountSkillsPromotion(r, NewSkillsPromotionHandler(promoter, slog.New(slog.NewTextHandler(io.Discard, nil))), passthrough)

	// A LEITURA de canais continua servindo — a metade que a regressao quebrou.
	rec := getSkills(t, r, "/v1/dashboard/skills/sk_1/channels")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /channels devolveu %d (%s) — a promocao sombreou a leitura", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "stable") {
		t.Fatalf("GET /channels nao devolveu o corpo do upstream: %s", rec.Body.String())
	}

	// E a PROMOCAO tambem serve, no mesmo roteador.
	rec = putPromote(t, r, "/v1/dashboard/skills/sk_1/channels/stable", `{"revision_id":"rev_nova"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /channels/{channel} devolveu %d (%s)", rec.Code, rec.Body.String())
	}

	// E as demais leituras seguem intactas — o controle que impede "consertei uma e quebrei outra".
	for _, p := range []string{
		"/v1/dashboard/skills",
		"/v1/dashboard/skills/sk_1",
		"/v1/dashboard/skills/sk_1/versions",
		"/v1/dashboard/skills/sk_1/instructions",
	} {
		if rec := getSkills(t, r, p); rec.Code != http.StatusOK {
			t.Errorf("%s devolveu %d — regressao colateral", p, rec.Code)
		}
	}
}

// M32 — a rota de ciclo de vida no BFF.
func (s *stubSkillsPromoter) SetLifecycle(_ context.Context, skillID, lifecycle, reason, supersededBy string) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seenArgs = append(s.seenArgs, "lifecycle:"+skillID+":"+lifecycle+":"+reason+":"+supersededBy)
	return json.RawMessage(`{"skill_id":"` + skillID + `","lifecycle":"` + lifecycle + `"}`), nil
}

func TestSetLifecycle_deprecarSemMotivoNaoChegaAoUpstream(t *testing.T) {
	// Depreciar EXIGE motivo, e a checagem é na fronteira para a mensagem sair escrita para quem
	// está na tela. Ir para `active` não exige: não tira nada de ninguém.
	promoter := &stubSkillsPromoter{}
	h := NewSkillsPromotionHandler(promoter, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r := chi.NewRouter()
	MountSkillsPromotion(r, h, func(next http.Handler) http.Handler { return next })

	pedir := func(corpo string) int {
		req := httptest.NewRequest(http.MethodPut, "/v1/dashboard/skills/sk_1/lifecycle", strings.NewReader(corpo))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	if got := pedir(`{"lifecycle":"deprecated"}`); got != http.StatusBadRequest {
		t.Fatalf("deprecar sem motivo deveria ser 400, veio %d", got)
	}
	if got := pedir(`{}`); got != http.StatusBadRequest {
		t.Fatalf("sem lifecycle deveria ser 400, veio %d", got)
	}
	if len(promoter.seenArgs) != 0 {
		t.Fatalf("não deveria ter chamado o upstream: %v", promoter.seenArgs)
	}

	// Controle: com motivo, passa — sem esta metade um gate que recusasse tudo passaria no teste.
	if got := pedir(`{"lifecycle":"deprecated","reason":"substituída","superseded_by":"sk_2"}`); got != http.StatusOK {
		t.Fatalf("deprecar com motivo deveria ser 200, veio %d", got)
	}
	if len(promoter.seenArgs) != 1 || promoter.seenArgs[0] != "lifecycle:sk_1:deprecated:substituída:sk_2" {
		t.Fatalf("chamadas: %v", promoter.seenArgs)
	}

	// Voltar para `active` NÃO exige motivo.
	if got := pedir(`{"lifecycle":"active"}`); got != http.StatusOK {
		t.Fatalf("reativar sem motivo deveria ser 200, veio %d", got)
	}
}

// M31 — a descoberta pelo BFF, e a colisão que ela poderia causar.
func TestRetrieve_naoColideComALeituraDeUmaSkill(t *testing.T) {
	// `:retrieve` e `{skillID}` ocupam a mesma posição no caminho. Se o chi resolvesse pelo
	// parâmetro, a descoberta viraria "ler a skill chamada `:retrieve`" — que não existe — e a
	// tela receberia o corpo errado sem erro algum.
	reader := &stubSkillsReader{}
	r := chi.NewRouter()
	MountSkillsDashboard(r, NewSkillsDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil))),
		func(next http.Handler) http.Handler { return next })

	pedir := func(caminho string) (int, string) {
		req := httptest.NewRequest(http.MethodGet, caminho, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}

	code, corpo := pedir("/v1/dashboard/skills/:retrieve?query=converter+moeda&top_k=3")
	if code != http.StatusOK {
		t.Fatalf("retrieve status %d: %s", code, corpo)
	}
	// O `matched` é metade do critério da DoD: sem ele a tela mostra um número sem dizer de onde
	// veio, e some a diferença entre "as palavras batem" e "entendeu".
	if !strings.Contains(corpo, `"matched"`) || !strings.Contains(corpo, `"score"`) {
		t.Fatalf("score/matched não atravessaram: %s", corpo)
	}
	if len(reader.seenID) == 0 || !strings.HasPrefix(reader.seenID[len(reader.seenID)-1], "retrieve:converter moeda:3:") {
		t.Fatalf("a consulta não chegou ao cliente: %v", reader.seenID)
	}

	// E a leitura de uma skill de verdade continua funcionando — a metade que impede a correção
	// de virar "a rota nova engoliu a vizinha".
	if code, _ := pedir("/v1/dashboard/skills/sk_real"); code != http.StatusOK {
		t.Fatalf("leitura de skill quebrou: %d", code)
	}
}

func TestRetrieve_consultaVaziaNaoChegaAoUpstream(t *testing.T) {
	reader := &stubSkillsReader{}
	r := chi.NewRouter()
	MountSkillsDashboard(r, NewSkillsDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil))),
		func(next http.Handler) http.Handler { return next })

	req := httptest.NewRequest(http.MethodGet, "/v1/dashboard/skills/:retrieve?query=%20%20", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("consulta vazia deveria ser 400, veio %d", w.Code)
	}
	for _, visto := range reader.seenID {
		if strings.HasPrefix(visto, "retrieve:") {
			t.Fatalf("não deveria ter chamado o upstream: %v", reader.seenID)
		}
	}
}

// M31 — a exclusão pelo BFF, e a garantia de que ela não engole as vizinhas.
type stubSkillsAuthor struct {
	seen []string
	err  error
}

func (s *stubSkillsAuthor) CreateSkill(_ context.Context, skillID, skillMd string) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seen = append(s.seen, "create:"+skillID+":"+strconv.Itoa(len(skillMd)))
	return json.RawMessage(`{"operation_id":"op_1"}`), nil
}

func (s *stubSkillsAuthor) CreateSkillFromZip(_ context.Context, skillID, zipBase64 string) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seen = append(s.seen, "createzip:"+skillID+":"+strconv.Itoa(len(zipBase64)))
	return json.RawMessage(`{"operation_id":"op_zip"}`), nil
}

func (s *stubSkillsAuthor) Operation(_ context.Context, id string) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seen = append(s.seen, "operation:"+id)
	return json.RawMessage(`{"operation_id":"` + id + `","state":"succeeded"}`), nil
}

func (s *stubSkillsAuthor) DeleteSkill(_ context.Context, skillID string) (json.RawMessage, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.seen = append(s.seen, skillID)
	return nil, nil
}

func TestDelete_apagaEDevolve204SemCorpo(t *testing.T) {
	author := &stubSkillsAuthor{}
	r := chi.NewRouter()
	MountSkillsAuthoring(r, NewSkillsAuthoringHandler(author, slog.New(slog.NewTextHandler(io.Discard, nil))),
		func(next http.Handler) http.Handler { return next })

	req := httptest.NewRequest(http.MethodDelete, "/v1/dashboard/skills/sk_1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, corpo %s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 não deve ter corpo: %q", w.Body.String())
	}
	if len(author.seen) != 1 || author.seen[0] != "sk_1" {
		t.Fatalf("chamadas: %v", author.seen)
	}
}

func TestDelete_naoSombreiaALeituraDeUmaSkill(t *testing.T) {
	// Os dois handlers ocupam o MESMO caminho, em verbos diferentes. Um `r.Route` na autoria
	// criaria subtree e mataria o `GET` — a regressão medida em produção em 2026-08-02, que
	// nenhum teste pegou porque cada família era testada isolada.
	reader := &stubSkillsReader{}
	author := &stubSkillsAuthor{}
	semJWT := func(next http.Handler) http.Handler { return next }

	r := chi.NewRouter()
	MountSkillsDashboard(r, NewSkillsDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWT)
	MountSkillsAuthoring(r, NewSkillsAuthoringHandler(author, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWT)

	pedir := func(metodo, caminho string) int {
		req := httptest.NewRequest(metodo, caminho, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	if got := pedir(http.MethodGet, "/v1/dashboard/skills/sk_1"); got != http.StatusOK {
		t.Fatalf("a leitura quebrou: %d", got)
	}
	if got := pedir(http.MethodGet, "/v1/dashboard/skills/sk_1/channels"); got != http.StatusOK {
		t.Fatalf("a leitura de canais quebrou: %d", got)
	}
	if got := pedir(http.MethodDelete, "/v1/dashboard/skills/sk_1"); got != http.StatusNoContent {
		t.Fatalf("a exclusão quebrou: %d", got)
	}
}

// M31 — a autoria: validar sem publicar, e publicar ACOMPANHANDO.
func TestAutoria_validarNaoEscreveEPublicarDevolve202(t *testing.T) {
	reader := &stubSkillsReader{}
	author := &stubSkillsAuthor{}
	semJWTAut := func(next http.Handler) http.Handler { return next }

	r := chi.NewRouter()
	MountSkillsDashboard(r, NewSkillsDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWTAut)
	MountSkillsAuthoring(r, NewSkillsAuthoringHandler(author, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWTAut)

	pedir := func(metodo, caminho, corpo string) (int, string) {
		req := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}

	// Validar NÃO escreve: nenhuma chamada ao cliente de autoria.
	if code, _ := pedir(http.MethodPost, "/v1/dashboard/skills/:validate", `{"skill_md":"# Skill"}`); code != http.StatusOK {
		t.Fatalf("validate status %d", code)
	}
	if len(author.seen) != 0 {
		t.Fatalf("validar não pode tocar o caminho de escrita: %v", author.seen)
	}

	// Publicar devolve 202 — ACEITO, não pronto. Traduzir para 200 faria a tela anunciar sucesso
	// no aceite, e o autor procuraria a skill num acervo onde ela ainda não está.
	code, corpo := pedir(http.MethodPost, "/v1/dashboard/skills", `{"skill_id":"sk_novo","skill_md":"# Skill"}`)
	if code != http.StatusAccepted {
		t.Fatalf("create deveria ser 202, veio %d: %s", code, corpo)
	}
	if !strings.Contains(corpo, "operation_id") {
		t.Fatalf("o identificador da operação precisa atravessar: %s", corpo)
	}

	// E a operação é consultável — é o que permite ACOMPANHAR em vez de fingir.
	if code, _ := pedir(http.MethodGet, "/v1/dashboard/operations/op_1", ""); code != http.StatusOK {
		t.Fatalf("operation status %d", code)
	}
}

func TestAutoria_corpoVazioNaoChegaAoUpstream(t *testing.T) {
	reader := &stubSkillsReader{}
	author := &stubSkillsAuthor{}
	semJWTAut := func(next http.Handler) http.Handler { return next }

	r := chi.NewRouter()
	MountSkillsDashboard(r, NewSkillsDashboardHandler(reader, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWTAut)
	MountSkillsAuthoring(r, NewSkillsAuthoringHandler(author, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWTAut)

	pedir := func(caminho, corpo string) int {
		req := httptest.NewRequest(http.MethodPost, caminho, strings.NewReader(corpo))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	if got := pedir("/v1/dashboard/skills/:validate", `{"skill_md":"   "}`); got != http.StatusBadRequest {
		t.Fatalf("validate vazio deveria ser 400, veio %d", got)
	}
	if got := pedir("/v1/dashboard/skills", `{"skill_md":"# x"}`); got != http.StatusBadRequest {
		t.Fatalf("create sem id deveria ser 400, veio %d", got)
	}
	if len(author.seen) != 0 {
		t.Fatalf("não deveria ter chamado o upstream: %v", author.seen)
	}
}

// Upload de skill com scripts — uma skill que carrega Python/Bash é uma ARVORE, nao um markdown.
//
// O registro sempre aceitou `zippedFilesystem` (a CLI publica assim desde o M12). O BFF nao: ele
// so decodificava `skill_md` e lia no maximo 1 MiB do corpo. Pela TELA, publicar uma skill com
// script era impossivel — e nada dizia isso ao autor, porque o campo simplesmente nao existia.
func TestCreate_aceitaZipEEncaminhaComoArvore(t *testing.T) {
	author := &stubSkillsAuthor{}
	semJWT := func(next http.Handler) http.Handler { return next }
	r := chi.NewRouter()
	MountSkillsAuthoring(r, NewSkillsAuthoringHandler(author, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWT)

	req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/skills",
		strings.NewReader(`{"skill_id":"sk_com_script","zipped_filesystem":"UEsDBBQAAAA="}`))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("upload de zip deveria ser aceito (202), veio %d: %s", w.Code, w.Body.String())
	}
	// A rota do ZIP e OUTRA no cliente: `CreateSkill` mandaria `skillMd`, que o registro prioriza,
	// e os scripts seriam descartados em silencio.
	if len(author.seen) != 1 || !strings.HasPrefix(author.seen[0], "createzip:") {
		t.Fatalf("o zip precisa viajar por CreateSkillFromZip, nao por CreateSkill: %v", author.seen)
	}
}

func TestCreate_zipGrandeNaoEDecapitadoPeloTetoDeCorpo(t *testing.T) {
	// O teto era 1 MiB. Um zip de skill com dependencias passa disso com folga, e o registro aceita
	// ate ~35 MB (`DEFAULT_MAX_BODY_BYTES`). Com o teto antigo o JSON chegava TRUNCADO ao decoder,
	// que devolvia erro de sintaxe — e a tela dizia "informe o identificador e o conteudo", culpando
	// o autor por um limite que era nosso e nao estava escrito em lugar nenhum.
	author := &stubSkillsAuthor{}
	semJWT := func(next http.Handler) http.Handler { return next }
	r := chi.NewRouter()
	MountSkillsAuthoring(r, NewSkillsAuthoringHandler(author, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWT)

	grande := strings.Repeat("A", 3<<20) // 3 MiB de base64 — acima do teto antigo, abaixo do registro
	req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/skills",
		strings.NewReader(`{"skill_id":"sk_grande","zipped_filesystem":"`+grande+`"}`))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("zip de 3 MiB deveria passar, veio %d: %s", w.Code, w.Body.String())
	}
	if len(author.seen) != 1 || !strings.Contains(author.seen[0], strconv.Itoa(len(grande))) {
		t.Fatalf("o zip precisa chegar INTEIRO ao cliente: %v", author.seen)
	}
}

func TestCreate_zipEMarkdownJuntosERecusado(t *testing.T) {
	// Mandar os dois nao e ambiguidade a resolver por precedencia: e um pedido cuja intencao nao da
	// para saber. O registro prioriza `skillMd` e descartaria o zip em SILENCIO — a skill entraria
	// no acervo sem os scripts, com 202 e sem erro. Recusar na fronteira e fail-fast (Regra 8).
	author := &stubSkillsAuthor{}
	semJWT := func(next http.Handler) http.Handler { return next }
	r := chi.NewRouter()
	MountSkillsAuthoring(r, NewSkillsAuthoringHandler(author, slog.New(slog.NewTextHandler(io.Discard, nil))), semJWT)

	req := httptest.NewRequest(http.MethodPost, "/v1/dashboard/skills",
		strings.NewReader(`{"skill_id":"sk_x","skill_md":"# a","zipped_filesystem":"UEsDBBQ="}`))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("os dois juntos precisam ser recusados, veio %d", w.Code)
	}
	if len(author.seen) != 0 {
		t.Fatalf("nada deveria ter chegado ao upstream: %v", author.seen)
	}
	// E a recusa precisa DIZER o que fazer — senao o autor tenta de novo do mesmo jeito.
	if !strings.Contains(w.Body.String(), "not both") {
		t.Fatalf("a mensagem precisa nomear a escolha: %s", w.Body.String())
	}
}
