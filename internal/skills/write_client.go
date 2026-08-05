// M26 — o caminho de MUTAÇÃO do registro de skills: promover um canal.
//
// Um método só, e deliberadamente só um. Promover é a operação mais perigosa do produto justamente
// por não parecer destrutiva: ela reaponta um canal e troca, **sem redeploy**, o conteúdo que os
// consumidores daquele canal resolvem. Não derruba nada — muda comportamento em silêncio.
//
// **A separação que carrega a segurança não está aqui, está na CREDENCIAL.** Este método vive no
// mesmo tipo `DataClient`, mas o BFF instancia DOIS clientes: o de leitura recebe uma chave cunhada
// apenas com `skills:read` e, por isso, **não consegue promover mesmo chamando este método** — o
// registro recusa com 403. O menor privilégio vira propriedade da chave, não de uma checagem que
// alguém pode esquecer de aplicar numa rota nova.
//
// `write_client_test.go` prova isso com o PAR que discrimina: a chave só-leitura recebe 403 na
// promoção **e** 200 numa leitura. Sem a segunda metade, um gate que recusasse tudo passaria no
// teste enquanto tivesse quebrado o caminho legítimo — recusa cega é indistinguível de segurança.
package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// PromoteChannel aponta `channel` para `revisionID` (`PUT /v1/skills/:id/channels/:channel`).
//
// Forma MEDIDA em `packages/api/src/server/handlers/publishing.ts`, não inferida do nome do método:
// corpo `{revision_id}`, resposta `{skill_id, channel, revision_id}`.
//
// **Idempotente por desenho do registro** — promover a mesma revisão duas vezes é o caso normal de
// um pipeline que reexecuta, e falhar nele obrigaria todo chamador a consultar antes. O BFF não
// acrescenta uma checagem "já está lá": ela criaria uma corrida entre a consulta e o PUT, e a tela
// passaria a recusar um ato que o serviço aceita.
func (c *DataClient) PromoteChannel(ctx context.Context, skillID, channel, revisionID string) (json.RawMessage, error) {
	body, err := json.Marshal(map[string]string{"revision_id": revisionID})
	if err != nil {
		return nil, fmt.Errorf("skills data client: encode promotion body: %w", err)
	}
	// Escapar os dois é o que mantém o alvo do PUT igual ao que a tela mostrou ao operador: um
	// canal chamado `../../algo` sairia do caminho pretendido e mutaria outro recurso.
	path := "/v1/skills/" + url.PathEscape(skillID) + "/channels/" + url.PathEscape(channel)
	return c.sendRaw(ctx, http.MethodPut, path, body)
}

// sendRaw é o irmão mutante de getRaw.
//
// Mesma ordem deliberada: resolver a credencial ANTES da rede, para que "resolver falhou ⇒ zero
// requisição" seja verdadeiro por construção. Numa mutação isso pesa mais que na leitura — uma
// promoção emitida sem credencial de inquilino é uma escrita potencialmente no acervo errado.
func (c *DataClient) sendRaw(ctx context.Context, method, path string, body json.RawMessage) (json.RawMessage, error) {
	if c.keyResolver == nil {
		return nil, fmt.Errorf("skills data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("skills data client: resolve per-tenant key: %w", err)
	}

	var reader io.Reader
	if len(body) > 0 {
		reader = strings.NewReader(string(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, fmt.Errorf("skills data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("skills data client: %s %s: %w", method, path, err) // nunca o bearer
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("skills data client: read %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Tipado, pela mesma razão do caminho de leitura: a recusa por escopo insuficiente (`403`)
		// precisa chegar distinguível de uma indisponibilidade, senão a tela diz "tente de novo"
		// sobre algo que nunca vai funcionar com aquela credencial.
		return nil, &UpstreamError{
			Status: resp.StatusCode,
			Body:   json.RawMessage(raw),
			Method: method,
			Path:   path,
		}
	}
	return json.RawMessage(raw), nil
}

// SetLifecycle muda o estágio de ciclo de vida de uma skill (`PUT /v1/skills/:id/lifecycle`).
//
// Vive no mesmo cliente da promoção porque exige a MESMA credencial: o registro passou a gatear
// esta rota por `skills:publish` (ADR `0003-lifecycle-gate-por-escopo` do theo-skills), pelo mesmo
// eixo da promoção — depreciar é curadoria do acervo, não administração do workspace.
//
// **Depreciar NÃO tira a skill de quem já a referencia**: ela continua resolvível, e o que muda é
// a descoberta. É por isso que este ato é menos perigoso que promover um canal, que troca o que os
// consumidores carregam sem redeploy.
//
// Forma MEDIDA em `packages/api/src/server/handlers/lifecycle.ts`, não inferida dos nomes: o campo
// do motivo é `reason` (não `deprecation_reason`, que é como ele aparece na LEITURA), e
// `superseded_by` é opcional.
func (c *DataClient) SetLifecycle(ctx context.Context, skillID, lifecycle, reason, supersededBy string) (json.RawMessage, error) {
	payload := map[string]string{"lifecycle": lifecycle}
	// Vazios são OMITIDOS, não enviados em branco: `superseded_by: ""` gravaria uma sucessora
	// vazia em vez de nenhuma, e a tela exibiria um link para lugar nenhum.
	if reason != "" {
		payload["reason"] = reason
	}
	if supersededBy != "" {
		payload["superseded_by"] = supersededBy
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("skills data client: encode lifecycle body: %w", err)
	}
	return c.sendRaw(ctx, http.MethodPut, "/v1/skills/"+url.PathEscape(skillID)+"/lifecycle", body)
}

// DeleteSkill apaga uma skill (`DELETE /v1/skills/:id`).
//
// A auditoria de 2026-08-03 mediu o absurdo que isto fecha: o acervo tem uma skill que **se
// descreve** como "pode ser removida" e não havia como removê-la pela tela, embora a rota exista
// há milestones.
//
// **Exige `skills:write`, e por isso viaja pelo cliente de AUTORIA**, não pelo de curadoria. Os
// dois danos são diferentes: promover reaponta consumidores, apagar destrói. Uma chave que faz as
// duas coisas transforma qualquer vazamento no pior caso possível.
//
// O registro faz SOFT-DELETE e **reserva o identificador** — quem já referencia a skill pelo id
// não consegue recriá-la com o mesmo nome. É por isso que descontinuar existe (M32): é o ato
// reversível para "não use mais esta", e a tela precisa oferecer os dois com a diferença clara.
//
// A resposta é `204 SEM CORPO`. Devolver `json.RawMessage` vazio é correto aqui — exigir JSON
// quebraria no sucesso, que é o pior lugar para quebrar: o efeito já aconteceu e a tela diria
// que falhou.
func (c *DataClient) DeleteSkill(ctx context.Context, skillID string) (json.RawMessage, error) {
	return c.sendRaw(ctx, http.MethodDelete, "/v1/skills/"+url.PathEscape(skillID), nil)
}

// CreateSkill publica uma skill (`POST /v1/skills`), assíncrono — responde **202** com o
// identificador da operação.
//
// Assíncrono por desenho do registro: a ingestão gera embeddings, e fazer o autor esperar por
// isso numa requisição HTTP amarraria a tela ao tempo de um provedor externo. Quem chama precisa
// **acompanhar a operação**, não fingir que terminou.
//
// Exige `skills:write` — viaja pelo cliente de AUTORIA, ao lado de apagar.
func (c *DataClient) CreateSkill(ctx context.Context, skillID, skillMd string) (json.RawMessage, error) {
	body, err := json.Marshal(map[string]string{"skill_id": skillID, "skillMd": skillMd})
	if err != nil {
		return nil, fmt.Errorf("skills data client: encode create body: %w", err)
	}
	return c.sendRaw(ctx, http.MethodPost, "/v1/skills", body)
}

// CreateSkillFromZip publica uma skill que é uma ÁRVORE de arquivos, não um único markdown.
//
// Uma skill com script (Python, Bash, um `assets/`) não cabe em `skillMd`. O registro sempre
// aceitou isso — `POST /v1/skills` recebe `zippedFilesystem`, um zip em base64, e a CLI publica
// por esse caminho desde o M12. O que faltava era a TELA: o BFF só sabia mandar `skillMd`, então
// publicar uma skill com script exigia terminal. A assimetria era da superfície, não do contrato.
//
// `skillMd` NÃO acompanha o zip. O registro o prioriza quando presente, e mandar os dois faria o
// zip ser descartado **em silêncio** — a skill entraria no acervo sem os scripts, com 202 e sem
// erro algum. É exatamente a classe de falha que este ciclo vem perseguindo: um verde afirmando
// um sucesso que não existe.
func (c *DataClient) CreateSkillFromZip(ctx context.Context, skillID, zipBase64 string) (json.RawMessage, error) {
	body, err := json.Marshal(map[string]string{"skill_id": skillID, "zippedFilesystem": zipBase64})
	if err != nil {
		return nil, fmt.Errorf("skills data client: encode create-from-zip body: %w", err)
	}
	return c.sendRaw(ctx, http.MethodPost, "/v1/skills", body)
}

// Operation lê o estado de uma operação de ingestão (`GET /v1/operations/:id`).
//
// É o que permite a tela **acompanhar** a publicação em vez de anunciar sucesso no 202 — que
// significa "aceito", não "pronto". Anunciar no aceite faria o autor procurar a skill num acervo
// onde ela ainda não está.
func (c *DataClient) Operation(ctx context.Context, operationID string) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/operations/"+url.PathEscape(operationID), nil)
}
