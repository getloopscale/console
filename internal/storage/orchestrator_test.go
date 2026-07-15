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
	puts      map[string][]byte
	putErr    error
	getErr    error
	deleted   []string
	lastKey   string
	deleteErr map[string]error // per-key delete error injection (bulk-delete tests)
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
	if e, ok := f.deleteErr[key]; ok {
		return e
	}
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
func (m *fakeFullMeta) InsertPending(ctx context.Context, t, name string, size int64, mime string) (Reservation, error) {
	res := Reservation{ID: "id-" + name}
	if prior, ok := m.rows[name]; ok {
		res.PriorCommitted = true
		res.PriorSize = prior.SizeBytes
		res.PriorMime = prior.MimeType
	}
	m.used += size
	m.pending[res.ID] = true
	m.rows[name] = ObjectRecord{Name: name, SizeBytes: size, MimeType: mime}
	return res, nil
}
func (m *fakeFullMeta) RestorePrior(ctx context.Context, id string, priorSize int64, priorMime string) error {
	name := strings.TrimPrefix(id, "id-")
	// undo the failed reserve's size delta, restore prior committed size
	if cur, ok := m.rows[name]; ok {
		m.used -= cur.SizeBytes
	}
	m.used += priorSize
	m.rows[name] = ObjectRecord{Name: name, SizeBytes: priorSize, MimeType: priorMime}
	delete(m.pending, id)
	return nil
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

// TestService_Upload_OverwriteThenFail_PreservesPriorObject is the HIGH-4
// regression (review 2026-07-14): re-uploading over an existing committed object
// that then fails at the S3 leg MUST NOT destroy the prior committed object.
func TestService_Upload_OverwriteThenFail_PreservesPriorObject(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	svc := newService(t, obj, meta, "pro")

	// First upload succeeds → committed.
	if err := svc.Upload(context.Background(), "tn", "keep.txt", strings.NewReader("original"), 8, "text/plain"); err != nil {
		t.Fatalf("first upload: %v", err)
	}
	// Second upload of the SAME path fails at the S3 leg.
	obj.putErr = errors.New("s3 down")
	if err := svc.Upload(context.Background(), "tn", "keep.txt", strings.NewReader("newer-bigger"), 12, "text/plain"); err == nil {
		t.Fatal("expected second upload to fail")
	}

	// The prior committed object MUST still be there with its original size.
	rec, err := svc.Stat(context.Background(), "tn", "keep.txt")
	if err != nil {
		t.Fatalf("prior object was destroyed by overwrite-then-fail: %v", err)
	}
	if rec.SizeBytes != 8 {
		t.Errorf("prior object size = %d, want 8 (must be restored, not left as the failed 12)", rec.SizeBytes)
	}
}

// --- T1.1: DeletePrefix (bulk folder delete) -----------------------------

func seedRows(m *fakeFullMeta, recs ...ObjectRecord) {
	for _, r := range recs {
		m.rows[r.Name] = r
	}
}

func TestService_DeletePrefix_DeletesAllUnderPrefix(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	seedRows(meta,
		ObjectRecord{Name: "skills/a.md", SizeBytes: 10, MimeType: "text/markdown"},
		ObjectRecord{Name: "skills/b.md", SizeBytes: 20, MimeType: "text/markdown"},
		ObjectRecord{Name: "skills/.keep", SizeBytes: 1, MimeType: "application/octet-stream"},
		ObjectRecord{Name: "rules/x.md", SizeBytes: 5, MimeType: "text/markdown"}, // sibling, NOT under skills/
	)
	svc := newService(t, obj, meta, "pro")
	res, err := svc.DeletePrefix(context.Background(), "tn", "skills/")
	if err != nil {
		t.Fatalf("DeletePrefix: %v", err)
	}
	if res.Deleted != 3 {
		t.Errorf("Deleted = %d, want 3 (incl .keep)", res.Deleted)
	}
	if res.Freed != 31 {
		t.Errorf("Freed = %d, want 31", res.Freed)
	}
	if len(res.Failed) != 0 {
		t.Errorf("Failed = %v, want none", res.Failed)
	}
	if _, ok := meta.rows["rules/x.md"]; !ok {
		t.Error("sibling rules/x.md must NOT be deleted (prefix must not substring-match)")
	}
	if _, ok := meta.rows["skills/a.md"]; ok {
		t.Error("skills/a.md must be gone")
	}
}

func TestService_DeletePrefix_PartialFailure(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	obj.deleteErr = map[string]error{"tn/skills/b.md": errors.New("backend 503")}
	seedRows(meta,
		ObjectRecord{Name: "skills/a.md", SizeBytes: 10},
		ObjectRecord{Name: "skills/b.md", SizeBytes: 20},
	)
	svc := newService(t, obj, meta, "pro")
	res, err := svc.DeletePrefix(context.Background(), "tn", "skills/")
	if err != nil {
		t.Fatalf("DeletePrefix: %v", err)
	}
	if res.Deleted != 1 {
		t.Errorf("Deleted = %d, want 1 (loop not aborted by one failure)", res.Deleted)
	}
	if len(res.Failed) != 1 || res.Failed[0].Path != "skills/b.md" {
		t.Errorf("Failed = %v, want exactly [skills/b.md]", res.Failed)
	}
}

func TestService_DeletePrefix_IdempotentNotFound(t *testing.T) {
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	obj.deleteErr = map[string]error{"tn/skills/gone.md": ErrObjectNotFoundMeta}
	seedRows(meta, ObjectRecord{Name: "skills/gone.md", SizeBytes: 7})
	svc := newService(t, obj, meta, "pro")
	res, err := svc.DeletePrefix(context.Background(), "tn", "skills/")
	if err != nil {
		t.Fatalf("DeletePrefix: %v", err)
	}
	if res.Deleted != 1 {
		t.Errorf("Deleted = %d, want 1 (not-found is idempotent success, D5/EC-1)", res.Deleted)
	}
	if len(res.Failed) != 0 {
		t.Errorf("Failed = %v, want none (not-found must NOT be a failure)", res.Failed)
	}
}

func TestService_DeletePrefix_RejectsUnsafePrefix(t *testing.T) {
	svc := newService(t, newFakeObjectStore(), newFakeFullMeta(), "pro")
	// empty / whole-tenant / traversal / no-trailing-slash (greedy substring) — all rejected.
	for _, bad := range []string{"", "/", ".", "..", "../other/", "skills"} {
		if _, err := svc.DeletePrefix(context.Background(), "tn", bad); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("DeletePrefix(%q) err = %v, want ErrInvalidPath", bad, err)
		}
	}
}

func TestService_DeletePrefix_Truncated(t *testing.T) {
	old := bulkDeleteMaxObjects
	bulkDeleteMaxObjects = 2
	defer func() { bulkDeleteMaxObjects = old }()
	obj, meta := newFakeObjectStore(), newFakeFullMeta()
	seedRows(meta,
		ObjectRecord{Name: "big/1", SizeBytes: 1},
		ObjectRecord{Name: "big/2", SizeBytes: 1},
		ObjectRecord{Name: "big/3", SizeBytes: 1},
	)
	svc := newService(t, obj, meta, "pro")
	res, err := svc.DeletePrefix(context.Background(), "tn", "big/")
	if err != nil {
		t.Fatalf("DeletePrefix: %v", err)
	}
	if !res.Truncated {
		t.Error("Truncated = false, want true (cap hit)")
	}
	if res.Deleted != 2 {
		t.Errorf("Deleted = %d, want 2 (bulkDeleteMaxObjects cap)", res.Deleted)
	}
}
