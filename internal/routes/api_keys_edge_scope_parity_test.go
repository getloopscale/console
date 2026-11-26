// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"regexp"
	"testing"
)

// scopeLiteral casa "vertical:acao" — o formato de um escopo emitível.
var scopeLiteral = regexp.MustCompile(`^[a-z]+:[a-z-]+$`)

// TestEdgeRequiredScopesAreIssuable fecha a CLASSE de defeito que já bateu três vezes.
//
// O modo de falha, sempre idêntico: a cadeia Model B de um vertical sobe inteira — borda
// roteando, ForwardAuth ligado, broker cunhando chave por tenant — e nenhum cliente
// consegue alcançá-la, porque o escopo que a borda EXIGE não é emitível pelo cunhador.
// Cada camada parece correta isolada e nada fica vermelho. Ocorrências medidas:
// looprag (#168), loopguardrails (2026-07-31) e loopprompt (2026-08-01) — este último
// deixou o produto inteiro inutilizável em app-dev, com 403 SCOPE_REQUIRED.
//
// POR QUE ESTE TESTE É DIFERENTE DOS ANTERIORES. `api_keys_trust_scope_test.go` fixa uma
// lista escrita à mão para UM vertical. Ele pegou o trust depois do fato e não impediu o
// promptly, porque um vertical novo simplesmente não aparece numa lista que ninguém
// lembra de editar — a mesma razão pela qual `validScopes` divergiu da fiação. Este aqui
// não repete a lista: ele a DERIVA de `cmd/main.go`, então um vertical novo entra na
// checagem no instante em que é ligado à borda, sem ninguém lembrar de nada.
//
// O SINAL ESCOLHIDO é o 4º argumento de `NewForwardAuthHandler(resolve, broker, authorize,
// scope, logger)`: o escopo que a borda cobra da chave do cliente. Deliberadamente NÃO se
// olha as listas de `KeyForTenantScoped`/`NewBroker`, porque elas carregam os escopos de
// DOWNSTREAM — o broker do promptly traduz `promptly:* → prompt:*`, e `prompt:read` não é
// nem deve ser emitível pelo cliente. Assertar sobre elas exigiria o oposto deste teste.
//
// LIMITE HONESTO: lê o AST de `cmd/main.go`, então só enxerga o que é ligado ali. Um
// ForwardAuth construído em outro arquivo escapa. O caminho estruturalmente melhor seria
// os dois lados lerem um registro único (DRY), eliminando a duplicação em vez de vigiá-la;
// isto é a rede de segurança enquanto essa refatoração não acontece.
func TestEdgeRequiredScopesAreIssuable(t *testing.T) {
	mainPath := filepath.Join("..", "..", "cmd", "main.go")
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, mainPath, nil, 0)
	if err != nil {
		t.Fatalf("não foi possível parsear %s: %v", mainPath, err)
	}

	var required []struct {
		scope string
		pos   string
	}

	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		name := ""
		switch fn := call.Fun.(type) {
		case *ast.SelectorExpr:
			name = fn.Sel.Name
		case *ast.Ident:
			name = fn.Name
		}
		if name != "NewForwardAuthHandler" {
			return true
		}
		// Só argumentos literais de topo: uma lista []string{...} de downstream não é
		// varrida porque não é um BasicLit direto na chamada.
		for _, arg := range call.Args {
			lit, ok := arg.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				continue
			}
			s := lit.Value[1 : len(lit.Value)-1] // tira as aspas
			if !scopeLiteral.MatchString(s) {
				continue
			}
			required = append(required, struct {
				scope string
				pos   string
			}{s, fset.Position(lit.Pos()).String()})
		}
		return true
	})

	if len(required) == 0 {
		t.Fatalf("nenhuma chamada a NewForwardAuthHandler com escopo literal encontrada em %s — "+
			"o teste perdeu o sinal que vigia (a fiação mudou de forma?) e estaria verde sobre nada", mainPath)
	}

	for _, r := range required {
		if !validScopes[r.scope] {
			t.Errorf("a borda EXIGE o escopo %q (%s) mas ele NÃO é emitível: falta em validScopes. "+
				"Efeito: a cadeia inteira do vertical sobe e todo cliente leva 403 SCOPE_REQUIRED, "+
				"sem nada ficar vermelho.", r.scope, r.pos)
		}
	}
}
