// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package storage

import (
	"context"
	"database/sql"
	"fmt"
)

// PGTierResolver resolves a tenant's active plan tier from the subscriptions
// table, mirroring the billing cost_aggregator query (cost_aggregator.go:177).
// A tenant with no active subscription resolves to "starter" (fail-safe — the
// most restrictive real tier).
type PGTierResolver struct {
	db *sql.DB
}

// NewPGTierResolver wraps a *sql.DB.
func NewPGTierResolver(db *sql.DB) *PGTierResolver { return &PGTierResolver{db: db} }

// TierForTenant returns the tenant's active plan tier, or "starter" if none.
func (r *PGTierResolver) TierForTenant(ctx context.Context, tenantID string) (string, error) {
	var tier string
	err := r.db.QueryRowContext(ctx,
		`SELECT plan FROM subscriptions
		 WHERE account_id = (SELECT account_id FROM tenants WHERE id = $1)
		   AND status = 'active'`,
		tenantID,
	).Scan(&tier)
	if err == sql.ErrNoRows {
		return "starter", nil // fail-safe default
	}
	if err != nil {
		return "", fmt.Errorf("storage: resolve tier: %w", err)
	}
	return tier, nil
}
