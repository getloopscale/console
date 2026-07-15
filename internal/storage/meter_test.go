// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"testing"

	"github.com/usetheodev/theo-cloud/internal/metrics"
)

// TestAddStorageBytes_PrometheusCounter proves the exported metrics hook
// increments the storage counter (the Prometheus half of the Meter; the
// cost_counters upsert half is covered by the integration test against real PG).
func TestAddStorageBytes_PrometheusCounter(t *testing.T) {
	before := metrics.StorageBytesWrittenValue()
	metrics.AddStorageBytes(1024)
	metrics.AddStorageBytes(-5) // negative ignored
	after := metrics.StorageBytesWrittenValue()

	if got := after - before; got != 1024 {
		t.Errorf("counter delta = %v, want 1024 (negative deltas ignored)", got)
	}
}

// PromMeter must satisfy the Meter interface (compile-time assertion).
var _ Meter = (*PromMeter)(nil)
