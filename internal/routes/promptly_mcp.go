// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

// A superficie MCP canonica do theo-promptly (usetheoai/theo-promptly#50).
//
// Vive aqui, e nao inline em cmd/main.go, pelo mesmo motivo do rag_mcp.go: o teste de
// invariante de UM BALDE guarda o mapa de PRODUCAO. Uma tool nova que nasca sem escopo,
// ou que caia em dois baldes, reprova o gate — e nao vira descoberta em runtime.
//
// POR QUE ESTE MAPA TEM DE ESPELHAR O GATE DO PROPRIO MCP, e nao apenas "parecer certo":
// desde o theo-promptly#52 o servidor MCP registra as tools POR ESCOPO — `create_dataset`
// so existe para uma chave com `prompt:write`. Se este mapa discordar daquele registro,
// passamos a ter DUAS protecoes para a mesma regra, e duas protecoes que podem divergir
// sao piores que uma: a que ficar mais frouxa vira o limite real, e ninguem percebe qual
// delas e. O gateway filtra `tools/list` pelo balde; o proprio promptly nem registra a
// tool. Os dois tem de dizer a MESMA coisa.

// PromptlyMCPTools e o conjunto EXAUSTIVO das tools registradas pelo @usetheo/promptly-mcp.
// Tem de ficar em sincronia com theo-promptly packages/mcp/src/create-mcp-server.ts.
//
// Sao SEIS. `run_evaluation` NAO esta aqui e nao e omissao: ela nao e exposta no MCP por
// decisao de seguranca — executar exige a credencial de modelo do usuario, que num
// tool-call entraria no historico de conversa de um agente (persistido, logado, e muitas
// vezes enviado a um terceiro).
//
// `greet` e `nope` tambem NAO estao aqui, e a ausencia merece nota porque um cenario de
// teste ja as procurou como "tools de fixture vazando": sao nomes de PROMPT usados como
// dado dentro de arquivos de teste, nunca foram tools.
var PromptlyMCPTools = []string{
	"compare_evaluation_runs",
	"create_dataset",
	"get_evaluation_run",
	"get_prompt",
	"list_labels",
	"list_revisions",
}

// PromptlyScopeTools mapeia cada escopo de dados do promptly para as tools MCP que ele
// concede. Uma chave `promptly:read` NAO expoe tool de escrita alguma.
//
// UMA UNICA TOOL ESCREVE — `create_dataset`. Isto foi medido no codigo, nao suposto:
// em `create-mcp-server.ts` ela e a unica sob a guarda de `prompt:write`, e o REST cobra
// `prompt:write` na rota equivalente (`POST /evaluations/datasets`) porque criar dataset
// produz estado. `get_evaluation_run` e `compare_evaluation_runs` LEEM uma execucao ja
// gravada — o nome "evaluation" nas tres induz a agrupa-las, e agrupar erraria para o
// lado frouxo, dando escrita a quem so pode ler.
//
// O balde `promptly:delete` fica declarado e VAZIO: o promptly nao tem tool de remocao
// (revisoes sao imutaveis por contrato). Declara-lo torna a ausencia explicita, em vez de
// deixar um leitor supor que o escopo foi esquecido.
var PromptlyScopeTools = map[string][]string{
	"promptly:read": {
		"compare_evaluation_runs",
		"get_evaluation_run",
		"get_prompt",
		"list_labels",
		"list_revisions",
	},
	"promptly:write":  {"create_dataset"},
	"promptly:delete": {},
}
