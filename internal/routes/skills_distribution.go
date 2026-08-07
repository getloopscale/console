// M35 — o BFF da superfície de DISTRIBUIÇÃO: bundles, tokens delegados e adoção.
//
// Separado do BFF de leitura (`skills_dashboard.go`) porque é outro CLIENTE, com outra credencial:
// todas as seis operações exigem `skills:publish` no registro — inclusive a adoção, que é leitura
// mas é telemetria comercial de quem publica. Fundir os dois handlers devolveria ao caminho de
// leitura um poder que a separação existe para tirar dele.
//
// **O caminho é `/v1/dashboard/bundles`, e não `/v1/dashboard/skills/bundles`.** A escolha é
// deliberada e tem precedente caro: em 2026-08-02 um `r.Route` sob `/v1/dashboard/skills/...`
// criou subtree no chi, sombreou `GET /{skillID}/channels` e derrubou a coluna de canais em
// produção — devolvendo `404 page not found` em texto puro. Pendurar `bundles` sob `skills/`
// reproduziria a classe do defeito por outra via: o chi trataria `bundles` como um `{skillID}`, e
// a precedência entre rota estática e parâmetro passaria a depender da ordem de registro.
//
// Um recurso irmão não tem esse problema, espelha a API do registro (`/v1/bundles`) e é o que
// `TestDistribuicao_naoSombreiaAsRotasDeSkills` trava — montando as duas famílias no MESMO
// roteador, que é a interação que só existia no `main.go` quando a regressão passou.
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

	"github.com/usetheoai/theo-cloud/internal/skills"
)

// skillsDistributor é a porta da superfície de distribuição.
//
// Interface declarada aqui, no CONSUMIDOR, e não junto da implementação: é o lado que sabe do que
// precisa (ISP + DIP, `rules/architecture.md`). Seis métodos porque a tela usa os seis; um sétimo
// que ninguém chama seria peso morto que o `/code-quality` cobraria depois.
type skillsDistributor interface {
	ListBundles(ctx context.Context) (json.RawMessage, error)
	CreateBundle(ctx context.Context, name string) (json.RawMessage, error)
	ListTokens(ctx context.Context, bundleID string) (json.RawMessage, error)
	MintToken(ctx context.Context, bundleID string, ttlDays int, label string) (json.RawMessage, error)
	RevokeToken(ctx context.Context, bundleID, tokenID string) (json.RawMessage, error)
	Adoption(ctx context.Context, bundleID string, days int) (json.RawMessage, error)
	SetBundleItems(ctx context.Context, bundleID string, items []skills.BundleItem) (json.RawMessage, error)
}

// SkillsDistributionHandler serve a superfície de distribuição para o dashboard.
type SkillsDistributionHandler struct {
	client skillsDistributor
	logger *slog.Logger
}

// NewSkillsDistributionHandler constrói o handler.
func NewSkillsDistributionHandler(c skillsDistributor, logger *slog.Logger) *SkillsDistributionHandler {
	return &SkillsDistributionHandler{client: c, logger: logger}
}

const maxCorpoDistribuicao = 1 << 16

func bundleID(r *http.Request) string { return chi.URLParam(r, "bundleID") }

// escreve devolve o corpo cru do upstream, sem re-modelar — mesma política do BFF de leitura.
func (h *SkillsDistributionHandler) escreve(w http.ResponseWriter, out json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// recusa aplica a MESMA política do caminho de promoção, e pelo mesmo motivo: aqui o `403` fala da
// credencial do OPERADOR (falta `skills:publish`), que é a única coisa que ele pode corrigir — e
// precisa chegar distinguível de indisponibilidade, senão a tela oferece "tente de novo" sobre
// algo que nunca vai funcionar.
func (h *SkillsDistributionHandler) recusa(w http.ResponseWriter, r *http.Request, op string, err error) {
	writeRejection(w, r, h.logger, op, err, true)
}

func (h *SkillsDistributionHandler) invalido(w http.ResponseWriter, r *http.Request, mensagem string) {
	h.logger.WarnContext(r.Context(), "skills distribution: invalid request body", "path", r.URL.Path)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":` + strconv.Quote(mensagem) + `}`))
}

// ListBundles serve GET /v1/dashboard/bundles.
func (h *SkillsDistributionHandler) ListBundles(w http.ResponseWriter, r *http.Request) {
	out, err := h.client.ListBundles(r.Context())
	if err != nil {
		h.recusa(w, r, "list bundles", err)
		return
	}
	h.escreve(w, out)
}

// CreateBundle serve POST /v1/dashboard/bundles.
//
// Valida o nome NA FRONTEIRA (`rules/architecture.md` § 2 — validar na entrada do sistema).
// Encaminhar um nome vazio devolveria o mesmo 400 do registro, ao custo de uma requisição e de um
// mint de credencial por erro de digitação — e com a mensagem escrita para quem consome a API,
// não para quem está na tela.
func (h *SkillsDistributionHandler) CreateBundle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxCorpoDistribuicao)).Decode(&body); err != nil ||
		strings.TrimSpace(body.Name) == "" {
		h.invalido(w, r, "dê um nome ao pacote — é como ele aparece para quem instala")
		return
	}
	out, err := h.client.CreateBundle(r.Context(), strings.TrimSpace(body.Name))
	if err != nil {
		h.recusa(w, r, "create bundle", err)
		return
	}
	h.escreve(w, out)
}

// ListTokens serve GET /v1/dashboard/bundles/{bundleID}/tokens.
//
// É a rota que torna a revogação possível: sem ela o operador não tem como descobrir o
// identificador que o DELETE exige, e um token emitido pela CLI ou por outro operador fica
// invisível — logo, irrevogável.
func (h *SkillsDistributionHandler) ListTokens(w http.ResponseWriter, r *http.Request) {
	out, err := h.client.ListTokens(r.Context(), bundleID(r))
	if err != nil {
		h.recusa(w, r, "list tokens", err)
		return
	}
	h.escreve(w, out)
}

// MintToken serve POST /v1/dashboard/bundles/{bundleID}/tokens.
//
// A resposta carrega o valor em claro UMA vez. O BFF a repassa intacta — e quem renderiza precisa
// dizer ao operador que ele não reaparece, porque a listagem devolve só o identificador.
func (h *SkillsDistributionHandler) MintToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TTLDays int    `json:"ttl_days"`
		Label   string `json:"label"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxCorpoDistribuicao)).Decode(&body); err != nil ||
		body.TTLDays <= 0 {
		// TTL ausente ou não-positivo geraria um token já expirado — inútil e confuso, porque a
		// tela mostraria um segredo que nunca funcionou.
		h.invalido(w, r, "informe por quantos dias o token deve valer (maior que zero)")
		return
	}
	out, err := h.client.MintToken(r.Context(), bundleID(r), body.TTLDays, strings.TrimSpace(body.Label))
	if err != nil {
		h.recusa(w, r, "mint token", err)
		return
	}
	h.escreve(w, out)
}

// RevokeToken serve DELETE /v1/dashboard/bundles/{bundleID}/tokens/{tokenID}.
func (h *SkillsDistributionHandler) RevokeToken(w http.ResponseWriter, r *http.Request) {
	out, err := h.client.RevokeToken(r.Context(), bundleID(r), chi.URLParam(r, "tokenID"))
	if err != nil {
		h.recusa(w, r, "revoke token", err)
		return
	}
	h.escreve(w, out)
}

// janelaPadraoDias é a janela usada quando a tela não pede outra. Trinta dias é o que o registro
// já assume por omissão — divergir aqui faria a tela e a API discordarem sobre o mesmo "padrão".
const janelaPadraoDias = 30

// Adoption serve GET /v1/dashboard/bundles/{bundleID}/adoption.
//
// `days` inválido cai no padrão em vez de virar 400: é um parâmetro de VISUALIZAÇÃO, e recusar a
// tela inteira por causa dele trocaria um gráfico levemente diferente por uma tela de erro.
func (h *SkillsDistributionHandler) Adoption(w http.ResponseWriter, r *http.Request) {
	dias := janelaPadraoDias
	if raw := r.URL.Query().Get("days"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			dias = n
		}
	}
	out, err := h.client.Adoption(r.Context(), bundleID(r), dias)
	if err != nil {
		h.recusa(w, r, "adoption", err)
		return
	}
	h.escreve(w, out)
}

// SetItems serve PUT /v1/dashboard/bundles/{bundleID}/items.
//
// **Substitui a lista inteira**, seguindo o contrato do registro. "Adicionar sem poder remover"
// produziria pacotes que só crescem, e um item esquecido lá dentro é acesso que ninguém
// pretendeu conceder.
//
// Valida NA FRONTEIRA: cada item precisa de `skill_id` E `channel`. O canal é o que torna o
// pacote vivo — promover o canal reaponta todos os consumidores sem reeditar o pacote —, então
// um item sem ele não é um item, é uma entrada que o registro não sabe servir.
//
// Lista VAZIA é aceita: esvaziar o pacote sem apagá-lo é como se revoga o conteúdo dele, e
// recusar aqui deixaria a tela sem como desfazer o que o operador montou.
func (h *SkillsDistributionHandler) SetItems(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Items *[]struct {
			SkillID string `json:"skill_id"`
			Channel string `json:"channel"`
		} `json:"items"`
	}
	// Ponteiro para distinguir `{"items":[]}` (esvaziar — legítimo) de `{}` (campo ausente —
	// provavelmente engano de quem chama). Um slice comum colapsaria os dois em `nil`.
	if err := json.NewDecoder(io.LimitReader(r.Body, maxCorpoDistribuicao)).Decode(&body); err != nil || body.Items == nil {
		h.invalido(w, r, "informe a lista de itens do pacote (pode ser vazia para esvaziá-lo)")
		return
	}

	items := make([]skills.BundleItem, 0, len(*body.Items))
	for _, it := range *body.Items {
		if strings.TrimSpace(it.SkillID) == "" || strings.TrimSpace(it.Channel) == "" {
			h.invalido(w, r, "cada item precisa de uma skill e de um canal")
			return
		}
		items = append(items, skills.BundleItem{SkillID: it.SkillID, Channel: it.Channel})
	}

	out, err := h.client.SetBundleItems(r.Context(), bundleID(r), items)
	if err != nil {
		h.recusa(w, r, "set bundle items", err)
		return
	}
	h.escreve(w, out)
}

// MountSkillsDistribution registra a superfície de distribuição sob `requireJWT`.
//
// `r.Route` é seguro AQUI — e só aqui — porque `/v1/dashboard/bundles` é um recurso próprio: o
// subtree que ele cria não tem vizinho para sombrear. O que estaria errado é pendurá-lo sob
// `/v1/dashboard/skills/...`, onde o subtree engoliria as rotas de leitura já montadas.
func MountSkillsDistribution(r chi.Router, h *SkillsDistributionHandler, requireJWT func(http.Handler) http.Handler) {
	r.Route("/v1/dashboard/bundles", func(r chi.Router) {
		r.Use(requireJWT)
		r.Get("/", h.ListBundles)
		r.Post("/", h.CreateBundle)
		r.Get("/{bundleID}/tokens", h.ListTokens)
		r.Post("/{bundleID}/tokens", h.MintToken)
		r.Delete("/{bundleID}/tokens/{tokenID}", h.RevokeToken)
		r.Get("/{bundleID}/adoption", h.Adoption)
		r.Put("/{bundleID}/items", h.SetItems)
	})
}
