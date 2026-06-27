// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M2 — ProvisionStarter creates ONE subscription per Account: the INSERT derives
// account_id from the tenant and conflicts on account_id (not tenant_id), so a
// 2nd tenant of an existing account does not create a 2nd subscription.
package billing

import (
	"context"
	"io"
	"log/slog"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestProvisionStarter_AccountScopedInsert_OnConflictAccountID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	p := NewProvisioner(db, nil, quietLogger())

	// (?s) so `.` spans the multi-line SQL — assert both the account_id derivation
	// and ON CONFLICT (account_id) are present (the per-Account billing invariant).
	mock.ExpectExec(`(?s)INSERT INTO subscriptions.*account_id.*ON CONFLICT \(account_id\)`).
		WithArgs(sqlmock.AnyArg(), "tn-1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	if err := p.ProvisionStarter(context.Background(), "u1", "e@x.io", "tn-1"); err != nil {
		t.Fatalf("ProvisionStarter: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("subscription INSERT must be account-scoped (ON CONFLICT account_id): %v", err)
	}
}
