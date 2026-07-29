package serviceversions

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// slowVersionServer answers a valid version payload after d — the "healthy but not
// instant" target that proves the fan-out is parallel rather than serial.
func slowVersionServer(t *testing.T, d time.Duration, version string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(d)
		_ = json.NewEncoder(w).Encode(map[string]string{"version": version, "built_at": "2026-07-01T00:00:00Z"})
	}))
	t.Cleanup(srv.Close)
	return srv
}

// statesByName indexes a report so assertions read by service rather than by slot.
func statesByName(rep Report) map[string]State {
	got := make(map[string]State, len(rep.Services))
	for _, s := range rep.Services {
		got[s.Name()] = s.State()
	}
	return got
}

// servicesFromJSON round-trips the report through the wire so the assertions see
// what the browser would see, not what the Go type promises.
func servicesFromJSON(t *testing.T, rep Report) []map[string]any {
	t.Helper()
	b, err := json.Marshal(rep)
	if err != nil {
		t.Fatalf("marshal report: %v", err)
	}
	var envelope struct {
		CollectedAt string           `json:"collected_at"`
		Services    []map[string]any `json:"services"`
	}
	if err := json.Unmarshal(b, &envelope); err != nil {
		t.Fatalf("unmarshal report: %v", err)
	}
	if envelope.CollectedAt == "" {
		t.Fatalf("collected_at missing from report JSON: %s", b)
	}
	return envelope.Services
}

// TestCollect_hung_target_yields_timeout_without_version is the metric named in the
// plan's Goal: one hung target must not delay, cancel or contaminate its siblings.
func TestCollect_hung_target_yields_timeout_without_version(t *testing.T) {
	fast := versionServer(t, `{"version":"0.35.0","built_at":"2026-07-01T00:00:00Z"}`)
	hung := hungServer(t)

	c := NewCollector(Options{
		Client: &http.Client{},
		Targets: []Target{
			{Name: "theo-rag", BaseURL: fast.URL},
			{Name: "theo-lens", BaseURL: hung.URL},
			{Name: "theo-memory", BaseURL: fast.URL},
			{Name: "theo-storage", BaseURL: ""},
		},
		PerService: 200 * time.Millisecond,
		Global:     3 * time.Second,
	})

	start := time.Now()
	rep := c.Collect(context.Background())
	elapsed := time.Since(start)

	if elapsed > time.Second {
		t.Fatalf("Collect took %v — one hung target blocked the others (head-of-line blocking)", elapsed)
	}
	want := map[string]State{
		"theo-rag":     StateOK,
		"theo-lens":    StateTimeout,
		"theo-memory":  StateOK,
		"theo-storage": StateNotDeployed,
	}
	got := statesByName(rep)
	for name, w := range want {
		if got[name] != w {
			t.Fatalf("%s = %q, want %q", name, got[name], w)
		}
	}
	for _, s := range servicesFromJSON(t, rep) {
		if s["state"] == "ok" {
			continue
		}
		if _, present := s["version"]; present {
			t.Fatalf("service %v in state %v leaked a version key", s["name"], s["state"])
		}
	}
}

// TestCollect_preserves_results_that_already_arrived pins the D1 rationale: the
// slow target burning the whole budget must not erase what already landed.
func TestCollect_preserves_results_that_already_arrived(t *testing.T) {
	quick := versionServer(t, `{"version":"1.2.3"}`)
	hung := hungServer(t)

	c := NewCollector(Options{
		Client: &http.Client{},
		Targets: []Target{
			{Name: "theo-lens", BaseURL: hung.URL},
			{Name: "theo-rag", BaseURL: quick.URL},
		},
		PerService: 150 * time.Millisecond,
		Global:     2 * time.Second,
	})

	rep := c.Collect(context.Background())

	got := statesByName(rep)
	if got["theo-rag"] != StateOK {
		t.Fatalf("theo-rag = %q, want ok — the hung sibling erased a result that had already arrived", got["theo-rag"])
	}
	if got["theo-lens"] != StateTimeout {
		t.Fatalf("theo-lens = %q, want timeout", got["theo-lens"])
	}
}

func TestCollect_is_concurrent_not_serial(t *testing.T) {
	slow := slowVersionServer(t, 200*time.Millisecond, "1.0.0")

	var calls int32
	c := NewCollector(Options{
		Client: &http.Client{},
		Targets: []Target{
			{Name: "a", BaseURL: slow.URL},
			{Name: "b", BaseURL: slow.URL},
			{Name: "c", BaseURL: slow.URL},
		},
		PerService: 2 * time.Second,
		Global:     3 * time.Second,
		OnResult:   func(string, string) { atomic.AddInt32(&calls, 1) },
	})

	start := time.Now()
	rep := c.Collect(context.Background())
	elapsed := time.Since(start)

	if elapsed > 400*time.Millisecond {
		t.Fatalf("Collect took %v for 3x200ms targets — the fan-out serialized", elapsed)
	}
	if len(rep.Services) != 3 {
		t.Fatalf("len(Services) = %d, want 3", len(rep.Services))
	}
	if n := atomic.LoadInt32(&calls); n != 3 {
		t.Fatalf("OnResult called %d times, want exactly 3 (one per target)", n)
	}
}

func TestCollect_empty_targets_returns_empty_services_not_nil(t *testing.T) {
	c := NewCollector(Options{Client: &http.Client{}, PerService: time.Second, Global: time.Second})

	rep := c.Collect(context.Background())

	if rep.Services == nil {
		t.Fatal("Services is nil — the wire would carry `null` instead of `[]`")
	}
	b, err := json.Marshal(rep)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got, ok := m["services"].([]any); !ok || len(got) != 0 {
		t.Fatalf("services = %v, want an empty array: %s", m["services"], b)
	}
	if m["collected_at"] == "" || m["collected_at"] == nil {
		t.Fatalf("collected_at missing on an empty collection: %s", b)
	}
}

func TestCollect_report_carries_collected_at_distinct_from_built_at(t *testing.T) {
	srv := versionServer(t, `{"version":"0.35.0","built_at":"2026-07-01T00:00:00Z"}`)
	c := NewCollector(Options{
		Client:     &http.Client{},
		Targets:    []Target{{Name: "theo-rag", BaseURL: srv.URL}},
		PerService: time.Second,
		Global:     2 * time.Second,
	})

	rep := c.Collect(context.Background())

	b, _ := json.Marshal(rep)
	var envelope struct {
		CollectedAt string           `json:"collected_at"`
		Services    []map[string]any `json:"services"`
	}
	if err := json.Unmarshal(b, &envelope); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, err := time.Parse(time.RFC3339, envelope.CollectedAt); err != nil {
		t.Fatalf("collected_at = %q, want RFC3339: %v", envelope.CollectedAt, err)
	}
	if envelope.Services[0]["built_at"] != "2026-07-01T00:00:00Z" {
		t.Fatalf("built_at = %v, want the target's build instant", envelope.Services[0]["built_at"])
	}
	if envelope.CollectedAt == envelope.Services[0]["built_at"] {
		t.Fatal("collected_at equals built_at — the collection instant is not distinct from the build instant")
	}
}

func TestCollect_calls_onResult_once_per_target(t *testing.T) {
	srv := versionServer(t, `{"version":"9.9.9"}`)
	var calls int32
	seen := make(chan [2]string, 8)

	c := NewCollector(Options{
		Client: &http.Client{},
		Targets: []Target{
			{Name: "theo-rag", BaseURL: srv.URL},
			{Name: "theo-storage", BaseURL: ""},
		},
		PerService: time.Second,
		Global:     2 * time.Second,
		OnResult: func(service, result string) {
			atomic.AddInt32(&calls, 1)
			seen <- [2]string{service, result}
		},
	})

	c.Collect(context.Background())
	close(seen)

	if n := atomic.LoadInt32(&calls); n != 2 {
		t.Fatalf("OnResult called %d times, want 2 — one per target, no lost update", n)
	}
	results := map[string]string{}
	for pair := range seen {
		results[pair[0]] = pair[1]
	}
	if results["theo-rag"] != string(StateOK) {
		t.Fatalf("theo-rag reported %q, want ok", results["theo-rag"])
	}
	if results["theo-storage"] != string(StateNotDeployed) {
		t.Fatalf("theo-storage reported %q, want not_deployed", results["theo-storage"])
	}
}

// panickingRoundTripper makes client.Do panic inside the probe goroutine.
//
// EC-3 — without the per-goroutine recover this test does NOT fail: it KILLS the
// test binary, which is the same failure mode as production (a panic in any
// goroutine tears down the whole gateway process).
type panickingRoundTripper struct{}

func (panickingRoundTripper) RoundTrip(*http.Request) (*http.Response, error) {
	panic("boom: simulated probe defect")
}

func TestCollect_panicking_probe_does_not_take_down_the_process(t *testing.T) {
	c := NewCollector(Options{
		Client: &http.Client{Transport: panickingRoundTripper{}},
		Targets: []Target{
			{Name: "theo-rag", BaseURL: "http://example.invalid"},
			{Name: "theo-lens", BaseURL: "http://example.invalid"},
		},
		PerService: time.Second,
		Global:     2 * time.Second,
	})

	rep := c.Collect(context.Background()) // if the panic escapes, the process dies here

	if len(rep.Services) != 2 {
		t.Fatalf("len(Services) = %d, want 2", len(rep.Services))
	}
	for _, s := range rep.Services {
		if s.State() != StateUnreachable {
			t.Fatalf("%s = %q, want unreachable — a panicking probe must degrade its own slot, not the process", s.Name(), s.State())
		}
	}
	for _, s := range servicesFromJSON(t, rep) {
		if _, present := s["version"]; present {
			t.Fatalf("panicked slot leaked a version key: %v", s)
		}
	}
}

func TestCollect_parent_cancel_returns_early(t *testing.T) {
	hung := hungServer(t)
	c := NewCollector(Options{
		Client: &http.Client{},
		Targets: []Target{
			{Name: "theo-rag", BaseURL: hung.URL},
			{Name: "theo-lens", BaseURL: hung.URL},
		},
		PerService: 10 * time.Second,
		Global:     10 * time.Second,
	})

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	rep := c.Collect(ctx)
	elapsed := time.Since(start)

	if elapsed > 500*time.Millisecond {
		t.Fatalf("Collect took %v after the caller gave up — derived contexts did not die with the parent", elapsed)
	}
	for _, s := range rep.Services {
		if s.State() == StateOK {
			t.Fatalf("%s = ok after cancellation — a result was fabricated", s.Name())
		}
		// D10: a caller giving up is a timeout, never a service being down.
		if s.State() != StateTimeout {
			t.Fatalf("%s = %q, want timeout — caller cancellation must not be reported as unreachable (D10)", s.Name(), s.State())
		}
	}
}
