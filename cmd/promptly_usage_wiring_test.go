package main

import (
	"os"
	"strings"
	"testing"
)

// M15 (loopprompt) — a guarda de WIRING do uso por revisão.
//
// O handler de promptly é construído em torno da linha 560; o cliente do lens só existe
// ~200 linhas depois. Sem uma ligação explícita entre os dois, a rota `/usage` sobe
// SEMPRE recusando com `PROMPTLY_USAGE_NOT_CONFIGURED` — e o teste de rota continua verde,
// porque lá o leitor é injetado à mão.
//
// É a mesma classe de defeito que o M13 do dashboard sofreu: o submenu declarado completo
// e a linha de resolução ausente. Tudo verde, e nenhuma tela abrindo.
func TestPromptlyUsageReaderIsWiredFromLensClient(t *testing.T) {
	fonte, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("ler main.go: %v", err)
	}
	texto := string(fonte)

	if !strings.Contains(texto, "WithUsageReader(") {
		t.Fatal("o composition root nunca liga o leitor de uso — a rota /usage recusaria sempre")
	}

	// E a ligação tem de vir DEPOIS do cliente do lens existir.
	iLens := strings.Index(texto, "lensDataClient := looptrace.NewDataClient")
	iUso := strings.Index(texto, "WithUsageReader(")
	if iLens < 0 {
		t.Fatal("cliente do lens ausente do composition root")
	}
	if iUso < iLens {
		t.Fatal("WithUsageReader vem antes de o cliente do lens existir")
	}
}
