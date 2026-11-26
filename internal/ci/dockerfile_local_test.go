package ci

// Dockerfile.local é o caminho de recuperação: ele existe para o dia em que o
// `gomod_token` falta, e resolve `contracts` por um `replace` para uma cópia local
// em vez de buscar o módulo privado. Foi criado em 2026-06-27 (Red Team #95 P0) porque o
// token havia expirado e bloqueava um rebuild.
//
// Em 2026-08-10, reconstruindo o app-dev do zero sem acesso ao registro, ele NÃO
// funcionou — e falhou pelas duas únicas coisas que ele precisa acertar. Ambos os
// defeitos são invisíveis a um build verde, e é por isso que este guarda é estático:
//
//  1. O `replace` citava `github.com/getloopscale/contracts`, enquanto o `go.mod`
//     declara `github.com/getloopscale/contracts`. Um `replace` que não casa com o
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
	"os/exec"
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
	declared := regexp.MustCompile(`(?m)^\s+(github\.com/[\w.-]+/contracts)\s`).FindStringSubmatch(string(gomod))
	if declared == nil {
		t.Fatal("go.mod não declara contracts — o guarda perdeu o alvo e precisa ser revisto")
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
	if !regexp.MustCompile(`(?m)^COPY\s+contracts/`).MatchString(dockerfile) {
		t.Error("Dockerfile.local não copia `contracts/` para dentro do contexto; " +
			"o `replace` apontaria para um caminho inexistente e o build voltaria a buscar remoto")
	}
}

// TestDockerfileLocalCopiesEverySourceDirTheBinaryNeeds closes the class the
// three sibling guards above cannot see.
//
// They assert three specific past defects: the build target is the package and
// not one file, the replace directive points at the right module path, and the
// contracts sibling is staged locally. All three are frozen mistakes. None of
// them notices a NEW top-level source directory that `cmd` starts importing and
// the Dockerfile never copies — the build then fails inside the image with a
// missing-package error, which is the same shape as the defects the item exists
// to prevent.
//
// The B-017 bullet asked for a check that BUILDS this Dockerfile without the
// token. This is not that: a real build needs Docker, and pretending a static
// check is a build would be the kind of substitution this whole item is about.
// What it does instead is derive the required set instead of restating it —
// `go list -deps ./cmd` reports exactly the packages the binary reaches, so the
// answer comes from the compiler rather than from someone remembering to update
// a list.
//
// Directories NOT reached by ./cmd are deliberately not required. `tests/` holds
// Go files and is correctly absent from the image.
func TestDockerfileLocalCopiesEverySourceDirTheBinaryNeeds(t *testing.T) {
	modBytes, err := os.ReadFile(filepath.Clean("../../go.mod"))
	if err != nil {
		t.Fatalf("reading go.mod: %v", err)
	}
	var modPath string
	for _, line := range strings.Split(string(modBytes), "\n") {
		if after, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
			modPath = strings.TrimSpace(after)
			break
		}
	}
	if modPath == "" {
		t.Fatal("go.mod declares no module path — the deps below cannot be attributed to this module")
	}

	// Run from the MODULE ROOT: the test's working directory is internal/ci, where
	// `./cmd` does not exist. The first version of this check skipped for exactly
	// that reason and reported ok — a silent pass, which is the failure mode this
	// whole item is about.
	cmd := exec.Command("go", "list", "-deps", "./cmd")
	cmd.Dir = "../.."
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list -deps ./cmd failed in the module root: %v — a check that cannot run must say "+
			"so loudly, because a skip reads as a pass", err)
	}

	needed := map[string]bool{}
	for _, pkg := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		rest, ok := strings.CutPrefix(pkg, modPath+"/")
		if !ok {
			continue // stdlib or an external module — not copied from this tree
		}
		needed[strings.SplitN(rest, "/", 2)[0]] = true
	}
	if len(needed) == 0 {
		t.Fatal("go list reported no package of this module under ./cmd — the check measured nothing, " +
			"which is not the same as measuring a clean result")
	}

	dockerfile := readDockerfileLocal(t)
	for dir := range needed {
		want := "COPY loop-console/" + dir + "/"
		if !strings.Contains(dockerfile, want) {
			t.Errorf("./cmd transitively imports %s/ and Dockerfile.local never copies it (%q absent).\n"+
				"    The image build fails with a missing package, and the three guards above cannot see\n"+
				"    it because each pins one past defect rather than the set the binary needs (B-017).",
				dir, want)
		}
	}
}
