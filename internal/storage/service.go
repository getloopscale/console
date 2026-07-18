// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"
	"io"
	"strings"
	"time"
)

// ObjectStore is the DIP boundary between the storage service and the concrete
// S3-compatible backend (internal/storage/s3x implements it). Handlers and the
// quota logic depend on this interface, so unit tests mock it and integration
// tests use the real client (architecture.md § 2 / blueprint ADR D4).
type ObjectStore interface {
	PutObject(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	GetObject(ctx context.Context, key string) (io.ReadCloser, ObjectMeta, error)
	HeadObject(ctx context.Context, key string) (ObjectMeta, error)
	DeleteObject(ctx context.Context, key string) error
	// PresignPut/PresignGet mint short-lived direct-to-S3 URLs so the bytes never
	// flow through the BFF (the presigned data-plane; orchestrator M2/M3).
	PresignPut(key string, expires time.Duration) (string, error)
	PresignGet(key string, expires time.Duration) (string, error)
}

// ObjectMeta mirrors the backend's object metadata (kept distinct from s3x's
// type so the domain does not depend on the adapter package).
type ObjectMeta struct {
	Size        int64
	ContentType string
}

// KeyForTenant derives the S3 object key for a (tenant, path) pair. The tenant
// prefix is ALWAYS applied server-side (plan EC-1 — cross-tenant isolation at the
// bytes layer): two tenants using the same path map to DISTINCT S3 keys. The path
// is cleaned of a leading slash; callers MUST have already validated it (no "..",
// no control chars) at the request boundary.
func KeyForTenant(tenantID, path string) string {
	return tenantID + "/" + strings.TrimPrefix(path, "/")
}
