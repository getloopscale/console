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
	"bytes"
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
	baseURL string
	// httpClient serve as LEITURAS — catalogo, revisoes, labels, politica. Orcamento curto: um
	// GET que demora dez segundos ja e um defeito.
	httpClient *http.Client
	// invocationClient serve o playground, e existe porque os dois casos tem orcamentos
	// incomparaveis: uma leitura lenta e patologia, uma geracao de LLM que leva vinte segundos e
	// rotina. Compartilhar o cliente das leituras fazia o BFF DESISTIR antes de a recusa tipada
	// existir — e o operador via "nao foi possivel falar com o servico" para uma chave invalida,
	// com a quota dele ja consumida. `http.Client.Timeout` e teto absoluto: um `context` mais
	// generoso nao o afrouxa, so um cliente proprio resolve.
	//
	// Nil = usa `httpClient`, preservando o comportamento de quem nao opta.
	invocationClient *http.Client
	keyResolver      func(ctx context.Context) (string, error)
}

// NewDataClient constroi o cliente. baseURL e a raiz REST do theo-promptly. httpClient nil usa
// http.DefaultClient.
func NewDataClient(baseURL string, httpClient *http.Client) *DataClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &DataClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

// WithInvocationClient liga o cliente HTTP das INVOCACOES (playground), separado do das leituras.
//
// Ver o comentario de `DataClient.invocationClient` para a razao: os dois orcamentos de tempo nao
// sao comparaveis, e o teto do `http.Client` nao pode ser afrouxado por `context`.
func (c *DataClient) WithInvocationClient(h *http.Client) *DataClient {
	c.invocationClient = h
	return c
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

// proximaPaginaQuery le o sinal de continuacao do header RFC-5988.
//
// Devolve DOIS valores porque sao DUAS perguntas, e colapsa-las numa string vazia foi um defeito
// real: "ha proxima pagina" e "sei o endereco dela" nao sao a mesma coisa. Um
// `Link: </prompts>; rel="next"` — o servico AFIRMANDO que ha mais, sem cursor — devolvia "" e o
// painel exibia os numeros como TOTAIS sobre uma pagina que o servico declarou truncada. Era o
// falso total que este milestone existe para impedir, produzido pelo caminho que deveria impedi-lo.
//
// A query vem do servico, e nao e re-derivada do corpo: o cursor e decisao dele (keyset por nome),
// e a copia erraria em silencio no dia em que a ordenacao mudasse.
//
// POR QUE NAO `len(linhas) == limit`: o servico devolve no maximo `limit` linhas (ele pede limit+1
// internamente e corta), entao um catalogo de EXATAMENTE `limit` prompts satisfaz a heuristica sem
// ter proxima pagina. Marcar esse caso de parcial ensina o operador a desconfiar de um numero
// correto — pior do que nao marcar. A decisao vem do servico, nunca do tamanho da pagina.
//
// POR QUE NAO uma lib de parse RFC-5988: nos somos quem emite o header e o formato e unico
// (Regra 9 / parsimony ladder rung 5 — a lib resolveria um caso que nao temos). Se algum dia
// consumirmos `Link` de terceiro, a lib entra.
func proximaPaginaQuery(h http.Header) (temMais bool, query string) {
	for _, v := range h.Values("Link") {
		m := linkNextRE.FindStringSubmatch(v)
		if m == nil {
			continue
		}
		// O alvo do Link e sempre um caminho DESTE servico; interessa so a query, porque o
		// caminho publicado ao navegador e o do BFF, nao o do servico (EC-1).
		if i := strings.IndexByte(m[1], '?'); i >= 0 {
			return true, m[1][i+1:]
		}
		return true, "" // ha continuacao, e ela nao e enderecavel — mas HA.
	}
	return false, ""
}

// Continuacao responde as duas perguntas que a pagina levanta, separadamente.
//
// `TemMais` sem `Query` e um estado real: o servico afirma que ha mais e nao diz para onde ir. A
// tela precisa marcar parcialidade mesmo assim — tratar isso como "ultima pagina" produziria o
// total falso que este milestone elimina.
type Continuacao struct {
	TemMais bool
	Query   string
}

// Catalog devolve a pagina do catalogo do inquilino (`GET /prompts`) — uma linha por nome, sem o
// conteudo dos prompts — e se ha proxima pagina.
//
// O segundo retorno existe porque, sem ele, toda contagem derivada desta pagina seria um limite
// inferior apresentado como total. O sinal chegava ao BFF e morria aqui (M13).
// CatalogoFiltro estreita o catalogo NO SERVICO (M16).
//
// Existe porque ate o M13 o filtro rodava na tela, sobre a pagina ja carregada — e a propria tela
// dizia isso. Com 14 prompts funciona; com 500 mente por omissao: o operador digita um termo, nao
// ve linha alguma, e conclui ausencia a partir de um filtro que nunca perguntou ao servidor.
//
// Struct em vez de tres parametros soltos: `Catalog(ctx, limit, after, search, tag, folder)` e uma
// assinatura em que trocar dois argumentos de lugar compila e mente. O campo nomeado nao.
type CatalogoFiltro struct {
	Search string // substring do nome
	Tag    string // exatamente esta tag
	Folder string // pasta, como segmento inteiro
}

func (c *DataClient) Catalog(ctx context.Context, limit int, after string, filtro CatalogoFiltro) (json.RawMessage, Continuacao, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if after != "" {
		q.Set("after", after)
	}
	// Vazio NAO vira parametro: mandar `search=` obrigaria o servico a saber que vazio e ausente
	// significam o mesmo, espalhando a regra por duas camadas em vez de mante-la numa.
	for chave, valor := range map[string]string{"search": filtro.Search, "tag": filtro.Tag, "folder": filtro.Folder} {
		if valor != "" {
			q.Set(chave, valor)
		}
	}
	body, hdr, err := c.getRaw(ctx, "/prompts", q)
	if err != nil {
		return nil, Continuacao{}, err
	}
	temMais, query := proximaPaginaQuery(hdr)
	return body, Continuacao{TemMais: temMais, Query: query}, nil
}

// Comments le a discussao de UMA revisao (`GET /prompts/:name/revisions/:version/comments`) — M18.
//
// Quem promove precisa ver a discussao ANTES de confirmar: discussao que nao e lida na hora da
// decisao nao muda decisao nenhuma.
func (c *DataClient) Comments(ctx context.Context, name string, version int) (json.RawMessage, error) {
	path := "/prompts/" + url.PathEscape(name) + "/revisions/" + strconv.Itoa(version) + "/comments"
	body, _, err := c.getRaw(ctx, path, nil)
	return body, err
}

// LabelProtection le o papel exigido por um label; `404` quando ele nao e protegido — M18.
func (c *DataClient) LabelProtection(ctx context.Context, label string) (json.RawMessage, error) {
	body, _, err := c.getRaw(ctx, "/labels/"+url.PathEscape(label)+"/protection", nil)
	return body, err
}

// Playground roda o prompt UMA vez contra o modelo (`POST /prompts/:name/playground`).
//
// Vive no cliente de LEITURA, e nao no de escrita, porque a rota nao muta nada do NOSSO estado: ela
// renderiza o texto que veio no corpo e invoca o modelo. O que gasta dinheiro e a credencial do
// MODELO, que o operador poe no corpo — nao a chave de inquilino desta chamada. Escalar o escopo
// para `write` nao protegeria gasto algum e daria a um leitor a capacidade de escrever.
//
// O corpo atravessa OPACO: a recusa tipada do servico (`400 missing_variable`, `422 model_refused`
// com o status do provider) e o que a tela transforma em diagnostico. Um BFF que validasse antes
// devolveria a propria recusa, sem o motivo do provider.
func (c *DataClient) Playground(ctx context.Context, name string, body json.RawMessage) (json.RawMessage, error) {
	return c.postRaw(ctx, "/prompts/"+url.PathEscape(name)+"/playground", body)
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
// postRaw envia um corpo e devolve o do servico, com as mesmas guardas de getRaw.
//
// Duplica a forma de `WriteClient.sendRaw` de proposito, por ora: sao duas implementacoes de "POST
// com Bearer e UpstreamError", o que a regra de 3 tolera. Na terceira, extrair — antes disso, a
// abstracao custaria mais leitura do que economiza.
func (c *DataClient) postRaw(ctx context.Context, path string, corpo json.RawMessage) (json.RawMessage, error) {
	// Fail-closed ANTES de qualquer I/O — mesma razao de getRaw: sem chave de inquilino a
	// requisicao nao chega a existir, e o operador nao investiga autenticacao por um defeito de
	// fiacao.
	if c.keyResolver == nil {
		return nil, fmt.Errorf("promptly data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("promptly data client: resolve per-tenant key: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(corpo))
	if err != nil {
		return nil, fmt.Errorf("promptly data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	cliente := c.invocationClient
	if cliente == nil {
		cliente = c.httpClient
	}
	resp, err := cliente.Do(req)
	if err != nil {
		// Nem o bearer nem o CORPO entram na mensagem: o corpo carrega a credencial do modelo que
		// o operador digitou. O caminho entra, e e util.
		return nil, fmt.Errorf("promptly data client: POST %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("promptly data client: read %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &UpstreamError{
			Status: resp.StatusCode,
			Body:   json.RawMessage(body),
			Method: http.MethodPost,
			Path:   path,
		}
	}
	return json.RawMessage(body), nil
}

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
