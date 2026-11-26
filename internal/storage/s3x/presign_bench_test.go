// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package s3x

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"
)

// BenchmarkPresignPut measures the BFF-side cost of minting a presigned upload
// URL. This cost is O(1) in the FILE SIZE — the BFF only signs, it never touches
// the bytes — so a 1 GB upload costs the BFF the same as a 1 KB upload. Contrast
// with BenchmarkProxyPut below, whose cost grows with the payload the BFF must
// stream. This is the quantitative core of the presigned-storage roadmap: the
// per-upload BFF cost goes from O(payload) to O(1).
func BenchmarkPresignPut(b *testing.B) {
	signer := &Signer{Region: "us-east-1", AccessKey: "AKIAEXAMPLE", SecretKey: "SECRETEXAMPLEKEY"}
	url := "https://storage.example.com/loopstore/tenant-x/data/report.bin"
	now := time.Date(2026, 1, 2, 15, 4, 5, 0, time.UTC)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := signer.Presign("PUT", url, 5*time.Minute, now); err != nil {
			b.Fatal(err)
		}
	}
}

// bufWriter is a plain io.Writer that copies each Write into its own growing
// buffer — it has NO ReaderFrom, so io.Copy cannot take a zero-copy fast path and
// the benchmark measures a REAL O(payload) memmove + allocation (a faithful lower
// bound on what proxying costs the BFF: it must buffer/relay every byte, unlike
// the presign mint which touches none).
type bufWriter struct{ n int }

func (w *bufWriter) Write(p []byte) (int, error) {
	dst := make([]byte, len(p))
	copy(dst, p) // force a real memmove of every byte through the process
	w.n += len(dst)
	return len(p), nil
}

// BenchmarkProxyPut_<size> measures the BFF-side cost of PROXYING a payload of the
// given size (what the current /objects PUT path does: the bytes flow through the
// BFF). Cost grows linearly with the payload — the exact opposite of the presign
// mint. Run: go test -bench=ProxyPut -benchmem ./internal/storage/s3x/
func benchProxyPut(b *testing.B, size int) {
	payload := bytes.Repeat([]byte("x"), size)
	buf := make([]byte, 32<<10) // the 32 KiB relay buffer io.Copy uses by default
	b.SetBytes(int64(size))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := &bufWriter{}
		if _, err := io.CopyBuffer(w, bytesReader(payload), buf); err != nil {
			b.Fatal(err)
		}
	}
	_ = context.Background()
}

// bytesReader returns a reader with NO WriteTo, so io.CopyBuffer uses the real
// read→write relay loop (bytes.Reader implements WriteTo and would bypass it).
func bytesReader(p []byte) io.Reader { return &plainReader{p: p} }

type plainReader struct {
	p   []byte
	off int
}

func (r *plainReader) Read(dst []byte) (int, error) {
	if r.off >= len(r.p) {
		return 0, io.EOF
	}
	n := copy(dst, r.p[r.off:])
	r.off += n
	return n, nil
}

func BenchmarkProxyPut_1KB(b *testing.B)   { benchProxyPut(b, 1<<10) }
func BenchmarkProxyPut_1MB(b *testing.B)   { benchProxyPut(b, 1<<20) }
func BenchmarkProxyPut_16MB(b *testing.B)  { benchProxyPut(b, 16<<20) }
func BenchmarkProxyPut_128MB(b *testing.B) { benchProxyPut(b, 128<<20) }
