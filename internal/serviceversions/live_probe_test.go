package serviceversions

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// Instrumento de MEDICAO do painel, legivel por programa.
//
// O painel `/status` e o unico instrumento de observabilidade da frota e ele nao pode
// ser interrogado: `/v1/dashboard/status/versions` exige Bearer, o container e
// distroless (sem exec) e a metrica existente e um counter que so materializa serie
// depois que um humano autenticado abre a tela (usetheodev/theo-workspace#37).
//
// Este teste fecha essa lacuna para a verificacao pontual: roda o COLETOR REAL — o
// mesmo `probe` que o handler usa, nao um caminho paralelo que divergiria — contra
// alvos passados por env, e imprime o veredito que o painel exibiria.
//
//	THEO_LIVE_PROBE_TARGETS='theo-traefik-mcp=http://localhost:18090,theo-rag=http://localhost:18082' \
//	  go test ./internal/serviceversions/ -run TestLiveProbe -v
//
// Sem a variavel ele e SKIP, entao CI e maquina de desenvolvimento nao dependem de
// nenhum servico no ar.
func TestLiveProbe(t *testing.T) {
	spec := os.Getenv("THEO_LIVE_PROBE_TARGETS")
	if spec == "" {
		t.Skip("THEO_LIVE_PROBE_TARGETS nao definida — instrumento de medicao pontual, nao gate de CI")
	}

	targets := parseLiveTargets(t, spec)
	client := &http.Client{Timeout: 10 * time.Second}

	t.Logf("%-22s %-16s %s", "SERVICE", "STATE", "VERSION / REASON")
	for _, tgt := range targets {
		got := probe(context.Background(), client, tgt, 2*time.Second, time.Now)

		detail := got.reason
		if got.State() == StateOK {
			detail = got.version
			if got.builtAt != "" {
				detail += "  built=" + got.builtAt
			}
		}
		t.Logf("%-22s %-16s %s", got.Name(), got.State(), detail)

		// O unico invariante que este instrumento IMPOE, e o mais importante: `ok`
		// exige versao presente. Se algum dia um alvo sair `ok` sem versao, o painel
		// esta afirmando saude que ninguem mediu — e e' justamente a classe de defeito
		// que motivou o estado `no_provenance`.
		if got.State() == StateOK && got.version == "" {
			t.Errorf("%s saiu ok SEM versao — o painel afirmaria saude nao medida", got.Name())
		}
	}
}

// parseLiveTargets le `nome=url,nome=url`. Falha alto num spec malformado em vez de
// sondar silenciosamente menos alvos do que o operador pediu — um instrumento de
// medicao que mede menos do que dizem e pior que nenhum.
func parseLiveTargets(t *testing.T, spec string) []Target {
	t.Helper()

	var out []Target
	for _, pair := range strings.Split(spec, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		name, url, ok := strings.Cut(pair, "=")
		if !ok || strings.TrimSpace(name) == "" || strings.TrimSpace(url) == "" {
			t.Fatalf("THEO_LIVE_PROBE_TARGETS malformada em %q — esperado nome=url[,nome=url]", pair)
		}
		out = append(out, Target{Name: strings.TrimSpace(name), BaseURL: strings.TrimSpace(url)})
	}
	if len(out) == 0 {
		t.Fatal("THEO_LIVE_PROBE_TARGETS definida mas sem alvo algum")
	}
	return out
}
