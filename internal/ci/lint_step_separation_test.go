// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package ci

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// B-273 — a gate must not report "your code is wrong" when nothing analysed it.
//
// job 94258930430, 2026-08-12, step `Lint`:
//
//	Installing golangci-lint binary v2.12.2...
//	Downloading binary https://github.com/golangci/golangci-lint/releases/download/v2.12.2/...
//	socket hang up          (x3, then the action gives up)
//	##[error]Failed to run: Error: socket hang up, Error: socket hang up
//
// `golangci-lint run ./...` locally exits with 0 issues. The BINARY did not come down. One step
// named `Lint` held both the acquisition and the analysis, so its red said nothing about which
// one failed, and reading the raw log was the only way to find out.
//
// This is the same class the B-270 investigation named across four defects at once: a check that
// DID NOT HAPPEN being reported as one that happened and failed. The cost is not the red — it is
// that a red unable to distinguish "your code is broken" from "nothing ran" spends the time of
// whoever investigates, every time.
//
// Deliberately NOT solved with `continue-on-error`: a gate that ignores its own failure is worse
// than the flake.

func readQualityWorkflow(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean(filepath.Join("../../.github/workflows", "quality.yml")))
	if err != nil {
		t.Fatalf("reading quality.yml: %v", err)
	}
	return string(b)
}

func TestLintAcquisitionIsASeparateNamedStepFromAnalysis(t *testing.T) {
	wf := readQualityWorkflow(t)

	acquisition := "- name: Install golangci-lint"
	if !strings.Contains(wf, acquisition) {
		t.Errorf("no step named %q — a download failure is indistinguishable from a lint finding", acquisition)
	}
	analysis := "- name: Lint (analysis)"
	if !strings.Contains(wf, analysis) {
		t.Errorf("no step named %q — the analysis must be able to fail on its own", analysis)
	}
	if strings.Index(wf, acquisition) > strings.Index(wf, analysis) {
		t.Error("the install step must come before the analysis step")
	}
}

func TestLintBinaryComesFromTheModuleProxyNotAGitHubRelease(t *testing.T) {
	// The download that hung was a GitHub release asset. The module proxy is a different path,
	// already warmed by `actions/setup-go`'s module cache, and it is where the rest of this job's
	// dependencies already come from — so the failure mode is one the job already handles.
	wf := readQualityWorkflow(t)

	if !strings.Contains(wf, "go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@") {
		t.Error("golangci-lint is not installed from the module proxy")
	}
	if strings.Contains(wf, "golangci/golangci-lint-action@") {
		t.Error("the release-asset action is still in use — the download path that hung is still the one taken")
	}
}

func TestTheLintGateDoesNotSwallowItsOwnFailure(t *testing.T) {
	// The fix B-273 forbids by name. A gate that passes when it could not run is decoration.
	wf := readQualityWorkflow(t)
	for _, escape := range []string{"continue-on-error: true", "|| true"} {
		if strings.Contains(wf, escape) {
			t.Errorf("quality.yml contains %q — a gate that ignores its own failure is worse than the flake", escape)
		}
	}
}

func TestTheVersionIsStillPinned(t *testing.T) {
	// The reason the action was pinned in the first place: an unpinned resolve let a new v2.11.3
	// break theo-traefik-mcp with no code change. Changing the acquisition path must not lose that.
	wf := readQualityWorkflow(t)
	if !strings.Contains(wf, "golangci-lint@v2.12.2") {
		t.Error("the golangci-lint version is no longer pinned to v2.12.2")
	}
}

func TestTheLintBinaryIsBuiltWithTheRepositorysOwnGoVersion(t *testing.T) {
	// Found by running the first version of this fix instead of trusting it.
	//
	// `go install` builds golangci-lint with the toolchain ITS module requires (go1.25), and the
	// resulting binary then refuses the target: "the Go language version (go1.25) used to build
	// golangci-lint is lower than the targeted Go version (1.26.1)". That is the same floor the
	// version comment already described — the action never hit it because it downloaded a binary
	// somebody else had built with a newer Go.
	//
	// Without GOTOOLCHAIN the acquisition succeeds and the analysis fails on a config error, which
	// is the exact confusion this item exists to remove, reintroduced one layer down.
	//
	// The expected toolchain is read from go.mod, not hardcoded: a Go bump that forgets this step
	// fails here instead of in CI.
	wf := readQualityWorkflow(t)
	want := "GOTOOLCHAIN=go" + goModGoVersion(t)
	if !strings.Contains(wf, want+" ") {
		t.Errorf("the install step does not force the build toolchain (%s absent) — the binary will refuse the target", want)
	}
}

// goModGoVersion returns the version on the `go` directive of the repository's go.mod.
func goModGoVersion(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean("../../go.mod"))
	if err != nil {
		t.Fatalf("reading go.mod: %v", err)
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), "go "); ok {
			return strings.TrimSpace(v)
		}
	}
	t.Fatal("go.mod has no `go` directive")
	return ""
}

func TestNodeModulesIsExcludedFromTheGoLint(t *testing.T) {
	// The first real run of this gate — the first ever, since the binary had never arrived —
	// reported two govet findings in dashboard/node_modules/flatted/golang/pkg/flatted/flatted.go.
	// `flatted` is an npm package that happens to ship a Go file, and `go list ./...` walks into it
	// because it sits under the module root. Nobody here can fix it.
	b, err := os.ReadFile(filepath.Clean("../../.golangci.yml"))
	if err != nil {
		t.Fatalf("no .golangci.yml: %v", err)
	}
	if !strings.Contains(string(b), "dashboard/node_modules") {
		t.Error("node_modules is not excluded — the gate reports findings in an npm dependency")
	}
}
