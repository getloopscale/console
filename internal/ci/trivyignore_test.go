package ci

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// O `.trivyignore` deste repositorio existe por um motivo de encanamento e NAO como allowlist.
//
// O reusable compartilhado passa `trivyignores: .trivyignore` incondicionalmente; sem o arquivo o
// trivy sai 1 em 17ms com `cannot find ignorefile` e o scan NAO RODA — o gate reporta falha de
// vulnerabilidade para uma varredura que nunca houve. Criar o arquivo e' o que faz o scan
// acontecer.
//
// A decisao que antes recusava criar esse arquivo tinha um receio concreto e correto: "um allowlist
// vazio no repo e um convite para a primeira supressao". Este teste e' o que fecha o convite. Uma
// supressao passa a exigir mexer AQUI, o que forca a conversa em vez de deixar um CVE sumir numa
// linha solta.
//
// Se um dia uma supressao for legitima, o caminho e' o mesmo dos outros allowlists deste repo
// (`code-quality-allowlist.txt`): id do CVE, motivo, e SUNSET — e este teste passa a exigir os tres
// em vez de exigir zero.
func TestTrivyIgnoreCarriesNoSuppressions(t *testing.T) {
	// Mesmo caminho relativo que os outros testes deste pacote usam (gate_workflows_test.go:67).
	path := filepath.Join("../..", ".trivyignore")

	f, err := os.Open(path)
	if err != nil {
		t.Fatalf(".trivyignore ausente (%v).\n"+
			"Sem ele o trivy sai `cannot find ignorefile` e o scan de vulnerabilidade NAO RODA, "+
			"enquanto o gate reporta falha — uma varredura que nunca houve reportada como achado.", err)
	}
	defer func() { _ = f.Close() }()

	var active []string
	scanner := bufio.NewScanner(f)
	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimSpace(scanner.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		active = append(active, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("lendo .trivyignore: %v", err)
	}

	if len(active) > 0 {
		t.Errorf(".trivyignore tem %d supressao(oes) ativa(s): %v\n\n"+
			"Suprimir um CVE CRITICAL/HIGH e' uma decisao de risco, nao um ajuste de build. "+
			"Se for mesmo necessaria, ela vem com id do CVE, motivo e SUNSET — e este teste "+
			"passa a exigir os tres, em vez de simplesmente deixar de existir.", len(active), active)
	}
}
