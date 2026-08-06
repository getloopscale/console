package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/usetheodev/theo-cloud/internal/config"
)

// Pilar (b) da triade de wiring para theo-workspace#37.
//
// `serviceversions.Refresh` pode estar perfeito e coberto por testes de unidade, e o
// issue continuar aberto: o defeito NAO era codigo faltando, era codigo nunca
// disparado. A metrica de frota so virava real quando um humano AUTENTICADO abria o
// painel. Um refresher escrito e nao iniciado reproduz o issue inteiro com a suite
// verde — foi exatamente assim que duas correcoes nasceram INERTES nesta corrida.
//
// Inspecao de AST, e nao execucao, pela mesma razao que o teste vizinho: `main()`
// abre porta, banco e cliente de pagamento. O que se trava aqui e' a LIGACAO.

func mainFuncDecl(t *testing.T) *ast.FuncDecl {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse cmd/main.go: %v", err)
	}
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Name.Name == "main" && fn.Recv == nil {
			return fn
		}
	}
	t.Fatal("func main not found in cmd/main.go")
	return nil
}

func TestFleetRefresh_IniciadoPorMain(t *testing.T) {
	iniciado := false
	ast.Inspect(mainFuncDecl(t), func(n ast.Node) bool {
		// `go serviceversions.Refresh(...)` — precisa ser um GoStmt: chamar de forma
		// sincrona bloquearia o boot para sempre, e o processo nunca serviria trafego.
		g, ok := n.(*ast.GoStmt)
		if !ok {
			return true
		}
		sel, ok := g.Call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "serviceversions" && sel.Sel.Name == "Refresh" {
			iniciado = true
		}
		return true
	})
	if !iniciado {
		t.Fatal("main() nao inicia serviceversions.Refresh — a frota volta a so ser sondada quando " +
			"um humano autenticado abre o painel, e /metrics fica em not_collected indefinidamente " +
			"(theo-workspace#37)")
	}
}

func TestFleetRefresh_RecebeOColetorDoMountEOContextoDeShutdown(t *testing.T) {
	// Duas ligacoes que um `go Refresh(...)` presente ainda pode errar, e nenhuma
	// delas quebra a compilacao:
	//
	//  1. receber o coletor CRU em vez do devolvido pelo mount — publicaria uma frota
	//     sem a linha do proprio gateway, e o censo do Prometheus discordaria do censo
	//     do painel por um;
	//  2. receber `context.Background()` em vez do `schedulerCtx` — o refresher
	//     sobreviveria ao SIGTERM, segurando o shutdown e sondando uma frota que
	//     ninguem mais observa.
	var argCtx, argColetor string
	ast.Inspect(mainFuncDecl(t), func(n ast.Node) bool {
		g, ok := n.(*ast.GoStmt)
		if !ok {
			return true
		}
		sel, ok := g.Call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		pkg, ok := sel.X.(*ast.Ident)
		if !ok || pkg.Name != "serviceversions" || sel.Sel.Name != "Refresh" || len(g.Call.Args) < 2 {
			return true
		}
		if id, ok := g.Call.Args[0].(*ast.Ident); ok {
			argCtx = id.Name
		}
		if id, ok := g.Call.Args[1].(*ast.Ident); ok {
			argColetor = id.Name
		}
		return true
	})

	if argCtx != "schedulerCtx" {
		t.Fatalf("Refresh recebe o contexto %q, esperado \"schedulerCtx\" — sem ele o refresher "+
			"nao para no SIGTERM", argCtx)
	}
	if argColetor != "fleetCollector" {
		t.Fatalf("Refresh recebe o coletor %q, esperado \"fleetCollector\" (o devolvido por "+
			"mountServiceVersions) — o coletor cru omite a linha do proprio gateway", argColetor)
	}
}

func TestMountServiceVersions_DevolveColetorUsavel(t *testing.T) {
	// O mount virou fonte do coletor do refresher. Devolver nil compila e so falha em
	// producao, na primeira coleta — um nil-panic dentro de goroutine de background
	// derruba o processo inteiro.
	r := chi.NewRouter()
	passthrough := func(next http.Handler) http.Handler { return next }
	got := mountServiceVersions(r, config.Config{}, quietLogger(), passthrough)
	if got == nil {
		t.Fatal("mountServiceVersions devolveu nil — o refresher entraria em panic na primeira coleta")
	}
}
