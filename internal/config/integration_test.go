// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package config_test

import (
	"strings"
	"testing"

	"github.com/getloopscale/loop-console/internal/config"
)

// #334: uma integracao some da borda quando falta configuracao, e o servico sobe
// sem dizer nada. O bloco que a constroi RECUSA SUBIR quando o broker falha
// ("refusing to start"), mas quando a config esta AUSENTE ele apenas pula. As
// duas situacoes tem o mesmo efeito para o usuario — a capacidade nao existe —
// e tratamento oposto no codigo.
//
// Medido em app-dev: SKILLS_PLATFORM_ADMIN_KEY vazia => o endpoint de authz nao
// e registrado => o ForwardAuth do edge recebe 404 => a borda devolve 404 e o
// sintoma parece "rota inexistente no produto". Tres camadas entre causa e
// sintoma, nenhuma linha de log no meio.
func TestMissingSettings_NomeiaExatamenteOQueFalta(t *testing.T) {
	missing := config.MissingSettings(
		config.Setting{Name: "SKILLS_BASE_URL", Value: "http://skills:3000"},
		config.Setting{Name: "SKILLS_PLATFORM_ADMIN_KEY", Value: ""},
	)

	if len(missing) != 1 || missing[0] != "SKILLS_PLATFORM_ADMIN_KEY" {
		t.Fatalf("missing = %v, quero exatamente [SKILLS_PLATFORM_ADMIN_KEY]", missing)
	}
}

func TestMissingSettings_VazioQuandoTudoPresente(t *testing.T) {
	if missing := config.MissingSettings(
		config.Setting{Name: "TRUST_BASE_URL", Value: "http://trust:3000"},
		config.Setting{Name: "TRUST_PLATFORM_ADMIN_KEY", Value: "k"},
	); len(missing) != 0 {
		t.Fatalf("missing = %v, quero vazio", missing)
	}
}

// A ordem precisa ser a declarada, nao a de um mapa: um relatorio de diagnostico
// que embaralha os nomes a cada boot e mais dificil de comparar entre execucoes.
func TestMissingSettings_PreservaAOrdemDeclarada(t *testing.T) {
	missing := config.MissingSettings(
		config.Setting{Name: "A", Value: ""},
		config.Setting{Name: "B", Value: "x"},
		config.Setting{Name: "C", Value: ""},
	)

	if strings.Join(missing, ",") != "A,C" {
		t.Fatalf("missing = %v, quero [A C] na ordem declarada", missing)
	}
}

// Espaco em branco nao e configuracao. Um valor " " passaria num teste de
// != "" e produziria um cliente HTTP com credencial em branco — falha adiante,
// longe daqui, que e exatamente o que este arquivo existe para evitar.
func TestMissingSettings_TrataEspacoEmBrancoComoAusente(t *testing.T) {
	if missing := config.MissingSettings(
		config.Setting{Name: "SKILLS_PLATFORM_ADMIN_KEY", Value: "   "},
	); len(missing) != 1 {
		t.Fatalf("missing = %v, quero que espaco em branco conte como ausente", missing)
	}
}
