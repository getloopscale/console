package routes

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/usetheodev/theo-cloud/internal/serviceversions"
	"github.com/usetheodev/theo-cloud/internal/version"
)

type stubCollector struct {
	report serviceversions.Report
	// atomic: TestCollectIsSafeUnderConcurrentCalls drives 64 goroutines through Collect, and a
	// plain int++ here is a race in the TEST that the detector correctly reports against the
	// decorator's call site — which is exactly how it was found.
	calls atomic.Int64
}

func (s *stubCollector) Collect(context.Context) serviceversions.Report {
	s.calls.Add(1)
	return s.report
}

var fixedNow = time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)

func stamped() version.Info {
	return version.Info{Name: "theo-cloud", Version: "0.71.0", GitSHA: "abc1234", BuiltAt: "2026-07-30T12:00:00Z", Node: "go1.26.5"}
}

// The gateway must appear on the panel it serves, and it must get there WITHOUT an HTTP call to
// itself: a service probing itself reports its own liveness, which is the one thing a status panel
// cannot learn that way. The decorator therefore composes in-process build metadata.
func TestSelfRowIsAppendedFromInProcessMetadata(t *testing.T) {
	inner := &stubCollector{report: serviceversions.Report{
		CollectedAt: fixedNow,
		Services: []serviceversions.ServiceStatus{
			serviceversions.OK("theo-memory", "1.2.3", "", fixedNow),
		},
	}}

	dec := NewSelfReportingCollector(inner, stamped(), func() time.Time { return fixedNow }, nil)
	got := dec.Collect(context.Background())

	if len(got.Services) != 2 {
		t.Fatalf("services = %d, want 2 (inner + self)", len(got.Services))
	}
	self := got.Services[len(got.Services)-1]
	if self.Name() != "theo-cloud" {
		t.Errorf("self-row name = %q, want theo-cloud", self.Name())
	}
	if self.State() != serviceversions.StateOK {
		t.Errorf("self-row state = %v, want ok for a stamped build", self.State())
	}
}

// EC-1 — `append` writes into the callee's backing array whenever capacity is spare. Collector
// happens to allocate len==cap today, but that is its implementation detail, not a contract. If it
// ever pre-allocates, two concurrent requests would corrupt each other's report through the shared
// array. The decorator must copy.
func TestDecoratorDoesNotMutateTheInnerReport(t *testing.T) {
	backing := make([]serviceversions.ServiceStatus, 1, 8) // spare capacity ON PURPOSE
	backing[0] = serviceversions.OK("theo-memory", "1.2.3", "", fixedNow)
	inner := &stubCollector{report: serviceversions.Report{CollectedAt: fixedNow, Services: backing}}

	dec := NewSelfReportingCollector(inner, stamped(), func() time.Time { return fixedNow }, nil)
	_ = dec.Collect(context.Background())

	// NOTA: nao ha assercao sobre len(inner.report.Services) aqui, de proposito. Ela seria
	// TAUTOLOGICA — `append` devolve um novo slice header e nunca muta o `len` do header guardado
	// no callee, escreva ele in-place ou nao. Passaria contra um append-in-place quebrado, diluindo
	// o sinal de falha. A assercao abaixo e a que faz o trabalho: `backing` tem cap 8 e len 1, entao
	// `backing[:2][1]` alcanca o slot 1 do array diretamente. (Review LOW-1.)
	if got := backing[:2][1].Name(); got == "theo-cloud" {
		t.Fatal("EC-1: the decorator wrote the self-row into the inner collector's backing array " +
			"instead of copying; two concurrent requests would corrupt each other's report")
	}
}

// D3 coupling — an unstamped local build reports version "dev". If it reported "unknown",
// serviceversions.normalizeUnknown would map it to empty, OK() would degrade the row to
// Unreachable, and aggregateState would pin the whole panel at "degraded" forever.
func TestUnstampedBuildStaysOkNotDegraded(t *testing.T) {
	inner := &stubCollector{report: serviceversions.Report{CollectedAt: fixedNow}}
	unstamped := version.Info{Name: "theo-cloud", Version: "dev", GitSHA: "unknown", BuiltAt: "unknown"}

	got := NewSelfReportingCollector(inner, unstamped, func() time.Time { return fixedNow }, nil).
		Collect(context.Background())

	if len(got.Services) != 1 {
		t.Fatalf("services = %d, want 1", len(got.Services))
	}
	if got.Services[0].State() != serviceversions.StateOK {
		t.Fatalf("unstamped self-row state = %v, want ok; a permanently amber panel lies exactly "+
			"as much as a permanently green one", got.Services[0].State())
	}
}

// Options.OnResult fires once per TARGET inside Collect. A row appended afterwards is invisible to
// it, so the Prometheus census and the JSON census would disagree by one.
func TestSelfRowEmitsItsOwnMetricObservation(t *testing.T) {
	var seen []string
	inner := &stubCollector{report: serviceversions.Report{CollectedAt: fixedNow}}

	NewSelfReportingCollector(inner, stamped(), func() time.Time { return fixedNow },
		func(service, result string) { seen = append(seen, service+":"+result) }).Collect(context.Background())

	if len(seen) != 1 {
		t.Fatalf("metric observations = %d, want exactly 1", len(seen))
	}
	if seen[0] != "theo-cloud:ok" {
		t.Errorf("observation = %q, want %q", seen[0], "theo-cloud:ok")
	}
}

// The handler is served by chi from many goroutines at once.
func TestCollectIsSafeUnderConcurrentCalls(t *testing.T) {
	inner := &stubCollector{report: serviceversions.Report{
		CollectedAt: fixedNow,
		Services:    []serviceversions.ServiceStatus{serviceversions.OK("theo-memory", "1.2.3", "", fixedNow)},
	}}
	dec := NewSelfReportingCollector(inner, stamped(), func() time.Time { return fixedNow }, nil)

	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if n := len(dec.Collect(context.Background()).Services); n != 2 {
				t.Errorf("services = %d under concurrency, want 2", n)
			}
		}()
	}
	wg.Wait()
}
