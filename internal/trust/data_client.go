// M23 — DataClient e o proxy de LEITURA por tenant para a API do theo-trust, consumido pelo BFF
// do dashboard (`/v1/dashboard/trust/*`).
//
// Model B, igual ao `internal/thelens/data_client.go`: o cliente NAO guarda credencial alguma. Um
// `keyResolver` injetado cunha o Bearer do tenant a cada requisicao, a partir do JWT em contexto.
// Resolver ausente ou com erro FALHA FECHADO — nenhuma requisicao sai, e nao existe fallback para
// chave-mestra. Esse e o ponto: uma requisicao feita com a credencial errada e como comeca um
// vazamento entre tenants, e um 401 do upstream mandaria o operador investigar autenticacao quando
// o defeito e de fiacao.
//
// O corpo do upstream atravessa como `json.RawMessage`, sem re-modelagem. O BFF e proxy, nao
// tradutor: re-tipar aqui criaria um segundo schema para manter em sincronia com o theo-trust, e
// toda divergencia entre os dois viraria bug silencioso de renderizacao.
package trust

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

// maxBodyBytes limita o que o BFF le do upstream. Sem teto, uma resposta anomala do theo-trust
// vira pressao de memoria no plano de controle — que serve todos os tenants, nao so este.
const maxBodyBytes = 8 << 20 // 8 MiB

// DataClient e o proxy de leitura por tenant para o theo-trust.
type DataClient struct {
	baseURL     string
	httpClient  *http.Client
	keyResolver func(ctx context.Context) (string, error)
}

// NewDataClient constroi o cliente. baseURL e a raiz REST do theo-trust (ex.:
// http://host.docker.internal:18085). httpClient nil usa http.DefaultClient.
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

// Trends devolve as series temporais do plano de observacao (`GET /v1/trends`).
func (c *DataClient) Trends(ctx context.Context, timeRange string) (json.RawMessage, error) {
	q := url.Values{}
	if timeRange != "" {
		q.Set("range", timeRange)
	}
	return c.getRaw(ctx, "/v1/trends", q)
}

// PolicyViolations devolve as violacoes de politica registradas (`GET /v1/policy-violations`).
// limit <= 0 deixa o default do upstream decidir — o BFF nao inventa paginacao propria.
func (c *DataClient) PolicyViolations(ctx context.Context, limit int) (json.RawMessage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	return c.getRaw(ctx, "/v1/policy-violations", q)
}

// Conversation devolve uma conversa por id (`GET /v1/conversations/{id}`).
//
// O id vem da URL do usuario, entao passa por url.PathEscape: sem isso um id como
// `../policy-violations` sairia do segmento e alcancaria outra rota do upstream com o Bearer do
// tenant ja anexado.
func (c *DataClient) Conversation(ctx context.Context, id string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/conversations/"+url.PathEscape(id), nil)
}

// Validators devolve o catalogo mesclado plataforma+tenant (`GET /v1/validators`).
//
// M23 o consome em LEITURA para responder a pergunta que a tela existe para responder: quais
// politicas o sistema OBSERVA sem BLOQUEAR. Sem isso a tela conta violacoes e nao diz o que fazer
// com elas — um alarme sem interruptor. A gestao (criar/remover) segue em M24, com escopo proprio.
func (c *DataClient) Validators(ctx context.Context) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/validators", nil)
}

// EnforcementEvents devolve o log de auditoria do enforcement inline (`GET /v1/enforcement-events`).
//
// O corpo e repassado como veio. O upstream ja garante a redacao na origem — conteudo bruto nunca
// chega aquela tabela — entao redigir de novo aqui criaria uma SEGUNDA fonte de verdade sobre o que
// e seguro exibir, e duas fontes divergem em silencio.
//
// limit <= 0 deixa o default do upstream decidir, como em PolicyViolations: o BFF nao inventa
// paginacao propria.
func (c *DataClient) EnforcementEvents(ctx context.Context, limit int) (json.RawMessage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	return c.getRaw(ctx, "/v1/enforcement-events", q)
}

// getRaw executa a requisicao autenticada por tenant e devolve o corpo do upstream.
//
// Ordem deliberada: o resolver e consultado ANTES de qualquer coisa de rede. E o que torna
// "resolver falhou => zero requisicao upstream" verdadeiro por construcao, e nao por sorte de
// ordenacao.
func (c *DataClient) getRaw(ctx context.Context, path string, q url.Values) (json.RawMessage, error) {
	if c.keyResolver == nil {
		return nil, fmt.Errorf("trust data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("trust data client: resolve per-tenant key: %w", err)
	}

	u := c.baseURL + path
	if enc := q.Encode(); enc != "" {
		u += "?" + enc
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("trust data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// %w sobre o erro de transporte NAO carrega o header — mas o path sim, e ele e util.
		// O bearer nunca entra em nenhuma mensagem desta funcao.
		return nil, fmt.Errorf("trust data client: GET %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("trust data client: read %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// O corpo do upstream entra truncado: ele carrega o codigo tipado do theo-trust
		// (`POLICY_BLOCKED`, `INVALID_SPEC`), que e diagnostico util — mas nao ha razao para
		// ecoar um corpo grande de erro no log do plano de controle.
		return nil, fmt.Errorf("trust data client: GET %s: upstream %d: %s",
			path, resp.StatusCode, truncate(string(body), 300))
	}
	return json.RawMessage(body), nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
