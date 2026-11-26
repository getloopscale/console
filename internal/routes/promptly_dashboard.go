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
// DIVERGENCIA DELIBERADA da referencia (`loop-console#358`): o `proxy` do trust colapsa TODO erro em
// 502 com corpo opaco. Aqui a recusa do CLIENTE (4xx) sai com status e corpo preservados, porque a
// tela precisa DECIDIR sobre o codigo: `policy_not_found` significa "promocao livre" e desenha
// diferente de "nao consegui ler"; `promotion_blocked` carrega os numeros que explicam a recusa.
package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/getloopscale/loop-console/internal/promptly"
	"github.com/go-chi/chi/v5"
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

// promptlyCatalogPath e o caminho DESTA capacidade nesta origem — o que o navegador consegue
// seguir. O servico publica o caminho dele (`/prompts`), que aqui nao resolve.
const promptlyCatalogPath = "/v1/dashboard/promptly/prompts"

// promptlyReader e o subconjunto de leitura que este BFF consome.
type promptlyReader interface {
	// Catalog devolve a pagina E se ha proxima — ver M13 e `promptly.Continuacao`.
	Catalog(ctx context.Context, limit int, after string, filtro promptly.CatalogoFiltro) (json.RawMessage, promptly.Continuacao, error)
	Prompt(ctx context.Context, name string) (json.RawMessage, error)
	// M20 — os DOIS textos, e quem depende de mim. Separados de `Prompt` de proposito: resolver
	// atravessa o grafo, e quem so quer o texto escrito nao paga por isso.
	PromptResolvido(ctx context.Context, name string) (json.RawMessage, error)
	Dependentes(ctx context.Context, name string) (json.RawMessage, error)
	// M18 — a discussao e a protecao, do lado da LEITURA: quem promove precisa ve-las ANTES de
	// confirmar. Discussao que nao e lida na hora da decisao nao muda decisao nenhuma.
	Comments(ctx context.Context, name string, version int) (json.RawMessage, error)
	LabelProtection(ctx context.Context, label string) (json.RawMessage, error)
	Revisions(ctx context.Context, name string, limit, after int) (json.RawMessage, error)
	Labels(ctx context.Context, name string) (json.RawMessage, error)
	Policy(ctx context.Context, name, label string) (json.RawMessage, error)
	// M14 — o playground. Fica na porta de LEITURA porque nao muta estado nosso; ver o comentario
	// de `DataClient.Playground` para a razao completa do escopo.
	Playground(ctx context.Context, name string, body json.RawMessage) (json.RawMessage, error)
}

// promptlyPromoter e o UNICO verbo mutante da capacidade.
type promptlyPromoter interface {
	AssignLabel(ctx context.Context, name, label string, body json.RawMessage) (json.RawMessage, error)
	// M12 — as duas escritas da jornada de autoria. Ficam na MESMA porta que a promocao porque
	// compartilham a propriedade que importa: sao servidas pela credencial de ESCRITA cunhada por
	// inquilino. Separa-las em outra interface sugeriria outro nivel de privilegio, que nao existe.
	CreateRevision(ctx context.Context, body json.RawMessage) (json.RawMessage, error)
	// M16 — marcar e ESCRITA, servida pela mesma credencial de inquilino.
	SetTags(ctx context.Context, name string, body json.RawMessage) (json.RawMessage, error)
	// M18 — a discussao e a protecao. Mesma porta que a promocao porque compartilham a
	// propriedade que importa: sao servidas pela credencial de ESCRITA cunhada por inquilino.
	AddComment(ctx context.Context, name string, version int, body json.RawMessage) (json.RawMessage, error)
	ProtectLabel(ctx context.Context, label string, body json.RawMessage) (json.RawMessage, error)
	UnprotectLabel(ctx context.Context, label string) (json.RawMessage, error)
	Rollback(ctx context.Context, name string, body json.RawMessage) (json.RawMessage, error)
}

// promptlyUsageReader e a porta do uso observado por revisao (M15).
//
// Separada das outras duas de proposito: este dado vem do `looptrace`, nao do
// `loopprompt`, e e servido por outra credencial. Junta-las numa porta so
// sugeriria um nivel de privilegio unico que nao existe (ISP).
type promptlyUsageReader interface {
	PromptUsage(ctx context.Context, promptName string, windowDays int) (json.RawMessage, error)
}

// PromptlyDashboardHandler serve o catalogo de prompts ao dashboard.
type PromptlyDashboardHandler struct {
	reader   promptlyReader
	promoter promptlyPromoter
	usage    promptlyUsageReader
	logger   *slog.Logger
}

// WithUsageReader liga a leitura de uso (M15). OPCIONAL por desenho: um operador que
// nao tenha o `looptrace` configurado continua com toda a capacidade de autoria. Sem
// ele, a rota de uso RECUSA com razao legivel em vez de entrar em panico.
func (h *PromptlyDashboardHandler) WithUsageReader(u promptlyUsageReader) *PromptlyDashboardHandler {
	h.usage = u
	return h
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
const promptlyUnavailable = `{"code":"PROMPTLY_UPSTREAM_UNAVAILABLE","message":"the prompts service did not respond; no data was read"}`

// invalidPromotionBody e a recusa na FRONTEIRA: promover exige dizer PARA QUAL revisao.
const invalidPromotionBody = `{"code":"INVALID_PROMOTION_BODY","message":"provide the target revision for the promotion"}`

// maxPromotionBody limita o corpo aceito na promocao. O corpo legitimo tem um numero.
const maxPromotionBody = 4 << 10

// maxPromptBody limita o corpo das ESCRITAS de autoria, que carregam o TEXTO de um prompt.
//
// Teto proprio porque a grandeza e outra: 4 KiB dimensionam um corpo com um numero, nao um system
// prompt. Reusar o teto da promocao aqui cortava um prompt de 5 KiB no meio e o mandava adiante —
// `io.LimitReader` devolve EOF no teto SEM erro, entao o corte era indetectavel na camada que so
// repassa, e o produto respondia erro de parse sobre um conteudo que o operador escreveu inteiro.
const maxPromptBody = 256 << 10

// lerCorpoLimitado le o corpo e DISTINGUE "acabou" de "estourou o teto".
//
// Le um byte alem do limite: se ele veio, o corpo era maior. E isso que transforma um truncamento
// silencioso numa recusa tipada — o produto nunca ve JSON pela metade.
func lerCorpoLimitado(r *http.Request, teto int) (json.RawMessage, bool, error) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, int64(teto)+1))
	if err != nil {
		return nil, false, err
	}
	if len(raw) > teto {
		return nil, true, nil
	}
	return json.RawMessage(raw), false, nil
}

// corpoGrandeDemais e a recusa tipada — com o teto DENTRO da mensagem, para o operador saber por
// quanto passou em vez de tentar de novo no escuro.
func (h *PromptlyDashboardHandler) corpoGrandeDemais(w http.ResponseWriter, r *http.Request, op string) {
	h.logger.WarnContext(r.Context(), "promptly dashboard: "+op+": corpo acima do teto",
		"limite_bytes", maxPromptBody, "path", r.URL.Path)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusRequestEntityTooLarge)
	_, _ = fmt.Fprintf(w,
		`{"code":"PAYLOAD_TOO_LARGE","message":"the content exceeds the limit of %d KiB per revision"}`,
		maxPromptBody>>10)
}

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
	if ok && ue.IsClientRefusal() && json.Valid(ue.Body) &&
		(!isControlPlaneAuthFailure(ue.Status) || recusaDePapel(ue.Body)) {
		w.WriteHeader(ue.Status)
		_, _ = w.Write(ue.Body)
		return
	}

	w.WriteHeader(http.StatusBadGateway)
	_, _ = w.Write([]byte(promptlyUnavailable))
}

// recusasDeAutoridade são os códigos com que o promptly recusa UMA PESSOA — não uma credencial de
// infraestrutura.
//
// É uma lista explícita, e não uma heurística sobre a forma do corpo, porque a diferença entre as
// duas classes de 403 decide se o operador vê um diagnóstico ou uma mentira. Errar para o lado
// permissivo repassaria ao navegador um 403 que significa "a fiação está errada" — e o usuário
// investigaria a própria sessão. Um código novo entra aqui de propósito, com quem o escreveu
// sabendo o que está afirmando.
//
// `label_protected` entrou depois de `forbidden_role`, e o motivo é registro: a quarta rodada de
// aceitação do M18 mostrou o gate funcionando (um `member` foi barrado ao promover) e a explicação
// se perdendo — o serviço dizia "label production exige papel admin; quem tentou tem member" e a
// tela mostrava "o serviço não respondeu". Conhecer uma recusa da classe e não a irmã dela é o
// mesmo defeito, uma linha mais tarde.
var recusasDeAutoridade = map[string]bool{
	"forbidden_role":  true, // a AÇÃO exige um papel que o autor não tem
	"label_protected": true, // ESTE label exige um papel que o autor não tem
}

// recusaDePapel distingue os DOIS 403 que o promptly pode devolver — e a distinção é a diferença
// entre um diagnóstico e uma mentira.
//
// Até o M18, 403 upstream só podia significar UMA coisa: a credencial do PLANO DE CONTROLE está
// errada. Repassá-la ao navegador deslogaria alguém perfeitamente autenticado, que investigaria a
// própria sessão enquanto o defeito é de fiação — por isso `reject` a converte em 502.
//
// O M18 criou um 403 de outra natureza: `forbidden_role` é dirigido AO HUMANO e diz o que ele
// precisa ("required: admin, actual: member"). Medido na aceitação de 2026-08-04: o serviço
// respondeu com essa razão exata e a tela recebeu "o serviço de prompts não respondeu" — uma
// afirmação FALSA, que manda investigar disponibilidade num problema de autorização.
//
// O que discrimina não é o status (idêntico nos dois) nem a rota (a mesma pode dar os dois): é o
// CÓDIGO TIPADO no corpo. Por isso a checagem é aqui, sobre o corpo, e `isControlPlaneAuthFailure`
// — compartilhada com o dashboard de skills — fica intacta.
func recusaDePapel(corpo []byte) bool {
	var tipado struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(corpo, &tipado); err != nil {
		return false
	}
	return recusasDeAutoridade[tipado.Error]
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
	// M16 — os filtros. Superficie MINIMA de proposito: so estes tres atravessam, e um parametro
	// desconhecido na URL do navegador nao vira parametro na chamada ao servico. Um proxy que
	// repassa a query inteira publica, sem querer, toda opcao futura do upstream.
	filtro := promptly.CatalogoFiltro{
		Search: r.URL.Query().Get("search"),
		Tag:    r.URL.Query().Get("tag"),
		Folder: r.URL.Query().Get("folder"),
	}

	// O catalogo NAO usa `proxy`: e a unica operacao que precisa publicar um header, e acrescentar
	// um parametro ao proxy generico penalizaria as outras sete que nao o usam (SRP — o proxy
	// transporta; a operacao decide o que ela precisa dizer).
	corpo, cont, err := h.reader.Catalog(r.Context(), limit, after, filtro)
	if err != nil {
		h.reject(w, r, "catalog", err)
		return
	}
	if cont.TemMais {
		// EC-1 — o servico monta o Link com o caminho DELE (`</prompts?...>`). Esta capacidade e
		// servida ao navegador em `/v1/dashboard/promptly/prompts`; repassar verbatim entregaria um
		// endereco que NAO resolve nesta origem — correto como booleano, mentiroso como URL.
		//
		// A QUERY vem do servico e atravessa intacta: o cursor e decisao dele (keyset por nome), e
		// re-deriva-la aqui duplicaria essa regra no plano de controle.
		//
		// Publica MESMO SEM cursor. "Ha mais" e "sei o endereco" sao perguntas distintas, e
		// silenciar a primeira porque a segunda nao tem resposta faria a tela exibir totais sobre
		// uma pagina que o servico declarou truncada — o falso total que este milestone elimina.
		alvo := promptlyCatalogPath
		if cont.Query != "" {
			alvo += "?" + cont.Query
		}
		w.Header().Set("Link", `<`+alvo+`>; rel="next"`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(corpo)
}

// Prompt serve GET /v1/dashboard/promptly/prompts/{promptName}.
func (h *PromptlyDashboardHandler) Prompt(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "prompt", func() (json.RawMessage, error) {
		return h.reader.Prompt(r.Context(), promptName(r))
	})
}

// PromptResolvido serve GET /v1/dashboard/promptly/prompts/{promptName}/resolved (M20, DoD-2).
//
// O caminho e proprio, e nao um `?resolve=true` sobre o detalhe, porque as duas leituras tem custos
// diferentes e a tela escolhe qual paga. A resposta traz os DOIS textos vindos da MESMA leitura do
// servico: se viessem de duas, uma escrita entre elas faria a tela exibir um resolvido que nao
// corresponde ao escrito, e alguem depuraria uma composicao que nunca existiu.
func (h *PromptlyDashboardHandler) PromptResolvido(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "prompt_resolved", func() (json.RawMessage, error) {
		return h.reader.PromptResolvido(r.Context(), promptName(r))
	})
}

// Dependentes serve GET /v1/dashboard/promptly/prompts/{promptName}/dependents (M20, DoD-4).
//
// Lista vazia e um FATO ("ninguem depende de mim"), nao uma falha — quem consome tem de conseguir
// distinguir isso de "nao consegui ler", que e a distincao que o CLAUDE.md deste repo nomeia.
func (h *PromptlyDashboardHandler) Dependentes(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "prompt_dependents", func() (json.RawMessage, error) {
		return h.reader.Dependentes(r.Context(), promptName(r))
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

// SetTags repassa a marcacao (`PUT /prompts/:name/tags`) — M16.
func (h *PromptlyDashboardHandler) SetTags(w http.ResponseWriter, r *http.Request) {
	raw, grande, err := lerCorpoLimitado(r, maxPromotionBody)
	if err != nil {
		h.badRequest(w, r, "set_tags: read body", err)
		return
	}
	if grande {
		h.corpoGrandeDemais(w, r, "set_tags")
		return
	}
	// O corpo atravessa OPACO: as recusas tipadas do servico (`empty_tag`, `too_many_tags`,
	// `prompt_not_found`) sao o que a tela transforma em diagnostico. Validar aqui duplicaria a
	// regra, e as duas copias divergiriam no dia em que uma mudasse.
	h.proxy(w, r, "set_tags", func() (json.RawMessage, error) {
		return h.promoter.SetTags(r.Context(), promptName(r), raw)
	})
}

// versaoDaRota le o segmento :version. Um valor invalido e recusado AQUI, antes de sair para o
// servico: mandar `NaN` adiante produziria uma recusa do upstream sobre um pedido que este proxy
// sabia estar errado.
func versaoDaRota(r *http.Request) (int, bool) {
	n, err := strconv.Atoi(chi.URLParam(r, "version"))
	if err != nil || n < 1 {
		return 0, false
	}
	return n, true
}

// AddComment repassa o comentario de uma revisao (M18).
func (h *PromptlyDashboardHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	version, ok := versaoDaRota(r)
	if !ok {
		h.badRequest(w, r, "add_comment: invalid version", nil)
		return
	}
	raw, grande, err := lerCorpoLimitado(r, maxPromptBody)
	if err != nil {
		h.badRequest(w, r, "add_comment: read body", err)
		return
	}
	if grande {
		h.corpoGrandeDemais(w, r, "add_comment")
		return
	}
	h.proxy(w, r, "add_comment", func() (json.RawMessage, error) {
		return h.promoter.AddComment(r.Context(), promptName(r), version, raw)
	})
}

// Comments le a discussao de uma revisao (M18).
func (h *PromptlyDashboardHandler) Comments(w http.ResponseWriter, r *http.Request) {
	version, ok := versaoDaRota(r)
	if !ok {
		h.badRequest(w, r, "comments: invalid version", nil)
		return
	}
	h.proxy(w, r, "comments", func() (json.RawMessage, error) {
		return h.reader.Comments(r.Context(), promptName(r), version)
	})
}

// ProtectLabel define o papel minimo do label (M18).
func (h *PromptlyDashboardHandler) ProtectLabel(w http.ResponseWriter, r *http.Request) {
	raw, grande, err := lerCorpoLimitado(r, maxPromotionBody)
	if err != nil {
		h.badRequest(w, r, "protect_label: read body", err)
		return
	}
	if grande {
		h.corpoGrandeDemais(w, r, "protect_label")
		return
	}
	h.proxy(w, r, "protect_label", func() (json.RawMessage, error) {
		return h.promoter.ProtectLabel(r.Context(), chi.URLParam(r, "label"), raw)
	})
}

// UnprotectLabel e o caminho de emergencia auditado (M18, ADR-2).
func (h *PromptlyDashboardHandler) UnprotectLabel(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "unprotect_label", func() (json.RawMessage, error) {
		return h.promoter.UnprotectLabel(r.Context(), chi.URLParam(r, "label"))
	})
}

// LabelProtection le o papel exigido (M18). `404` quando livre — a tela precisa distinguir
// "promocao livre" de "nao consegui ler".
func (h *PromptlyDashboardHandler) LabelProtection(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "label_protection", func() (json.RawMessage, error) {
		return h.reader.LabelProtection(r.Context(), chi.URLParam(r, "label"))
	})
}

// Create repassa a criacao de uma revisao (`POST /prompts`).
//
// O corpo NAO e validado aqui, e a ausencia e decisao: `name` e `content` tem regra no produto
// (nome nao vazio, template balanceado), e uma segunda copia dessa regra no BFF divergiria da
// primeira no dia em que uma das duas mudasse. O que este handler garante e o teto de tamanho —
// que protege ESTE processo — e a credencial certa. A recusa do produto chega tipada via
// UpstreamError e e o proprio `reject` que a repassa.
func (h *PromptlyDashboardHandler) Create(w http.ResponseWriter, r *http.Request) {
	raw, grande, err := lerCorpoLimitado(r, maxPromptBody)
	if err != nil {
		h.badRequest(w, r, "create: read body", err)
		return
	}
	if grande {
		h.corpoGrandeDemais(w, r, "create")
		return
	}
	h.proxy(w, r, "create", func() (json.RawMessage, error) {
		return h.promoter.CreateRevision(r.Context(), raw)
	})
}

// Rollback repassa a reversao (`POST /prompts/:name/rollback`).
//
// Mesmo raciocinio do Create sobre validacao. E ha uma razao a mais para o corpo seguir opaco: a
// recusa `400 label_required` carrega `availableLabels`, e e ELA que a tela transforma em escolha.
// Um BFF que validasse antes devolveria a propria recusa, sem a lista — e a tela perderia o dado
// que torna o erro acionavel.
func (h *PromptlyDashboardHandler) Rollback(w http.ResponseWriter, r *http.Request) {
	raw, grande, err := lerCorpoLimitado(r, maxPromptBody)
	if err != nil {
		h.badRequest(w, r, "rollback: read body", err)
		return
	}
	if grande {
		h.corpoGrandeDemais(w, r, "rollback")
		return
	}
	h.proxy(w, r, "rollback", func() (json.RawMessage, error) {
		return h.promoter.Rollback(r.Context(), promptName(r), raw)
	})
}

// Playground repassa a invocacao (`POST /prompts/:name/playground`).
//
// Corpo OPACO, pela mesma razao do Create e do Rollback, mais uma que so vale aqui: o corpo carrega
// a credencial do MODELO, digitada pelo operador. Ler campos dela para validar seria criar um lugar
// a mais de onde ela pode escapar para um log.
func (h *PromptlyDashboardHandler) Playground(w http.ResponseWriter, r *http.Request) {
	raw, grande, err := lerCorpoLimitado(r, maxPromptBody)
	if err != nil {
		h.badRequest(w, r, "playground: read body", err)
		return
	}
	if grande {
		h.corpoGrandeDemais(w, r, "playground")
		return
	}
	h.proxy(w, r, "playground", func() (json.RawMessage, error) {
		return h.reader.Playground(r.Context(), promptName(r), raw)
	})
}

// responderJSON escreve um corpo JSON literal com o status dado.
func responderJSON(w http.ResponseWriter, status int, corpo string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(corpo))
}

// usageWindowDefault e o teto da janela do agregado de uso.
//
// O default e curto de proposito: um agregado "desde sempre" varre a tabela de spans do
// ecossistema inteiro, e a tela DIZ qual janela esta mostrando em vez de deixar implicita.
const (
	usageWindowDefault = 7
	usageWindowCeiling = 90
)

// usageUnavailable e o corpo da falha de LEITURA do uso. Nao e um agregado vazio,
// deliberadamente: "nao consegui ler" e "ninguem usou este prompt" levam a decisoes
// opostas, e o segundo disfarcado do primeiro faz a tela afirmar um fato que ninguem mediu.
const usageUnavailable = `{"code":"PROMPTLY_USAGE_UNAVAILABLE","message":"could not read this prompt's usage; no number was read"}`

// usageNotConfigured e a recusa quando o operador nao ligou o looptrace.
const usageNotConfigured = `{"code":"PROMPTLY_USAGE_NOT_CONFIGURED","message":"a leitura de uso exige o looptrace configurado neste ambiente"}`

// Usage serve GET /v1/dashboard/promptly/prompts/{promptName}/usage — quantas resolucoes e a
// que custo, POR REVISAO, na janela pedida.
func (h *PromptlyDashboardHandler) Usage(w http.ResponseWriter, r *http.Request) {
	if h.usage == nil {
		h.logger.WarnContext(r.Context(), "promptly_usage_not_configured")
		responderJSON(w, http.StatusServiceUnavailable, usageNotConfigured)
		return
	}
	janela := usageWindowDefault
	if raw := r.URL.Query().Get("windowDays"); raw != "" {
		// Fail-fast: trocar em silencio faria o chamador atribuir o resultado a uma janela
		// diferente da que pediu — e a tela mostra a janela, entao ela mentiria junto.
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > usageWindowCeiling {
			h.badRequest(w, r, "usage", fmt.Errorf("windowDays fora de 1..%d", usageWindowCeiling))
			return
		}
		janela = n
	}
	corpo, err := h.usage.PromptUsage(r.Context(), promptName(r), janela)
	if err != nil {
		h.logger.ErrorContext(r.Context(), "promptly_usage_failed", "erro", err.Error())
		responderJSON(w, http.StatusBadGateway, usageUnavailable)
		return
	}
	responderJSON(w, http.StatusOK, string(corpo))
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
		r.Get("/prompts/{promptName}/resolved", h.PromptResolvido)
		r.Get("/prompts/{promptName}/dependents", h.Dependentes)
		r.Get("/prompts/{promptName}/revisions", h.Revisions)
		r.Get("/prompts/{promptName}/labels", h.Labels)
		// M15 — o uso observado por revisao. GET porque nao muda nada; a janela vem por query.
		r.Get("/prompts/{promptName}/usage", h.Usage)
		r.Get("/prompts/{promptName}/policies/{label}", h.Policy)
		r.Put("/prompts/{promptName}/labels/{label}", h.Promote)
		// M12 — as escritas da autoria. `POST` nos dois porque NENHUM dos dois e idempotente:
		// cada chamada cria mais uma revisao. Confundi-los com o `PUT` acima faria um retry de
		// rede virar duas revisoes sem que ninguem percebesse.
		r.Post("/prompts", h.Create)
		r.Put("/prompts/{promptName}/tags", h.SetTags)
		r.Post("/prompts/{promptName}/revisions/{version}/comments", h.AddComment)
		r.Get("/prompts/{promptName}/revisions/{version}/comments", h.Comments)
		r.Put("/labels/{label}/protection", h.ProtectLabel)
		r.Delete("/labels/{label}/protection", h.UnprotectLabel)
		r.Get("/labels/{label}/protection", h.LabelProtection)
		r.Post("/prompts/{promptName}/playground", h.Playground)
		r.Post("/prompts/{promptName}/rollback", h.Rollback)
	})
}
