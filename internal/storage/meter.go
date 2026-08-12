// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"

	"github.com/usetheoai/theo-cloud/internal/metrics"
)

// PromMeter is the MVP Meter: it increments the Prometheus counter only.
//
// DESIGN (grill decision 8 + blueprint ADR D4): the MVP has NO overage billing,
// so storage usage is MEASURED (the theo_storage_bytes_written_total counter) but
// NOT written to the engine-owned cost_counters table. Writing there would require
// a `storage_bytes` value in the engine's contract-guarded cost_counters.metric
// CHECK, which is asserted to equal the theo-contracts plan.CostMetric constants
// (api/internal/db/metric_check_drift_test.go). Coupling a storage metric into the
// shared billing contract before storage billing exists is premature (YAGNI +
// ADR D4 keeps storage decoupled from theo-contracts until a second consumer).
//
// DEFERRED (named): when storage billing lands, add MetricStorageBytes to
// theo-contracts plan.CostMetric + widen the cost_counters CHECK (migration) +
// swap this PromMeter for a cost_counters-writing one. The counter is the day-1
// measurement that feeds that future work.
type PromMeter struct{}

// NewPromMeter builds the MVP Prometheus-only meter.
func NewPromMeter() *PromMeter { return &PromMeter{} }

// RecordStorageBytes increments the Prometheus counter for committed bytes.
func (m *PromMeter) RecordStorageBytes(ctx context.Context, tenantID, tier string, deltaBytes int64) error {
	metrics.AddStorageBytes(deltaBytes)
	return nil
}
