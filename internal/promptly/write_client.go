// M25 — o caminho de MUTACAO do loopprompt: promover um label para outra revisao.
//
// Vive em arquivo e TIPO proprios, separados do de leitura, e a separacao e o mecanismo de menor
// privilegio — nao organizacao de arquivo. O cliente de leitura recebe uma credencial cunhada
// apenas com `prompt:read` e portanto NAO CONSEGUE promover, mesmo que alguem registre por engano
// uma rota mutante sobre ele. A propriedade vira da CHAVE, e nao de uma checagem que se pode
// esquecer de aplicar numa rota nova.
//
// A assimetria de risco e real: uma leitura disparada com a credencial errada VE dado de outro
// inquilino; uma escrita ESCREVE nele. E esta escrita em particular troca, sem redeploy, o prompt
// que agentes em execucao resolvem — nao derruba nada, muda comportamento em silencio.
package promptly

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

// WriteClient promove labels no loopprompt, por inquilino.
type WriteClient struct {
	baseURL     string
	httpClient  *http.Client
	keyResolver func(ctx context.Context) (string, error)
}

// NewWriteClient constroi o cliente de mutacao.
func NewWriteClient(baseURL string, httpClient *http.Client) *WriteClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &WriteClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

// WithKeyResolver liga o resolver de Bearer por inquilino. Sem ele nao ha escrita — nem tentativa.
func (c *WriteClient) WithKeyResolver(r func(ctx context.Context) (string, error)) *WriteClient {
	c.keyResolver = r
	return c
}

// AssignLabel promove: repontar `label` para a revisao declarada no corpo
// (`PUT /prompts/:name/labels/:label`).
//
// `PUT` porque a operacao e idempotente — promover duas vezes para a mesma versao e o mesmo
// estado. O nome e o label passam por `url.PathEscape`: numa rota de escrita, escapar do segmento
// significa repontar OUTRO ponteiro, com o Bearer do inquilino ja anexado.
func (c *WriteClient) AssignLabel(ctx context.Context, name, label string, body json.RawMessage) (json.RawMessage, error) {
	path := "/prompts/" + url.PathEscape(name) + "/labels/" + url.PathEscape(label)
	return c.sendRaw(ctx, http.MethodPut, path, body)
}

// SetTags substitui o conjunto INTEIRO de tags de um prompt (`PUT /prompts/:name/tags`).
//
// `PUT` porque a operacao e idempotente: marcar duas vezes com o mesmo conjunto e o mesmo estado.
// O corpo atravessa OPACO, como o das outras escritas — as recusas tipadas do servico
// (`400 empty_tag`, `400 too_many_tags`, `404 prompt_not_found`) sao o que a tela transforma em
// diagnostico, e um BFF que validasse antes devolveria a propria recusa em vez do motivo real.
func (c *WriteClient) SetTags(ctx context.Context, name string, body json.RawMessage) (json.RawMessage, error) {
	return c.sendRaw(ctx, http.MethodPut, "/prompts/"+url.PathEscape(name)+"/tags", body)
}

// AddComment comenta UMA revisao (`POST /prompts/:name/revisions/:version/comments`) — M18.
//
// O corpo atravessa OPACO, como o das outras escritas: as recusas tipadas do servico
// (`400 empty_comment`, `400 comment_too_long`, `400 secret_in_comment` com o TIPO de credencial,
// `404 prompt_not_found`) sao o que a tela transforma em diagnostico. Um BFF que validasse antes
// devolveria a propria recusa em vez do motivo real.
func (c *WriteClient) AddComment(ctx context.Context, name string, version int, body json.RawMessage) (json.RawMessage, error) {
	path := "/prompts/" + url.PathEscape(name) + "/revisions/" + strconv.Itoa(version) + "/comments"
	return c.sendRaw(ctx, http.MethodPost, path, body)
}

// ProtectLabel define o papel minimo para mover um label (`PUT /labels/:label/protection`) — M18.
func (c *WriteClient) ProtectLabel(ctx context.Context, label string, body json.RawMessage) (json.RawMessage, error) {
	return c.sendRaw(ctx, http.MethodPut, "/labels/"+url.PathEscape(label)+"/protection", body)
}

// UnprotectLabel remove a protecao — o caminho de emergencia auditado do M18 (ADR-2).
func (c *WriteClient) UnprotectLabel(ctx context.Context, label string) (json.RawMessage, error) {
	return c.sendRaw(ctx, http.MethodDelete, "/labels/"+url.PathEscape(label)+"/protection", nil)
}

// CreateRevision cria uma revisao nova (`POST /prompts`). O corpo vem da tela e segue OPACO ate
// o produto: validar `name`/`content` aqui duplicaria a regra que o servico ja aplica, e as duas
// copias divergiriam no dia em que uma mudasse. O que este cliente garante e a CREDENCIAL certa —
// a chave cunhada por inquilino, com escopo de escrita.
//
// Nao ha `url.PathEscape` porque nao ha segmento variavel: o nome viaja no CORPO, nao no caminho.
func (c *WriteClient) CreateRevision(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return c.sendRaw(ctx, http.MethodPost, "/prompts", body)
}

// Rollback cria uma revisao nova com o conteudo de outra e, se o corpo nomear um label, reponta
// esse label (`POST /prompts/:name/rollback`).
//
// `POST` e nao `PUT` porque a operacao NAO e idempotente: cada chamada cria mais uma revisao. Quem
// ler esta linha esperando o comportamento de AssignLabel precisa ver a diferenca aqui.
func (c *WriteClient) Rollback(ctx context.Context, name string, body json.RawMessage) (json.RawMessage, error) {
	path := "/prompts/" + url.PathEscape(name) + "/rollback"
	return c.sendRaw(ctx, http.MethodPost, path, body)
}

// sendRaw e o irmao mutante de getRaw. Mesma ordem deliberada: resolver ANTES da rede, para que
// "resolver falhou ⇒ zero requisicao" seja verdadeiro por construcao.
func (c *WriteClient) sendRaw(ctx context.Context, method, path string, body json.RawMessage) (json.RawMessage, error) {
	if c.keyResolver == nil {
		return nil, fmt.Errorf("promptly write client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("promptly write client: resolve per-tenant key: %w", err)
	}

	var reader io.Reader
	if len(body) > 0 {
		reader = strings.NewReader(string(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, fmt.Errorf("promptly write client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("promptly write client: %s %s: %w", method, path, err) // nunca o bearer
	}
	defer func() { _ = resp.Body.Close() }()

	out, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("promptly write client: read %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// `409 promotion_blocked` carrega `required` e `actual` — os dois numeros que dizem POR QUE
		// a promocao foi barrada. Sem eles o operador ve "erro" e tenta de novo igual.
		return nil, &UpstreamError{
			Status: resp.StatusCode,
			Body:   json.RawMessage(out),
			Method: method,
			Path:   path,
		}
	}
	return json.RawMessage(out), nil
}
