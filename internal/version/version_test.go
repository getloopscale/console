package version_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"

	"github.com/usetheoai/theo-cloud/internal/version"
)

// D3 — the sentinel choice is load-bearing, not cosmetic.
//
// `internal/serviceversions.normalizeUnknown` maps "unknown" to the empty string, and `OK()` then
// degrades the row to Unreachable. If an unstamped local build reported version "unknown", the
// gateway's own row would be permanently unreachable and `aggregateState` would pin the whole panel
// at "degraded" — the "âmbar permanente também mente" failure M21 was written to close.
//
// "dev" survives normalization, so the row stays ok on a local build.
func TestUnstampedVersionSentinelIsDev(t *testing.T) {
	if got := version.Read().Version; got != "dev" {
		t.Fatalf("unstamped Version = %q, want %q — %q is normalized to empty by serviceversions "+
			"and would pin the status panel at degraded for every locally built gateway",
			got, "dev", got)
	}
}

func TestUnstampedProvenanceSentinelsAreUnknown(t *testing.T) {
	info := version.Read()
	if info.GitSHA != "unknown" {
		t.Errorf("unstamped GitSHA = %q, want \"unknown\"", info.GitSHA)
	}
	if info.BuiltAt != "unknown" {
		t.Errorf("unstamped BuiltAt = %q, want \"unknown\"", info.BuiltAt)
	}
}

func TestReadIsPureAndReportsTheGoRuntime(t *testing.T) {
	a, b := version.Read(), version.Read()
	if a != b {
		t.Fatal("Read() is not pure — two calls returned different values")
	}
	if a.Node != runtime.Version() {
		t.Errorf("Node = %q, want the Go runtime version %q", a.Node, runtime.Version())
	}
	if a.Name == "" {
		t.Error("Name must be a compile-time literal, never empty")
	}
}

// The endpoint is auth-exempt by contract. With a credential, "service down" and "credential wrong"
// produce the same response, and the operator cannot tell them apart.
func TestHandlerServesTheFiveFieldContractUnauthenticated(t *testing.T) {
	w := httptest.NewRecorder()
	version.Handler()(w, httptest.NewRequest(http.MethodGet, "/v1/version", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — the endpoint is auth-exempt by contract", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	for _, field := range []string{"name", "version", "git_sha", "built_at", "node"} {
		v, ok := got[field]
		if !ok {
			t.Errorf("field %q missing from the wire contract", field)
			continue
		}
		if s, _ := v.(string); s == "" {
			t.Errorf("field %q is empty; the contract mandates a sentinel, never an empty string "+
				"and never an omitted field", field)
		}
	}
	if len(got) != 5 {
		t.Errorf("wire contract has %d fields, want exactly 5: %v", len(got), got)
	}
}
