// M25 — DataClient e o proxy de LEITURA por inquilino para a API do theo-promptly, consumido pelo
// BFF do dashboard (`/v1/dashboard/promptly/*`).
//
// Model B, como `internal/trust`, `internal/thelens` e `internal/skills`: o cliente NAO guarda
// credencial alguma. Um `keyResolver` injetado cunha o Bearer do inquilino a cada requisicao, a
// partir do JWT em contexto. Isso e SEGURANCA ESTRUTURAL, nao disciplina: como a chave vem do
// contexto e nao de um parametro, nao existe assinatura por onde a tela peca dados de outro
// inquilino. Resolver ausente ou em erro FALHA FECHADO — nenhuma requisicao sai, e nao ha fallback
// para chave-mestra.
//
// O corpo do upstream atravessa como `json.RawMessage`, sem re-modelagem: re-tipar aqui criaria um
// segundo schema para manter em sincronia com o servico, e toda divergencia entre os dois viraria
// bug silencioso de renderizacao.
//
// DIVERGENCIA DELIBERADA da referencia — ver o docstring de `UpstreamError`. O `getRaw` do
// `internal/trust` colapsa o erro do upstream em `fmt.Errorf` (`theo-cloud#358`); aqui o 4xx/5xx
// constroi o tipo, porque a tela precisa DECIDIR sobre o codigo.
package promptly

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// maxBodyBytes limita o que o BFF le do upstream. Sem teto, uma resposta anomala vira pressao de
// memoria no plano de controle — que serve TODOS os inquilinos, nao so este.
const maxBodyBytes = 8 << 20 // 8 MiB

// DataClient e o proxy de leitura por inquilino para o theo-promptly.
type DataClient struct {
	baseURL     string
	httpClient  *http.Client
	keyResolver func(ctx context.Context) (string, error)
}

// NewDataClient constroi o cliente. baseURL e a raiz REST do theo-promptly. httpClient nil usa
// http.DefaultClient.
func NewDataClient(baseURL string, httpClient *http.Client) *DataClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &DataClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

// WithKeyResolver liga o resolver de Bearer por inquilino (Model B). Sem ele o cliente nao
// autentica — e, por contrato, tambem nao tenta.
func (c *DataClient) WithKeyResolver(r func(ctx context.Context) (string, error)) *DataClient {
	c.keyResolver = r
	return c
}

// relNextRE casa o marcador de continuacao da RFC 5988 em suas tres grafias validas.
//
// A RFC permite o valor com aspas duplas, simples ou SEM aspas. Nos emitimos com duplas
// (`app.ts:594`), mas um proxy que normalize o header pode reescreve-lo — e uma leitura literal de
// `rel="next"` devolveria "sem continuacao" sobre um catalogo truncado, produzindo um TOTAL FALSO
// no painel. O `\b` final impede que `rel=nextpage` case.
var linkNextRE = regexp.MustCompile(`(?i)<([^>]*)>\s*;[^,]*\brel\s*=\s*(?:"next"|'next'|next\b)`)

// proximaPaginaQuery le o sinal de continuacao do header RFC-5988 e devolve a QUERY da proxima
// pagina ("" quando nao ha).
//
// Devolve a query, e nao um booleano, porque o BFF precisa PUBLICAR um Link utilizavel e o cursor
// e uma decisao do servico (keyset por nome). Re-deriva-lo do corpo duplicaria essa regra de
// negocio no plano de controle, e a copia erraria em silencio no dia em que o servico mudasse a
// ordenacao. O booleano continua disponivel — e `query != ""`.
//
// POR QUE NAO `len(linhas) == limit`: o servico devolve no maximo `limit` linhas (ele pede limit+1
// internamente e corta), entao um catalogo de EXATAMENTE `limit` prompts satisfaz a heuristica sem
// ter proxima pagina. Marcar esse caso de parcial ensina o operador a desconfiar de um numero
// correto — pior do que nao marcar. A decisao vem do servico, nunca do tamanho da pagina.
//
// POR QUE NAO uma lib de parse RFC-5988: nos somos quem emite o header e o formato e unico
// (Regra 9 / parsimony ladder rung 5 — a lib resolveria um caso que nao temos). Se algum dia
// consumirmos `Link` de terceiro, a lib entra.
func proximaPaginaQuery(h http.Header) string {
	for _, v := range h.Values("Link") {
		m := linkNextRE.FindStringSubmatch(v)
		if m == nil {
			continue
		}
		// O alvo do Link e sempre um caminho DESTE servico; interessa so a query, porque o
		// caminho publicado ao navegador e o do BFF, nao o do servico (EC-1).
		if i := strings.IndexByte(m[1], '?'); i >= 0 {
			return m[1][i+1:]
		}
		return "" // ha continuacao mas sem cursor: nao ha proxima pagina enderecavel
	}
	return ""
}

// Catalog devolve a pagina do catalogo do inquilino (`GET /prompts`) — uma linha por nome, sem o
// conteudo dos prompts — e a QUERY da proxima pagina ("" quando a pagina e a ultima).
//
// O segundo retorno existe porque, sem ele, toda contagem derivada desta pagina seria um limite
// inferior apresentado como total. O sinal chegava ao BFF e morria aqui (M13).
func (c *DataClient) Catalog(ctx context.Context, limit int, after string) (json.RawMessage, string, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if after != "" {
		q.Set("after", after)
	}
	body, hdr, err := c.getRaw(ctx, "/prompts", q)
	if err != nil {
		return nil, "", err
	}
	return body, proximaPaginaQuery(hdr), nil
}

// Prompt resolve um prompt pelo nome (`GET /prompts/:name`) — a ultima revisao.
func (c *DataClient) Prompt(ctx context.Context, name string) (json.RawMessage, error) {
	body, _, err := c.getRaw(ctx, "/prompts/"+url.PathEscape(name), nil)
	return body, err
}

// Revisions lista as revisoes de um prompt (`GET /prompts/:name/revisions`).
//
// O `limit` e ARGUMENTO OBRIGATORIO do chamador, nao um opcional com default do servico: cada item
// desta lista carrega o `content` integral da revisao (medido), e o teto do servico e 100. Deixar
// o default valer significa baixar ate 100 corpos de prompt para desenhar uma lista de versoes.
func (c *DataClient) Revisions(ctx context.Context, name string, limit, after int) (json.RawMessage, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if after > 0 {
		q.Set("after", strconv.Itoa(after))
	}
	body, _, err := c.getRaw(ctx, "/prompts/"+url.PathEscape(name)+"/revisions", q)
	return body, err
}

// Labels lista os labels de ambiente e a revisao que cada um serve (`GET /prompts/:name/labels`).
//
// E o dado que a confirmacao da promocao consome: para dizer "prod deixa de servir a v4" e preciso
// saber que hoje `prod` aponta para 4 — e este e o unico lugar que responde isso.
func (c *DataClient) Labels(ctx context.Context, name string) (json.RawMessage, error) {
	body, _, err := c.getRaw(ctx, "/prompts/"+url.PathEscape(name)+"/labels", nil)
	return body, err
}

// Policy le a politica que GOVERNA a promocao de um label (`GET /prompts/:name/policies/:label`).
//
// Existe para que a tela mostre a regra ANTES do ato. Sem ela, o operador so descobre a regra
// pela recusa — e `404 policy_not_found` (promocao livre) chega como erro tipado, distinto de
// "nao consegui ler", que renderiza diferente.
func (c *DataClient) Policy(ctx context.Context, name, label string) (json.RawMessage, error) {
	body, _, err := c.getRaw(ctx, "/prompts/"+url.PathEscape(name)+"/policies/"+url.PathEscape(label), nil)
	return body, err
}

// getRaw devolve corpo E headers. Os headers viajam porque a resposta do upstream carrega
// informacao de produto neles (o `Link` de continuacao); descarta-los aqui foi o que fez o sinal
// morrer antes de qualquer decisao. Chamadores que nao precisam deles usam `_`.
func (c *DataClient) getRaw(ctx context.Context, path string, q url.Values) (json.RawMessage, http.Header, error) {
	// Fail-closed ANTES de qualquer I/O: a requisicao sem credencial de inquilino nao chega a
	// existir. Devolver o 401 do upstream mandaria o operador investigar autenticacao quando o
	// defeito e de fiacao.
	if c.keyResolver == nil {
		return nil, nil, fmt.Errorf("promptly data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("promptly data client: resolve per-tenant key: %w", err)
	}

	u := c.baseURL + path
	if enc := q.Encode(); enc != "" {
		u += "?" + enc
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("promptly data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// O bearer nunca entra em mensagem nenhuma desta funcao; o caminho sim, e e util.
		return nil, nil, fmt.Errorf("promptly data client: GET %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, nil, fmt.Errorf("promptly data client: read %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, &UpstreamError{
			Status: resp.StatusCode,
			Body:   json.RawMessage(body),
			Method: http.MethodGet,
			Path:   path,
		}
	}
	return json.RawMessage(body), resp.Header, nil
}
