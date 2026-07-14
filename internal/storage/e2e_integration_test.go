// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

//go:build integration

// End-to-end integration test of the WHOLE storage vertical against real
// Postgres + real MinIO. This is the strongest local proof the system works:
// the real Service (real PGStore + real s3x client + share signer) runs the
// full chain upload→stat→list→download→share→redeem→delete→404, plus quota
// enforcement, exactly as production would (minus the HTTP layer). Run with:
//
//	STORAGE_TEST_DATABASE_URL=postgres://... \
//	S3X_TEST_ENDPOINT=http://127.0.0.1:19000 S3X_TEST_BUCKET=theo-storage-itest \
//	S3X_TEST_ACCESS_KEY=... S3X_TEST_SECRET_KEY=... \
//	go test -tags=integration ./internal/storage/ -run E2E
package storage

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/usetheodev/theo-cloud/internal/storage/s3x"
)

type fixedTier struct{ tier string }

func (f fixedTier) TierForTenant(ctx context.Context, t string) (string, error) { return f.tier, nil }

// realService wires the actual Service with a real PGStore + real s3x client
// (via the in-package s3Adapter) and a fixed tier, so the e2e exercises the true
// production code path without the subscriptions table.
func realService(t *testing.T, tier string) (*Service, *sql.DB) {
	t.Helper()
	dbURL := os.Getenv("STORAGE_TEST_DATABASE_URL")
	ep := os.Getenv("S3X_TEST_ENDPOINT")
	if dbURL == "" || ep == "" {
		t.Skip("STORAGE_TEST_DATABASE_URL / S3X_TEST_ENDPOINT not set — skipping storage e2e")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		t.Fatalf("ping db: %v", err)
	}
	client, err := s3x.New(s3x.Config{
		Endpoint:  ep,
		Bucket:    os.Getenv("S3X_TEST_BUCKET"),
		Region:    "us-east-1",
		AccessKey: os.Getenv("S3X_TEST_ACCESS_KEY"),
		SecretKey: os.Getenv("S3X_TEST_SECRET_KEY"),
	})
	if err != nil {
		t.Fatalf("s3x.New: %v", err)
	}
	svc := NewService(&s3Adapter{c: client}, NewPGStore(db), fixedTier{tier}, NewPromMeter(), "this-is-a-32char-minimum-share-secret!")
	return svc, db
}

func TestE2E_FullChain_RealPGAndMinIO(t *testing.T) {
	svc, db := realService(t, "pro")
	defer db.Close()
	ctx := context.Background()
	const tenant = "tn-e2e"
	const path = "e2e/report.txt"
	payload := []byte("full-vertical e2e: real PG metadata + real MinIO bytes")
	_, _ = db.Exec(`DELETE FROM storage_objects WHERE tenant_id = $1`, tenant)
	defer db.Exec(`DELETE FROM storage_objects WHERE tenant_id = $1`, tenant)

	// upload
	if err := svc.Upload(ctx, tenant, path, bytes.NewReader(payload), int64(len(payload)), "text/plain"); err != nil {
		t.Fatalf("Upload: %v", err)
	}

	// stat
	rec, err := svc.Stat(ctx, tenant, path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if rec.SizeBytes != int64(len(payload)) {
		t.Errorf("stat size = %d, want %d", rec.SizeBytes, len(payload))
	}

	// list
	files, _, err := svc.List(ctx, tenant, "e2e/", 100, "")
	if err != nil || len(files) != 1 || files[0].Name != path {
		t.Fatalf("List = %v (err %v), want [%s]", files, err, path)
	}

	// download — bytes identical (through real MinIO)
	rc, _, err := svc.Download(ctx, tenant, path)
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	got, _ := io.ReadAll(rc)
	rc.Close()
	if !bytes.Equal(got, payload) {
		t.Errorf("download bytes mismatch:\n got %q\nwant %q", got, payload)
	}

	// share → redeem (bytes identical)
	tok, _, err := svc.Share(ctx, tenant, path, 0)
	if err != nil {
		t.Fatalf("Share: %v", err)
	}
	rrc, _, err := svc.Redeem(ctx, tok)
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	rgot, _ := io.ReadAll(rrc)
	rrc.Close()
	if !bytes.Equal(rgot, payload) {
		t.Errorf("redeem bytes mismatch: got %q", rgot)
	}

	// delete → 404
	if err := svc.Delete(ctx, tenant, path); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := svc.Stat(ctx, tenant, path); !errors.Is(err, ErrObjectNotFoundMeta) {
		t.Errorf("Stat after delete = %v, want ErrObjectNotFoundMeta", err)
	}
}

func TestE2E_QuotaAndOverwrite_RealInfra(t *testing.T) {
	svc, db := realService(t, "starter") // per-file 25MB, aggregate 100MB
	defer db.Close()
	ctx := context.Background()
	const tenant = "tn-e2e-quota"
	_, _ = db.Exec(`DELETE FROM storage_objects WHERE tenant_id = $1`, tenant)
	defer db.Exec(`DELETE FROM storage_objects WHERE tenant_id = $1`, tenant)

	// A file over the starter per-file cap (25MB) → 413.
	big := make([]byte, 26<<20)
	err := svc.Upload(ctx, tenant, "big.bin", bytes.NewReader(big), int64(len(big)), "application/octet-stream")
	var fe *FileTooLargeError
	if !errors.As(err, &fe) {
		t.Fatalf("oversize upload = %v, want *FileTooLargeError", err)
	}

	// HIGH-4 e2e: upload a good file, then overwrite-then-fail must not destroy it.
	if err := svc.Upload(ctx, tenant, "keep.txt", bytes.NewReader([]byte("original")), 8, "text/plain"); err != nil {
		t.Fatalf("first upload: %v", err)
	}
	// Overwrite with an oversize file → 413 (fails AFTER reserve replaces the row).
	err = svc.Upload(ctx, tenant, "keep.txt", bytes.NewReader(big), int64(len(big)), "application/octet-stream")
	if !errors.As(err, &fe) {
		// 413 is caught before the store; the prior object is untouched. Still assert it survives.
		t.Logf("overwrite rejected with: %v", err)
	}
	rec, err := svc.Stat(ctx, tenant, "keep.txt")
	if err != nil {
		t.Fatalf("prior object destroyed by overwrite attempt: %v", err)
	}
	if rec.SizeBytes != 8 {
		t.Errorf("prior object size = %d, want 8 (must survive overwrite-then-reject)", rec.SizeBytes)
	}
}
