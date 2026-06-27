// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package account provisions the Account entity ("Cliente Theo" / independent
// developer) that sits ONE level above the tenant in the nested B2B2C model
// (ADR account-level-tenancy, M0). An Account groups 1..N isolated tenants;
// v1 is 1:1 user<->account, enforced by accounts.UNIQUE(owner_id).
//
// The Account lives only in the control-plane — nothing here crosses to the
// data-plane (the tenant remains the hard isolation boundary, workspace_id ==
// tenant_id, unchanged).
package account

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Querier is the minimal read/write surface EnsureAccount needs. Both *sql.DB
// and *sql.Tx satisfy it, so EnsureAccount composes inside an existing
// provisioning transaction (auth.EnsureTenant) or standalone (ISP).
type Querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// EnsureAccount returns the owner's Account id, creating it if absent. Idempotent
// and race-safe: the create uses ON CONFLICT (owner_id) so two concurrent
// first-logins converge on a single account row (the UNIQUE(owner_id) from
// migration 000034). 1:1 owner<->account in v1.
func EnsureAccount(ctx context.Context, q Querier, ownerID, email string) (string, error) {
	if ownerID == "" {
		return "", errors.New("account: empty ownerID")
	}

	// Fast path: owner already has an account.
	var existing string
	err := q.QueryRowContext(ctx, `SELECT id FROM accounts WHERE owner_id = $1`, ownerID).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("query account: %w", err)
	}

	// Create. ON CONFLICT (owner_id) DO UPDATE ... RETURNING id makes the insert
	// return the WINNER's id even when a concurrent caller created it first —
	// DO NOTHING would return zero rows on conflict, so DO UPDATE is required to
	// always get an id back. The touched updated_at is a harmless no-op marker.
	display := strings.TrimSpace(email)
	if display == "" {
		display = ownerID
	}
	var id string
	err = q.QueryRowContext(ctx,
		`INSERT INTO accounts (id, display_name, plan, owner_id, created_at, updated_at)
		 VALUES ($1, $2, 'starter', $3, now(), now())
		 ON CONFLICT (owner_id) DO UPDATE SET updated_at = now()
		 RETURNING id`,
		generateAccountID(), display, ownerID,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create account: %w", err)
	}
	return id, nil
}

// generateAccountID creates a collision-free account ID using crypto/rand.
// Format: acct-{16 hex chars}, mirroring generateTenantID (tn-{16hex}).
func generateAccountID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure must never silently produce a zeroed (collision-prone)
		// ID. It should never happen in practice.
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return fmt.Sprintf("acct-%x", b)
}
