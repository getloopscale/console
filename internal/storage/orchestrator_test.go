// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

// --- fakes ---------------------------------------------------------------

type fakeObjectStore struct {
	puts     map[string][]byte
	putErr   error
	getErr   error
	deleted  []string
	lastKey  string
}

func newFakeObjectStore() *fakeObjectStore { return &fakeObjectStore{puts: map[string][]byte{}} }

func (f *fakeObjectStore) PutObject(ctx context.Context, key string, body io.Reader, size int64, ct string) error {
	f.lastKey = key
	if f.putErr != nil {
		return f.putErr
	}
	b, _ := io.ReadAll(body)
	f.puts[key] = b
	return nil
}
func (f *fakeObjectStore) GetObject(ctx context.Context, key string) (io.ReadCloser, ObjectMeta, error) {
	f.lastKey = key
	if f.getErr != nil {
		return nil, ObjectMeta{}, f.getErr
	}
	b, ok := f.puts[key]
	if !ok {
		b = []byte("bytes-for-" + key)
	}
	return io.NopCloser(bytes.NewReader(b)), ObjectMeta{Size: int64(len(b)), ContentType: "text/plain"}, nil
}
func (f *fakeObjectStore) HeadObject(ctx context.Context, key string) (ObjectMeta, error) {
	return ObjectMeta{}, nil
}
func (f *fakeObjectStore) DeleteObject(ctx context.Context, key string) error {
	f.deleted = append(f.deleted, key)
	return nil
}

// fakeFullMeta implements the full MetaStore (quota + object ops).
type fakeFullMeta struct {
	used      int64
	rows      map[string]ObjectRecord // name → record (committed)
	pending   map[string]bool
	compensated int
}

func newFakeFullMeta() *fakeFullMeta {
	return &fakeFullMeta{rows: map[string]ObjectRecord{}, pending: map[string]bool{}}
}

func (m *fakeFullMeta) WithTenantLock(ctx context.Context, t string, fn func(context.Context) error) error {
	return fn(ctx)
}
func (m *fakeFullMeta) SumBytes(ctx context.Context, t string) (int64, error) { return m.used, nil }
func (m *fakeFullMeta) InsertPending(ctx context.Context, t, name string, size int64, mime string) (string, error) {
	m.used += size
	id := "id-" + name
	m.pending[id] = true
	m.rows[name] = ObjectRecord{Name: name, SizeBytes: size, MimeType: mime}
	return id, nil
}
func (m *fakeFullMeta) MarkCommitted(ctx context.Context, id string) error { delete(m.pending, id); return nil }
func (m *fakeFullMeta) DeletePending(ctx context.Context, id string) error {
	m.compensated++
	delete(m.pending, id)
	// undo the row inserted by the pending reserve
	name := strings.TrimPrefix(id, "id-")
	if r, ok := m.rows[name]; ok {
		m.used -= r.SizeBytes
		delete(m.rows, name)
	}
	return nil
}
func (m *fakeFullMeta) GetMeta(ctx context.Context, t, name string) (ObjectRecord, error) {
	if r, ok := m.rows[name]; ok {
		return r, nil
	}
	return ObjectRecord{}, ErrObjectNotFoundMeta
}
func (m *fakeFullMeta) ListByPrefix(ctx context.Context, t, prefix string, limit int, cursor string) ([]ObjectRecord, string, error) {
	var out []ObjectRecord
	for _, r := range m.rows {
		if strings.HasPrefix(r.Name, prefix) {
			out = append(out, r)
		}
	}
	return out, "", nil
}
func (m *fakeFullMeta) DeleteByName(ctx context.Context, t, name string) error {
	delete(m.rows, name)
	return nil
}

type fakeTiers struct{ tier string }

func (f fakeTiers) TierForTenant(ctx context.Context, t string) (string, error) { return f.tier, nil }

func newService(t *testing.T, obj ObjectStore, meta MetaStore, tier string) *Service {
	t.Helper()
	return NewService(obj, meta, fakeTiers{tier}, nil, "this-is-a-32char-minimum-share-secret!")
}

// --- tests ---------------------------------------------------------------

func TestService_UploadDownload_RoundTrip(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	svc := newService(t, obj, meta, "pro")

	err := svc.Upload(context.Background(), "tn-a", "docs/readme.md", strings.NewReader("hello world"), 11, "text/markdown")
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if obj.lastKey != "tn-a/docs/readme.md" {
		t.Errorf("S3 key = %q, want tn-a/docs/readme.md (tenant-namespaced)", obj.lastKey)
	}

	rc, _, err := svc.Download(context.Background(), "tn-a", "docs/readme.md")
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	defer rc.Close()
	body, _ := io.ReadAll(rc)
	if string(body) != "hello world" {
		t.Errorf("body = %q, want hello world", body)
	}
}

func TestService_Upload_CompensatesOnPutFailure(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	obj.putErr = errors.New("s3 down")
	svc := newService(t, obj, meta, "pro")

	err := svc.Upload(context.Background(), "tn-a", "f", strings.NewReader("x"), 1, "text/plain")
	if err == nil {
		t.Fatal("expected upload error when PutObject fails")
	}
	if meta.compensated != 1 {
		t.Errorf("compensations = %d, want 1 (pending row must be removed)", meta.compensated)
	}
	if meta.used != 0 {
		t.Errorf("used after compensate = %d, want 0 (quota must not be consumed)", meta.used)
	}
}

func TestService_Upload_RejectsBadPath(t *testing.T) {
	svc := newService(t, newFakeObjectStore(), newFakeFullMeta(), "pro")
	if err := svc.Upload(context.Background(), "tn", "../escape", strings.NewReader("x"), 1, "t"); !errors.Is(err, ErrInvalidPath) {
		t.Errorf("Upload traversal = %v, want ErrInvalidPath", err)
	}
}

func TestService_Upload_QuotaExceeded(t *testing.T) {
	meta := newFakeFullMeta()
	meta.used = 99 << 20 // 99MB of 100MB starter
	svc := newService(t, newFakeObjectStore(), meta, "starter")
	err := svc.Upload(context.Background(), "tn", "big", strings.NewReader("x"), 5<<20, "bin")
	var qe *QuotaExceededError
	if !errors.As(err, &qe) {
		t.Errorf("Upload over quota = %v, want *QuotaExceededError", err)
	}
}

func TestService_Download_NotFound(t *testing.T) {
	svc := newService(t, newFakeObjectStore(), newFakeFullMeta(), "pro")
	_, _, err := svc.Download(context.Background(), "tn", "missing")
	if !errors.Is(err, ErrObjectNotFoundMeta) {
		t.Errorf("Download missing = %v, want ErrObjectNotFoundMeta", err)
	}
}

func TestService_ShareRedeem_RoundTrip_IsolatesTenantKey(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	svc := newService(t, obj, meta, "pro")
	_ = svc.Upload(context.Background(), "tn-owner", "pic.png", strings.NewReader("img"), 3, "image/png")

	tok, exp, err := svc.Share(context.Background(), "tn-owner", "pic.png", time.Minute)
	if err != nil {
		t.Fatalf("Share: %v", err)
	}
	if !exp.After(time.Now()) {
		t.Error("expiry must be in the future")
	}

	rc, _, err := svc.Redeem(context.Background(), tok)
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	defer rc.Close()
	// The redemption must re-derive the key from the token's tenant claim.
	if obj.lastKey != "tn-owner/pic.png" {
		t.Errorf("redeem key = %q, want tn-owner/pic.png (from token claim)", obj.lastKey)
	}
}

func TestService_Share_TTLTooLong(t *testing.T) {
	meta := newFakeFullMeta()
	meta.rows["p"] = ObjectRecord{Name: "p"}
	svc := newService(t, newFakeObjectStore(), meta, "pro")
	_, _, err := svc.Share(context.Background(), "tn", "p", 8*24*time.Hour) // > 7d max
	if !errors.Is(err, ErrShareTTLTooLong) {
		t.Errorf("Share 8d = %v, want ErrShareTTLTooLong", err)
	}
}

func TestService_Delete_RemovesBackendThenMeta(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	svc := newService(t, obj, meta, "pro")
	_ = svc.Upload(context.Background(), "tn", "gone.txt", strings.NewReader("x"), 1, "text/plain")

	if err := svc.Delete(context.Background(), "tn", "gone.txt"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if len(obj.deleted) != 1 || obj.deleted[0] != "tn/gone.txt" {
		t.Errorf("backend deletes = %v, want [tn/gone.txt]", obj.deleted)
	}
	if _, err := svc.Stat(context.Background(), "tn", "gone.txt"); !errors.Is(err, ErrObjectNotFoundMeta) {
		t.Error("metadata must be gone after delete")
	}
}
