// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package storage

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// Presigned-URL TTLs. Short by design: the URL carries full authorization, so a
// leaked URL is only usable within this window (blueprint EC — bound URL leakage).
const (
	PresignUploadTTL   = 5 * time.Minute
	PresignDownloadTTL = 5 * time.Minute
)

// UploadNotCompletedError is returned by CommitUpload when the object is absent
// in S3 (the client never PUT the bytes, or aborted). Handlers map it to 409.
type UploadNotCompletedError struct{ Path string }

func (e *UploadNotCompletedError) Error() string {
	return fmt.Sprintf("storage: presigned upload not completed for %q", e.Path)
}

// SizeMismatchError is returned by CommitUpload when the object actually stored in
// S3 does not match the size the client declared at mint time (quota was reserved
// against the declared size). Handlers map it to 409. The mismatched object is
// deleted and the reservation released so a client cannot bypass the quota by
// declaring a small size and uploading a large body.
type SizeMismatchError struct {
	Path     string
	Declared int64
	Actual   int64
}

func (e *SizeMismatchError) Error() string {
	return fmt.Sprintf("storage: presigned upload size mismatch for %q: declared %d, stored %d",
		e.Path, e.Declared, e.Actual)
}

// PresignUpload reserves quota and a pending metadata row, then mints a presigned
// PUT URL so the client uploads the bytes DIRECTLY to S3 — the BFF never touches
// the data plane (the bottleneck the presigned path removes). The upload is
// finalized by CommitUpload. If minting fails the reservation is compensated, so a
// failed mint never holds quota (mirrors Upload's reserve/compensate discipline).
//
// The tenant-namespaced key is derived server-side (never client-controlled), so
// two tenants uploading the same path get distinct S3 keys (isolation invariant).
func (s *Service) PresignUpload(ctx context.Context, tenantID, path string, size int64, mime string) (string, time.Time, error) {
	if err := ValidatePath(path); err != nil {
		return "", time.Time{}, err
	}
	tier, err := s.tiers.TierForTenant(ctx, tenantID)
	if err != nil {
		return "", time.Time{}, err
	}
	q := NewQuota(s.meta, tier)

	res, err := q.Reserve(ctx, tenantID, path, size, mime)
	if err != nil {
		return "", time.Time{}, err // FileTooLargeError / QuotaExceededError / store error
	}

	key := KeyForTenant(tenantID, path)
	url, err := s.store.PresignPut(key, PresignUploadTTL)
	if err != nil {
		if cerr := q.Compensate(ctx, res); cerr != nil {
			slog.ErrorContext(ctx, "storage: compensation failed after presign-mint error — pending row may linger",
				"tenant", tenantID, "path", path, "compensate_err", cerr, "mint_err", err)
		}
		return "", time.Time{}, err
	}
	return url, time.Now().Add(PresignUploadTTL).UTC(), nil
}

// CommitUpload finalizes a presigned upload: it HEADs S3 to confirm the bytes
// actually landed (the BFF never saw them) and that their size matches what the
// client declared at mint time, then marks the pending row committed and meters
// the bytes. A missing object releases the reservation (409 UploadNotCompleted); a
// size mismatch deletes the object and releases the reservation (409 SizeMismatch).
func (s *Service) CommitUpload(ctx context.Context, tenantID, path string) error {
	if err := ValidatePath(path); err != nil {
		return err
	}

	declared, err := s.meta.PendingSizeByName(ctx, tenantID, path)
	if err != nil {
		// No pending reservation for this (tenant, path) — nothing to commit.
		if errors.Is(err, ErrObjectNotFoundMeta) {
			return &UploadNotCompletedError{Path: path}
		}
		return err
	}

	key := KeyForTenant(tenantID, path)
	info, err := s.store.HeadObject(ctx, key)
	if err != nil {
		// Client never uploaded — release the held reservation.
		if derr := s.meta.DeletePendingByName(ctx, tenantID, path); derr != nil {
			slog.ErrorContext(ctx, "storage: failed to release reservation for un-uploaded object",
				"tenant", tenantID, "path", path, "err", derr)
		}
		return &UploadNotCompletedError{Path: path}
	}

	if info.Size != declared {
		// The client uploaded a body whose size differs from the reserved size.
		// Delete the mismatched object and release the reservation (quota-bypass guard).
		if derr := s.store.DeleteObject(ctx, key); derr != nil {
			slog.ErrorContext(ctx, "storage: failed to delete size-mismatched object", "key", key, "err", derr)
		}
		if derr := s.meta.DeletePendingByName(ctx, tenantID, path); derr != nil {
			slog.ErrorContext(ctx, "storage: failed to release reservation after size mismatch",
				"tenant", tenantID, "path", path, "err", derr)
		}
		return &SizeMismatchError{Path: path, Declared: declared, Actual: info.Size}
	}

	if err := s.meta.MarkCommittedByName(ctx, tenantID, path); err != nil {
		return err
	}
	if s.meter != nil {
		tier, terr := s.tiers.TierForTenant(ctx, tenantID)
		if terr == nil {
			_ = s.meter.RecordStorageBytes(ctx, tenantID, tier, declared)
		}
	}
	return nil
}

// PresignDownload mints a short-lived presigned GET URL for a committed object so
// the client reads the bytes DIRECTLY from S3 (the BFF is out of the download data
// plane too). The object must exist as a committed row for this tenant (404
// otherwise); the key is tenant-derived server-side (isolation invariant).
func (s *Service) PresignDownload(ctx context.Context, tenantID, path string) (string, time.Time, error) {
	if err := ValidatePath(path); err != nil {
		return "", time.Time{}, err
	}
	if _, err := s.meta.GetMeta(ctx, tenantID, path); err != nil {
		return "", time.Time{}, err // ErrObjectNotFoundMeta → 404
	}
	url, err := s.store.PresignGet(KeyForTenant(tenantID, path), PresignDownloadTTL)
	if err != nil {
		return "", time.Time{}, err
	}
	return url, time.Now().Add(PresignDownloadTTL).UTC(), nil
}
