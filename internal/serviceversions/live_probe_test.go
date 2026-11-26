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
// depois que um humano autenticado abre a tela (getloopscale/loopscale-workspace#37).
//
// Este teste fecha essa lacuna para a verificacao pontual: roda o COLETOR REAL — o
// mesmo `probe` que o handler usa, nao um caminho paralelo que divergiria — contra
// alvos passados por env, e imprime o veredito que o painel exibiria.
//
//	LOOPSCALE_LIVE_PROBE_TARGETS='loopmcp=http://localhost:18090,looprag=http://localhost:18082' \
//	  go test ./internal/serviceversions/ -run TestLiveProbe -v
//
// Sem a variavel ele e SKIP, entao CI e maquina de desenvolvimento nao dependem de
// nenhum servico no ar.
//
// # DE ONDE RODAR — isto nao e detalhe operacional, e parte do contrato
//
// O instrumento mede do lugar de onde e' executado, e um alvo inalcancavel DAQUI e
// indistinguivel de um alvo fora do ar. Rodado da maquina errada ele reporta a frota
// inteira como caida, com total conviccao e zero erro.
//
// Aconteceu na primeira execucao real (2026-08-02): rodado de uma estacao apontando
// para as portas do host remoto, devolveu `unreachable / connection refused` nos OITO
// alvos. Parar ali teria reportado a plataforma inteira fora do ar — quando o defeito
// era o ponto de observacao. E' o MESMO defeito do `loop-runtime`
// (getloopscale/loopscale-workspace#38): alvo correto, ponto de observacao errado.
//
// Rode de onde o COLETOR roda — o host que serve o painel — ou por tunel SSH ate' ele.
// O guard abaixo detecta o padrao e diz as duas leituras possiveis, porque daqui elas
// sao indistinguiveis e escolher uma seria inventar.
func TestLiveProbe(t *testing.T) {
	spec := os.Getenv("LOOPSCALE_LIVE_PROBE_TARGETS")
	if spec == "" {
		t.Skip("LOOPSCALE_LIVE_PROBE_TARGETS nao definida — instrumento de medicao pontual, nao gate de CI")
	}

	targets := parseLiveTargets(t, spec)
	client := &http.Client{Timeout: 10 * time.Second}

	t.Logf("%-22s %-16s %s", "SERVICE", "STATE", "VERSION / REASON")
	transportDown := 0
	for _, tgt := range targets {
		got := probe(context.Background(), client, tgt, 2*time.Second, time.Now)
		if got.State() == StateUnreachable &&
			(got.reason == "connection refused" || got.reason == "dns failure" || got.reason == "transport error") {
			transportDown++
		}

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

	// TODOS os alvos mudos na camada de transporte tem DUAS leituras, e daqui elas sao
	// indistinguiveis. Escolher uma seria inventar; nao dizer nada deixaria o operador
	// escolher a errada — que foi o que quase aconteceu na primeira execucao real.
	//
	// Nao falha o teste: uma frota genuinamente fora do ar e' um resultado legitimo do
	// instrumento, nao um defeito dele.
	if transportDown == len(targets) && len(targets) > 1 {
		t.Logf("")
		t.Logf("  !! os %d alvos falharam no TRANSPORTE (refused/dns/transport). Duas leituras:", transportDown)
		t.Logf("     (a) a frota esta' fora do ar;")
		t.Logf("     (b) voce esta' medindo do lugar errado — daqui as duas sao IDENTICAS.")
		t.Logf("     Confirme o ponto de observacao antes de reportar (a): rode de onde o")
		t.Logf("     coletor roda, ou por tunel ate' ele. Precedente: 8/8 assim em 2026-08-02,")
		t.Logf("     e a causa era (b).")
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
			t.Fatalf("LOOPSCALE_LIVE_PROBE_TARGETS malformada em %q — esperado nome=url[,nome=url]", pair)
		}
		out = append(out, Target{Name: strings.TrimSpace(name), BaseURL: strings.TrimSpace(url)})
	}
	if len(out) == 0 {
		t.Fatal("LOOPSCALE_LIVE_PROBE_TARGETS definida mas sem alvo algum")
	}
	return out
}
