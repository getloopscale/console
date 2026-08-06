// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"
	"database/sql"
	"io"
	"time"

	"github.com/usetheoai/theo-cloud/internal/storage/s3x"
)

// BackendConfig is the subset of the service config the storage factory needs
// (mirrors the config.Config storage fields; passed explicitly to keep this
// package independent of internal/config).
type BackendConfig struct {
	S3Endpoint       string
	S3PublicEndpoint string // browser-reachable host for minting presigned URLs
	S3Bucket         string
	S3Region         string
	S3AccessKey      string
	S3SecretKey      string
	ShareSecret      string
}

// BuildService wires the full storage Service from a DB and backend config — the
// composition helper cmd/main.go calls when the storage vertical is enabled.
// Callers gate on config.StorageEnabled() before calling.
func BuildService(db *sql.DB, cfg BackendConfig) (*Service, error) {
	client, err := s3x.New(s3x.Config{
		Endpoint:       cfg.S3Endpoint,
		PublicEndpoint: cfg.S3PublicEndpoint,
		Bucket:         cfg.S3Bucket,
		Region:         cfg.S3Region,
		AccessKey:      cfg.S3AccessKey,
		SecretKey:      cfg.S3SecretKey,
	})
	if err != nil {
		return nil, err
	}
	return NewService(
		&s3Adapter{c: client},
		NewPGStore(db),
		NewPGTierResolver(db),
		NewPromMeter(),
		cfg.ShareSecret,
	), nil
}

// s3Adapter bridges *s3x.Client to the storage.ObjectStore interface, translating
// s3x.ObjectInfo → storage.ObjectMeta so the domain does not depend on the adapter
// package's type.
type s3Adapter struct{ c *s3x.Client }

func (a *s3Adapter) PutObject(ctx context.Context, key string, body io.Reader, size int64, ct string) error {
	return a.c.PutObject(ctx, key, body, size, ct)
}

func (a *s3Adapter) GetObject(ctx context.Context, key string) (io.ReadCloser, ObjectMeta, error) {
	rc, info, err := a.c.GetObject(ctx, key)
	if err != nil {
		return nil, ObjectMeta{}, err
	}
	return rc, ObjectMeta{Size: info.Size, ContentType: info.ContentType}, nil
}

func (a *s3Adapter) HeadObject(ctx context.Context, key string) (ObjectMeta, error) {
	info, err := a.c.HeadObject(ctx, key)
	if err != nil {
		return ObjectMeta{}, err
	}
	return ObjectMeta{Size: info.Size, ContentType: info.ContentType}, nil
}

func (a *s3Adapter) DeleteObject(ctx context.Context, key string) error {
	return a.c.DeleteObject(ctx, key)
}

func (a *s3Adapter) PresignPut(key string, expires time.Duration) (string, error) {
	return a.c.PresignPut(key, expires)
}

func (a *s3Adapter) PresignGet(key string, expires time.Duration) (string, error) {
	return a.c.PresignGet(key, expires)
}

// Compile-time interface assertions.
var (
	_ ObjectStore  = (*s3Adapter)(nil)
	_ MetaStore    = (*PGStore)(nil)
	_ TierResolver = (*PGTierResolver)(nil)
	_ Meter        = (*PromMeter)(nil)
)
