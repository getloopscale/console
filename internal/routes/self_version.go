package routes

import (
	"context"
	"time"

	"github.com/usetheodev/theo-cloud/internal/serviceversions"
	"github.com/usetheodev/theo-cloud/internal/version"
)

// selfReportingCollector puts the gateway itself on the panel the gateway serves.
//
// WHY HERE AND NOT IN internal/serviceversions. `VersionCollector` is declared on the CONSUMER side
// and satisfied implicitly, which is exactly what makes it the right seam: anything with a
// `Collect` method qualifies, so the fifth row costs the M21 package no change at all.
//
// The alternatives all widen something that was deliberately narrowed:
//
//   - A fifth Target would need either an HTTP call to ourselves — a service probing itself reports
//     its own liveness, which is the one fact a status panel cannot learn that way — or a non-URL
//     field on Target plus a branch in probe(). Both widen the M21 type, and both break the two
//     wiring assertions that pin serviceVersionTargets at four.
//   - A `SelfOK` constructor or an exported field on ServiceStatus is literally what that type
//     exists to prevent: its fields are unexported and its four constructors are the only way in,
//     so a failure variant can never carry a version.
//   - Options.Self on the Collector would still edit M21's package, and would insert an always-ok
//     slot into a fan-out whose entire contract is measurement under a time budget.
//
// Report is a CONTAINER, not the union — appending to it only ever composes values the four
// exported constructors produced, so the invariant survives untouched.
type selfReportingCollector struct {
	inner VersionCollector
	info  version.Info
	now   func() time.Time
	onRow func(service, result string)
}

// NewSelfReportingCollector wraps inner so its report also carries this process's own row.
//
// onRow may be nil. Its signature mirrors the collector's own OnResult hook so the same function
// can be passed to both. When non-nil it receives the self-row's state exactly once per Collect: the
// collector's own OnResult hook fires once per TARGET inside Collect, so a row appended afterwards
// is invisible to it, and the Prometheus census would disagree with the JSON census by one.
func NewSelfReportingCollector(
	inner VersionCollector,
	info version.Info,
	now func() time.Time,
	onRow func(service, result string),
) VersionCollector {
	return selfReportingCollector{inner: inner, info: info, now: now, onRow: onRow}
}

func (c selfReportingCollector) Collect(ctx context.Context) serviceversions.Report {
	report := c.inner.Collect(ctx)
	at := c.now()

	// OK() self-polices: it degrades to Unreachable when the version normalizes to empty, so an
	// unstamped binary reports itself unreachable rather than an "ok" with nothing to show. That is
	// why version.Version defaults to "dev" and not "unknown" — "unknown" normalizes to empty, and
	// the whole panel would sit permanently at "degraded" for every locally built gateway.
	self := serviceversions.OK(c.info.Name, c.info.Version, c.info.BuiltAt, at)

	// A fresh slice, never append-in-place. `append` writes into the callee's backing array whenever
	// capacity is spare; the collector happens to allocate len==cap today, but that is its
	// implementation detail, not a contract. If it ever pre-allocates, two concurrent requests would
	// corrupt each other's report through the shared array.
	services := make([]serviceversions.ServiceStatus, 0, len(report.Services)+1)
	services = append(services, report.Services...)
	services = append(services, self)

	if c.onRow != nil {
		c.onRow(c.info.Name, string(self.State()))
	}

	return serviceversions.Report{CollectedAt: report.CollectedAt, Services: services}
}
