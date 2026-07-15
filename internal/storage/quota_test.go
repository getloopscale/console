// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"context"
	"errors"
	"testing"
)

// fakeMetaStore is an in-memory MetaStore for unit-testing the quota arithmetic
// and typed-error contract without a real Postgres. The advisory-lock
// serialization (two concurrent reserves near the cap) is proven separately in
// the integration test (quota_integration_test.go, build tag `integration`).
type fakeMetaStore struct {
	used         int64
	pendingCalls int
	insertErr    error
}

func (f *fakeMetaStore) SumBytes(ctx context.Context, tenantID string) (int64, error) {
	return f.used, nil
}

func (f *fakeMetaStore) InsertPending(ctx context.Context, tenantID, name string, size int64, mime string) (Reservation, error) {
	if f.insertErr != nil {
		return Reservation{}, f.insertErr
	}
	f.pendingCalls++
	f.used += size
	return Reservation{ID: "obj-id"}, nil
}
func (f *fakeMetaStore) RestorePrior(ctx context.Context, id string, priorSize int64, priorMime string) error {
	return nil
}

func (f *fakeMetaStore) MarkCommitted(ctx context.Context, id string) error { return nil }
func (f *fakeMetaStore) DeletePending(ctx context.Context, id string) error {
	f.used -= 0
	return nil
}
func (f *fakeMetaStore) WithTenantLock(ctx context.Context, tenantID string, fn func(context.Context) error) error {
	// No real lock in the fake — just run fn (serialization is an integration concern).
	return fn(ctx)
}

// Object-read ops are unused by the quota unit tests; stubbed to satisfy MetaStore.
func (f *fakeMetaStore) GetMeta(ctx context.Context, t, name string) (ObjectRecord, error) {
	return ObjectRecord{}, ErrObjectNotFoundMeta
}
func (f *fakeMetaStore) ListByPrefix(ctx context.Context, t, prefix string, limit int, cursor string) ([]ObjectRecord, string, error) {
	return nil, "", nil
}
func (f *fakeMetaStore) DeleteByName(ctx context.Context, t, name string) error { return nil }

func TestReserve_UnderCap(t *testing.T) {
	store := &fakeMetaStore{used: 10 << 20} // 10MB used
	q := NewQuota(store, "starter")          // 100MB aggregate cap

	res, err := q.Reserve(context.Background(), "tn", "f", 5<<20, "text/plain")
	if err != nil {
		t.Fatalf("Reserve under cap: %v", err)
	}
	if res.ID == "" {
		t.Error("expected an object id")
	}
	if store.pendingCalls != 1 {
		t.Errorf("pending inserts = %d, want 1", store.pendingCalls)
	}
}

func TestReserve_ExceedsAggregate_402(t *testing.T) {
	store := &fakeMetaStore{used: 99 << 20} // 99MB of 100MB starter cap
	q := NewQuota(store, "starter")

	_, err := q.Reserve(context.Background(), "tn", "f", 5<<20, "text/plain") // would hit 104MB
	var qe *QuotaExceededError
	if !errors.As(err, &qe) {
		t.Fatalf("Reserve over aggregate = %v, want *QuotaExceededError", err)
	}
	if qe.LimitBytes != 100<<20 {
		t.Errorf("limit = %d, want %d", qe.LimitBytes, int64(100<<20))
	}
	if store.pendingCalls != 0 {
		t.Error("must NOT insert a pending row when quota exceeded")
	}
}

func TestReserve_PerFileTooLarge_413_BeforeStore(t *testing.T) {
	store := &fakeMetaStore{used: 0}
	q := NewQuota(store, "starter") // per-file cap 25MB

	_, err := q.Reserve(context.Background(), "tn", "f", 30<<20, "text/plain") // 30MB > 25MB
	var fe *FileTooLargeError
	if !errors.As(err, &fe) {
		t.Fatalf("Reserve over per-file = %v, want *FileTooLargeError", err)
	}
	if fe.MaxFileBytes != 25<<20 {
		t.Errorf("max = %d, want %d", fe.MaxFileBytes, int64(25<<20))
	}
	// EC/plan T2.3: the per-file check happens BEFORE any store interaction.
	if store.pendingCalls != 0 {
		t.Error("per-file rejection must not touch the store (SumBytes/InsertPending)")
	}
}

func TestReserve_EnterpriseUnlimitedAggregate(t *testing.T) {
	store := &fakeMetaStore{used: 100 << 30} // 100GB already used
	q := NewQuota(store, "enterprise")        // Unlimited aggregate, 5GB per-file

	if _, err := q.Reserve(context.Background(), "tn", "f", 1<<30, "bin"); err != nil {
		t.Errorf("enterprise unlimited aggregate should accept 1GB: %v", err)
	}
}
