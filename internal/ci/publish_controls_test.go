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
	files, err := filepath.Glob("../../.github/workflows/*.yml")
	if err != nil || len(files) == 0 {
		t.Fatalf("globbing workflows: %v (%d files)", err, len(files))
	}

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
	body := readWF(t, "build-publish.yml")

	re := regexp.MustCompile(`(?m)^\s*trivyignores:\s*(\S+)\s*$`)
	m := re.FindStringSubmatch(body)
	if m == nil {
		return // no allowlist declared — nothing to point at, nothing to break
	}

	named := m[1]
	if _, err := os.Stat(filepath.Join("../..", named)); err != nil {
		t.Fatalf("build-publish.yml declares `trivyignores: %s` but that file does not exist: %v\n"+
			"trivy exits 1 before scanning anything, so the gate reports a vulnerability failure "+
			"for a scan that never ran", named, err)
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

	files, err := filepath.Glob("../../.github/workflows/*.yml")
	if err != nil || len(files) == 0 {
		t.Fatalf("nenhum workflow encontrado: %v", err)
	}

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
