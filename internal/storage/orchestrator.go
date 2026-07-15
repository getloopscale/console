// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/usetheodev/theo-cloud/internal/storage/share"
)

// TierResolver resolves a tenant's plan tier (e.g. "pro") — implemented over the
// subscriptions table (cost_aggregator pattern). Injected so storage does not
// depend on billing internals (DIP).
type TierResolver interface {
	TierForTenant(ctx context.Context, tenantID string) (string, error)
}

// Meter records committed storage usage (Prometheus + cost_counters). Injected
// (DIP) so the orchestrator does not import the metrics package directly.
type Meter interface {
	RecordStorageBytes(ctx context.Context, tenantID, tier string, deltaBytes int64) error
}

// Service orchestrates the storage vertical: it composes the object backend, the
// metadata store, per-tenant quota, and the share-token signer. HTTP handlers
// (API + dashboard BFF) call these methods; the methods own the security-critical
// invariants (tenant-namespaced keys, quota reserve/commit/compensate).
type Service struct {
	store  ObjectStore
	meta   MetaStore
	tiers  TierResolver
	meter  Meter
	shares *share.Signer

	shareTTLDefault time.Duration
	shareTTLMax     time.Duration
}

// NewService wires the storage service. shareSecret keys the HMAC share tokens.
func NewService(store ObjectStore, meta MetaStore, tiers TierResolver, meter Meter, shareSecret string) *Service {
	return &Service{
		store:           store,
		meta:            meta,
		tiers:           tiers,
		meter:           meter,
		shares:          share.New(shareSecret, nil),
		shareTTLDefault: 15 * time.Minute,
		shareTTLMax:     7 * 24 * time.Hour,
	}
}

// Upload validates the path, reserves quota under the tenant lock, streams the
// bytes to the tenant-namespaced S3 key, then commits — compensating (deleting
// the pending reservation) if the byte upload fails, so a failed upload never
// leaves quota consumed (blueprint ADR D2 / Q3).
func (s *Service) Upload(ctx context.Context, tenantID, path string, body io.Reader, size int64, mime string) error {
	if err := ValidatePath(path); err != nil {
		return err
	}
	tier, err := s.tiers.TierForTenant(ctx, tenantID)
	if err != nil {
		return err
	}
	q := NewQuota(s.meta, tier)

	res, err := q.Reserve(ctx, tenantID, path, size, mime)
	if err != nil {
		return err // FileTooLargeError / QuotaExceededError / store error
	}

	key := KeyForTenant(tenantID, path)
	if err := s.store.PutObject(ctx, key, body, size, mime); err != nil {
		// Compensate restores a replaced object or removes the pending row. A
		// compensation failure is exactly what would orphan a pending row, so it
		// is logged (never silently swallowed).
		if cerr := q.Compensate(ctx, res); cerr != nil {
			slog.ErrorContext(ctx, "storage: compensation failed after upload error — pending row may linger",
				"tenant", tenantID, "path", path, "compensate_err", cerr, "upload_err", err)
		}
		return err
	}
	if err := q.Commit(ctx, res); err != nil {
		return err
	}
	if s.meter != nil {
		_ = s.meter.RecordStorageBytes(ctx, tenantID, tier, size)
	}
	return nil
}

// Download validates the path and returns a streaming reader + metadata for the
// tenant's object. The caller MUST Close the reader.
func (s *Service) Download(ctx context.Context, tenantID, path string) (io.ReadCloser, ObjectMeta, error) {
	if err := ValidatePath(path); err != nil {
		return nil, ObjectMeta{}, err
	}
	if _, err := s.meta.GetMeta(ctx, tenantID, path); err != nil {
		return nil, ObjectMeta{}, err // ErrObjectNotFoundMeta → 404
	}
	return s.store.GetObject(ctx, KeyForTenant(tenantID, path))
}

// Stat returns metadata for a tenant's object without the body.
func (s *Service) Stat(ctx context.Context, tenantID, path string) (ObjectRecord, error) {
	if err := ValidatePath(path); err != nil {
		return ObjectRecord{}, err
	}
	return s.meta.GetMeta(ctx, tenantID, path)
}

// List returns committed objects under prefix (keyset pagination).
func (s *Service) List(ctx context.Context, tenantID, prefix string, limit int, cursor string) ([]ObjectRecord, string, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	return s.meta.ListByPrefix(ctx, tenantID, prefix, limit, cursor)
}

// Delete removes a tenant's object from the backend then its metadata row.
func (s *Service) Delete(ctx context.Context, tenantID, path string) error {
	if err := ValidatePath(path); err != nil {
		return err
	}
	if err := s.store.DeleteObject(ctx, KeyForTenant(tenantID, path)); err != nil {
		return err
	}
	return s.meta.DeleteByName(ctx, tenantID, path)
}

// bulkDeleteMaxObjects bounds a single DeletePrefix so a pathological prefix
// cannot turn into an unbounded server loop (D3). A var (not const) so tests can
// lower it; realistic folders are far below it (e.g. skills/ ≈ 548).
var bulkDeleteMaxObjects = 10000

// FailedDelete records one object that could not be deleted during a bulk op.
type FailedDelete struct {
	Path   string
	Reason string
}

// BulkDeleteResult is the partial-failure-aware outcome of a bulk/prefix delete
// (D4): successes and failures are BOTH reported — a per-object failure never
// aborts the batch nor masks the successes.
type BulkDeleteResult struct {
	Deleted   int
	Freed     int64
	Failed    []FailedDelete
	Truncated bool
}

// safePrefix guards the mass-delete blast radius (EC-2 + EC-3): a folder prefix
// MUST be non-empty, end with "/" (so List matches only true folder members, not
// a substring sibling like READ→README.md), and contain no traversal — otherwise
// a crafted prefix could enumerate + delete the tenant's entire storage.
func safePrefix(prefix string) bool {
	return prefix != "" &&
		strings.HasSuffix(prefix, "/") &&
		!strings.Contains(prefix, "..") &&
		!strings.HasPrefix(prefix, "/") &&
		prefix != "./"
}

// DeletePrefix removes every committed object under prefix (a folder), tenant-
// scoped. Bounded by bulkDeleteMaxObjects (D3). A not-found is idempotent success,
// not a failure (D5/EC-1: overlapping selections and re-clicks are safe). A real
// store error is recorded in Failed and the loop continues (D4). A failure to LIST
// is surfaced as an error (the caller could not even enumerate).
func (s *Service) DeletePrefix(ctx context.Context, tenantID, prefix string) (BulkDeleteResult, error) {
	var res BulkDeleteResult
	if !safePrefix(prefix) {
		return res, ErrInvalidPath
	}
	cursor := ""
	seen := 0
	for {
		recs, next, err := s.List(ctx, tenantID, prefix, 1000, cursor)
		if err != nil {
			return res, err
		}
		for _, rec := range recs {
			if seen >= bulkDeleteMaxObjects {
				res.Truncated = true
				return res, nil
			}
			seen++
			if err := s.Delete(ctx, tenantID, rec.Name); err == nil || errors.Is(err, ErrObjectNotFoundMeta) {
				res.Deleted++
				res.Freed += rec.SizeBytes
			} else {
				res.Failed = append(res.Failed, FailedDelete{Path: rec.Name, Reason: codeForBulkErr(err)})
			}
		}
		if next == "" {
			break
		}
		cursor = next
	}
	return res, nil
}

// codeForBulkErr maps a delete error to a stable, product-safe reason string for
// the Failed[] rows (never leaks the raw backend message).
func codeForBulkErr(err error) string {
	switch {
	case errors.Is(err, ErrInvalidPath):
		return "invalid_path"
	case errors.Is(err, ErrObjectNotFoundMeta):
		return "file_not_found"
	default:
		return "storage_unavailable"
	}
}

// Share mints a capability token for (tenant, path). ttl is clamped to
// [1s, shareTTLMax]; zero uses the default.
func (s *Service) Share(ctx context.Context, tenantID, path string, ttl time.Duration) (token string, expires time.Time, err error) {
	if err := ValidatePath(path); err != nil {
		return "", time.Time{}, err
	}
	if _, err := s.meta.GetMeta(ctx, tenantID, path); err != nil {
		return "", time.Time{}, err // can't share what doesn't exist → 404
	}
	if ttl <= 0 {
		ttl = s.shareTTLDefault
	}
	if ttl > s.shareTTLMax {
		return "", time.Time{}, ErrShareTTLTooLong
	}
	tok := s.shares.Mint(tenantID, path, ttl)
	return tok, time.Now().Add(ttl), nil
}

// Usage reports the tenant's current aggregate usage and their plan's caps —
// powers the dashboard quota bar. AggregateLimit is -1 (Unlimited) for Enterprise.
func (s *Service) Usage(ctx context.Context, tenantID string) (UsageInfo, error) {
	tier, err := s.tiers.TierForTenant(ctx, tenantID)
	if err != nil {
		return UsageInfo{}, err
	}
	used, err := s.meta.SumBytes(ctx, tenantID)
	if err != nil {
		return UsageInfo{}, err
	}
	caps := CapsForTier(tier)
	return UsageInfo{
		UsedBytes:      used,
		AggregateLimit: caps.AggregateBytes,
		PerFileLimit:   caps.PerFileBytes,
		Tier:           tier,
	}, nil
}

// UsageInfo is the tenant's storage usage snapshot.
type UsageInfo struct {
	UsedBytes      int64
	AggregateLimit int64 // -1 = unlimited
	PerFileLimit   int64
	Tier           string
}

// Redeem verifies a share token and returns a streaming reader for the object.
// The S3 key is re-derived from the token's tenant claim (never client input) —
// EC-1 isolation on the unauthenticated route.
func (s *Service) Redeem(ctx context.Context, token string) (io.ReadCloser, ObjectMeta, error) {
	claims, err := s.shares.Redeem(token)
	if err != nil {
		return nil, ObjectMeta{}, err // ErrExpired → 410, ErrInvalid → 403
	}
	if _, err := s.meta.GetMeta(ctx, claims.TenantID, claims.Path); err != nil {
		return nil, ObjectMeta{}, err // deleted after mint → 404
	}
	return s.store.GetObject(ctx, KeyForTenant(claims.TenantID, claims.Path))
}

// ErrShareTTLTooLong is returned when a requested share TTL exceeds the max.
// Handlers map it to HTTP 400.
var ErrShareTTLTooLong = errShareTTL

var errShareTTL = errorString("storage: share ttl exceeds maximum (7d)")

type errorString string

func (e errorString) Error() string { return string(e) }
