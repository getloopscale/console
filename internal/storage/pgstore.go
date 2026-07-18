// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
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

// InsertPending reserves a row. It first captures any prior COMMITTED row for the
// same (tenant, name) — inside the same locked tx — so an overwrite-then-fail can
// restore it (HIGH-4). Then it upserts to pending and returns the reservation.
func (s *PGStore) InsertPending(ctx context.Context, tenantID, name string, size int64, mime string) (Reservation, error) {
	q := txFrom(ctx, s.db)

	// Capture prior committed state (if any) before we flip the row to pending.
	var priorSize int64
	var priorMime string
	priorCommitted := false
	err := q.QueryRowContext(ctx,
		`SELECT size_bytes, mime_type FROM storage_objects
		 WHERE tenant_id = $1 AND name = $2 AND status = 'committed'`,
		tenantID, name,
	).Scan(&priorSize, &priorMime)
	if err == nil {
		priorCommitted = true
	} else if err != sql.ErrNoRows {
		return Reservation{}, fmt.Errorf("storage: read prior: %w", err)
	}

	var id string
	err = q.QueryRowContext(ctx,
		`INSERT INTO storage_objects (tenant_id, name, size_bytes, mime_type, status)
		 VALUES ($1, $2, $3, $4, 'pending')
		 ON CONFLICT (tenant_id, name) DO UPDATE SET size_bytes = EXCLUDED.size_bytes,
		     mime_type = EXCLUDED.mime_type, status = 'pending', updated_at = now()
		 RETURNING id`,
		tenantID, name, size, mime,
	).Scan(&id)
	if err != nil {
		return Reservation{}, fmt.Errorf("storage: insert pending: %w", err)
	}
	return Reservation{ID: id, PriorCommitted: priorCommitted, PriorSize: priorSize, PriorMime: priorMime}, nil
}

// RestorePrior reverts a replaced object back to committed with its prior size/
// mime (HIGH-4 — overwrite-then-fail must not destroy the prior object).
func (s *PGStore) RestorePrior(ctx context.Context, id string, priorSize int64, priorMime string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE storage_objects SET status = 'committed', size_bytes = $2, mime_type = $3, updated_at = now()
		 WHERE id = $1`,
		id, priorSize, priorMime)
	if err != nil {
		return fmt.Errorf("storage: restore prior: %w", err)
	}
	return nil
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

// PendingSizeByName returns the declared size of the pending row for (tenant,
// name), or ErrObjectNotFoundMeta when there is no pending upload — the two-phase
// presign commit addresses the reservation by name (the mint/commit are separate
// requests). Scoped to status='pending' so a committed object is never re-committed.
func (s *PGStore) PendingSizeByName(ctx context.Context, tenantID, name string) (int64, error) {
	var size int64
	err := s.db.QueryRowContext(ctx,
		`SELECT size_bytes FROM storage_objects
		 WHERE tenant_id = $1 AND name = $2 AND status = 'pending'`,
		tenantID, name,
	).Scan(&size)
	if err == sql.ErrNoRows {
		return 0, ErrObjectNotFoundMeta
	}
	if err != nil {
		return 0, fmt.Errorf("storage: pending size by name: %w", err)
	}
	return size, nil
}

// MarkCommittedByName flips the pending row for (tenant, name) to committed.
func (s *PGStore) MarkCommittedByName(ctx context.Context, tenantID, name string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE storage_objects SET status = 'committed', updated_at = now()
		 WHERE tenant_id = $1 AND name = $2 AND status = 'pending'`,
		tenantID, name)
	if err != nil {
		return fmt.Errorf("storage: mark committed by name: %w", err)
	}
	return nil
}

// DeletePendingByName releases the pending reservation for (tenant, name) so a
// failed / aborted presigned upload never holds quota.
func (s *PGStore) DeletePendingByName(ctx context.Context, tenantID, name string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM storage_objects WHERE tenant_id = $1 AND name = $2 AND status = 'pending'`,
		tenantID, name)
	if err != nil {
		return fmt.Errorf("storage: delete pending by name: %w", err)
	}
	return nil
}

// GetMeta returns a committed object's metadata, or ErrObjectNotFoundMeta.
func (s *PGStore) GetMeta(ctx context.Context, tenantID, name string) (ObjectRecord, error) {
	var r ObjectRecord
	err := s.db.QueryRowContext(ctx,
		`SELECT name, size_bytes, mime_type FROM storage_objects
		 WHERE tenant_id = $1 AND name = $2 AND status = 'committed'`,
		tenantID, name,
	).Scan(&r.Name, &r.SizeBytes, &r.MimeType)
	if err == sql.ErrNoRows {
		return ObjectRecord{}, ErrObjectNotFoundMeta
	}
	if err != nil {
		return ObjectRecord{}, fmt.Errorf("storage: get meta: %w", err)
	}
	return r, nil
}

// ListByPrefix returns committed objects whose name starts with prefix, ordered
// by name, using keyset pagination (name > cursor). nextCursor is the last name
// returned when the page is full, else "".
func (s *PGStore) ListByPrefix(ctx context.Context, tenantID, prefix string, limit int, cursor string) ([]ObjectRecord, string, error) {
	// MEDIUM-2: escape LIKE metacharacters so a prefix containing %, _ or \ is
	// treated literally (a bare `%` prefix must NOT list the whole store). ESCAPE
	// '\' makes the backslash the escape char.
	escaped := likeEscape(prefix)
	rows, err := s.db.QueryContext(ctx,
		`SELECT name, size_bytes, mime_type FROM storage_objects
		 WHERE tenant_id = $1 AND status = 'committed' AND name LIKE $2 || '%' ESCAPE '\' AND name > $3
		 ORDER BY name ASC LIMIT $4`,
		tenantID, escaped, cursor, limit,
	)
	if err != nil {
		return nil, "", fmt.Errorf("storage: list: %w", err)
	}
	defer rows.Close()

	var out []ObjectRecord
	for rows.Next() {
		var r ObjectRecord
		if err := rows.Scan(&r.Name, &r.SizeBytes, &r.MimeType); err != nil {
			return nil, "", fmt.Errorf("storage: list scan: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("storage: list rows: %w", err)
	}
	next := ""
	if len(out) == limit && limit > 0 {
		next = out[len(out)-1].Name
	}
	return out, next, nil
}

// likeEscape escapes the LIKE metacharacters (\, %, _) so the prefix matches
// literally under `ESCAPE '\'`.
func likeEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// DeleteByName removes a committed object's metadata row.
func (s *PGStore) DeleteByName(ctx context.Context, tenantID, name string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM storage_objects WHERE tenant_id = $1 AND name = $2`, tenantID, name)
	if err != nil {
		return fmt.Errorf("storage: delete by name: %w", err)
	}
	return nil
}
