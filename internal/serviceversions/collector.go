package serviceversions

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
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
	//
	// `version` is passed ONLY for the ok variant and is "" for every other state.
	// The narrowing happens HERE, inside the package, instead of via an exported
	// accessor: ServiceStatus deliberately has no Version() method, because one would
	// let a caller read a version off a degraded row and reintroduce the exact lie the
	// union exists to prevent (ADR D3).
	OnResult func(service, result, version string)
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
	onResult   func(service, result, version string)
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
		c.onResult = func(string, string, string) {}
	}
	if c.logger == nil {
		c.logger = slog.Default()
	}
	return c
}

// slotResult carries one probe outcome back to the join, tagged with the slot it
// belongs to so the caller — and only the caller — writes into the report slice.
type slotResult struct {
	index  int
	status ServiceStatus
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

	// Results travel on a channel instead of being written into `out` directly, so
	// the join below can abandon a straggler without racing it: once the budget
	// expires the caller returns while the goroutine may still be running, and a
	// goroutine writing into a slice its caller already returned is a data race.
	// The buffer is exactly len(targets), so no sender ever blocks and no goroutine
	// leaks even when nobody is left reading.
	results := make(chan slotResult, len(c.targets))
	for i, t := range c.targets {
		go func(i int, t Target) {
			// A panic in a goroutine is not contained by the handler's recovery:
			// without this, one defective probe takes down the whole gateway
			// process (EC-3). The recovery still reports its slot, so a panicking
			// probe degrades itself rather than starving the join.
			defer func() {
				if r := recover(); r != nil {
					c.logger.Error("service version probe panicked", "service", t.Name, "panic", r)
					results <- slotResult{index: i, status: Unreachable(t.Name, reasonProbePanic, c.now())}
				}
			}()
			results <- slotResult{index: i, status: probe(gctx, c.client, t, c.perService, c.now)}
		}(i, t)
	}

	// The join honours BOTH halves of this function's contract: it returns once
	// every target settled OR the budget ran out. A bare wait would make `global`
	// inert — every in-repo probe derives its deadline from gctx, but a transport
	// that ignores cancellation (F-wire-2) would hold the join far past the budget,
	// leaving the client's last-resort Timeout as the real ceiling.
	budgetExpired := false
join:
	for settled := 0; settled < len(c.targets); settled++ {
		select {
		case r := <-results:
			out[r.index] = r.status
		case <-gctx.Done():
			budgetExpired = true
			break join
		}
	}
	if budgetExpired {
		// Drain what settled before the deadline but had not been read yet:
		// reporting a probe that DID answer as `timeout` would be its own small lie.
		for draining := true; draining; {
			select {
			case r := <-results:
				out[r.index] = r.status
			default:
				draining = false
			}
		}
		c.logger.Warn("service version collection hit its budget", "budget", c.global, "targets", len(c.targets))
	}

	// Observed after the join, on the caller's goroutine: the counter is never
	// touched concurrently by this package's own fan-out.
	for _, s := range out {
		version := ""
		if s.State() == StateOK {
			version = s.version
		}
		c.onResult(s.Name(), string(s.State()), version)
	}
	return Report{CollectedAt: collectedAt, Services: out}
}
