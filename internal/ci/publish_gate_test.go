package ci

// T3.1 — publish.yml's `images` job must not run unless the three gates are green.
//
// This is the milestone's critical finding: measured over the audit window, 12 commits published at
// least one production image while a test gate was red (17 image pushes total); 3daf3663 shipped two
// images with ci, quality AND security-sast all failing. The host converges :develop within ~5 min,
// so each went live.
//
// `needs:` is the mechanism, not an in-job early-exit step: `needs:` aborts the job BEFORE it
// starts, so no registry credential is acquired and there is no partial push to unwind.
//
// `workflow_run` is forbidden as the gate mechanism — three independent rejections in this
// workspace. It is asynchronous and `github.sha` becomes the PREVIOUS event's, which breaks the
// promotion guard's `compare/main...$SHA`.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

type publishWorkflow struct {
	Jobs map[string]struct {
		Needs any    `yaml:"needs"` // string or []string
		Uses  string `yaml:"uses"`
		If    string `yaml:"if"`
		With  map[string]any `yaml:"with"`
	} `yaml:"jobs"`
}

func needsList(v any) []string {
	switch t := v.(type) {
	case string:
		return []string{t}
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func parsePublish(t *testing.T) publishWorkflow {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean("../../.github/workflows/publish.yml"))
	if err != nil {
		t.Fatalf("reading publish.yml: %v", err)
	}
	var wf publishWorkflow
	if err := yaml.Unmarshal(b, &wf); err != nil {
		t.Fatalf("parsing publish.yml: %v", err)
	}
	return wf
}

var requiredGates = map[string]string{
	"gate-ci":      "./.github/workflows/ci.yml",
	"gate-quality": "./.github/workflows/quality.yml",
	"gate-sast":    "./.github/workflows/security-sast.yml",
}

func TestPublishImagesJobIsGated(t *testing.T) {
	wf := parsePublish(t)

	images, ok := wf.Jobs["images"]
	if !ok {
		t.Fatal("job `images` not found in publish.yml")
	}
	needs := needsList(images.Needs)

	for gate := range requiredGates {
		found := false
		for _, n := range needs {
			if n == gate {
				found = true
			}
		}
		if !found {
			t.Errorf("images.needs is missing %q — an image can be published while that gate is red", gate)
		}
	}
}

func TestGateJobsInvokeTheWorkflowsByWorkflowCall(t *testing.T) {
	wf := parsePublish(t)

	for gate, wantUses := range requiredGates {
		job, ok := wf.Jobs[gate]
		if !ok {
			t.Errorf("gate job %q is not defined", gate)
			continue
		}
		if job.Uses != wantUses {
			t.Errorf("%s.uses = %q, want %q — `workflow_run` is forbidden: it is asynchronous and "+
				"github.sha becomes the previous event's", gate, job.Uses, wantUses)
		}
		if !strings.Contains(job.If, "needs.plan.outputs.images") {
			t.Errorf("%s has no `if:` on plan.outputs.images — a docs-only push would run the full "+
				"gate and publish nothing, worsening the 4,812 runner-seconds the audit measured "+
				"on docs-only commits", gate)
		}
	}
}
