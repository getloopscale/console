// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/usetheodev/theo-cloud/internal/metrics"
)

// PGMeter is the concrete Meter: it increments the Prometheus counter and upserts
// the tenant's monthly usage into cost_counters (the same table + shape billing
// uses — cost_aggregator.go). Metering is measurement-only in the MVP (no overage
// billing yet, grill decision 8) but feeds future billing from day 1.
type PGMeter struct {
	db  *sql.DB
	now func() time.Time
}

// NewPGMeter builds a PGMeter. clock may be nil (defaults to time.Now UTC).
func NewPGMeter(db *sql.DB, clock func() time.Time) *PGMeter {
	if clock == nil {
		clock = func() time.Time { return time.Now().UTC() }
	}
	return &PGMeter{db: db, now: clock}
}

// storageMetric is the cost_counters metric key for storage bytes.
const storageMetric = "storage_bytes"

// RecordStorageBytes increments the Prometheus counter and upserts the current
// billing-period usage row. The delta is added to the running period value
// (same ON CONFLICT shape as cost_aggregator).
func (m *PGMeter) RecordStorageBytes(ctx context.Context, tenantID, tier string, deltaBytes int64) error {
	metrics.AddStorageBytes(deltaBytes)

	now := m.now()
	periodStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	periodEnd := periodStart.AddDate(0, 1, 0)

	_, err := m.db.ExecContext(ctx, `
		INSERT INTO cost_counters (tenant_id, plan_tier, metric, period_start, period_end, value)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (tenant_id, metric, period_start) DO UPDATE SET
			value = cost_counters.value + EXCLUDED.value,
			plan_tier = EXCLUDED.plan_tier,
			updated_at = now()
	`, tenantID, tier, storageMetric, periodStart, periodEnd, deltaBytes)
	if err != nil {
		return fmt.Errorf("storage: meter upsert: %w", err)
	}
	return nil
}
