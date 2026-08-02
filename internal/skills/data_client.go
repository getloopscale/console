// M29 — DataClient e o proxy de LEITURA por tenant para a API do theo-skills, consumido pelo BFF
// do dashboard (`/v1/dashboard/skills/*`).
//
// Model B, como `internal/trust` e `internal/thelens`: o cliente NAO guarda credencial alguma. Um
// `keyResolver` injetado cunha o Bearer do tenant a cada requisicao, a partir do JWT em contexto.
// Isso e SEGURANCA ESTRUTURAL, nao disciplina: como a chave vem do contexto e nao de um parametro,
// nao existe assinatura por onde a tela peca dados de outro inquilino. Resolver ausente ou em erro
// FALHA FECHADO — nenhuma requisicao sai, e nao ha fallback para chave-mestra.
//
// O corpo do upstream atravessa como `json.RawMessage`, sem re-modelagem: re-tipar aqui criaria um
// segundo schema para manter em sincronia com o registro, e toda divergencia entre os dois viraria
// bug silencioso de renderizacao.
//
// DIVERGENCIA DELIBERADA da referencia: `internal/trust/data_client.go:144-149` colapsa o erro do
// upstream em `fmt.Errorf("...%d: %s", status, corpo)` — e o proprio comentario de la reconhece que
// o corpo "carrega o codigo tipado, que e diagnostico util" antes de o transformar em texto. O tipo
// `UpstreamError` foi criado no M24 justamente para impedir isso e o `getRaw` ficou para tras.
// Copiar aquele getRaw portaria o defeito junto com o padrao, entao aqui o 4xx/5xx constroi o tipo.
package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// maxBodyBytes limita o que o BFF le do upstream. Sem teto, uma resposta anomala do registro vira
// pressao de memoria no plano de controle — que serve TODOS os inquilinos, nao so este.
const maxBodyBytes = 8 << 20 // 8 MiB

// DataClient e o proxy de leitura por tenant para o theo-skills.
type DataClient struct {
	baseURL     string
	httpClient  *http.Client
	keyResolver func(ctx context.Context) (string, error)
}

// NewDataClient constroi o cliente. baseURL e a raiz REST do theo-skills. httpClient nil usa
// http.DefaultClient.
func NewDataClient(baseURL string, httpClient *http.Client) *DataClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &DataClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

// WithKeyResolver liga o resolver de Bearer por tenant (Model B). Sem ele o cliente nao autentica
// — e, por contrato, tambem nao tenta.
func (c *DataClient) WithKeyResolver(r func(ctx context.Context) (string, error)) *DataClient {
	c.keyResolver = r
	return c
}

// List devolve a pagina do acervo do inquilino (`GET /v1/skills`).
func (c *DataClient) List(ctx context.Context, limit int, cursor string) (json.RawMessage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("page_token", cursor)
	}
	return c.getRaw(ctx, "/v1/skills", q)
}

// Get devolve uma skill (`GET /v1/skills/:id`).
func (c *DataClient) Get(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/skills/"+url.PathEscape(id), nil)
}

// Versions lista as versoes publicadas (`GET /v1/skills/:id/versions`).
func (c *DataClient) Versions(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/skills/"+url.PathEscape(id)+"/versions", nil)
}

// Channels lista os canais e a revisao vigente de cada um (`GET /v1/skills/:id/channels`).
func (c *DataClient) Channels(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/skills/"+url.PathEscape(id)+"/channels", nil)
}

// Instructions devolve a instrucao resolvida (`GET /v1/skills/:id/instructions`) — o fim da
// jornada de leitura: o texto que um agente de fato carregaria.
func (c *DataClient) Instructions(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/skills/"+url.PathEscape(id)+"/instructions", nil)
}

func (c *DataClient) getRaw(ctx context.Context, path string, q url.Values) (json.RawMessage, error) {
	// Fail-closed ANTES de qualquer I/O: a requisicao sem credencial de inquilino nao chega a
	// existir. Devolver o 401 do upstream mandaria o operador investigar autenticacao quando o
	// defeito e de fiacao.
	if c.keyResolver == nil {
		return nil, fmt.Errorf("skills data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("skills data client: resolve per-tenant key: %w", err)
	}

	u := c.baseURL + path
	if enc := q.Encode(); enc != "" {
		u += "?" + enc
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("skills data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// O bearer nunca entra em mensagem nenhuma desta funcao; o path sim, e e util.
		return nil, fmt.Errorf("skills data client: GET %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("skills data client: read %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Aqui esta a divergencia da referencia: o erro sai TIPADO. A recusa do registro
		// (`INVALID_FRONTMATTER`, `CONFLICT`, `NOT_FOUND`) diz o que o operador tem de corrigir,
		// e a tela precisa DECIDIR sobre o codigo — o que uma string nao permite.
		return nil, &UpstreamError{
			Status: resp.StatusCode,
			Body:   json.RawMessage(body),
			Method: http.MethodGet,
			Path:   path,
		}
	}
	return json.RawMessage(body), nil
}
