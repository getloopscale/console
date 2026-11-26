// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package ci

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// #343 — a invariante que falhou QUATRO vezes e nunca teve verificação.
//
// Dois lugares precisam concordar e só concordam se alguém lembrar:
//
//	internal/routes/api_keys.go   `validScopes`      — o que a EMISSÃO aceita
//	cmd/main.go                   `*.NewBroker(…)`   — o que o BROKER sabe cunhar
//
// Um escopo emitível que o broker não conhece é aceito no `POST /v1/api-keys` (200, chave
// cunhada) e DESCARTADO na travessia: o cliente recebe uma credencial que não carrega o que ele
// pediu, e a capacidade fica inalcançável por qualquer credencial. Fail-closed — seguro —, mas
// silencioso: cada camada parece correta isolada, e só um cliente tentando usar o escopo revela.
//
// Acima da lista, em `api_keys.go`, está escrito: "O conjunto é EXATAMENTE o que o broker sabe
// cunhar (cmd/main.go)". Isso é **prosa**. Quem adicionou o quarto escopo declarou ter lido esse
// aviso e adicionou três linhas abaixo dele — porque um comentário não reprova.
//
// Este teste é a verificação que faltava. Ele parseia os dois lados (AST, não grep — um grep
// casaria a própria prosa acima) e reprova quando divergem.

// brokerNamespace — o prefixo que o BROKER usa, quando difere do prefixo do CLIENTE.
//
// MEDIDO na doc de cada NewBroker, e os dois significados coexistem no mesmo parametro:
//
//	internal/trust/broker.go:53     "scopes are the data scopes minted per-tenant key"  -> trust:*
//	internal/promptly/broker.go:58  "the service-namespace (`prompt:*`) scopes"         -> prompt:*
//
// A primeira versao deste teste comparou os literais e acusou `promptly` — FALSO-POSITIVO, porque
// ali cliente e servico vivem em namespaces diferentes por desenho. Um teste que grita sobre
// configuracao correta e pior que teste nenhum: treina a ignorar o vermelho, que e o defeito do
// #333. A invariante real e sobre a CAPACIDADE (o verbo), nao sobre o prefixo.
var brokerNamespace = map[string]string{
	"promptly": "prompt",
}

func verbsOf(scopes map[string]bool, prefix string) map[string]bool {
	out := map[string]bool{}
	for s := range scopes {
		if p, verb, ok := strings.Cut(s, ":"); ok && p == prefix {
			out[verb] = true
		}
	}
	return out
}

func TestEveryIssuableScopeIsKnownToItsBroker(t *testing.T) {
	issuable := parseValidScopes(t)
	known := parseBrokerScopes(t)

	// Escopos de ciclo de vida pertencem ao broker e NUNCA ao consumidor — a propria prosa de
	// `api_keys.go` os exclui pelo mesmo motivo. Nao sao divergencia.
	lifecycle := func(s string) bool {
		return strings.HasSuffix(s, ":admin") || strings.HasSuffix(s, ":platform-admin")
	}

	products := map[string]bool{}
	for _, s := range sortedKeys(issuable) {
		if lifecycle(s) {
			continue
		}
		if p, _, ok := strings.Cut(s, ":"); ok {
			products[p] = true
		}
	}

	for _, product := range sortedKeys(products) {
		ns := product
		if alias, ok := brokerNamespace[product]; ok {
			ns = alias
		}
		brokerScopes, hasBroker := known[ns]
		if !hasBroker {
			// Produto emitivel sem broker: pode ser legitimo (rota servida direto). Registrado,
			// nao reprovado — reprovar geraria ruido em cada vertical nova.
			t.Logf("INFO: %q e emitivel e nenhum broker foi encontrado no namespace %q", product, ns)
			continue
		}
		want := verbsOf(issuable, product)
		got := verbsOf(brokerScopes, ns)
		for _, verb := range sortedKeys(want) {
			if lifecycle(product + ":" + verb) {
				continue
			}
			if !got[verb] {
				t.Errorf("`%s:%s` e aceito na emissao (validScopes) mas o broker de %q nao o "+
					"conhece (namespace %q conhece %v).\n"+
					"  Efeito: POST /v1/api-keys devolve 200 e cunha a chave, o escopo e DESCARTADO "+
					"na travessia, e a capacidade fica inalcancavel por QUALQUER credencial — sem "+
					"erro em lugar nenhum. Ja ocorreu quatro vezes (rag, storage, promptly, "+
					"trust:content), e o aviso em prosa acima da lista nao impediu nenhuma.",
					product, verb, product, ns, sortedKeys(got))
			}
		}
	}
}

// A metade OPOSTA: o broker que sabe cunhar um escopo que ninguém pode pedir.
//
// Sem ela, "o broker conhece tudo" passaria no teste acima — e essa é a divergência inversa, que
// deixa capacidade morta no código parecendo suportada.
func TestEveryBrokerScopeIsIssuable(t *testing.T) {
	issuable := parseValidScopes(t)
	known := parseBrokerScopes(t)

	// prefixo do broker -> prefixo do cliente (inverso de brokerNamespace)
	customerOf := map[string]string{}
	for cust, ns := range brokerNamespace {
		customerOf[ns] = cust
	}

	for _, ns := range sortedKeys(toSet(known)) {
		product := ns
		if c, ok := customerOf[ns]; ok {
			product = c
		}
		want := verbsOf(issuable, product)
		for _, verb := range sortedKeys(verbsOf(known[ns], ns)) {
			if verb == "admin" || verb == "platform-admin" {
				continue
			}
			if !want[verb] {
				t.Errorf("o broker de %q sabe cunhar o verbo %q, mas nenhum cliente pode pedi-lo "+
					"(`%s:%s` ausente de validScopes). Capacidade morta que o codigo faz parecer "+
					"suportada — a divergencia inversa do #343.", ns, verb, product, verb)
			}
		}
	}
}

// --- parsing -----------------------------------------------------------------------------
//
// AST, não grep, e a razão é concreta: os dois arquivos CITAM escopos na prosa que explica as
// ocorrências anteriores (`trust:read/write/delete`, `rag:admin`, …). Um grep casaria os
// comentários e o teste ficaria verde por acidente.

func parseGo(t *testing.T, rel string) (*token.FileSet, *ast.File) {
	t.Helper()
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filepath.Join("../..", rel), nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("parseando %s: %v", rel, err)
	}
	return fset, f
}

// parseValidScopes lê as CHAVES do mapa `validScopes`.
func parseValidScopes(t *testing.T) map[string]bool {
	t.Helper()
	_, f := parseGo(t, "internal/routes/api_keys.go")
	out := map[string]bool{}

	ast.Inspect(f, func(n ast.Node) bool {
		vs, ok := n.(*ast.ValueSpec)
		if !ok || len(vs.Names) == 0 || vs.Names[0].Name != "validScopes" {
			return true
		}
		for _, v := range vs.Values {
			cl, ok := v.(*ast.CompositeLit)
			if !ok {
				continue
			}
			for _, elt := range cl.Elts {
				kv, ok := elt.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				if s, ok := stringLit(kv.Key); ok {
					out[s] = true
				}
			}
		}
		return false
	})

	if len(out) == 0 {
		t.Fatal("não achei `validScopes` em internal/routes/api_keys.go — se ele foi renomeado, " +
			"este teste precisa acompanhar, senão vira verde-por-omissão (o defeito que ele combate)")
	}
	return out
}

// parseBrokerScopes lê os escopos passados a cada `*.NewBroker(…)` em cmd/main.go, resolvendo
// UM nível de indireção (ex.: `trust.CustomerScopes`) contra o pacote correspondente.
func parseBrokerScopes(t *testing.T) map[string]map[string]bool {
	t.Helper()
	_, f := parseGo(t, "cmd/main.go")
	out := map[string]map[string]bool{}

	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "NewBroker" {
			return true
		}
		for _, arg := range call.Args {
			for _, s := range scopesFromExpr(t, arg) {
				product, _, ok := strings.Cut(s, ":")
				if !ok {
					continue
				}
				if out[product] == nil {
					out[product] = map[string]bool{}
				}
				out[product][s] = true
			}
		}
		return true
	})

	if len(out) == 0 {
		t.Fatal("nenhuma chamada a `NewBroker` com escopos foi encontrada em cmd/main.go")
	}
	return out
}

// scopesFromExpr extrai literais de `[]string{…}` ou resolve `pkg.Var` no pacote interno.
func scopesFromExpr(t *testing.T, e ast.Expr) []string {
	t.Helper()
	switch v := e.(type) {
	case *ast.CompositeLit:
		var out []string
		for _, elt := range v.Elts {
			if s, ok := stringLit(elt); ok {
				out = append(out, s)
			}
		}
		return out
	case *ast.SelectorExpr:
		pkg, ok := v.X.(*ast.Ident)
		if !ok {
			return nil
		}
		return resolveSharedScopes(t, pkg.Name, v.Sel.Name)
	}
	return nil
}

// resolveSharedScopes acha `var <name> = []string{…}` em internal/<pkg>/.
//
// Sem isto, um broker que passou a derivar de uma fonte única (o `trust` já derivou) apareceria
// como "não conhece escopo algum" e o teste reprovaria o padrão CORRETO — punindo justamente a
// correção estrutural que o #343 pede.
func resolveSharedScopes(t *testing.T, pkg, name string) []string {
	t.Helper()
	dir := filepath.Join("../..", "internal", pkg)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		_, f := parseGo(t, filepath.Join("internal", pkg, e.Name()))
		var found []string
		ast.Inspect(f, func(n ast.Node) bool {
			vs, ok := n.(*ast.ValueSpec)
			if !ok || len(vs.Names) == 0 || vs.Names[0].Name != name {
				return true
			}
			for _, val := range vs.Values {
				if cl, ok := val.(*ast.CompositeLit); ok {
					for _, elt := range cl.Elts {
						if s, ok := stringLit(elt); ok {
							found = append(found, s)
						}
					}
				}
			}
			return false
		})
		if len(found) > 0 {
			return found
		}
	}
	return nil
}

func stringLit(e ast.Expr) (string, bool) {
	bl, ok := e.(*ast.BasicLit)
	if !ok || bl.Kind != token.STRING {
		return "", false
	}
	s, err := strconv.Unquote(bl.Value)
	if err != nil {
		return "", false
	}
	return s, true
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func toSet[V any](m map[string]V) map[string]bool {
	out := make(map[string]bool, len(m))
	for k := range m {
		out[k] = true
	}
	return out
}
