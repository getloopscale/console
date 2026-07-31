package ci

// Tests that pin two defects found by the 2026-07-30 devops audit in the scheduled drift workflow.
//
// They parse the YAML rather than grepping it. A `strings.Contains` for a token name passes on a
// commented-out line, on a line belonging to a different step, and on the very comment that explains
// why the token is wrong — all three of which exist in this repository.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

const e2eDriftPath = "../../.github/workflows/e2e-drift.yml"

// gomodTokenExpr is the only credential that can pull a package owned by a sibling repository.
// GHCR package access is a per-package ACL; `packages: read` in the workflow grants the run's
// GITHUB_TOKEN nothing on `ghcr.io/usetheoai/theo-memory`, which theo-cloud is not listed on.
// Measured: run 30527179585 fails with `Error response from daemon: denied`, while the same
// reference resolves from a host holding a user PAT. `.github/workflows/ci.yml:72-80` records the
// same finding, and commit f5ee627 fixed ci.yml's two e2e jobs — this workflow was missed.
const gomodTokenExpr = "${{ secrets.GOMOD_TOKEN }}"

type driftWorkflow struct {
	Jobs map[string]struct {
		Steps []struct {
			Name string            `yaml:"name"`
			Uses string            `yaml:"uses"`
			With map[string]string `yaml:"with"`
		} `yaml:"steps"`
	} `yaml:"jobs"`
}

func parseDrift(t *testing.T) driftWorkflow {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean(e2eDriftPath))
	if err != nil {
		t.Fatalf("reading %s: %v", e2eDriftPath, err)
	}
	var wf driftWorkflow
	if err := yaml.Unmarshal(b, &wf); err != nil {
		t.Fatalf("parsing %s: %v", e2eDriftPath, err)
	}
	return wf
}

func TestE2EDriftLoginUsesGomodToken(t *testing.T) {
	wf := parseDrift(t)

	var found int
	for jobName, job := range wf.Jobs {
		for _, step := range job.Steps {
			if !strings.HasPrefix(step.Uses, "docker/login-action@") {
				continue
			}
			found++
			if got := step.With["password"]; got != gomodTokenExpr {
				t.Errorf("job %q step %q: GHCR login password = %q, want %q\n"+
					"GITHUB_TOKEN has no ACL on a sibling repository's package, so the pull fails "+
					"with `denied` and the only automated drift detector never runs",
					jobName, step.Name, got, gomodTokenExpr)
			}
		}
	}
	if found == 0 {
		t.Fatal("no docker/login-action step found in e2e-drift.yml — the pull is unauthenticated")
	}
}

func TestE2EDriftLoopKeysMatchRealPackages(t *testing.T) {
	b, err := os.ReadFile(filepath.Clean(e2eDriftPath))
	if err != nil {
		t.Fatalf("reading %s: %v", e2eDriftPath, err)
	}
	body := string(b)

	// The drift loop reconstructs a registry path from the pair's KEY, so a stale key names a
	// repository that no longer exists. Measured: `ghcr.io/usetheoai/themory:develop` does not
	// resolve; `theo-memory` does. That leg reports `unreachable` forever and emits a permanent
	// false drift warning. Warning-only — it never fails the job — but a permanently wrong warning
	// trains people to ignore the channel.
	if strings.Contains(body, `"themory:$THEMORY_IMAGE"`) {
		t.Error(`loop key "themory" builds ghcr.io/usetheoai/themory, which no longer exists after ` +
			`the rename; the leg reports unreachable on every run`)
	}
	if !strings.Contains(body, `"theo-memory:$THEMORY_IMAGE"`) {
		t.Error(`expected the loop key to be "theo-memory:$THEMORY_IMAGE"`)
	}
}
