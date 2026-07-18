// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

//go:build integration

// Integration proof that the query-string SigV4 presigned URLs actually
// authenticate against a REAL S3 server (MinIO): mint a presigned PUT, upload
// bytes with a plain HTTP client (no signing headers — the auth is in the query),
// mint a presigned GET, read the bytes back. This is the only test that proves the
// presign SIGNATURE works, not just its format (blueprint ADR D2 mitigation). Run:
//
//	S3X_TEST_ENDPOINT=http://127.0.0.1:19000 S3X_TEST_BUCKET=theo-storage-itest \
//	S3X_TEST_ACCESS_KEY=... S3X_TEST_SECRET_KEY=... \
//	go test -tags=integration ./internal/storage/s3x/...
package s3x

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestPresign_RoundTrip_RealMinIO(t *testing.T) {
	c := integrationClient(t)
	ctx := context.Background()
	key := "tenant-presign-itest/dogfood/presigned.txt"
	payload := []byte("theo presigned-url direct-to-S3 round-trip proof")
	plain := &http.Client{Timeout: 30 * time.Second}

	// 1. Mint a presigned PUT and upload the bytes DIRECTLY (no BFF, no signing headers).
	putURL, err := c.PresignPut(key, 5*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	putReq, _ := http.NewRequestWithContext(ctx, http.MethodPut, putURL, bytes.NewReader(payload))
	putReq.ContentLength = int64(len(payload))
	putResp, err := plain.Do(putReq)
	if err != nil {
		t.Fatalf("presigned PUT: %v", err)
	}
	_, _ = io.Copy(io.Discard, putResp.Body)
	putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		t.Fatalf("presigned PUT status = %d, want 200 (signature rejected?)", putResp.StatusCode)
	}

	// 2. Mint a presigned GET and read the bytes back.
	getURL, err := c.PresignGet(key, 5*time.Minute)
	if err != nil {
		t.Fatalf("PresignGet: %v", err)
	}
	getReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, getURL, nil)
	getResp, err := plain.Do(getReq)
	if err != nil {
		t.Fatalf("presigned GET: %v", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("presigned GET status = %d, want 200", getResp.StatusCode)
	}
	got, _ := io.ReadAll(getResp.Body)
	if !bytes.Equal(got, payload) {
		t.Fatalf("round-trip mismatch: got %q, want %q", got, payload)
	}

	// cleanup
	if err := c.DeleteObject(ctx, key); err != nil {
		t.Logf("cleanup DeleteObject: %v", err)
	}
}
