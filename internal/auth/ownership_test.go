// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// M1 T2.1 — AccountOwnsTenant ownership check (sqlmock). Proves the three paths
// distinctly: owns→true, not-owns→(false,nil), DB error→(false,non-nil) so the
// caller (ForwardAuth) fails closed rather than silently allowing/denying.
package auth

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestAccountOwnsTenant_TrueWhenRowMatches(t *testing.T) {
	db, mock := newAuthMock(t)
	mock.ExpectQuery("SELECT 1 FROM tenants WHERE id = .+ AND account_id").
		WithArgs("tn-x", "acct-a").
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(1))

	ok, err := AccountOwnsTenant(context.Background(), db, "acct-a", "tn-x")
	if err != nil {
		t.Fatalf("want nil err, got %v", err)
	}
	if !ok {
		t.Fatalf("want owns=true")
	}
}

func TestAccountOwnsTenant_FalseWhenNoRow(t *testing.T) {
	db, mock := newAuthMock(t)
	mock.ExpectQuery("SELECT 1 FROM tenants WHERE id = .+ AND account_id").
		WithArgs("tn-x", "acct-other").
		WillReturnError(sql.ErrNoRows)

	ok, err := AccountOwnsTenant(context.Background(), db, "acct-other", "tn-x")
	if err != nil {
		t.Fatalf("not-owns must NOT error, got %v", err)
	}
	if ok {
		t.Fatalf("want owns=false (cross-account)")
	}
}

func TestAccountOwnsTenant_DBErrorPropagates(t *testing.T) {
	db, mock := newAuthMock(t)
	mock.ExpectQuery("SELECT 1 FROM tenants WHERE id = .+ AND account_id").
		WillReturnError(errors.New("connection reset"))

	ok, err := AccountOwnsTenant(context.Background(), db, "acct-a", "tn-x")
	if err == nil {
		t.Fatalf("DB error must propagate (fail-closed), got nil")
	}
	if ok {
		t.Fatalf("owns must be false on error")
	}
}
