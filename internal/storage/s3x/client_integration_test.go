// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

//go:build integration

// Integration test for the s3x client against a REAL S3-compatible server
// (MinIO). Proves the hand-rolled SigV4 signer authenticates correctly against a
// real backend — the one thing unit tests with httptest cannot. Run with:
//
//	S3X_TEST_ENDPOINT=http://127.0.0.1:19000 S3X_TEST_BUCKET=theo-storage-itest \
//	S3X_TEST_ACCESS_KEY=... S3X_TEST_SECRET_KEY=... \
//	go test -tags=integration ./internal/storage/s3x/...
package s3x

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"testing"
)

func integrationClient(t *testing.T) *Client {
	t.Helper()
	ep := os.Getenv("S3X_TEST_ENDPOINT")
	if ep == "" {
		t.Skip("S3X_TEST_ENDPOINT not set — skipping s3x integration test")
	}
	c, err := New(Config{
		Endpoint:  ep,
		Bucket:    os.Getenv("S3X_TEST_BUCKET"),
		Region:    "us-east-1",
		AccessKey: os.Getenv("S3X_TEST_ACCESS_KEY"),
		SecretKey: os.Getenv("S3X_TEST_SECRET_KEY"),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

// TestS3X_RoundTrip_RealMinIO proves put→head→get→delete works end-to-end against
// a real S3 server with the hand-rolled SigV4 signature.
func TestS3X_RoundTrip_RealMinIO(t *testing.T) {
	c := integrationClient(t)
	ctx := context.Background()
	key := "tenant-itest/dogfood/roundtrip.txt"
	payload := []byte("theo s3x hand-rolled sigv4 round-trip proof")

	// PUT
	if err := c.PutObject(ctx, key, bytes.NewReader(payload), int64(len(payload)), "text/plain"); err != nil {
		t.Fatalf("PutObject against real MinIO: %v", err)
	}

	// HEAD — metadata visible
	info, err := c.HeadObject(ctx, key)
	if err != nil {
		t.Fatalf("HeadObject: %v", err)
	}
	if info.Size != int64(len(payload)) {
		t.Errorf("head size = %d, want %d", info.Size, len(payload))
	}

	// GET — bytes identical
	rc, getInfo, err := c.GetObject(ctx, key)
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	got, _ := io.ReadAll(rc)
	rc.Close()
	if !bytes.Equal(got, payload) {
		t.Errorf("round-trip bytes mismatch:\n got: %q\nwant: %q", got, payload)
	}
	if getInfo.ContentType != "text/plain" {
		t.Errorf("content-type = %q, want text/plain", getInfo.ContentType)
	}

	// DELETE
	if err := c.DeleteObject(ctx, key); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}

	// GET after delete → ErrObjectNotFound
	if _, _, err := c.GetObject(ctx, key); !errors.Is(err, ErrObjectNotFound) {
		t.Errorf("GetObject after delete = %v, want ErrObjectNotFound", err)
	}
}

// TestS3X_TenantKeyIsolation_RealMinIO proves two tenants' identical paths map to
// DISTINCT objects in the real bucket (EC-1 at the bytes layer).
func TestS3X_TenantKeyIsolation_RealMinIO(t *testing.T) {
	c := integrationClient(t)
	ctx := context.Background()

	if err := c.PutObject(ctx, "tn-a/shared.txt", bytes.NewReader([]byte("A")), 1, "text/plain"); err != nil {
		t.Fatalf("put A: %v", err)
	}
	if err := c.PutObject(ctx, "tn-b/shared.txt", bytes.NewReader([]byte("B")), 1, "text/plain"); err != nil {
		t.Fatalf("put B: %v", err)
	}

	rcA, _, _ := c.GetObject(ctx, "tn-a/shared.txt")
	a, _ := io.ReadAll(rcA)
	rcA.Close()
	rcB, _, _ := c.GetObject(ctx, "tn-b/shared.txt")
	b, _ := io.ReadAll(rcB)
	rcB.Close()

	if string(a) != "A" || string(b) != "B" {
		t.Errorf("cross-tenant collision: A=%q B=%q (must be A/B)", a, b)
	}
	_ = c.DeleteObject(ctx, "tn-a/shared.txt")
	_ = c.DeleteObject(ctx, "tn-b/shared.txt")
}
