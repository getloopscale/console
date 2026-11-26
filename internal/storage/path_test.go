// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package storage

import (
	"errors"
	"strings"
	"testing"
)

func TestValidatePath(t *testing.T) {
	valid := []string{
		"file.txt",
		"avatars/user1.png",
		"a/b/c/deep.json",
		"with-dash_and.underscore.ext",
	}
	for _, p := range valid {
		if err := ValidatePath(p); err != nil {
			t.Errorf("ValidatePath(%q) = %v, want nil", p, err)
		}
	}

	invalid := []struct {
		path string
		why  string
	}{
		{"", "empty"},
		{"/leading", "leading slash"},
		{"../escape", "parent traversal"},
		{"a/../../etc/passwd", "traversal mid-path"},
		{"a/./b", "dot segment"},
		{"trailing/", "trailing slash"},
		{"has\x00null", "control char"},
		{"has\nnewline", "control char"},
		{"double//slash", "empty segment"},
	}
	for _, tc := range invalid {
		if err := ValidatePath(tc.path); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("ValidatePath(%q) = %v, want ErrInvalidPath (%s)", tc.path, err, tc.why)
		}
	}
}

func TestValidatePath_MaxLength(t *testing.T) {
	long := make([]byte, maxPathLen+1)
	for i := range long {
		long[i] = 'a'
	}
	if err := ValidatePath(string(long)); !errors.Is(err, ErrInvalidPath) {
		t.Error("over-length path must be rejected")
	}
}

// ── loop-console#195 — a rejeição de path deve ver o que o caller ESCREVEU, não só o literal ────────
//
// O Red Team LIVE do M7 mediu 5 achados de higiene (LOW / defense-in-depth; zero vazamento entre
// tenants, zero escape de namespace). Três deles têm a MESMA causa: `chi.URLParam(r, "*")` entrega o
// wildcard ainda PERCENT-ENCODED, então `..%2f..%2fetc%2fpasswd` é UM segmento — não é `..`, passa a
// validação, chega no backend e o erro sai como 503 `storage_unavailable`.
//
// Mascarar rejeição de input como saúde de backend é o defeito: manda o operador investigar o S3
// quando o problema é a requisição. E o comparador do path nunca vê o separador que o caller injetou.
//
// A regra é estreita de propósito: rejeitar quando a forma DECODIFICADA seria inválida. Isso pega
// injeção de separador, `..` e caractere de controle sem quebrar um `%` legítimo num nome de arquivo.
func TestValidatePath_rejectsEncodedTraversal_195(t *testing.T) {
	cases := []struct {
		name string
		path string
		why  string
	}{
		{"F1 barra percent-encoded", "..%2f..%2fetc%2fpasswd",
			"decodifica para ../../etc/passwd — separador injetado por trás da validação"},
		{"F1 maiúsculas", "..%2F..%2Fetc%2Fpasswd",
			"escape é case-insensitive; validar só a forma minúscula deixa metade do buraco"},
		{"F2 duplo-encode", "..%252f..%252fetc%252fpasswd",
			"decodifica para ..%2f.. e depois para ../.. — uma passada só não basta"},
		{"F4 CRLF encoded", "probe%0d%0a.txt",
			"controle decodificado; era armazenado como literal (input != output)"},
		{"F4 LF encoded", "probe%0a.txt", "idem"},
		{"dot-dot encoded", "%2e%2e/x.txt", "o próprio .. escondido no escape"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := ValidatePath(c.path); !errors.Is(err, ErrInvalidPath) {
				t.Fatalf("ValidatePath(%q) = %v, quero ErrInvalidPath (%s)", c.path, err, c.why)
			}
		})
	}
}

// O contraponto que impede a correção de virar um bloqueio cego: um `%` que NÃO é escape válido, e um
// escape que decodifica para algo perfeitamente legal, seguem aceitos. Rejeitar todo `%` seria simples
// e erraria — nomes de arquivo com porcentagem existem, e o cliente que codifica um espaço não está
// atacando ninguém.
func TestValidatePath_acceptsBenignPercent_195(t *testing.T) {
	for _, p := range []string{"crescimento-50%.txt", "relatorio%20final.pdf", "a/b/c.txt", "100%-done/x.bin"} {
		if err := ValidatePath(p); err != nil {
			t.Errorf("ValidatePath(%q) = %v, quero nil", p, err)
		}
	}
}

// F3 e F5 já eram cobertos — travados aqui para que a correção acima não os afrouxe por acidente.
func TestValidatePath_existingRejections_195(t *testing.T) {
	long := strings.Repeat("a", maxPathLen+1)
	for _, c := range []struct{ name, path string }{
		{"F3 nome acima do limite", long},
		{"F5 dotdot no meio", "a/../b/c.txt"},
	} {
		if err := ValidatePath(c.path); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("%s: ValidatePath = %v, quero ErrInvalidPath", c.name, err)
		}
	}
}
