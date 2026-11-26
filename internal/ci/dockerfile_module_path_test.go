package ci

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// O caminho de modulo dentro do Dockerfile tem de ser o MESMO do `go.mod`.
//
// A organizacao migrou de `getloopscale` para `getloopscale` em 2026-08-06 (`2d5e5b13`). O `go.mod`
// acompanhou; o Dockerfile nao, em OITO lugares. Nenhum foi notado por seis dias, porque o unico
// lugar que constroi a imagem e o `publish`, e o `publish` estava morto no startup (B-270).
//
// Os tres efeitos, em ordem crescente de perversidade:
//
//  1. `GOPRIVATE=github.com/getloopscale/*` — o modulo privado real vive em `getloopscale`, entao ele
//     deixa de ser tratado como privado e o Go tenta o proxy publico, que devolve 404.
//  2. o `insteadOf` reescreve `getloopscale` — o token nunca e' injetado para `getloopscale`, e o
//     `go mod download` falha. Este e' o barulhento: quebra o build (job 94259... em 2026-08-12).
//  3. as ldflags carimbam `-X github.com/getloopscale/loop-console/internal/version.Version` — um
//     caminho de pacote que NAO EXISTE MAIS. O linker aceita silenciosamente uma ldflag que nao
//     casa simbolo nenhum, entao o binario compila e reporta `dev`/`unknown` para sempre.
//
// O terceiro e' o que este teste existe para pegar. Ele nao quebra nada: ele faz o criterio de
// aceite do M22 (`/v1/version` bate com o label da imagem) ficar FALSO sem um unico erro. E' a
// mesma classe dos outros achados deste dia — algo que nao aconteceu, reportado como se tivesse.
func TestDockerfileStampsTheRealModulePath(t *testing.T) {
	root := filepath.Join("..", "..")

	gomod, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatalf("go.mod: %v", err)
	}
	m := regexp.MustCompile(`(?m)^module\s+(\S+)`).FindSubmatch(gomod)
	if m == nil {
		t.Fatal("go.mod nao declara `module`")
	}
	modulePath := string(m[1])

	df, err := os.ReadFile(filepath.Join(root, "Dockerfile"))
	if err != nil {
		t.Fatalf("Dockerfile: %v", err)
	}
	dockerfile := string(df)

	// As ldflags: cada `-X <caminho>/internal/version.X=` tem de partir do modulo real, senao o
	// linker ignora em silencio e a versao nunca chega ao binario.
	for _, sym := range []string{"Version", "GitSHA", "BuiltAt"} {
		want := modulePath + "/internal/version." + sym + "="
		if !strings.Contains(dockerfile, want) {
			t.Errorf("Dockerfile nao carimba %s a partir do modulo real.\n"+
				"esperado conter: -X %s\n"+
				"Uma ldflag que nao casa simbolo NAO e' erro para o linker: o binario compila e "+
				"reporta `dev`/`unknown` para sempre, e o criterio do M22 fica falso sem barulho.",
				sym, want)
		}
	}

	// A org do modulo tem de aparecer no GOPRIVATE e no insteadOf, ou o modulo privado nao e'
	// buscado com token.
	org := modulePath
	if i := strings.Index(strings.TrimPrefix(org, "github.com/"), "/"); i >= 0 {
		org = "github.com/" + strings.TrimPrefix(org, "github.com/")[:i]
	}
	for _, needle := range []string{"GOPRIVATE=" + org + "/*", org + "/\".insteadOf"} {
		if !strings.Contains(dockerfile, needle) {
			t.Errorf("Dockerfile nao contem %q — o modulo privado de %s nao sera' buscado com token, "+
				"e `go mod download` falha no build da imagem", needle, org)
		}
	}
}
