// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package ci

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// #342 (LT-051) — o catch-all da SPA respondia por rotas de API.
//
// `location / { try_files $uri /index.html; }` devolve index.html com **200** para qualquer path
// que nao seja arquivo. Quando o edge encaminha ao dashboard um path de API que nao casou nenhuma
// rota de produto, o cliente recebe `200 text/html` — status de sucesso com corpo de outro tipo,
// que e a pior forma de falhar: `resp.ok` e true, e um SDK/jq/agente MCP segue em frente.
//
// MEDIDO em 2026-08-02 contra app-dev, SEM credencial (a manifestacao que nao exige chave):
//
//	/health   -> 200 application/json   (roteado ao cloud-API, correto)
//	/ready    -> 200 text/html          <-- a sonda de readiness do #338, ENGOLIDA pela SPA
//
// Ou seja: o endpoint que existe para poder REPROVAR devolvia 200 com HTML — um verificador
// externo apontado para ele ficaria verde para sempre. E exatamente o "healthcheck que nenhuma
// falha derruba" (LT-040/LT-041 do promptly), produzido por outra camada.
//
// ATENCAO AO MEDIR: o coordenador mediu isto SEM chave, viu 401 nos seis produtos e concluiu "o
// edge esta correto". O 401 nao era o roteamento funcionando — era o ForwardAuth barrando ANTES
// de o roteamento ser exercido. Meca autenticado, ou meca por um path que nao exige auth.
func nginxConf(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("../../dashboard/nginx.conf")
	if err != nil {
		t.Fatalf("lendo dashboard/nginx.conf: %v", err)
	}
	return string(b)
}

// A metade NEGATIVA: superficie de API nunca pode cair no catch-all.
func TestSPAFallbackDoesNotAnswerForAPIPaths(t *testing.T) {
	conf := nginxConf(t)

	guard := regexp.MustCompile(`(?s)location\s+~\s+\^/\((?P<alts>[^)]+)\).*?return\s+404`)
	m := guard.FindStringSubmatch(conf)
	if m == nil {
		t.Fatal("dashboard/nginx.conf nao tem guarda: qualquer path de API que chegue aqui vira " +
			"`200 text/html` pelo `try_files $uri /index.html`. Medido em app-dev: /ready " +
			"devolvia 200 HTML — a sonda que existe para reprovar nunca reprovava")
	}

	alts := m[1]
	for _, p := range []string{"v1", "ready", "health", "metrics"} {
		if !strings.Contains(alts, p) {
			t.Errorf("a guarda nao cobre %q (cobre %q). Cada prefixo de API ausente e uma rota "+
				"que volta a responder 200 com HTML", p, alts)
		}
	}
	if !strings.Contains(conf, "application/json") {
		t.Error("a guarda devolve 404 sem `application/json` — trocar 200-HTML por 404-HTML " +
			"conserta o status e mantem o corpo mentindo sobre o tipo")
	}
}

// A metade POSITIVA — sem ela, "404 em tudo" passaria e a SPA pararia de carregar.
//
// Uma SPA precisa que QUALQUER rota do cliente (`/overview`, `/billing/…`) devolva index.html,
// senao um refresh no meio do app vira 404. Este teste morre se alguem "consertar" o fallback
// removendo o try_files.
func TestSPAStillServesItsOwnClientRoutes(t *testing.T) {
	conf := nginxConf(t)

	if !strings.Contains(conf, "try_files $uri /index.html") {
		t.Fatal("o catch-all da SPA sumiu: sem ele um refresh em /overview devolve 404 e o " +
			"dashboard para de funcionar. O defeito do #342 e a API cair AQUI, nao a existencia " +
			"deste fallback")
	}
	// A guarda deve vir ANTES do catch-all: no nginx, regex location tem precedencia sobre
	// prefixo, entao funciona de qualquer forma — mas quem le concluiria o contrario.
	//
	// Indexar o arquivo cru NAO serve: os dois termos aparecem tambem na PROSA que explica o
	// defeito, e a primeira versao deste teste falhou por isso. Compara-se apenas DIRETIVAS.
	var directives []string
	for _, line := range strings.Split(conf, "\n") {
		if t := strings.TrimSpace(line); t != "" && !strings.HasPrefix(t, "#") {
			directives = append(directives, t)
		}
	}
	code := strings.Join(directives, "\n")
	if gi, ci := strings.Index(code, "return 404"), strings.Index(code, "try_files"); gi < 0 || gi > ci {
		t.Errorf("a guarda de API (pos %d) nao precede o catch-all (pos %d) nas diretivas", gi, ci)
	}
}
