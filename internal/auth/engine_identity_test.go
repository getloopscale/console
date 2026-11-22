// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package auth_test

import (
	"net/http"
	"testing"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

// The engine reads X-LoopZero-User-ID, X-LoopZero-Tenant and X-LoopZero-Email
// (getloopscale/loopzero api/internal/middleware/auth/auth.go). A proxy that
// writes any other name sends an anonymous call, and the engine answers 401 on
// every /engine route (getloopscale/console#522).
func TestSetEngineIdentityWritesTheHeadersTheEngineReads(t *testing.T) {
	h := http.Header{}
	auth.SetEngineIdentity(h, &auth.UserContext{Subject: "user-1", TenantID: "tenant-1", Email: "a@example.com", Role: "owner"})

	want := map[string]string{
		"X-LoopZero-User-ID": "user-1",
		"X-LoopZero-Tenant":  "tenant-1",
		"X-LoopZero-Email":   "a@example.com",
	}
	for name, value := range want {
		if got := h.Get(name); got != value {
			t.Errorf("header %s = %q, want %q", name, got, value)
		}
	}
	if len(h) != len(want) {
		t.Errorf("SetEngineIdentity wrote %d headers, want exactly %d (no role, no legacy names): %v", len(h), len(want), h)
	}
}
