// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package config

import "strings"

// Setting e um par nome/valor de configuracao, avaliado por presenca.
type Setting struct {
	Name  string
	Value string
}

// MissingSettings devolve, na ORDEM declarada, os nomes das configuracoes
// ausentes — tratando espaco em branco como ausencia.
//
// #334: existe para que "integracao desligada por falta de config" deixe de ser
// silenciosa. Hoje o cloud-API RECUSA SUBIR quando a construcao de um broker
// falha, mas quando a configuracao esta AUSENTE ele apenas pula o bloco — e as
// duas situacoes produzem o mesmo resultado para quem usa: a capacidade nao
// existe. Medido em app-dev: com `SKILLS_PLATFORM_ADMIN_KEY` vazia o endpoint de
// authz do skills nao e registrado, o ForwardAuth do edge recebe 404 e a borda
// devolve 404 — um sintoma a tres camadas da causa, sem uma linha de log entre
// elas.
//
// Devolve NOMES, nunca valores: varios destes campos sao credenciais, e o
// destino desta lista e o log.
func MissingSettings(settings ...Setting) []string {
	var missing []string
	for _, s := range settings {
		if strings.TrimSpace(s.Value) == "" {
			missing = append(missing, s.Name)
		}
	}
	return missing
}
