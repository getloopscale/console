package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// As coordenadas de imagem do e2e apontam para repositorios que EXISTEM.
//
// Em 2026-07-28 a imagem foi renomeada de `themory` para `theo-memory`. O
// `.github/e2e-images.env` continuou fixando um digest do repositorio ANTIGO, e
// `e2e` + `e2e-edge` passaram a falhar com `manifest unknown` — rastreado como
// #260, e por dias tratado como "CI vermelho pre-existente" em vez de como o
// que era: uma coordenada morta.
//
// O teste nao vai a rede. Ele trava o nome, que e o que a renomeacao quebrou.
// Verificar existencia exigiria credencial de registry no unit test, e um teste
// que precisa de segredo e um teste que ninguem roda.
func TestE2EImages_naoReferenciamORepositorioRenomeado(t *testing.T) {
	root := repoRoot(t)

	// `themory` foi renomeado; qualquer ocorrencia como NOME DE REPOSITORIO e
	// coordenada morta. O prefixo `ghcr.io/<org>/` e o que distingue de nomes de
	// servico e de variavel de ambiente, que continuam legitimos.
	dead := "/themory@"
	deadTag := "/themory:"

	for _, rel := range []string{
		".github/e2e-images.env",
		".github/workflows/e2e-drift.yml",
	} {
		path := filepath.Join(root, rel)
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("nao consegui ler %s: %v", rel, err)
		}
		body := string(b)
		for _, needle := range []string{dead, deadTag} {
			for _, line := range strings.Split(body, "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), "#") {
					continue // comentario que EXPLICA a renomeacao e documentacao util
				}
				if strings.Contains(line, needle) {
					t.Errorf("%s: coordenada morta %q\n  linha: %s\n"+
						"  o repositorio foi renomeado para `theo-memory`; o antigo nao resolve",
						rel, needle, strings.TrimSpace(line))
				}
			}
		}
	}
}

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod nao encontrado subindo a partir do cwd")
		}
		dir = parent
	}
}
