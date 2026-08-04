// M35 — a superfície de DISTRIBUIÇÃO do registro: bundles, tokens delegados e adoção.
//
// Arquivo separado de `data_client.go` (leitura do acervo) e de `write_client.go` (promoção de
// canal) pela mesma razão que aqueles são separados entre si: SRP no nível do arquivo. Os três
// compartilham o tipo `DataClient` — e portanto `getRaw`/`sendRaw`, o teto de corpo e o
// `UpstreamError` — porque duplicar o transporte criaria três lugares para consertar o mesmo bug.
//
// **TODAS as seis operações exigem `skills:publish` no registro**, inclusive a adoção, que é
// leitura. Isso não é excesso de zelo: adoção é telemetria comercial de quem publica, e até
// 2026-08-04 era a única rota da família sem o gate — um portador de `skills:read` a lia. Por
// isso o BFF liga estes métodos ao resolver de PUBLICAÇÃO, nunca ao de leitura.
//
// O corpo do upstream atravessa como `json.RawMessage`, sem re-modelagem, pelo mesmo motivo do
// `data_client`: um segundo schema aqui vira bug silencioso de renderização na primeira
// divergência com o registro.
package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// ListBundles devolve os bundles do inquilino (`GET /v1/bundles`).
func (c *DataClient) ListBundles(ctx context.Context) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/bundles", nil)
}

// CreateBundle cria um bundle (`POST /v1/bundles`), corpo `{name}`.
func (c *DataClient) CreateBundle(ctx context.Context, name string) (json.RawMessage, error) {
	body, err := json.Marshal(map[string]string{"name": name})
	if err != nil {
		return nil, fmt.Errorf("skills data client: encode bundle body: %w", err)
	}
	return c.sendRaw(ctx, http.MethodPost, "/v1/bundles", body)
}

// ListTokens devolve os tokens delegados de um bundle (`GET /v1/bundles/:id/tokens`).
//
// **É a rota que torna a revogação possível.** Até o M35 o registro sabia emitir e revogar, e não
// listar — então `revokeToken` exigia um `tokenId` que a tela não tinha como descobrir, e um token
// emitido pela CLI ou por outro operador era invisível e portanto irrevogável.
//
// A resposta traz identidade e ciclo de vida; **nunca o valor nem o hash** — o valor existe em
// claro uma única vez, na resposta de `MintToken`.
func (c *DataClient) ListTokens(ctx context.Context, bundleID string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/bundles/"+url.PathEscape(bundleID)+"/tokens", nil)
}

// MintToken emite um token delegado (`POST /v1/bundles/:id/tokens`).
//
// A resposta carrega o valor em claro **uma única vez**. Quem consome precisa mostrá-lo ao
// operador na hora e deixar explícito que não reaparece: a listagem devolve só o identificador.
func (c *DataClient) MintToken(ctx context.Context, bundleID string, ttlDays int, label string) (json.RawMessage, error) {
	payload := map[string]any{"ttl_days": ttlDays}
	// Rótulo vazio é OMITIDO, não enviado em branco: `{"label":""}` faria o registro gravar um
	// rótulo vazio em vez de nenhum, e a tela exibiria uma linha em branco onde deve dizer
	// "sem rótulo".
	if label != "" {
		payload["label"] = label
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("skills data client: encode token body: %w", err)
	}
	return c.sendRaw(ctx, http.MethodPost, "/v1/bundles/"+url.PathEscape(bundleID)+"/tokens", body)
}

// RevokeToken revoga um token delegado (`DELETE /v1/bundles/:id/tokens/:tokenId`).
//
// O token revogado **continua listado**, com a marca de revogação — esconder impediria auditar o
// que já foi emitido, que é metade do valor de manter a lista.
func (c *DataClient) RevokeToken(ctx context.Context, bundleID, tokenID string) (json.RawMessage, error) {
	// Escapar os dois mantém o alvo do DELETE igual ao que a tela mostrou: um identificador com
	// `../` sairia do caminho e mutaria outro recurso.
	path := "/v1/bundles/" + url.PathEscape(bundleID) + "/tokens/" + url.PathEscape(tokenID)
	return c.sendRaw(ctx, http.MethodDelete, path, nil)
}

// Adoption devolve a adoção do bundle na janela (`GET /v1/bundles/:id/adoption?days=N`).
//
// A resposta traz as linhas **e** `total_installs`, o denominador da janela. Somar as linhas
// recebidas só parece equivalente: sob paginação ou top-N a soma é de um recorte, e a proporção
// que a tela desenha sai errada em silêncio — o pior modo de errar num gráfico.
//
// A granularidade das linhas é **skill + versão**, escopada ao bundle — NÃO "por bundle", como
// uma leitura apressada do roadmap sugeria. O que não existe é agregação ENTRE bundles: uma skill
// publicada em três bundles produz três linhas, e "instalações totais da skill X" não é
// computável hoje. Quem rotular a tela precisa dizer isso, sob pena de a interface mentir.
func (c *DataClient) Adoption(ctx context.Context, bundleID string, days int) (json.RawMessage, error) {
	// A janela vai em `url.Values`, não concatenada na string: o encoder escapa, e a rota fica
	// imune a um `days` que um dia deixe de ser inteiro.
	return c.getRaw(ctx, "/v1/bundles/"+url.PathEscape(bundleID)+"/adoption",
		url.Values{"days": []string{strconv.Itoa(days)}})
}
