package ci

// T4.1 — the controls exist and are switched off exactly where production consumes them.
//
// Measured: `trivy` defaults to false at build-publish.yml:41 and publish.yml never passes it, so
// the CVE gate runs on NO channel, release included. `sign`/`verify` are gated on IS_TAG, while the
// production host pulls :develop. `provenance` receives the literal 'false' on the develop path,
// which switches OFF buildx's own mode=min default — the production channel ends up with LESS
// provenance than an unconfigured build.
//
// EC-3 decision: `trivy` and `sign` ship unconditionally on develop; `verify` stays tag-scoped.
// `cosign verify` resolves against Rekor/Fulcio AFTER the push, so a Sigstore outage would red a run
// whose image already published, and the reconciler would converge on an image the pipeline reports
// as failed. Signing is local to the run and carries no such dependency — the artifact stays
// verifiable by anyone, later.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

func readWF(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean(filepath.Join("../../.github/workflows", name)))
	if err != nil {
		t.Fatalf("reading %s: %v", name, err)
	}
	return string(b)
}

func TestDevelopChannelIsScannedAndSigned(t *testing.T) {
	wf := parsePublish(t)
	images, ok := wf.Jobs["images"]
	if !ok {
		t.Fatal("job `images` not found")
	}

	for _, key := range []string{"trivy", "sign"} {
		v, present := images.With[key]
		if !present {
			t.Errorf("images.with.%s is not passed; the reusable defaults it to false "+
				"(build-publish.yml:41), so the control runs on NO channel — release included", key)
			continue
		}
		s := strings.TrimSpace(strings.ToLower(fmt.Sprint(v)))
		if s == "false" || strings.Contains(s, "refs/tags") || strings.Contains(s, "is_tag") ||
			strings.Contains(s, "outputs.sign") {
			t.Errorf("images.with.%s = %q gates the control off the develop channel, which is what "+
				"production actually runs", key, s)
		}
	}
}

func TestCosignIdentityRegexpIsAnchored(t *testing.T) {
	body := readWF(t, "build-publish.yml")
	re := regexp.MustCompile(`--certificate-identity-regexp\s+'([^']+)'`)
	m := re.FindStringSubmatch(body)
	if m == nil {
		t.Fatal("no --certificate-identity-regexp found in build-publish.yml")
	}
	got := m[1]

	if !strings.HasSuffix(got, "$") {
		t.Errorf("identity regexp %q has no terminal anchor: it matches any SUFFIX, so a signature "+
			"produced by a DIFFERENT workflow in this repo would be accepted as this one's. "+
			"theo-memory records the same fix as its item #8.", got)
	}
	if !strings.Contains(got, "refs/") {
		t.Errorf("identity regexp %q does not constrain the ref; develop and tags must BOTH be "+
			"expressible, or signing :develop makes verify unsatisfiable", got)
	}
}

func TestProvenanceIsNotExplicitlyDisabled(t *testing.T) {
	body := readWF(t, "build-publish.yml")
	if strings.Contains(body, `|| 'false' }}`) {
		t.Error("`provenance` passes the literal 'false' on the non-sign path, which switches OFF " +
			"buildx's own mode=min default — the develop channel would carry LESS provenance than " +
			"an unconfigured build")
	}
}

// T5.2 — the provenance build-arg must reach BOTH build steps.
//
// build-publish.yml:130 claims the pushed image is "cache-identical to the scanned image". A
// build-arg changes the final layer's digest, so passing it to the push build but not the
// scan build silently voids that claim: Trivy would scan a different artifact than ships.
func TestProvenanceBuildArgsReachBothBuildSteps(t *testing.T) {
	body := readWF(t, "build-publish.yml")

	var wf struct {
		Jobs map[string]struct {
			Steps []struct {
				Name string            `yaml:"name"`
				Uses string            `yaml:"uses"`
				With map[string]string `yaml:"with"`
			} `yaml:"steps"`
		} `yaml:"jobs"`
	}
	if err := yaml.Unmarshal([]byte(body), &wf); err != nil {
		t.Fatalf("parsing build-publish.yml: %v", err)
	}

	builds := 0
	for _, job := range wf.Jobs {
		for _, s := range job.Steps {
			if !strings.HasPrefix(s.Uses, "docker/build-push-action@") {
				continue
			}
			builds++
			args := s.With["build-args"]
			for _, want := range []string{"GIT_SHA", "BUILT_AT", "VERSION"} {
				if !strings.Contains(args, want) {
					t.Errorf("build step %q does not pass %s; the scanned and the pushed image "+
						"would differ, voiding the cache-identity claim at build-publish.yml:130",
						s.Name, want)
				}
			}
		}
	}
	if builds < 2 {
		t.Fatalf("expected both the scan build and the push build, found %d", builds)
	}
}

// T7.2 — every job that CAN carry a timeout carries one.
//
// Measured: 12 of 13 jobs had none, on a PAID 8-vCPU fleet, so a hang bills the platform maximum of
// 6h. The slowest job in the audit window ran 98.9s, so a 15-minute cap is ~9x headroom and cannot
// produce a false red.
//
// `timeout-minutes` is NOT honored on a `uses:` job — it only works inside the reusable. Applying it
// to publish.yml's gate jobs would be silently inert, so those are skipped rather than "fixed".
func TestEveryNonReusableJobHasATimeout(t *testing.T) {
	files := workflowFiles(t)

	for _, f := range files {
		b, err := os.ReadFile(filepath.Clean(f))
		if err != nil {
			t.Fatalf("reading %s: %v", f, err)
		}
		var wf struct {
			Jobs map[string]struct {
				Uses    string `yaml:"uses"`
				Timeout int    `yaml:"timeout-minutes"`
			} `yaml:"jobs"`
		}
		if err := yaml.Unmarshal(b, &wf); err != nil {
			t.Fatalf("parsing %s: %v", f, err)
		}
		for name, job := range wf.Jobs {
			if job.Uses != "" {
				continue // inert on a `uses:` job
			}
			if job.Timeout == 0 {
				t.Errorf("%s job %q declares no timeout-minutes; a hang bills 6h of a paid 8-vCPU runner",
					filepath.Base(f), name)
			}
		}
	}
}

// MEDIUM-1 (review 2026-07-30) — an explicitly empty build-arg must not reach the linker.
//
// `--build-arg VERSION=` overrides the Dockerfile's `ARG VERSION=dev`; it does not fall back to it.
// Measured in review: the resulting binary reports version "", `normalizeUnknown("")` returns "",
// `OK()` degrades the row to Unreachable and the panel sits at `degraded` permanently — the exact
// failure the "dev" sentinel exists to prevent. The reusable advertises these inputs as optional
// with `default: ”`, so any future caller that omits them walks into it.
func TestProvenanceArgsCoerceEmptyToSentinels(t *testing.T) {
	b, err := os.ReadFile(filepath.Clean("../../Dockerfile"))
	if err != nil {
		t.Fatalf("reading Dockerfile: %v", err)
	}
	body := string(b)
	for arg, sentinel := range map[string]string{
		"VERSION": "dev", "GIT_SHA": "unknown", "BUILT_AT": "unknown",
	} {
		want := "${" + arg + ":-" + sentinel + "}"
		if !strings.Contains(body, want) {
			t.Errorf("Dockerfile passes %s without the %q coercion: an explicitly empty build-arg "+
				"would reach the linker and degrade the status row permanently", arg, want)
		}
	}
}

// The Trivy gate must not point at an ignore file that does not exist.
//
// Measured, run 30570111324: the gate died in 17ms with `ERROR: cannot find ignorefile
// '.trivyignore'` — the scan NEVER RAN. It failed closed, so nothing was published, which is the
// right outcome for the wrong reason: a reader seeing a red `images` job would look for a CVE that
// was never searched for.
//
// The invariant is two-sided on purpose. Either the input is absent (no allowlist — the state M22
// chose, since it fixed CVEs by upgrading rather than suppressing), or the file it names exists.
// Both halves are needed: dropping only the input would let someone re-add it later against a
// missing file, and creating only the file would leave an allowlist nobody asked for.
func TestTrivyIgnoreFileInputMatchesReality(t *testing.T) {
	// PARSEIA, nao grepa. O plano deste milestone proibe explicitamente a forma grep
	// ("a grep passes on a commented-out line") e este arquivo ja importa o parser. A regex
	// anterior ainda exigia o valor na MESMA linha: um `trivyignores:` escrito em bloco YAML
	// passaria como "nao declarado" — veredito vazio com um ignorefile de fato configurado,
	// que e precisamente o modo de falha silenciosa que este teste existe para impedir.
	var wf struct {
		Jobs map[string]struct {
			Steps []struct {
				Uses string         `yaml:"uses"`
				With map[string]any `yaml:"with"`
			} `yaml:"steps"`
		} `yaml:"jobs"`
	}
	if err := yaml.Unmarshal([]byte(readWF(t, "build-publish.yml")), &wf); err != nil {
		t.Fatalf("build-publish.yml: %v", err)
	}

	for job, j := range wf.Jobs {
		for i, st := range j.Steps {
			raw, ok := st.With["trivyignores"]
			if !ok {
				continue // chave ausente do mapa parseado: nada apontado, nada a quebrar
			}
			named := strings.TrimSpace(fmt.Sprintf("%v", raw))
			if named == "" {
				continue
			}
			if _, err := os.Stat(filepath.Join("../..", named)); err != nil {
				t.Fatalf("jobs.%s.steps[%d] declara `trivyignores: %s`, que nao existe: %v\n"+
					"o trivy sai 1 em ~17ms com `cannot find ignorefile` — o scan NAO RODA, e o "+
					"gate reporta falha de vulnerabilidade para uma varredura que nunca houve",
					job, i, named, err)
			}
		}
	}
}

// A security-upgrade layer that the build cache can serve is a security upgrade that stopped
// happening.
//
// MEASURED, run 30577983071 vs a local `--no-cache` build of the SAME Dockerfile against the SAME
// base:
//
//	CI (cache-from: type=gha)   4 HIGH  (c-ares 1.34.6-r0, libexpat 2.7.5-r0)
//	local --no-cache            0 HIGH
//
// The base image is not at fault: every candidate base carries those same CVEs, and every one lists
// the fix as available. `apk upgrade --no-cache` clears them — when it runs. In CI it did not,
// because nothing above that layer changes between releases, so buildkit served it from the GHA
// cache, frozen at whenever it was first built.
//
// The fix reuses machinery already plumbed for provenance: BUILT_AT is a per-run timestamp, so
// declaring `ARG BUILT_AT` immediately before the upgrade invalidates exactly that layer on every
// build, and nothing above it. No new mechanism (parsimony rung 4).
func TestSecurityUpgradeLayerCannotBeServedFromCache(t *testing.T) {
	for _, df := range []string{"dashboard/Dockerfile"} {
		b, err := os.ReadFile(filepath.Clean(filepath.Join("../..", df)))
		if err != nil {
			t.Fatalf("reading %s: %v", df, err)
		}
		body := string(b)

		idx := strings.Index(body, "apk upgrade")
		if idx < 0 {
			continue // no upgrade layer to protect
		}
		// Everything between the final FROM and the upgrade must contain a per-build ARG.
		lastFrom := strings.LastIndex(body[:idx], "\nFROM ")
		if lastFrom < 0 {
			t.Fatalf("%s: could not locate the stage containing `apk upgrade`", df)
		}
		preamble := body[lastFrom:idx]
		if !strings.Contains(preamble, "ARG BUILT_AT") {
			t.Errorf("%s: `apk upgrade` is not preceded by a per-build ARG in its own stage, so "+
				"buildkit serves it from cache and the upgrade silently stops applying. Measured: "+
				"4 HIGH in CI versus 0 on a --no-cache build of the same file", df)
		}
	}
}

// TestExternalActionsArePinnedBySHA — DoD do M22, item 6.
//
// Uma tag de action e MUTAVEL. `actions/checkout@v4` resolve para o que o dono do repositorio
// apontar hoje; quem controla a tag executa codigo arbitrario dentro de um job que tem
// `packages: write` e `id-token: write`. O SHA e imutavel: e a unica forma de o que rodou ontem
// ser o que roda amanha.
//
// `dorny/paths-filter` e o unico terceiro de fato — e e justamente ele que decide QUAIS imagens
// saem. Uma tag reapontada ali nao precisa nem sequer publicar nada: basta devolver um filtro
// vazio para que a entrega pare em silencio, com o run verde.
func TestExternalActionsArePinnedBySHA(t *testing.T) {
	sha40 := regexp.MustCompile(`^[0-9a-f]{40}$`)
	uses := regexp.MustCompile(`uses:\s*([^\s#]+)`)

	files := workflowFiles(t)

	for _, f := range files {
		body, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		for i, line := range strings.Split(string(body), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "#") {
				continue // comentario: a prosa deste repositorio cita `uses:` ao explicar a divida
			}
			m := uses.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			ref := m[1]
			if strings.HasPrefix(ref, "./") {
				continue // reusable local: versionado com este repositorio, nao ha tag a reapontar
			}
			at := strings.LastIndex(ref, "@")
			if at < 0 {
				t.Errorf("%s:%d: `uses: %s` sem versao alguma", filepath.Base(f), i+1, ref)
				continue
			}
			if !sha40.MatchString(ref[at+1:]) {
				t.Errorf("%s:%d: `uses: %s` esta preso a uma tag MUTAVEL. Fixe o SHA de 40 "+
					"hex (mantenha a tag no comentario ao lado para legibilidade)",
					filepath.Base(f), i+1, ref)
			}
		}
	}
}

// workflowFiles — o GitHub executa `.yml` E `.yaml`. Globar so uma extensao faz um workflow
// futuro nascer FORA de todo gate deste pacote, em silencio: o teste segue verde porque nunca
// olhou o arquivo. Hoje os 8 sao `.yml`; o invariante nao pode depender disso.
func workflowFiles(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, pat := range []string{"../../.github/workflows/*.yml", "../../.github/workflows/*.yaml"} {
		m, err := filepath.Glob(pat)
		if err != nil {
			t.Fatalf("glob %s: %v", pat, err)
		}
		out = append(out, m...)
	}
	if len(out) == 0 {
		t.Fatal("nenhum workflow encontrado")
	}
	return out
}

// TestGateAndImagesShareOneCondition — o `if:` que decide se os gates rodam esta copiado
// LITERALMENTE em quatro jobs. Se um deles divergir, `images` roda com um gate `skipped` e a
// imagem sai sem passar por ele: exatamente o que a auditoria de 2026-07-30 mediu 12 vezes.
//
// A direcao da falha hoje e fail-closed (sem `always()`, o `success()` implicito do `needs`
// vale), mas isso e propriedade da forma ATUAL. O que este teste trava e a forma: uma unica
// condicao, e `images` dependendo dos tres gates. `internal/ci` ja trava pin por SHA, timeout,
// ignorefile e camada de upgrade — nao travava justamente o mecanismo do gate.
func TestGateAndImagesShareOneCondition(t *testing.T) {
	var wf struct {
		Jobs map[string]struct {
			If string `yaml:"if"`
			// `needs:` aceita escalar OU lista em YAML, e este workflow usa as duas formas
			// (`needs: plan` nos gates, `needs: [plan, gate-ci, ...]` em images). Tipar como
			// []string quebra o parse — foi o que este teste encontrou na primeira execucao.
			Needs any `yaml:"needs"`
		} `yaml:"jobs"`
	}
	if err := yaml.Unmarshal([]byte(readWF(t, "publish.yml")), &wf); err != nil {
		t.Fatalf("publish.yml: %v", err)
	}

	gates := []string{"gate-ci", "gate-quality", "gate-sast"}
	want := strings.TrimSpace(wf.Jobs["images"].If)
	if want == "" {
		t.Fatal("jobs.images nao declara `if:` — o filtro de caminhos deixou de gatear a publicacao")
	}
	for _, g := range append(gates, "images") {
		if got := strings.TrimSpace(wf.Jobs[g].If); got != want {
			t.Errorf("jobs.%s tem `if:` diferente de jobs.images:\n  %s\n  %s\n"+
				"condicoes divergentes fazem um gate ser pulado enquanto `images` roda — "+
				"a imagem sai sem aquele gate", g, got, want)
		}
	}

	for _, g := range gates {
		if !slices.Contains(needsOf(wf.Jobs["images"].Needs), g) {
			t.Errorf("jobs.images.needs nao contem %q (tem %v). `needs` aborta o job ANTES de ele "+
				"comecar: sem ele nenhuma credencial de registry e adquirida e nao ha push parcial "+
				"a desfazer — sem `needs`, a imagem sai com o gate vermelho", g, wf.Jobs["images"].Needs)
		}
	}
}

// needsOf normaliza as duas formas que o YAML aceita para `needs:` — escalar e sequencia.
func needsOf(v any) []string {
	switch t := v.(type) {
	case string:
		return []string{t}
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			out = append(out, fmt.Sprintf("%v", e))
		}
		return out
	}
	return nil
}
