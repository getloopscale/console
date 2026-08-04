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
	// M31 — a descoberta. Leitura pura: `skills:read` basta, e é o que este cliente carrega.
	Retrieve(ctx context.Context, query string, topK int, includeDraft, includeDeprecated bool) (json.RawMessage, error)
	// M31 — validar NÃO escreve, então mora no cliente de leitura: pedir escopo de escrita aqui
	// obrigaria quem só quer conferir um rascunho a carregar a credencial que publica.
	ValidateSkill(ctx context.Context, skillMd string) (json.RawMessage, error)
	// M34 — o diagnóstico de descobribilidade, no MESMO lugar onde `:validate` já responde: antes
	// de publicar é quando o autor ainda pode corrigir a descrição sem custo.
	Discoverability(ctx context.Context, name, description string, hasEmbedding bool) (json.RawMessage, error)
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

// Retrieve serve GET /v1/dashboard/skills:retrieve.
//
// Consulta VAZIA é recusada na fronteira: o serviço a rejeitaria com 400, e a mensagem sairia
// escrita para quem consome a API. Aqui ela sai para quem está na tela — e a diferença entre
// "informe o que você quer fazer" e "query is required" é a diferença entre um operador que
// entende e um que desiste.
func (h *SkillsDashboardHandler) Retrieve(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	if query == "" {
		h.logger.WarnContext(r.Context(), "skills retrieve: empty query", "path", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"descreva o que você quer que o agente faça"}`))
		return
	}

	// `top_k` inválido cai no padrão em vez de virar 400: é parâmetro de VISUALIZAÇÃO, e recusar
	// a busca inteira por causa dele trocaria uma lista levemente diferente por uma tela de erro.
	topK := 10
	if n, err := strconv.Atoi(r.URL.Query().Get("top_k")); err == nil && n > 0 && n <= 50 {
		topK = n
	}

	out, err := h.client.Retrieve(
		r.Context(),
		query,
		topK,
		r.URL.Query().Get("include_draft") == "true",
		r.URL.Query().Get("include_deprecated") == "true",
	)
	if err != nil {
		h.reject(w, r, "retrieve", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// Validate serve POST /v1/dashboard/skills:validate.
//
// **Sem efeito colateral** — é o que permite escrever uma skill na tela sem publicar às cegas. O
// M30 entregou a rota e ela ficou sem consumidor: o erro traz `field` e `line`, e nada disso
// alcançava um autor porque não havia tela de autoria.
//
// O corpo do erro atravessa INTACTO, com `field` e `line`. Re-modelá-lo aqui perderia justamente
// a informação que posiciona o problema no texto que o autor está escrevendo.
func (h *SkillsDashboardHandler) Validate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SkillMd string `json:"skill_md"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil ||
		strings.TrimSpace(body.SkillMd) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"escreva o conteúdo da skill antes de validar"}`))
		return
	}

	out, err := h.client.ValidateSkill(r.Context(), body.SkillMd)
	if err != nil {
		// Um `4xx` do registro AQUI não é falha de infraestrutura: é o diagnóstico que o autor
		// pediu. `writeRejection` já preserva o corpo tipado, e é ele que carrega `field`/`line`.
		h.reject(w, r, "validate skill", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// Discoverability serve POST /v1/dashboard/skills:discoverability.
//
// Roda no momento da AUTORIA — critério do M34. Um diagnóstico que só existisse depois de
// publicar chegaria quando corrigir já custa uma revisão nova; aqui o autor ainda está com o
// texto na mão.
func (h *SkillsDashboardHandler) Discoverability(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		HasEmbedding bool   `json:"has_embedding"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil ||
		strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.Description) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"o nome e a descrição da skill são necessários para diagnosticar"}`))
		return
	}

	out, err := h.client.Discoverability(
		r.Context(),
		strings.TrimSpace(body.Name),
		strings.TrimSpace(body.Description),
		body.HasEmbedding,
	)
	if err != nil {
		h.reject(w, r, "discoverability", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
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
		// `:retrieve` NÃO colide com `/{skillID}`: o chi dá precedência à rota estática, e o
		// literal carrega os dois-pontos que nenhum identificador de skill aceita
		// (`parseSkillId` os rejeita). Travado por teste.
		r.Get("/:retrieve", h.Retrieve)
		r.Post("/:validate", h.Validate)
		r.Post("/:discoverability", h.Discoverability)
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
	// M32 — mesma porta porque é a MESMA credencial: o registro gateia as duas por
	// `skills:publish`. Um segundo handler com a mesma chave não acrescentaria isolamento.
	SetLifecycle(ctx context.Context, skillID, lifecycle, reason, supersededBy string) (json.RawMessage, error)
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

// SetLifecycle serve PUT /v1/dashboard/skills/{skillID}/lifecycle.
//
// Valida NA FRONTEIRA duas coisas que o registro também valida, e por um motivo além de economizar
// a ida: a mensagem sai escrita para quem está na TELA, não para quem consome a API.
//
//  1. `lifecycle` é obrigatório — sem ele não há o que mudar;
//  2. depreciar EXIGE motivo. É o único estágio que exige, e a razão é assimétrica: ir para
//     `active` ou `draft` não tira nada de ninguém; descontinuar tira, e quem descobrir a skill
//     depois precisa ler por quê.
func (h *SkillsPromotionHandler) SetLifecycle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Lifecycle    string `json:"lifecycle"`
		Reason       string `json:"reason"`
		SupersededBy string `json:"superseded_by"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil ||
		strings.TrimSpace(body.Lifecycle) == "" {
		h.logger.WarnContext(r.Context(), "skills lifecycle: invalid request body", "path", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"informe o estágio do ciclo de vida"}`))
		return
	}

	lifecycle := strings.TrimSpace(body.Lifecycle)
	reason := strings.TrimSpace(body.Reason)
	if lifecycle == "deprecated" && reason == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"diga por que esta skill está sendo descontinuada — quem a descobrir depois vai ler isto"}`))
		return
	}

	out, err := h.client.SetLifecycle(r.Context(), skillID(r), lifecycle, reason, strings.TrimSpace(body.SupersededBy))
	if err != nil {
		h.reject(w, r, "set lifecycle", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// MountSkillsPromotion registra a promoção sob `requireJWT`.
//
// Montada separadamente do BFF de leitura, e não como mais um verbo dentro dele: são handlers
// distintos porque são CLIENTES distintos, com credenciais de escopos distintos.
//
// REGRESSÃO CORRIGIDA (medida em produção 2026-08-02). A primeira versão usava
// `r.Route("/v1/dashboard/skills/{skillID}/channels", …)`. No chi, `Route` cria um SUBTREE naquele
// caminho — e o subtree **sombreia** o `GET /{skillID}/channels` que `MountSkillsDashboard`
// registrou no roteador pai. A leitura de canais passou a devolver `404 page not found` (texto
// puro, nem JSON) e a coluna de canais da tela de versões parou de funcionar.
//
// `Group` + caminho completo registra a rota SEM criar subtree, então os dois mounts coexistem.
// O que garante isso agora é `TestSkillsRoutes_promocaoNaoSombreiaALeituraDeCanais`, que monta os
// DOIS no mesmo roteador — a interação que só existia no `main.go` e que teste nenhum exercitava.
func MountSkillsPromotion(r chi.Router, h *SkillsPromotionHandler, requireJWT func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(requireJWT)
		r.Put("/v1/dashboard/skills/{skillID}/channels/{channel}", h.Promote)
		// `Group` + caminho completo, como a promoção e pelo mesmo motivo: um `r.Route` aqui
		// criaria subtree e sombrearia `GET /{skillID}` do BFF de leitura.
		r.Put("/v1/dashboard/skills/{skillID}/lifecycle", h.SetLifecycle)
	})
}

// ---- M31 — o caminho de AUTORIA: apagar uma skill ---------------------------------------
//
// Handler SEPARADO do de curadoria pela mesma razão que aquele é separado do de leitura: é outro
// CLIENTE, com outra credencial. `skills:write` apaga; `skills:publish` reaponta consumidores.
// Fundir os dois daria a cada caminho o poder do outro, e uma chave que faz as duas coisas
// transforma qualquer vazamento no pior caso possível.

// skillsAuthor é a porta de AUTORIA. Um método só — apagar é a única escrita deste milestone.
type skillsAuthor interface {
	DeleteSkill(ctx context.Context, skillID string) (json.RawMessage, error)
	CreateSkill(ctx context.Context, skillID, skillMd string) (json.RawMessage, error)
	Operation(ctx context.Context, operationID string) (json.RawMessage, error)
}

// SkillsAuthoringHandler serve a exclusão de skills.
type SkillsAuthoringHandler struct {
	client skillsAuthor
	logger *slog.Logger
}

// NewSkillsAuthoringHandler constrói o handler de autoria.
func NewSkillsAuthoringHandler(c skillsAuthor, logger *slog.Logger) *SkillsAuthoringHandler {
	return &SkillsAuthoringHandler{client: c, logger: logger}
}

// Delete serve DELETE /v1/dashboard/skills/{skillID}.
//
// Devolve **204 sem corpo**, espelhando o registro. Inventar um corpo de sucesso obrigaria a tela
// a interpretá-lo, e um dia os dois divergiriam.
func (h *SkillsAuthoringHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if _, err := h.client.DeleteSkill(r.Context(), skillID(r)); err != nil {
		// `403` SOBE, como no caminho de promoção: aqui ele fala da credencial do operador, e é
		// a única coisa que ele pode corrigir.
		writeRejection(w, r, h.logger, "delete skill", err, true)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// MountSkillsAuthoring registra a exclusão sob `requireJWT`.
//
// `Group` + caminho completo, nunca `r.Route`: um subtree aqui sombrearia o `GET /{skillID}` que
// `MountSkillsDashboard` registrou — a regressão medida em produção em 2026-08-02.
func MountSkillsAuthoring(r chi.Router, h *SkillsAuthoringHandler, requireJWT func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(requireJWT)
		r.Delete("/v1/dashboard/skills/{skillID}", h.Delete)
		r.Post("/v1/dashboard/skills", h.Create)
		r.Get("/v1/dashboard/operations/{operationID}", h.Operation)
	})
}

// Create serve POST /v1/dashboard/skills.
//
// Repassa o **202** do registro, com o identificador da operação. Traduzir para 200 faria a tela
// anunciar sucesso no aceite — e o autor procuraria a skill num acervo onde ela ainda não está.
func (h *SkillsAuthoringHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SkillID string `json:"skill_id"`
		SkillMd string `json:"skill_md"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil ||
		strings.TrimSpace(body.SkillID) == "" || strings.TrimSpace(body.SkillMd) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"informe o identificador e o conteúdo da skill"}`))
		return
	}

	out, err := h.client.CreateSkill(r.Context(), strings.TrimSpace(body.SkillID), body.SkillMd)
	if err != nil {
		writeRejection(w, r, h.logger, "create skill", err, true)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	// 202: aceito, não pronto. A tela ACOMPANHA a operação.
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write(out)
}

// Operation serve GET /v1/dashboard/operations/{operationID} — o que a tela consulta para
// acompanhar a publicação em vez de fingir que ela terminou no aceite.
func (h *SkillsAuthoringHandler) Operation(w http.ResponseWriter, r *http.Request) {
	out, err := h.client.Operation(r.Context(), chi.URLParam(r, "operationID"))
	if err != nil {
		writeRejection(w, r, h.logger, "read operation", err, true)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}
