// M25 — o BFF do catalogo de prompts: `/v1/dashboard/promptly/*`.
//
// Segue a forma ja provada em `trust_dashboard.go` e `skills_dashboard.go`: rotas atras de
// `requireJWT`, o inquilino vindo SEMPRE do contexto derivado do JWT — nunca de parametro de
// requisicao — e o corpo do upstream repassado sem re-modelagem.
//
// As portas sao declaradas AQUI, pelo consumidor, e nao no pacote que as implementa (ISP + DIP).
// Sao DUAS, e a separacao nao e organizacao: `promptlyReader` e `promptlyPromoter` sao satisfeitas
// por clientes distintos, com credenciais distintas — a de leitura nao consegue promover.
//
// DIVERGENCIA DELIBERADA da referencia (`theo-cloud#358`): o `proxy` do trust colapsa TODO erro em
// 502 com corpo opaco. Aqui a recusa do CLIENTE (4xx) sai com status e corpo preservados, porque a
// tela precisa DECIDIR sobre o codigo: `policy_not_found` significa "promocao livre" e desenha
// diferente de "nao consegui ler"; `promotion_blocked` carrega os numeros que explicam a recusa.
package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/usetheodev/theo-cloud/internal/promptly"
)

// revisionsPageCeiling e o teto que ESTA rota impoe a listagem de revisoes.
//
// Nao e preferencia estetica: a rota do servico devolve o `content` INTEGRAL de cada revisao
// (medido) e aplica default 100 quando ninguem pede. Uma tela que so quer desenhar uma lista de
// versoes baixaria ate 100 corpos de prompt por abertura. O teto vive aqui — e nao so no cliente —
// porque e aqui que chega o `?limit` do navegador.
const revisionsPageCeiling = 20

// revisionsPageDefault e o que a tela pede quando nao pede nada.
const revisionsPageDefault = 10

// promptlyReader e o subconjunto de leitura que este BFF consome.
type promptlyReader interface {
	Catalog(ctx context.Context, limit int, after string) (json.RawMessage, error)
	Prompt(ctx context.Context, name string) (json.RawMessage, error)
	Revisions(ctx context.Context, name string, limit, after int) (json.RawMessage, error)
	Labels(ctx context.Context, name string) (json.RawMessage, error)
	Policy(ctx context.Context, name, label string) (json.RawMessage, error)
}

// promptlyPromoter e o UNICO verbo mutante da capacidade.
type promptlyPromoter interface {
	AssignLabel(ctx context.Context, name, label string, body json.RawMessage) (json.RawMessage, error)
}

// PromptlyDashboardHandler serve o catalogo de prompts ao dashboard.
type PromptlyDashboardHandler struct {
	reader   promptlyReader
	promoter promptlyPromoter
	logger   *slog.Logger
}

// NewPromptlyDashboardHandler constroi o handler com os dois clientes separados.
func NewPromptlyDashboardHandler(r promptlyReader, p promptlyPromoter, logger *slog.Logger) *PromptlyDashboardHandler {
	return &PromptlyDashboardHandler{reader: r, promoter: p, logger: logger}
}

// promptlyUnavailable e o corpo OPACO das falhas que nao sao recusa do cliente.
//
// Nao e 200-com-lista-vazia, deliberadamente: "este inquilino nao tem prompts" e "nao consegui
// perguntar" levam a decisoes opostas, e o segundo disfarcado do primeiro e um falso negativo
// silencioso — a tela diria "crie seu primeiro prompt" durante uma queda do servico.
const promptlyUnavailable = `{"code":"PROMPTLY_UPSTREAM_UNAVAILABLE","message":"o serviço de prompts não respondeu; nenhum dado foi lido"}`

// invalidPromotionBody e a recusa na FRONTEIRA: promover exige dizer PARA QUAL revisao.
const invalidPromotionBody = `{"code":"INVALID_PROMOTION_BODY","message":"informe a revisão de destino da promoção"}`

// maxPromotionBody limita o corpo aceito na promocao. O corpo legitimo tem um numero.
const maxPromotionBody = 4 << 10

func (h *PromptlyDashboardHandler) proxy(w http.ResponseWriter, r *http.Request, op string, call func() (json.RawMessage, error)) {
	body, err := call()
	if err != nil {
		h.reject(w, r, op, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// reject decide o que o navegador ve. Tres desfechos, e a distincao entre eles E o valor do bloco:
//
//   - recusa do CLIENTE (4xx, exceto 401/403) → status e corpo do servico preservados. O codigo
//     tipado diz o que fazer; um 502 generico o apagaria.
//   - 401/403 do servico → 502. A credencial que falhou e a do PLANO DE CONTROLE. Repassar 401 ao
//     navegador deslogaria alguem perfeitamente autenticado, que investigaria a propria sessao
//     enquanto o defeito e de fiacao.
//   - 5xx ou falha de transporte → 502 opaco. Ali o corpo fala de host, porta e DNS internos.
func (h *PromptlyDashboardHandler) reject(w http.ResponseWriter, r *http.Request, op string, err error) {
	// O detalhe COMPLETO vai sempre para o log, inclusive quando o corpo sai opaco: quem investiga
	// precisa do que o navegador nao pode receber.
	h.logger.ErrorContext(r.Context(), "promptly dashboard: "+op+" failed",
		"error", err, "path", r.URL.Path)

	w.Header().Set("Content-Type", "application/json")

	ue, ok := promptly.AsUpstreamError(err)
	if ok && ue.IsClientRefusal() && !isControlPlaneAuthFailure(ue.Status) && json.Valid(ue.Body) {
		w.WriteHeader(ue.Status)
		_, _ = w.Write(ue.Body)
		return
	}

	w.WriteHeader(http.StatusBadGateway)
	_, _ = w.Write([]byte(promptlyUnavailable))
}

func promptName(r *http.Request) string { return chi.URLParam(r, "promptName") }

// Catalog serve GET /v1/dashboard/promptly/prompts — o indice do inquilino.
func (h *PromptlyDashboardHandler) Catalog(w http.ResponseWriter, r *http.Request) {
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = min(n, maxLimit)
		}
	}
	after := r.URL.Query().Get("after")
	h.proxy(w, r, "catalog", func() (json.RawMessage, error) {
		return h.reader.Catalog(r.Context(), limit, after)
	})
}

// Prompt serve GET /v1/dashboard/promptly/prompts/{promptName}.
func (h *PromptlyDashboardHandler) Prompt(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "prompt", func() (json.RawMessage, error) {
		return h.reader.Prompt(r.Context(), promptName(r))
	})
}

// Revisions serve GET /v1/dashboard/promptly/prompts/{promptName}/revisions.
//
// O limite e SEMPRE explicito e pequeno — ver `revisionsPageCeiling`. Um pedido acima do teto e
// rebaixado em vez de recusado: o cliente pediu mais dado, nao algo invalido, e a tela continua
// funcionando enquanto o custo fica limitado.
func (h *PromptlyDashboardHandler) Revisions(w http.ResponseWriter, r *http.Request) {
	limit := revisionsPageDefault
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = min(n, revisionsPageCeiling)
		}
	}
	after := 0
	if raw := r.URL.Query().Get("after"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			after = n
		}
	}
	h.proxy(w, r, "revisions", func() (json.RawMessage, error) {
		return h.reader.Revisions(r.Context(), promptName(r), limit, after)
	})
}

// Labels serve GET /v1/dashboard/promptly/prompts/{promptName}/labels — para onde cada label
// aponta HOJE. E o dado que a confirmacao da promocao consome para nomear a revisao que sai.
func (h *PromptlyDashboardHandler) Labels(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "labels", func() (json.RawMessage, error) {
		return h.reader.Labels(r.Context(), promptName(r))
	})
}

// Policy serve GET /v1/dashboard/promptly/prompts/{promptName}/policies/{label} — a regra que
// governa a promocao, lida ANTES do ato.
func (h *PromptlyDashboardHandler) Policy(w http.ResponseWriter, r *http.Request) {
	label := chi.URLParam(r, "label")
	h.proxy(w, r, "policy", func() (json.RawMessage, error) {
		return h.reader.Policy(r.Context(), promptName(r), label)
	})
}

// promotionBody e o unico campo que a promocao aceita. Validar aqui, na fronteira, evita gastar
// uma escrita contra o servico para receber de volta um 400 que ja podiamos ter dado.
type promotionBody struct {
	Version *int `json:"version"`
}

// Promote serve PUT /v1/dashboard/promptly/prompts/{promptName}/labels/{label}.
//
// O ato mais perigoso do produto: repontar um label troca, sem redeploy, o prompt que agentes em
// execucao resolvem. A tela confirma ANTES, nomeando a revisao que deixa de servir — mas a
// validacao de fronteira vive aqui, porque a tela nao e a unica coisa que pode chamar esta rota.
func (h *PromptlyDashboardHandler) Promote(w http.ResponseWriter, r *http.Request) {
	label := chi.URLParam(r, "label")
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxPromotionBody))
	if err != nil {
		h.badRequest(w, r, "promote: read body", err)
		return
	}
	var parsed promotionBody
	if e := json.Unmarshal(raw, &parsed); e != nil || parsed.Version == nil || *parsed.Version < 1 {
		h.badRequest(w, r, "promote: invalid body", e)
		return
	}
	corpo, _ := json.Marshal(parsed)
	h.proxy(w, r, "promote", func() (json.RawMessage, error) {
		return h.promoter.AssignLabel(r.Context(), promptName(r), label, corpo)
	})
}

func (h *PromptlyDashboardHandler) badRequest(w http.ResponseWriter, r *http.Request, op string, err error) {
	h.logger.WarnContext(r.Context(), "promptly dashboard: "+op, "error", err, "path", r.URL.Path)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_, _ = w.Write([]byte(invalidPromotionBody))
}

// MountPromptlyDashboard registra o BFF sob `requireJWT`.
//
// A rota de promocao esta aqui junto das leituras porque e um so recurso do ponto de vista da
// navegacao — mas ela e servida pelo cliente de ESCRITA, com credencial propria. O menor
// privilegio esta na chave, nao no arquivo.
func MountPromptlyDashboard(r chi.Router, h *PromptlyDashboardHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/promptly", func(r chi.Router) {
		r.Use(requireJWT)
		r.Get("/prompts", h.Catalog)
		r.Get("/prompts/{promptName}", h.Prompt)
		r.Get("/prompts/{promptName}/revisions", h.Revisions)
		r.Get("/prompts/{promptName}/labels", h.Labels)
		r.Get("/prompts/{promptName}/policies/{label}", h.Policy)
		r.Put("/prompts/{promptName}/labels/{label}", h.Promote)
	})
}
