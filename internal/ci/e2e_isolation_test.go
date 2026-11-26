// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package ci

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"

	yaml "go.yaml.in/yaml/v3"
	"strings"
	"testing"
)

// MEDIDO no run 30723256775 (2026-08-01), e a causa NAO e a que a issue #333 supunha.
//
// A issue atribuiu a falha a "duas execucoes concorrentes" — dois PRs disputando o host.
// A evidencia diz outra coisa:
//
//   e2e       started 23:24:15Z  runner=blacksmith-01kyzt8q0y...  FALHOU 23:24:40Z (bind 55432)
//   e2e-edge  started 23:24:15Z  runner=blacksmith-01kyzt2k7c...  subiu pg-cloud 23:24:49Z, OK
//   ambos     Machine name: ip-172-31-64-123          <-- MESMO host, daemon Docker compartilhado
//
// Nenhum outro job e2e estava ativo naquele minuto (os anteriores fecharam 23:19). Quem colidiu
// foram os DOIS JOBS DO MESMO RUN: `e2e` e `e2e-edge` comecam no mesmo segundo, e o `e2e-edge`
// carrega o compose base + o overlay, entao ele tambem sobe `pg-cloud` na mesma porta fixa, sob o
// mesmo nome de projeto.
//
// Isso torna o defeito muito mais frequente do que "dois PRs coincidirem": basta a Blacksmith
// colocar os dois jobs irmaos no mesmo host, o que e o caso comum. E abre um segundo modo de
// falha, pior: `teardown()` roda `compose down -v --remove-orphans` no MESMO nome de projeto —
// um job pode apagar a pilha do irmao no meio do teste, e o resultado se parece com bug de
// produto.
//
// Estes testes travam as duas propriedades que fecham a classe: identidade de pilha por job e
// portas que nao sao literais compartilhados.

func e2eRunSH(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("../../tests/e2e/run.sh"))
	if err != nil {
		t.Fatalf("lendo tests/e2e/run.sh: %v", err)
	}
	return string(b)
}

// TestE2EComposeProjectIsPerJob — o nome do projeto compose e a identidade da pilha: containers,
// rede e volumes derivam dele, e `compose down` age sobre ele. Constante = dois jobs no mesmo
// daemon sao a MESMA pilha para o Docker.
func TestE2EComposeProjectIsPerJob(t *testing.T) {
	body := e2eRunSH(t)

	re := regexp.MustCompile(`docker compose -p (\S+)`)
	m := re.FindStringSubmatch(body)
	if m == nil {
		t.Fatal("tests/e2e/run.sh nao invoca `docker compose -p <projeto>` — sem nome de projeto " +
			"explicito o compose deriva do nome do diretorio, que e identico nos dois jobs")
	}
	if !strings.Contains(m[1], "$") {
		t.Errorf("o projeto compose e o literal %q. Dois jobs no mesmo daemon (medido: `e2e` e "+
			"`e2e-edge` no host ip-172-31-64-123) viram a MESMA pilha: disputam containers e "+
			"o `compose down -v` de um apaga o do outro no meio do teste", m[1])
	}
}

// TestE2EDumpStepsUseTheSameProjectAsTheHarness — os passos de dump em ci.yml repetem o `-p` a
// mao. Se o harness passa a variar o projeto e o dump nao, o dump fica olhando uma pilha que nao
// existe e o log de falha vem VAZIO — trocariamos uma falha ruidosa por uma muda, que e pior.
func TestE2EDumpStepsUseTheSameProjectAsTheHarness(t *testing.T) {
	body := readWF(t, "ci.yml")

	for i, line := range strings.Split(body, "\n") {
		if !strings.Contains(line, "docker compose -p ") {
			continue
		}
		if strings.Contains(line, "$") {
			continue // interpola: acompanha o harness
		}
		t.Errorf("ci.yml:%d fixa o projeto compose a mao:\n  %s\n"+
			"o harness escolhe o projeto por job; um dump preso ao nome antigo devolve log "+
			"vazio exatamente quando ele e mais necessario", i+1, strings.TrimSpace(line))
	}
}

// TestE2EHostPortsAreNotSharedLiteralsInCI — a porta e o recurso realmente disputado. Um literal
// como 55432 e o mesmo numero nos dois jobs; o primeiro a ligar vence e o segundo morre no setup,
// ANTES de qualquer teste rodar.
//
// Localmente o literal e desejavel (o dev faz `psql localhost:55432`), entao o que este teste
// exige nao e a remocao do default e sim a EXISTENCIA de um caminho dinamico e o seu uso quando
// o ambiente e de CI.
func TestE2EHostPortsAreNotSharedLiteralsInCI(t *testing.T) {
	body := e2eRunSH(t)

	if !strings.Contains(body, "free_port") {
		t.Fatal("tests/e2e/run.sh nao tem alocador de porta livre. Com defaults fixos, dois jobs " +
			"no mesmo host pedem a mesma porta e o segundo morre no setup (run 30723256775)")
	}
	if !regexp.MustCompile(`GITHUB_ACTIONS|CI[^A-Z_]`).MatchString(body) {
		t.Error("o alocador existe mas nada o liga ao ambiente de CI — um caminho dinamico que " +
			"nunca roda em CI nao fecha o defeito medido")
	}
}

// TestE2EHarnessFailureIsDistinguishableFromTestFailure — o pedido explicito da #333, e a parte
// que impede a proxima ocorrencia de ser lida como "flaky, re-roda". O job morreu no setup: a
// saida precisa dizer isso com codigo proprio, nao so com a mesma prosa vermelha de um teste que
// quebrou.
func TestE2EHarnessFailureIsDistinguishableFromTestFailure(t *testing.T) {
	body := e2eRunSH(t)

	if !strings.Contains(body, "E2E_EXIT_HARNESS") {
		t.Error("tests/e2e/run.sh nao declara codigo de saida proprio para falha de HARNESS. " +
			"Hoje subir-nao-deu e teste-quebrou saem iguais, e foi por isso que um PR foi " +
			"mergeado com este check vermelho: o leitor concluiu flaky sem abrir o log")
	}
}

// TestE2ELocalProjectMatchesTheMakefileTeardown — o `make e2e-down` do Makefile aponta para um
// nome de projeto LITERAL. Se o harness variasse o projeto tambem localmente (por PID, digamos),
// `make e2e-up` deixaria uma pilha que `make e2e-down` nao encontra: teardown que diz ter feito
// e nao fez, com volumes de Postgres orfaos acumulando no disco do dev.
//
// Foi um defeito que a primeira versao desta correcao introduziu. Ele fica aqui porque o mesmo
// erro e facil de reintroduzir na proxima vez que alguem mexer no isolamento.
// stackIdentity EXECUTA o bloco real de run.sh (entre os marcadores) com o ambiente dado e
// devolve as variaveis resolvidas. Comportamental de proposito: um grep por string passaria numa
// implementacao que declara o literal no ramo errado; isto so passa se o valor RESOLVIDO estiver
// certo.
func stackIdentity(t *testing.T, env ...string) map[string]string {
	t.Helper()
	body := e2eRunSH(t)
	const begin, end = "# --- BEGIN e2e-stack-identity", "# --- END e2e-stack-identity"
	i, j := strings.Index(body, begin), strings.Index(body, end)
	if i < 0 || j < 0 {
		t.Fatal("run.sh perdeu os marcadores e2e-stack-identity — o bloco nao pode mais ser exercitado")
	}

	dir := t.TempDir()
	frag := filepath.Join(dir, "frag.sh")
	if err := os.WriteFile(frag, []byte(body[i:j]), 0o600); err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("bash", "-c",
		`set -euo pipefail; source "$1"; for v in E2E_PROJECT E2E_PG_CLOUD_PORT E2E_KRATOS_PUBLIC_PORT E2E_EDGE_PORT; do printf '%s=%s\n' "$v" "${!v}"; done`,
		"bash", frag)
	cmd.Env = append(os.Environ(), env...)
	// Um ambiente de CI herdado tornaria o caso "local" impossivel de exercitar.
	cmd.Env = append(cmd.Env, "E2E_PROJECT=", "E2E_PG_CLOUD_PORT=", "E2E_KRATOS_PUBLIC_PORT=", "E2E_EDGE_PORT=")
	cmd.Env = append(cmd.Env, env...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("executando o bloco de identidade: %v\n%s", err, out)
	}
	got := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if k, v, ok := strings.Cut(line, "="); ok {
			got[k] = v
		}
	}
	return got
}

// TestE2ELocalProjectMatchesTheMakefileTeardown — o `make e2e-down` aponta para um projeto
// LITERAL. Se o harness variasse o projeto tambem localmente (por PID, digamos), `make e2e-up`
// deixaria uma pilha que `make e2e-down` nao encontra: teardown que reporta sucesso sem fazer
// nada, com volumes de Postgres orfaos acumulando no disco do dev.
//
// Foi um defeito que a PRIMEIRA versao desta correcao introduziu, pego por este teste antes de
// sair do galho. Fica aqui porque o mesmo erro e facil de reintroduzir.
func TestE2ELocalProjectMatchesTheMakefileTeardown(t *testing.T) {
	mk, err := os.ReadFile("../../Makefile")
	if err != nil {
		t.Fatalf("lendo Makefile: %v", err)
	}
	m := regexp.MustCompile(`docker compose -p (\S+)`).FindStringSubmatch(string(mk))
	if m == nil {
		t.Fatal("Makefile nao declara projeto compose para os alvos e2e")
	}

	got := stackIdentity(t, "GITHUB_ACTIONS=", "E2E_DYNAMIC_PORTS=0")
	if got["E2E_PROJECT"] != m[1] {
		t.Errorf("modo local resolve projeto=%q; `make e2e-down` derruba %q.\n"+
			"`make e2e-up` subiria uma pilha que o teardown nao acha — sucesso reportado sem "+
			"fazer nada, e volumes orfaos crescendo em silencio", got["E2E_PROJECT"], m[1])
	}
	if got["E2E_PG_CLOUD_PORT"] != "55432" {
		t.Errorf("modo local devia manter a porta previsivel 55432 (o dev faz `psql localhost:55432` "+
			"na pilha de pe); resolveu %q", got["E2E_PG_CLOUD_PORT"])
	}
}

// TestE2ETwoCIJobsGetDisjointStacks — a prova direta do defeito da #333: dois jobs do mesmo run,
// no mesmo daemon, nao podem coincidir em NADA que o Docker use para identificar ou ligar.
//
// Uma implementacao errada que morre aqui: manter o projeto/porta constantes e apenas renomear
// containers, ou derivar o id so de GITHUB_RUN_ID (identico nos dois jobs do mesmo run) — foi
// justamente essa a tentacao, e ela reproduziria a colisao medida.
func TestE2ETwoCIJobsGetDisjointStacks(t *testing.T) {
	a := stackIdentity(t, "GITHUB_ACTIONS=true", "GITHUB_JOB=e2e", "GITHUB_RUN_ATTEMPT=1")
	b := stackIdentity(t, "GITHUB_ACTIONS=true", "GITHUB_JOB=e2e-edge", "GITHUB_RUN_ATTEMPT=1")

	for _, k := range []string{"E2E_PROJECT", "E2E_PG_CLOUD_PORT", "E2E_KRATOS_PUBLIC_PORT", "E2E_EDGE_PORT"} {
		if a[k] == b[k] {
			t.Errorf("%s coincide entre os dois jobs (%q). Foi exatamente isto que derrubou o run "+
				"30723256775: os dois caem no mesmo host e o segundo morre no setup, antes de "+
				"qualquer teste rodar", k, a[k])
		}
	}
}

// TestCloudHealthcheckRespectsTheProbeVerdict — #338. Uma sonda que reprova nao vale nada se
// quem a consome ignora o veredito.
//
// O /health passou a devolver 503 quando o servico nao consegue servir. Isso so tem efeito
// porque o healthcheck usa `wget -qO-`, que sai != 0 em status de erro. Trocar por `curl` sem
// `-f`, ou acrescentar `|| true`, devolveria a sonda ao estado que o #338 descreve: verde sobre
// um servico degradado — e o diff pareceria inofensivo.
func TestCloudHealthcheckRespectsTheProbeVerdict(t *testing.T) {
	b, err := os.ReadFile("../../tests/e2e/docker-compose.e2e.yaml")
	if err != nil {
		t.Fatalf("lendo o compose do e2e: %v", err)
	}
	var compose struct {
		Services map[string]struct {
			Healthcheck struct {
				Test []string `yaml:"test"`
			} `yaml:"healthcheck"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal(b, &compose); err != nil {
		t.Fatalf("compose do e2e: %v", err)
	}

	test := strings.Join(compose.Services["loop-console"].Healthcheck.Test, " ")
	if test == "" {
		t.Fatal("o servico loop-console perdeu o healthcheck — a sonda existe e ninguem a le")
	}
	if !strings.Contains(test, "/ready") {
		t.Errorf("o healthcheck tem de sondar /ready (readiness), nao /health: %q", test)
	}
	if strings.Contains(test, "|| true") || strings.Contains(test, "|| exit 0") {
		t.Errorf("o healthcheck engole o veredito da sonda: %q", test)
	}
	// `wget` sai != 0 em status de erro; `curl` NAO, a menos que receba -f/--fail.
	if strings.Contains(test, "curl") && !strings.Contains(test, "-f") {
		t.Errorf("`curl` sem `-f` sai 0 mesmo em 503 — a sonda volta a nao significar nada: %q", test)
	}
}
