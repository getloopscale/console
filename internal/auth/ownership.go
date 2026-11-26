// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// AccountOwnsTenant reports whether accountID owns tenantID — the M1 ownership
// check ForwardAuth runs before minting, to reject a cross-account credential
// (an account_id that does not own the targeted tenant_id) with 403.
//
// A real DB error is RETURNED (never collapsed into a silent `false`), so the
// caller fails CLOSED (503) rather than wrongly denying or allowing. The empty-
// account case (legacy NULL-account key, accountID == "") is the CALLER's
// responsibility to skip — this function makes no special case for it (an empty
// accountID simply matches no tenant and returns false).
func AccountOwnsTenant(ctx context.Context, db *sql.DB, accountID, tenantID string) (bool, error) {
	var one int
	err := db.QueryRowContext(ctx,
		`SELECT 1 FROM tenants WHERE id = $1 AND account_id = $2`,
		tenantID, accountID,
	).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil // not-owns (the 403 path)
	}
	if err != nil {
		return false, fmt.Errorf("account ownership check: %w", err)
	}
	return true, nil
}
