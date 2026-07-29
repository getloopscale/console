package serviceversions

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// reasonProbePanic is the closed-set reason for a slot whose probe panicked. Like
// every other reason it is a constant: the panic value goes to the log, never to
// the browser (R5).
const reasonProbePanic = "probe panic"

// Options configures a Collector. It is filled at the composition root — the
// transport and the target list are injected, never built here.
type Options struct {
	Client     *http.Client
	Targets    []Target
	PerService time.Duration
	Global     time.Duration
	Now        func() time.Time
	// OnResult observes one probe outcome, once per target, after the fan-out has
	// joined. It is the runtime-metric pillar of the wiring triad.
	OnResult func(service, result string)
	Logger   *slog.Logger
}

// Collector fans out one probe per target and composes the results under a global
// time budget.
type Collector struct {
	client     *http.Client
	targets    []Target
	perService time.Duration
	global     time.Duration
	now        func() time.Time
	onResult   func(service, result string)
	logger     *slog.Logger
}

// NewCollector builds a Collector, defaulting the optional hooks so no call site
// has to nil-check them on the hot path.
func NewCollector(opts Options) *Collector {
	c := &Collector{
		client:     opts.Client,
		targets:    opts.Targets,
		perService: opts.PerService,
		global:     opts.Global,
		now:        opts.Now,
		onResult:   opts.OnResult,
		logger:     opts.Logger,
	}
	if c.now == nil {
		c.now = time.Now
	}
	if c.onResult == nil {
		c.onResult = func(string, string) {}
	}
	if c.logger == nil {
		c.logger = slog.Default()
	}
	return c
}

// Report is one collection: when it was taken, and every service's outcome.
type Report struct {
	CollectedAt time.Time
	Services    []ServiceStatus
}

// reportEnvelope is the wire shape of a Report.
type reportEnvelope struct {
	CollectedAt string          `json:"collected_at"`
	Services    []ServiceStatus `json:"services"`
}

// MarshalJSON emits collected_at — the instant of the collection, distinct from
// each service's checked_at and from any built_at — and never a null services
// list, so a consumer can always iterate.
func (r Report) MarshalJSON() ([]byte, error) {
	services := r.Services
	if services == nil {
		services = []ServiceStatus{}
	}
	return json.Marshal(reportEnvelope{
		CollectedAt: r.CollectedAt.UTC().Format(time.RFC3339),
		Services:    services,
	})
}

// Collect probes every target concurrently and returns once all of them have
// settled or the budget ran out.
//
// The concurrency shape is deliberate (ADR D4). errgroup is rejected despite
// being available: the value of errgroup.WithContext is cancelling the siblings
// on the first error, which is precisely this fan-out's anti-requirement — one
// service being down must never abort the probe of the others.
func (c *Collector) Collect(ctx context.Context) Report {
	collectedAt := c.now()

	gctx, gcancel := context.WithTimeout(ctx, c.global)
	defer gcancel()

	// Pre-filled with the timeout variant BEFORE any goroutine starts. The
	// zero-value of ServiceStatus would be a fifth, fake variant (empty state),
	// which would puncture the strict union from underneath.
	out := make([]ServiceStatus, len(c.targets))
	for i, t := range c.targets {
		out[i] = Timeout(t.Name, collectedAt)
	}

	var wg sync.WaitGroup
	for i, t := range c.targets {
		wg.Add(1)
		go func(i int, t Target) {
			defer wg.Done() // declared FIRST => runs LAST (LIFO)
			// EC-3: declared AFTER wg.Done() so it runs BEFORE it — the slot is
			// already written when Wait releases. A panic in a goroutine is not
			// contained by the handler's recovery: without this, one defective
			// probe takes down the whole gateway process.
			defer func() {
				if r := recover(); r != nil {
					out[i] = Unreachable(t.Name, reasonProbePanic, c.now())
					c.logger.Error("service version probe panicked", "service", t.Name, "panic", r)
				}
			}()
			out[i] = probe(gctx, c.client, t, c.perService, c.now)
		}(i, t)
	}
	wg.Wait()

	// Observed after the join, on the caller's goroutine: the counter is never
	// touched concurrently by this package's own fan-out.
	for _, s := range out {
		c.onResult(s.Name(), string(s.State()))
	}
	return Report{CollectedAt: collectedAt, Services: out}
}
