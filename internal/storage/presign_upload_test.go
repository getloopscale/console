// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package storage

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestService_PresignUpload_ReservesAndMints(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	svc := newService(t, obj, meta, "pro")

	url, exp, err := svc.PresignUpload(context.Background(), "tn-a", "data/report.txt", 100, "text/plain")
	if err != nil {
		t.Fatalf("PresignUpload: %v", err)
	}
	if !strings.Contains(url, "X-Amz-Signature=") {
		t.Errorf("minted URL missing signature: %s", url)
	}
	if exp.IsZero() {
		t.Error("expiry not set")
	}
	// tenant-namespaced key was presigned
	if obj.lastKey != "tn-a/data/report.txt" {
		t.Errorf("presigned key = %q, want tn-a/data/report.txt", obj.lastKey)
	}
	// quota reserved (pending row holds 100 bytes) but NOT yet committed
	if meta.used != 100 {
		t.Errorf("reserved bytes = %d, want 100", meta.used)
	}
	if len(meta.pending) != 1 {
		t.Errorf("pending rows = %d, want 1 (reservation held until commit)", len(meta.pending))
	}
}

func TestService_CommitUpload_ConfirmsHeadAndCommits(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	svc := newService(t, obj, meta, "pro")
	ctx := context.Background()

	if _, _, err := svc.PresignUpload(ctx, "tn-a", "data/r.txt", 5, "text/plain"); err != nil {
		t.Fatalf("PresignUpload: %v", err)
	}
	// Simulate the client uploading exactly the declared 5 bytes directly to S3.
	obj.puts["tn-a/data/r.txt"] = []byte("hello")

	if err := svc.CommitUpload(ctx, "tn-a", "data/r.txt"); err != nil {
		t.Fatalf("CommitUpload: %v", err)
	}
	if len(meta.pending) != 0 {
		t.Errorf("pending rows after commit = %d, want 0", len(meta.pending))
	}
	if meta.compensated != 0 {
		t.Errorf("compensations = %d, want 0 on the happy path", meta.compensated)
	}
	if meta.used != 5 {
		t.Errorf("committed bytes = %d, want 5", meta.used)
	}
}

func TestService_CommitUpload_NotUploaded_ReleasesReservation(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	svc := newService(t, obj, meta, "pro")
	ctx := context.Background()

	if _, _, err := svc.PresignUpload(ctx, "tn-a", "ghost.bin", 42, "application/octet-stream"); err != nil {
		t.Fatalf("PresignUpload: %v", err)
	}
	// Client never uploaded → HEAD misses.
	err := svc.CommitUpload(ctx, "tn-a", "ghost.bin")
	var notDone *UploadNotCompletedError
	if !errors.As(err, &notDone) {
		t.Fatalf("CommitUpload err = %v, want *UploadNotCompletedError", err)
	}
	if meta.used != 0 {
		t.Errorf("reserved bytes after release = %d, want 0 (a failed upload must not hold quota)", meta.used)
	}
}

func TestService_CommitUpload_SizeMismatch_Rejects(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	svc := newService(t, obj, meta, "pro")
	ctx := context.Background()

	// Declare 5 bytes (quota reserved against 5) …
	if _, _, err := svc.PresignUpload(ctx, "tn-a", "cheat.bin", 5, "application/octet-stream"); err != nil {
		t.Fatalf("PresignUpload: %v", err)
	}
	// … but upload 100 bytes directly to S3 (quota-bypass attempt).
	obj.puts["tn-a/cheat.bin"] = make([]byte, 100)

	err := svc.CommitUpload(ctx, "tn-a", "cheat.bin")
	var mismatch *SizeMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("CommitUpload err = %v, want *SizeMismatchError", err)
	}
	if mismatch.Declared != 5 || mismatch.Actual != 100 {
		t.Errorf("mismatch = declared %d actual %d, want 5/100", mismatch.Declared, mismatch.Actual)
	}
	// mismatched object deleted + reservation released
	if len(obj.deleted) != 1 || obj.deleted[0] != "tn-a/cheat.bin" {
		t.Errorf("object not deleted on mismatch: %v", obj.deleted)
	}
	if meta.used != 0 {
		t.Errorf("reserved bytes after mismatch = %d, want 0", meta.used)
	}
}
