// M26 — o BFF de LEITURA do registro de skills: `/v1/dashboard/skills/*`.
//
// Segue a forma ja provada em `lens_dashboard.go` e `trust_dashboard.go`: rotas atras de
// `requireJWT`, o tenant vindo SEMPRE do contexto derivado do JWT — nunca de parametro de
// requisicao — e o corpo do upstream repassado sem re-modelagem.
//
// A porta `skillsReader` e declarada AQUI, pelo consumidor, e nao no pacote que a implementa
// (ISP + DIP): o handler precisa de cinco leituras e nao deve depender da superficie inteira do
// `skills.DataClient`. Isso tambem permite ao teste substituir a porta sem HTTP.
//
// DIVERGENCIA DELIBERADA da referencia — a mesma ja registrada em `internal/skills/data_client.go`.
// O `proxy` do trust colapsa TODO erro em 502 com corpo opaco. Aqui a recusa do CLIENTE (4xx) sai
// com status e corpo preservados, porque o `UpstreamError` foi criado no M24 exatamente para isso e
// a tela precisa DECIDIR sobre o `code` — nao apenas exibi-lo.
package routes

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/usetheodev/theo-cloud/internal/skills"
)

// skillsReader e o subconjunto de `*skills.DataClient` que este BFF consome.
type skillsReader interface {
	List(ctx context.Context, limit int, cursor string) (json.RawMessage, error)
	Get(ctx context.Context, id string) (json.RawMessage, error)
	Versions(ctx context.Context, id string) (json.RawMessage, error)
	Channels(ctx context.Context, id string) (json.RawMessage, error)
	Instructions(ctx context.Context, id string) (json.RawMessage, error)
}

// SkillsDashboardHandler serve as leituras do registro de skills para o dashboard.
type SkillsDashboardHandler struct {
	client skillsReader
	logger *slog.Logger
}

// NewSkillsDashboardHandler constroi o handler.
func NewSkillsDashboardHandler(c skillsReader, logger *slog.Logger) *SkillsDashboardHandler {
	return &SkillsDashboardHandler{client: c, logger: logger}
}

// upstreamUnavailable e o corpo OPACO das falhas que nao sao recusa do cliente.
//
// Nao e 200-com-lista-vazia, deliberadamente: "nao ha skills" e "nao consegui perguntar" levam a
// decisoes opostas, e o segundo disfarcado do primeiro e um falso negativo silencioso.
const upstreamUnavailable = `{"code":"SKILLS_UPSTREAM_UNAVAILABLE","message":"o registro de skills não respondeu; nenhum dado foi lido"}`

// proxy centraliza a forma da resposta.
//
// Tres desfechos, e a distincao entre eles E o valor deste bloco:
//
//   - recusa do CLIENTE (4xx, exceto 401/403) → status e corpo do registro preservados. O
//     `code` tipado diz o que o operador tem de corrigir; um 502 generico o apagaria.
//   - 401/403 do registro → 502. A credencial que falhou e a do PLANO DE CONTROLE, nao a do
//     operador. Repassar 401 ao navegador deslogaria alguem perfeitamente autenticado, e ele
//     investigaria a propria sessao enquanto o defeito e de fiacao.
//   - 5xx ou falha de transporte → 502 opaco. Ali o corpo fala de topologia interna do registro
//     (host, porta, DNS), que nao ajuda o operador e nao deve chegar ao navegador.
func (h *SkillsDashboardHandler) proxy(w http.ResponseWriter, r *http.Request, op string, call func() (json.RawMessage, error)) {
	body, err := call()
	if err != nil {
		h.reject(w, r, op, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func (h *SkillsDashboardHandler) reject(w http.ResponseWriter, r *http.Request, op string, err error) {
	// O detalhe COMPLETO vai sempre para o log, inclusive quando o corpo sai opaco: quem investiga
	// precisa do que o navegador nao pode receber.
	h.logger.ErrorContext(r.Context(), "skills dashboard: "+op+" failed",
		"error", err, "path", r.URL.Path)

	w.Header().Set("Content-Type", "application/json")

	ue, ok := skills.AsUpstreamError(err)
	if ok && ue.IsClientRefusal() && !isControlPlaneAuthFailure(ue.Status) && json.Valid(ue.Body) {
		w.WriteHeader(ue.Status)
		_, _ = w.Write(ue.Body)
		return
	}

	w.WriteHeader(http.StatusBadGateway)
	_, _ = w.Write([]byte(upstreamUnavailable))
}

// isControlPlaneAuthFailure separa as recusas que falam da NOSSA credencial das que falam do que o
// operador pediu. So estas duas sao do plano de controle; as demais 4xx sao acionaveis por ele.
func isControlPlaneAuthFailure(status int) bool {
	return status == http.StatusUnauthorized || status == http.StatusForbidden
}

// skillID le o identificador do parametro de rota.
func skillID(r *http.Request) string { return chi.URLParam(r, "skillID") }

// List serve GET /v1/dashboard/skills — o acervo do inquilino.
func (h *SkillsDashboardHandler) List(w http.ResponseWriter, r *http.Request) {
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = min(n, maxLimit)
		}
	}
	cursor := r.URL.Query().Get("page_token")
	h.proxy(w, r, "list", func() (json.RawMessage, error) {
		return h.client.List(r.Context(), limit, cursor)
	})
}

// Get serve GET /v1/dashboard/skills/{skillID}.
func (h *SkillsDashboardHandler) Get(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "get", func() (json.RawMessage, error) {
		return h.client.Get(r.Context(), skillID(r))
	})
}

// Versions serve GET /v1/dashboard/skills/{skillID}/versions.
func (h *SkillsDashboardHandler) Versions(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "versions", func() (json.RawMessage, error) {
		return h.client.Versions(r.Context(), skillID(r))
	})
}

// Channels serve GET /v1/dashboard/skills/{skillID}/channels — qual revisao cada canal serve.
func (h *SkillsDashboardHandler) Channels(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "channels", func() (json.RawMessage, error) {
		return h.client.Channels(r.Context(), skillID(r))
	})
}

// Instructions serve GET /v1/dashboard/skills/{skillID}/instructions — o fim da jornada de
// leitura: o texto que um agente de fato carregaria.
func (h *SkillsDashboardHandler) Instructions(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "instructions", func() (json.RawMessage, error) {
		return h.client.Instructions(r.Context(), skillID(r))
	})
}

// MountSkillsDashboard registra o BFF de leitura sob `requireJWT`.
//
// Apenas verbos de leitura. A promocao de canal (o unico ato de escrita do M26) entra por caminho
// proprio, com cliente proprio e credencial cunhada com `skills:publish` — deixar um verbo mutante
// aqui daria ao caminho de leitura um poder que ele nao deve ter, e a separacao entre os dois
// clientes E o mecanismo de menor privilegio, nao organizacao de arquivo.
func MountSkillsDashboard(r chi.Router, h *SkillsDashboardHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/skills", func(r chi.Router) {
		r.Use(requireJWT)
		r.Get("/", h.List)
		r.Get("/{skillID}", h.Get)
		r.Get("/{skillID}/versions", h.Versions)
		r.Get("/{skillID}/channels", h.Channels)
		r.Get("/{skillID}/instructions", h.Instructions)
	})
}
