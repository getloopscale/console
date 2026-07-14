// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"
	"database/sql"
	"fmt"
)

// PGStore is the Postgres implementation of MetaStore over the storage_objects
// table (migration 000057). It follows the house advisory-lock pattern used by
// internal/auth/tenant.go (pg_advisory_xact_lock(hashtext(...)) inside a tx).
type PGStore struct {
	db *sql.DB
}

// NewPGStore wraps a *sql.DB.
func NewPGStore(db *sql.DB) *PGStore { return &PGStore{db: db} }

// txKey carries the active transaction through the context passed to the
// WithTenantLock callback, so SumBytes/InsertPending run inside the locked tx.
type txKey struct{}

func txFrom(ctx context.Context, fallback *sql.DB) queryer {
	if tx, ok := ctx.Value(txKey{}).(*sql.Tx); ok {
		return tx
	}
	return fallback
}

// queryer is the subset of *sql.DB / *sql.Tx the store needs.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// WithTenantLock runs fn inside a transaction holding pg_advisory_xact_lock for
// the tenant. The lock is released automatically on commit/rollback (xact-scoped —
// never session-scoped, which would break with the connection pool).
func (s *PGStore) WithTenantLock(ctx context.Context, tenantID string, fn func(context.Context) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("storage: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // no-op after Commit

	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", "storage:"+tenantID); err != nil {
		return fmt.Errorf("storage: advisory lock: %w", err)
	}

	if err := fn(context.WithValue(ctx, txKey{}, tx)); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("storage: commit: %w", err)
	}
	return nil
}

// SumBytes returns the tenant's committed+pending usage (conservative — pending
// rows count so a burst of concurrent reserves cannot overshoot).
func (s *PGStore) SumBytes(ctx context.Context, tenantID string) (int64, error) {
	var total sql.NullInt64
	err := txFrom(ctx, s.db).QueryRowContext(ctx,
		`SELECT COALESCE(SUM(size_bytes), 0) FROM storage_objects WHERE tenant_id = $1`,
		tenantID,
	).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("storage: sum bytes: %w", err)
	}
	return total.Int64, nil
}

// InsertPending inserts a pending row and returns its id.
func (s *PGStore) InsertPending(ctx context.Context, tenantID, name string, size int64, mime string) (string, error) {
	var id string
	err := txFrom(ctx, s.db).QueryRowContext(ctx,
		`INSERT INTO storage_objects (tenant_id, name, size_bytes, mime_type, status)
		 VALUES ($1, $2, $3, $4, 'pending')
		 ON CONFLICT (tenant_id, name) DO UPDATE SET size_bytes = EXCLUDED.size_bytes,
		     mime_type = EXCLUDED.mime_type, status = 'pending', updated_at = now()
		 RETURNING id`,
		tenantID, name, size, mime,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("storage: insert pending: %w", err)
	}
	return id, nil
}

// MarkCommitted flips a row to committed after the bytes land in S3.
func (s *PGStore) MarkCommitted(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE storage_objects SET status = 'committed', updated_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("storage: mark committed: %w", err)
	}
	return nil
}

// DeletePending removes a pending reservation whose upload failed (compensation).
func (s *PGStore) DeletePending(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM storage_objects WHERE id = $1 AND status = 'pending'`, id)
	if err != nil {
		return fmt.Errorf("storage: delete pending: %w", err)
	}
	return nil
}
