package serviceversions

import (
	"context"
	"net/http"
	"testing"
	"time"

	cloudmetrics "github.com/usetheodev/theo-cloud/internal/metrics"
)

// TestCollect_wired_to_metrics_observes_non_zero_counter is the wiring triad's
// pillar (c) proved rather than assumed: it runs a REAL Collect against real
// httptest targets with the same OnResult that cmd/main.go injects, and asserts
// the Prometheus counter actually moved. "The code exists and the tests pass" is
// not evidence that the hook fires.
//
// Two distinct results are asserted (one healthy, one failure) so a collector that
// reported every target identically would not satisfy it.
func TestCollect_wired_to_metrics_observes_non_zero_counter(t *testing.T) {
	healthy := versionServer(t, `{"version":"0.35.0"}`)
	hung := hungServer(t)

	const okService, timeoutService = "metrics-probe-ok", "metrics-probe-timeout"
	beforeOK := cloudmetrics.ServiceVersionProbeValue(okService, string(StateOK))
	beforeTimeout := cloudmetrics.ServiceVersionProbeValue(timeoutService, string(StateTimeout))

	c := NewCollector(Options{
		Client: &http.Client{},
		Targets: []Target{
			{Name: okService, BaseURL: healthy.URL},
			{Name: timeoutService, BaseURL: hung.URL},
		},
		PerService: 150 * time.Millisecond,
		Global:     2 * time.Second,
		OnResult:   cloudmetrics.IncServiceVersionProbe, // exactly what cmd/main.go wires
	})

	c.Collect(context.Background())

	if got := cloudmetrics.ServiceVersionProbeValue(okService, string(StateOK)) - beforeOK; got != 1 {
		t.Fatalf("ok counter delta = %v, want 1 — the OnResult hook never reached the metric", got)
	}
	if got := cloudmetrics.ServiceVersionProbeValue(timeoutService, string(StateTimeout)) - beforeTimeout; got != 1 {
		t.Fatalf("timeout counter delta = %v, want 1 — failure outcomes are invisible in production", got)
	}
}
