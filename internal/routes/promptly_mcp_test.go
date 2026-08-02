// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import "testing"

// Espelha TestRagScopeTools_EveryToolInExactlyOneBucket: toda tool do
// @usetheo/promptly-mcp em EXATAMENTE um balde — nenhuma sem escopo, nenhuma em dois.
// Guarda o mapa de PRODUCAO contra tool-drift: uma tool nova no theo-promptly que
// chegue aqui sem balde reprova o gate, em vez de aparecer no ar sem autorizacao
// declarada.
func TestPromptlyScopeTools_EveryToolInExactlyOneBucket(t *testing.T) {
	seen := map[string]int{}
	for scope, tools := range PromptlyScopeTools {
		for _, tool := range tools {
			seen[tool]++
			if seen[tool] > 1 {
				t.Errorf("tool %q esta em mais de um balde (double-mapped) — escopo %q", tool, scope)
			}
		}
	}
	for _, tool := range PromptlyMCPTools {
		if seen[tool] == 0 {
			t.Errorf("tool %q nao esta mapeada a escopo algum (tool drift — acrescente a PromptlyScopeTools)", tool)
		}
	}
	canonical := map[string]bool{}
	for _, tool := range PromptlyMCPTools {
		canonical[tool] = true
	}
	for tool := range seen {
		if !canonical[tool] {
			t.Errorf("PromptlyScopeTools mapeia %q, que nao e tool conhecida do @usetheo/promptly-mcp (PromptlyMCPTools)", tool)
		}
	}
	if len(seen) != len(PromptlyMCPTools) {
		t.Errorf("tools mapeadas %d != tools canonicas %d", len(seen), len(PromptlyMCPTools))
	}
}

// O invariante que o rag nao precisava declarar e o promptly precisa: `create_dataset` e
// a UNICA tool de escrita, e ela NAO pode estar no balde de leitura.
//
// Este teste existe porque o erro natural aqui e agrupar as tres tools cujo nome contem
// "evaluation" — e esse agrupamento erra para o lado FROUXO, concedendo escrita a uma
// chave de leitura. Foi exatamente a classe do theo-promptly#52, onde o MCP aplicava um
// gate de leitura sobre uma operacao de escrita e uma chave `prompt:read` criou um
// dataset que persistiu no banco.
func TestPromptlyScopeTools_OnlyCreateDatasetIsWrite(t *testing.T) {
	const writeTool = "create_dataset"

	for _, tool := range PromptlyScopeTools["promptly:read"] {
		if tool == writeTool {
			t.Fatalf("%q ESCREVE e nao pode estar no balde promptly:read — uma chave de leitura ganharia escrita", writeTool)
		}
	}

	write := PromptlyScopeTools["promptly:write"]
	if len(write) != 1 || write[0] != writeTool {
		t.Fatalf("o balde promptly:write deve conter exatamente [%q], tem %v", writeTool, write)
	}

	// E o par que discrimina: as tools de LEITURA continuam alcancaveis por uma chave de
	// leitura. Sem esta metade, um mapa que esvaziasse `promptly:read` passaria no teste
	// acima — recusar demais e o defeito inverso, e igualmente quebra a capacidade.
	read := PromptlyScopeTools["promptly:read"]
	if len(read) != len(PromptlyMCPTools)-1 {
		t.Fatalf("promptly:read deve conter as %d tools de leitura, tem %d",
			len(PromptlyMCPTools)-1, len(read))
	}
	for _, want := range []string{"get_prompt", "list_revisions", "list_labels"} {
		found := false
		for _, tool := range read {
			if tool == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("tool de leitura %q ausente do balde promptly:read", want)
		}
	}
}

// A sincronia com o produto e o unico ponto que este repositorio NAO consegue verificar
// sozinho: `PromptlyMCPTools` e uma copia declarada da lista que vive no theo-promptly.
// O teste fixa a CARDINALIDADE e os nomes, entao uma edicao distraida aqui reprova; uma
// tool nova no OUTRO repo continua exigindo que alguem atualize esta lista — divida
// registrada de proposito, do mesmo jeito que o rag_mcp.go a registra.
func TestPromptlyMCPTools_MatchesTheDeclaredSurface(t *testing.T) {
	want := map[string]bool{
		"compare_evaluation_runs": true,
		"create_dataset":          true,
		"get_evaluation_run":      true,
		"get_prompt":              true,
		"list_labels":             true,
		"list_revisions":          true,
	}
	if len(PromptlyMCPTools) != len(want) {
		t.Fatalf("a superficie do promptly-mcp tem %d tools declaradas, esperado %d", len(PromptlyMCPTools), len(want))
	}
	for _, tool := range PromptlyMCPTools {
		if !want[tool] {
			t.Errorf("tool inesperada na superficie declarada: %q", tool)
		}
	}
	// `run_evaluation` fica FORA por decisao de seguranca (a credencial de modelo do
	// usuario nao atravessa um tool-call). Se ela aparecer aqui, foi engano.
	for _, tool := range PromptlyMCPTools {
		if tool == "run_evaluation" {
			t.Error("run_evaluation NAO e exposta no MCP — ver create-mcp-server.ts")
		}
	}
}
