package ci

// Dockerfile.local é o caminho de recuperação: ele existe para o dia em que o
// `gomod_token` falta, e resolve `theo-contracts` por um `replace` para uma cópia local
// em vez de buscar o módulo privado. Foi criado em 2026-06-27 (Red Team #95 P0) porque o
// token havia expirado e bloqueava um rebuild.
//
// Em 2026-08-10, reconstruindo o app-dev do zero sem acesso ao registro, ele NÃO
// funcionou — e falhou pelas duas únicas coisas que ele precisa acertar. Ambos os
// defeitos são invisíveis a um build verde, e é por isso que este guarda é estático:
//
//  1. O `replace` citava `github.com/usetheodev/theo-contracts`, enquanto o `go.mod`
//     declara `github.com/usetheoai/theo-contracts`. Um `replace` que não casa com o
//     caminho do módulo é simplesmente ignorado pelo Go — sem aviso. COM credencial, o
//     fetch remoto funciona e mascara o replace morto; SEM credencial, que é o único
//     cenário em que este arquivo é usado, o build morre em `git ls-remote`.
//
//  2. O build era `go build -o /cloud-api ./cmd/main.go` — UM ARQUIVO, não o pacote.
//     Enquanto `main.go` foi autossuficiente isso passou; quando ele passou a chamar
//     funções declaradas em `cmd/promptly_dashboard_wiring.go` e irmãos, o build passou a
//     morrer com `undefined: newPromptlyDashboardKeyResolver`. O Dockerfile canônico
//     compila o pacote; este divergiu e ninguém notou, porque ninguém o usa em dia normal.
//
// A lição comum aos dois: um caminho de recuperação que só é exercitado no dia do
// incidente apodrece em silêncio. Este teste o exercita todo dia.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const dockerfileLocalPath = "../../Dockerfile.local"

func readDockerfileLocal(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean(dockerfileLocalPath))
	if err != nil {
		t.Fatalf("ler %s: %v", dockerfileLocalPath, err)
	}
	return string(b)
}

// TestDockerfileLocalReplaceMatchesModulePath compara o `replace` injetado com o caminho
// de módulo que o go.mod realmente declara — em vez de fixar uma string, que é como o
// defeito entrou (o caminho mudou de organização e o Dockerfile ficou para trás).
func TestDockerfileLocalReplaceMatchesModulePath(t *testing.T) {
	dockerfile := readDockerfileLocal(t)

	gomod, err := os.ReadFile(filepath.Clean("../../go.mod"))
	if err != nil {
		t.Fatalf("ler go.mod: %v", err)
	}
	declared := regexp.MustCompile(`(?m)^\s+(github\.com/[\w.-]+/theo-contracts)\s`).FindStringSubmatch(string(gomod))
	if declared == nil {
		t.Fatal("go.mod não declara theo-contracts — o guarda perdeu o alvo e precisa ser revisto")
	}
	modulePath := declared[1]

	injected := regexp.MustCompile(`replace\s+(\S+)\s+=>`).FindAllStringSubmatch(dockerfile, -1)
	if len(injected) == 0 {
		t.Fatalf("Dockerfile.local não injeta nenhum `replace` — sem ele o build busca o módulo "+
			"privado remoto, que é exatamente o que este arquivo existe para evitar (go.mod declara %s)",
			modulePath)
	}
	for _, m := range injected {
		if m[1] != modulePath {
			t.Errorf("o `replace` injetado cita %q, mas o go.mod declara %q.\n"+
				"Um replace que não casa com o caminho do módulo é IGNORADO pelo Go, sem aviso: "+
				"com credencial o fetch remoto mascara o problema, e sem credencial — o único caso "+
				"em que este Dockerfile é usado — o build morre em `git ls-remote`.", m[1], modulePath)
		}
	}
}

// TestDockerfileLocalBuildsThePackageNotOneFile trava o segundo defeito.
//
// `go build ./cmd/main.go` compila UM arquivo e ignora os irmãos do mesmo pacote. Isso
// funciona até o dia em que `main.go` chama algo declarado ao lado — e aí falha com
// `undefined:`, num arquivo que ninguém está editando.
func TestDockerfileLocalBuildsThePackageNotOneFile(t *testing.T) {
	dockerfile := readDockerfileLocal(t)

	for _, line := range strings.Split(dockerfile, "\n") {
		if !strings.Contains(line, "go build") {
			continue
		}
		if regexp.MustCompile(`\./\S*\.go\b`).MatchString(line) {
			t.Errorf("o build tem como alvo um ARQUIVO e não o pacote:\n  %s\n"+
				"Arquivos irmãos de `package main` (cmd/promptly_dashboard_wiring.go e outros) "+
				"ficam de fora, e o build morre com `undefined:` assim que main.go passar a "+
				"depender de um deles. Use `./cmd`.", strings.TrimSpace(line))
		}
	}
}

// TestDockerfileLocalStagesContractsLocally garante que a cópia local que o `replace`
// aponta chega de fato ao contexto — um replace correto para um caminho vazio falha igual.
func TestDockerfileLocalStagesContractsLocally(t *testing.T) {
	dockerfile := readDockerfileLocal(t)
	if !regexp.MustCompile(`(?m)^COPY\s+theo-contracts/`).MatchString(dockerfile) {
		t.Error("Dockerfile.local não copia `theo-contracts/` para dentro do contexto; " +
			"o `replace` apontaria para um caminho inexistente e o build voltaria a buscar remoto")
	}
}
