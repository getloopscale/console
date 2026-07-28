// Package ci holds tests that assert properties of this repository's CI configuration.
//
// These are not tests of the product. They exist because some CI defects are only
// visible as a diff between two files that no compiler relates — and those defects
// are expensive: a wrong cosign identity silently accepts a foreign signature, and a
// vendored copy left behind quietly diverges from its origin forever.
package ci

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	publishPath      = "../../.github/workflows/publish.yml"
	vendoredPath     = "../../.github/workflows/build-publish.yml"
	localRef         = "uses: ./.github/workflows/build-publish.yml"
	upstreamRef      = "uses: usetheodev/theo/.github/workflows/build-publish.yml"
	expectedIdentity = `^https://github\.com/usetheoai/theo-cloud/\.github/workflows/build-publish\.yml@`
)

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return string(b)
}

// The vendored copy and the reference that points at it must move together.
//
// ROADMAP_CICD CM1 vendored `build-publish.yml` into this repo because a private
// reusable workflow is shareable only within the same owner, and this repo is moving
// to `usetheoai` while `theo` stays in `usetheodev`. The copy is deliberate debt with
// an expiry: when `theo` migrates, the file is deleted and `publish.yml` goes back to
// the upstream reference.
//
// This test is the alarm against that expiry being forgotten. Deleting the copy
// without restoring the upstream reference — or restoring the reference while leaving
// a stale copy behind — fails here, in the same commit, instead of at the next release.
func TestPublishWorkflow_VendoredCopyAndReferenceAgree(t *testing.T) {
	publish := read(t, publishPath)
	_, statErr := os.Stat(vendoredPath)
	vendoredExists := statErr == nil

	usesLocal := strings.Contains(publish, localRef)
	usesUpstream := strings.Contains(publish, upstreamRef)

	switch {
	case usesLocal && usesUpstream:
		t.Fatal("publish.yml references BOTH the vendored copy and the upstream reusable; exactly one must be active")
	case !usesLocal && !usesUpstream:
		t.Fatalf("publish.yml references neither %q nor %q — the build-publish call was lost", localRef, upstreamRef)
	case usesLocal && !vendoredExists:
		t.Fatalf("publish.yml calls the vendored copy but %s does not exist: the workflow dies at PARSE "+
			"(\"workflow was not found\") with zero jobs created", vendoredPath)
	case usesUpstream && vendoredExists:
		t.Fatalf("publish.yml is back on the upstream reusable but the vendored copy still exists at %s. "+
			"Delete it — a leftover copy diverges silently and nothing else will flag it", vendoredPath)
	}
}

// The cosign identity regexp is a confused-deputy guard, not a label.
//
// Keyless signing derives the certificate identity from repo + workflow path. If this
// regexp points at another repository, `cosign verify` does not merely fail — it
// ACCEPTS a signature produced by that other repository's workflow. The copy came from
// `theo-memory`, so this is the exact mistake the copy invites.
func TestVendoredBuildPublish_CosignIdentityPointsAtThisRepo(t *testing.T) {
	if _, err := os.Stat(vendoredPath); err != nil {
		t.Skip("no vendored copy: nothing to pin (upstream reusable owns its own identity)")
	}
	vendored := read(t, vendoredPath)

	if !strings.Contains(vendored, expectedIdentity) {
		t.Errorf("vendored build-publish.yml does not pin the cosign identity to this repo.\nwant substring: %s", expectedIdentity)
	}
	for _, foreign := range []string{"usetheoai/theo-memory", "usetheodev/theo/"} {
		if strings.Contains(vendored, "certificate-identity-regexp") &&
			strings.Contains(vendored, foreign+"/.github/workflows/build-publish") {
			t.Errorf("cosign identity still points at %s — a signature from that repo's workflow would be accepted here", foreign)
		}
	}
}

// A run in `usetheoai` gets a GITHUB_TOKEN scoped to that org and has no push rights
// on `ghcr.io/usetheodev`. Publishing would fail with 403 at the very last step, after
// the whole build. Cheap to assert, expensive to discover.
func TestVendoredBuildPublish_RegistryMatchesTargetOrg(t *testing.T) {
	if _, err := os.Stat(vendoredPath); err != nil {
		t.Skip("no vendored copy")
	}
	vendored := read(t, vendoredPath)

	if !strings.Contains(vendored, `default: "ghcr.io/usetheoai"`) {
		t.Error("vendored build-publish.yml does not default the registry to ghcr.io/usetheoai")
	}

	// Comments are excluded on purpose: the header explains WHY `ghcr.io/usetheodev`
	// must not be used, and matching the whole file would flag that explanation as
	// the defect it warns about.
	for i, line := range strings.Split(vendored, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if strings.Contains(line, "ghcr.io/usetheodev") {
			t.Errorf("line %d still targets ghcr.io/usetheodev — a usetheoai run cannot push there (403): %s", i+1, strings.TrimSpace(line))
		}
	}
}
