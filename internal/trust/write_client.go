// M24 — o caminho de MUTACAO do catalogo de guardrails, consumido pelo BFF do dashboard.
//
// Vive em arquivo proprio, separado do de leitura, porque a assimetria de risco e real: uma
// leitura disparada com a credencial errada VE dado de outro tenant; uma escrita ESCREVE nele. O
// contrato fail-closed e o mesmo (`sendRaw` consulta o resolver antes de qualquer coisa de rede),
// mas manter os dois lados em arquivos distintos deixa a fronteira visivel em code review.
package trust

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// CreateValidator cria um validator do tenant (`POST /v1/validators`).
func (c *DataClient) CreateValidator(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return c.sendRaw(ctx, http.MethodPost, "/v1/validators", body)
}

// TestValidator roda o DRY-RUN (`POST /v1/validators:test`).
//
// Sem `content` no corpo, o upstream so faz lint da spec; com `content`, roda o candidato contra o
// texto e devolve o veredito. E o que separa "configurei uma regra" de "derrubei o trafego do
// tenant": um validator mal formado nao e erro de UI, e enforcement inline em producao.
func (c *DataClient) TestValidator(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return c.sendRaw(ctx, http.MethodPost, "/v1/validators:test", body)
}

// DeleteValidator remove um validator do tenant (`DELETE /v1/validators/{id}`).
//
// O id vem da URL do usuario e passa por url.PathEscape: numa rota de DELETE, escapar do segmento
// significa apagar OUTRA coisa — com o Bearer do tenant ja anexado.
func (c *DataClient) DeleteValidator(ctx context.Context, id string) error {
	_, err := c.sendRaw(ctx, http.MethodDelete, "/v1/validators/"+url.PathEscape(id), nil)
	return err
}

// sendRaw e o irmao mutante de getRaw. Mesma ordem deliberada: resolver ANTES da rede, para que
// "resolver falhou => zero requisicao" seja verdadeiro por construcao.
func (c *DataClient) sendRaw(ctx context.Context, method, path string, body json.RawMessage) (json.RawMessage, error) {
	if c.keyResolver == nil {
		return nil, fmt.Errorf("trust data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("trust data client: resolve per-tenant key: %w", err)
	}

	var reader io.Reader
	if len(body) > 0 {
		reader = strings.NewReader(string(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, fmt.Errorf("trust data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("trust data client: %s %s: %w", method, path, err) // nunca o bearer
	}
	defer func() { _ = resp.Body.Close() }()

	out, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("trust data client: read %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// O corpo carrega o codigo TIPADO do theo-trust (INVALID_SPEC, VALIDATOR_NAME_RESERVED,
		// CONFLICT). Ele precisa sobreviver ate a tela: sem o motivo, o operador ve "erro" e nao
		// sabe O QUE corrigir — e tenta de novo igual.
		return nil, fmt.Errorf("trust data client: %s %s: upstream %d: %s",
			method, path, resp.StatusCode, truncate(string(out), 300))
	}
	return json.RawMessage(out), nil
}
