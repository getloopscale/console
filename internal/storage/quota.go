// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"
	"fmt"
)

// QuotaExceededError is returned when an upload would push the tenant's aggregate
// usage past its plan cap. Handlers map it to HTTP 402 (STORAGE_QUOTA_EXCEEDED).
// It is DISTINCT from FileTooLargeError (413) — the two are never merged (grill
// decision 8 / blueprint Q3).
type QuotaExceededError struct {
	UsedBytes  int64
	LimitBytes int64
	AddBytes   int64
}

func (e *QuotaExceededError) Error() string {
	return fmt.Sprintf("storage quota exceeded: used %d + %d > limit %d", e.UsedBytes, e.AddBytes, e.LimitBytes)
}

// FileTooLargeError is returned when a single object exceeds the plan's per-file
// cap. Handlers map it to HTTP 413 (FILE_TOO_LARGE).
type FileTooLargeError struct {
	SizeBytes    int64
	MaxFileBytes int64
}

func (e *FileTooLargeError) Error() string {
	return fmt.Sprintf("file too large: %d > per-file limit %d", e.SizeBytes, e.MaxFileBytes)
}

// MetaStore is the metadata persistence boundary (Postgres storage_objects table).
// WithTenantLock serializes the reserve step per tenant via pg_advisory_xact_lock
// so two concurrent uploads cannot both pass a stale SUM check (blueprint ADR D2 —
// money-adjacent invariant). Implemented by internal/storage/pg (T2.3 runtime).
type MetaStore interface {
	// WithTenantLock runs fn inside a transaction holding the tenant's advisory
	// xact lock. All SumBytes/InsertPending inside fn are serialized per tenant.
	WithTenantLock(ctx context.Context, tenantID string, fn func(context.Context) error) error
	SumBytes(ctx context.Context, tenantID string) (int64, error)
	// InsertPending reserves a row and reports whether it REPLACED a previously-
	// committed object (with that object's prior size/mime) so a later failure can
	// restore it instead of destroying it.
	InsertPending(ctx context.Context, tenantID, name string, size int64, mime string) (Reservation, error)
	MarkCommitted(ctx context.Context, id string) error
	DeletePending(ctx context.Context, id string) error

	// By-name variants for the two-phase presigned upload: the mint and the commit
	// are SEPARATE HTTP requests, so the commit does not hold the in-memory
	// Reservation — it addresses the pending row by (tenant, name), unique per the
	// storage_objects(tenant_id, name) constraint. PendingSizeByName returns the
	// declared size of the pending row (ErrObjectNotFoundMeta if none).
	PendingSizeByName(ctx context.Context, tenantID, name string) (int64, error)
	MarkCommittedByName(ctx context.Context, tenantID, name string) error
	DeletePendingByName(ctx context.Context, tenantID, name string) error

	// RestorePrior reverts a reservation that REPLACED a previously-committed
	// object back to that committed object (HIGH-4 fix — an overwrite-then-fail
	// must not destroy the prior good object).
	RestorePrior(ctx context.Context, id string, priorSize int64, priorMime string) error

	// Object read/list/delete ops (committed rows only, always tenant-scoped).
	GetMeta(ctx context.Context, tenantID, name string) (ObjectRecord, error)
	ListByPrefix(ctx context.Context, tenantID, prefix string, limit int, cursor string) (records []ObjectRecord, nextCursor string, err error)
	DeleteByName(ctx context.Context, tenantID, name string) error
}

// ObjectRecord is a committed object's metadata row.
type ObjectRecord struct {
	Name      string
	SizeBytes int64
	MimeType  string
}

// ErrObjectNotFoundMeta is returned by GetMeta when no committed row matches.
// Handlers map it to HTTP 404.
var ErrObjectNotFoundMeta = fmt.Errorf("storage: object metadata not found")

// Reservation is the outcome of a successful Reserve: the pending row id plus,
// when the reserve replaced an existing committed object, that object's prior
// state (so Compensate can restore it on failure — HIGH-4 fix).
type Reservation struct {
	ID             string
	PriorCommitted bool
	PriorSize      int64
	PriorMime      string
}

// Quota enforces per-tenant storage caps using the reserve→commit→compensate
// protocol (blueprint ADR D2).
type Quota struct {
	store MetaStore
	caps  Caps
}

// NewQuota builds a Quota for a tenant's plan tier.
func NewQuota(store MetaStore, tier string) *Quota {
	return &Quota{store: store, caps: CapsForTier(tier)}
}

// Reserve checks caps and, if within budget, inserts a pending metadata row —
// all under the tenant advisory lock so concurrent uploads can't overshoot.
// Order matters: the per-file check runs FIRST, before ANY store interaction, so
// an oversize upload is rejected without a DB round-trip (plan T2.3).
// Returns the pending object id; caller then uploads bytes and calls Commit (or
// Compensate on failure).
func (q *Quota) Reserve(ctx context.Context, tenantID, name string, size int64, mime string) (Reservation, error) {
	if q.caps.PerFileBytes != Unlimited && size > q.caps.PerFileBytes {
		return Reservation{}, &FileTooLargeError{SizeBytes: size, MaxFileBytes: q.caps.PerFileBytes}
	}

	var res Reservation
	err := q.store.WithTenantLock(ctx, tenantID, func(ctx context.Context) error {
		used, err := q.store.SumBytes(ctx, tenantID)
		if err != nil {
			return err
		}
		if q.caps.AggregateBytes != Unlimited && used+size > q.caps.AggregateBytes {
			return &QuotaExceededError{UsedBytes: used, LimitBytes: q.caps.AggregateBytes, AddBytes: size}
		}
		res, err = q.store.InsertPending(ctx, tenantID, name, size, mime)
		return err
	})
	if err != nil {
		return Reservation{}, err
	}
	return res, nil
}

// Commit marks a reserved object as committed (bytes uploaded successfully).
func (q *Quota) Commit(ctx context.Context, res Reservation) error {
	return q.store.MarkCommitted(ctx, res.ID)
}

// Compensate reverses a reservation whose upload failed. If the reserve REPLACED
// a previously-committed object, the prior object is RESTORED (not deleted) so an
// overwrite-then-fail never destroys good data (HIGH-4). Otherwise the pending row
// is removed (blueprint Q3 compensation).
func (q *Quota) Compensate(ctx context.Context, res Reservation) error {
	if res.PriorCommitted {
		return q.store.RestorePrior(ctx, res.ID, res.PriorSize, res.PriorMime)
	}
	return q.store.DeletePending(ctx, res.ID)
}
