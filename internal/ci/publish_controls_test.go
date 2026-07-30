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

	"gopkg.in/yaml.v3"
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
