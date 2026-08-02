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
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

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
	writeRejection(w, r, h.logger, op, err, false)
}

// writeRejection e a politica UNICA de erro da capacidade. O `surfaceForbidden` existe porque um
// `403` significa coisas OPOSTAS nos dois caminhos, e colapsar os dois casos custaria um dos lados:
//
//   - **leitura** (`surfaceForbidden=false`): um `403` do registro fala da NOSSA credencial —
//     o operador nao pediu nada que justifique recusa. Repassa-lo ao navegador o mandaria
//     investigar a propria sessao enquanto o defeito e de fiacao. Vira 502.
//   - **promocao** (`surfaceForbidden=true`): um `403` fala da credencial DELE — a chave nao
//     carrega `skills:publish`. E acionavel, e precisa chegar com o motivo. Virar 502 faria a tela
//     dizer "tente de novo" sobre algo que nunca vai funcionar com aquela credencial.
//
// `401` NUNCA e repassado, nos dois caminhos: ali a credencial nao foi sequer reconhecida, o que e
// falha de fiacao do plano de controle e nao algo que o operador possa corrigir.
func writeRejection(w http.ResponseWriter, r *http.Request, logger *slog.Logger, op string, err error, surfaceForbidden bool) {
	// O detalhe COMPLETO vai sempre para o log, inclusive quando o corpo sai opaco: quem investiga
	// precisa do que o navegador nao pode receber.
	logger.ErrorContext(r.Context(), "skills dashboard: "+op+" failed",
		"error", err, "path", r.URL.Path)

	w.Header().Set("Content-Type", "application/json")

	ue, ok := skills.AsUpstreamError(err)
	if ok && ue.IsClientRefusal() && json.Valid(ue.Body) {
		// A assinatura de `isControlPlaneAuthFailure` fica INTACTA: o BFF do promptly a consome, e
		// mudá-la para acomodar este caso quebraria código de outra capacidade por conveniência
		// desta. A exceção do caminho de mutação é aplicada aqui, onde ela pertence.
		daNossaCredencial := isControlPlaneAuthFailure(ue.Status)
		if surfaceForbidden && ue.Status == http.StatusForbidden {
			daNossaCredencial = false
		}
		if !daNossaCredencial {
			w.WriteHeader(ue.Status)
			_, _ = w.Write(ue.Body)
			return
		}
	}

	w.WriteHeader(http.StatusBadGateway)
	_, _ = w.Write([]byte(upstreamUnavailable))
}

// isControlPlaneAuthFailure separa as recusas que falam da NOSSA credencial das que falam do que o
// operador pediu. So estas duas sao do plano de controle; as demais 4xx sao acionaveis por ele.
//
// Consumida tambem por `promptly_dashboard.go` — a assinatura e contrato compartilhado.
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

// ---- M26 T3.5 — o caminho de MUTAÇÃO: promover canal ------------------------------------
//
// Vive no mesmo arquivo porque é a mesma capacidade, mas o handler e a porta são SEPARADOS de
// propósito: `SkillsDashboardHandler` recebe um cliente cuja credencial carrega apenas
// `skills:read` e, por construção, não consegue promover. Fundir os dois num handler só
// devolveria ao caminho de leitura o poder que a separação existe para tirar dele.

// skillsPromoter é a porta de MUTAÇÃO. Um método só — promover é a única escrita deste milestone.
type skillsPromoter interface {
	PromoteChannel(ctx context.Context, skillID, channel, revisionID string) (json.RawMessage, error)
}

// SkillsPromotionHandler serve a promoção de canal.
type SkillsPromotionHandler struct {
	client skillsPromoter
	logger *slog.Logger
}

// NewSkillsPromotionHandler constrói o handler de mutação.
func NewSkillsPromotionHandler(c skillsPromoter, logger *slog.Logger) *SkillsPromotionHandler {
	return &SkillsPromotionHandler{client: c, logger: logger}
}

// Promote serve PUT /v1/dashboard/skills/{skillID}/channels/{channel}.
//
// Valida `revision_id` NA FRONTEIRA. Encaminhar um corpo inválido devolveria o mesmo 400 vindo do
// upstream — com o custo de uma requisição e de um mint de credencial por erro de cliente, e com o
// motivo escrito para quem consome a API do registro, não para quem está na tela.
func (h *SkillsPromotionHandler) Promote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RevisionID string `json:"revision_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil ||
		strings.TrimSpace(body.RevisionID) == "" {
		h.logger.WarnContext(r.Context(), "skills promotion: invalid request body", "path", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"informe a revisão que passará a servir o canal"}`))
		return
	}

	channel := chi.URLParam(r, "channel")
	out, err := h.client.PromoteChannel(r.Context(), skillID(r), channel, strings.TrimSpace(body.RevisionID))
	if err != nil {
		// Mesmo tratamento do caminho de leitura, e pela mesma razão: um `403` por escopo
		// insuficiente precisa chegar DISTINGUÍVEL de indisponibilidade, senão a tela diz
		// "tente de novo" sobre algo que nunca vai funcionar com aquela credencial.
		h.reject(w, r, "promote "+channel, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// reject usa a MESMA política do caminho de leitura, com uma diferença declarada: aqui o `403`
// SOBE. Ver `writeRejection` — no caminho de leitura um `403` fala da nossa credencial; aqui fala
// da do operador, e é a única coisa que ele pode corrigir.
func (h *SkillsPromotionHandler) reject(w http.ResponseWriter, r *http.Request, op string, err error) {
	writeRejection(w, r, h.logger, op, err, true)
}

// MountSkillsPromotion registra a promoção sob `requireJWT`.
//
// Montada separadamente do BFF de leitura, e não como mais um verbo dentro dele: são handlers
// distintos porque são CLIENTES distintos, com credenciais de escopos distintos.
func MountSkillsPromotion(r chi.Router, h *SkillsPromotionHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/skills/{skillID}/channels", func(r chi.Router) {
		r.Use(requireJWT)
		r.Put("/{channel}", h.Promote)
	})
}
