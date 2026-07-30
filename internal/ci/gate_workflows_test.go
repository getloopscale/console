package ci

// T2.2/T2.3 — the three workflows that `publish.yml` will invoke as gates.
//
// Two measured facts shape what these tests assert.
//
// 1. A `workflow_call` callee does NOT inherit the caller's `concurrency` group. It keeps its own,
//    evaluated in the caller's context. Measured 2026-07-30 on theo-memory, runs 30522117234 and
//    30522853797: a standalone run of the callee landed in the same group as the gated call and
//    cancelled it mid-checkout; the caller finished `cancelled` with `image` skipped. theo-lens hit
//    the same defect and fixed it by deleting the standalone triggers
//    (theo-lens/.github/workflows/integration.yml:28-32).
//
//    Only `ci.yml` declares a `concurrency` block, so only `ci.yml` can collide with itself.
//
// 2. A callee does NOT inherit secrets either. All three consume `secrets.GOMOD_TOKEN` to fetch the
//    private theo-contracts module, so each must declare it under `workflow_call.secrets` or every
//    gate dies at `go mod download`. `secrets: inherit` is banned in this repo
//    (publish.yml:69-71 — semgrep flags `secrets-inherit`).

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type gateWorkflow struct {
	On   map[string]any `yaml:"on"`
	Jobs map[string]any `yaml:"jobs"`
}

// gateSpec is the intended trigger surface of each gate, and WHY.
var gateSpec = []struct {
	file string
	// keepPush records whether the workflow keeps its own `push:` trigger.
	keepPush bool
	why      string
}{
	{
		file:     "ci.yml",
		keepPush: false,
		why: "ci.yml declares `concurrency: test-e2e-${branch}` with cancel-in-progress; keeping a " +
			"standalone push trigger puts the gated call and the standalone run in the same group, " +
			"and one kills the other — leaving `needs:` unsatisfiable on a green commit",
	},
	{
		file:     "quality.yml",
		keepPush: false,
		why: "a commit that produces no image has nothing for quality to check; the merge commit is " +
			"covered through the gate, and PRs are covered by the pull_request trigger",
	},
	{
		file:     "security-sast.yml",
		keepPush: true,
		why: "gitleaks must see EVERY commit, including docs-only merges that produce no image and " +
			"therefore run no gate. It has no `concurrency` block, so it cannot self-cancel, and at " +
			"~36s the duplicated run on image-producing commits is the price of unconditional " +
			"secret coverage",
	},
}

func parseGate(t *testing.T, file string) (gateWorkflow, string) {
	t.Helper()
	path := filepath.Join("../../.github/workflows", file)
	b, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	var wf gateWorkflow
	if err := yaml.Unmarshal(b, &wf); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
	return wf, string(b)
}

func TestGateWorkflowsAreCallable(t *testing.T) {
	for _, g := range gateSpec {
		wf, _ := parseGate(t, g.file)
		if _, ok := wf.On["workflow_call"]; !ok {
			t.Errorf("%s: no `workflow_call` trigger — publish.yml cannot invoke it as a gate", g.file)
		}
	}
}

func TestGateTriggerSurfaceMatchesTheMeasuredDesign(t *testing.T) {
	for _, g := range gateSpec {
		wf, _ := parseGate(t, g.file)

		if _, hasPush := wf.On["push"]; hasPush != g.keepPush {
			if g.keepPush {
				t.Errorf("%s: `push:` was removed but must stay.\n%s", g.file, g.why)
			} else {
				t.Errorf("%s: `push:` must be removed.\n%s", g.file, g.why)
			}
		}

		// workflow_dispatch is a standalone trigger too — it is the collider that survived in
		// theo-memory and produced both measured cancellations.
		if _, hasDispatch := wf.On["workflow_dispatch"]; hasDispatch && !g.keepPush {
			t.Errorf("%s: `workflow_dispatch:` is a standalone trigger and collides with the gated "+
				"call in the callee's own concurrency group", g.file)
		}

		// pull_request coverage is never traded away — it is what protects the branch before merge.
		if _, hasPR := wf.On["pull_request"]; !hasPR {
			t.Errorf("%s: `pull_request:` must remain — removing it would drop pre-merge coverage", g.file)
		}
	}
}

func TestGatesDeclareTheSecretsTheyConsume(t *testing.T) {
	for _, g := range gateSpec {
		wf, body := parseGate(t, g.file)

		if strings.Contains(body, "secrets: inherit") {
			t.Errorf("%s: `secrets: inherit` is banned in this repo (publish.yml:69-71); enumerate "+
				"the secrets the workflow actually consumes", g.file)
		}
		if !strings.Contains(body, "secrets.GOMOD_TOKEN") {
			continue // this gate does not need the private-module credential
		}

		call, ok := wf.On["workflow_call"].(map[string]any)
		if !ok {
			t.Errorf("%s: consumes GOMOD_TOKEN but `workflow_call` declares no `secrets:` block; a "+
				"callee does not inherit secrets, so every gated run dies at `go mod download`", g.file)
			continue
		}
		secrets, ok := call["secrets"].(map[string]any)
		if !ok {
			t.Errorf("%s: `workflow_call.secrets` missing; GOMOD_TOKEN would be empty in the gated run", g.file)
			continue
		}
		if _, ok := secrets["GOMOD_TOKEN"]; !ok {
			t.Errorf("%s: `workflow_call.secrets` does not declare GOMOD_TOKEN", g.file)
		}
	}
}

// HIGH-1 (review 2026-07-30) — a gate must not be able to enter the same concurrency group as a
// standalone run of itself, by ANY route.
//
// D4 removed `push:` and `workflow_dispatch:` and closed two doors. It left a third: `ci.yml`'s
// `pull_request:` has no branch filter, and this repo's release ritual is a `develop -> main` PR —
// measured, 10 of the last 10 PRs into main have head `develop`, and 5 recent ci runs carry
// event=pull_request with head_branch=develop.
//
// Such a PR resolves `github.event.pull_request.head.ref` to "develop", landing in
// `test-e2e-develop`. The gated callee, running under a push to develop, falls through to
// `github.ref_name` == "develop" and lands in the SAME group. With cancel-in-progress the release
// PR cancels the in-flight gate; `needs:` goes unsatisfied, `images` is skipped, and the release
// commit publishes nothing — reported as `cancelled`, i.e. grey rather than red.
//
// Before M22 that collision cost a duplicate CI signal. Gating publish on the callee converts it
// into blocked delivery.
//
// The key must therefore carry something that differs between the two. `github.event_name` is used
// because the mechanism is MEASURED: a callee evaluates its group expression in the CALLER's
// context (theo-memory runs 30522117234 / 30522853797, where `github.ref_name` resolved to the
// caller's branch). A standalone PR run sees `pull_request`; the gated callee under a push sees
// `push`.
func TestGateConcurrencyGroupCannotCollideWithAStandaloneRun(t *testing.T) {
	for _, g := range gateSpec {
		_, body := parseGate(t, g.file)

		var wf struct {
			Concurrency struct {
				Group string `yaml:"group"`
			} `yaml:"concurrency"`
		}
		if err := yaml.Unmarshal([]byte(body), &wf); err != nil {
			t.Fatalf("%s: %v", g.file, err)
		}
		group := wf.Concurrency.Group
		if group == "" {
			continue // no group: nothing to collide with, and nothing to cancel
		}
		if !strings.Contains(group, "github.event_name") {
			t.Errorf("%s: concurrency group %q does not distinguish the gated call from a "+
				"standalone run. A `develop -> main` release PR resolves head.ref to \"develop\" "+
				"and enters the same group as the callee running under a push to develop, "+
				"cancelling the gate mid-flight and skipping `images` on the release commit",
				g.file, group)
		}
	}
}
