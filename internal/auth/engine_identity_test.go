// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package auth_test

import (
	"net/http"
	"testing"

	"github.com/getloopscale/loop-console/internal/auth"
)

// The engine reads X-Loop-Runtime-User-ID, X-Loop-Runtime-Tenant and X-Loop-Runtime-Email
// (getloopscale/loop-runtime api/internal/middleware/auth/auth.go). A proxy that
// writes any other name sends an anonymous call, and the engine answers 401 on
// every /engine route (getloopscale/loop-console#522).
func TestSetEngineIdentityWritesTheHeadersTheEngineReads(t *testing.T) {
	h := http.Header{}
	auth.SetEngineIdentity(h, &auth.UserContext{Subject: "user-1", TenantID: "tenant-1", Email: "a@example.com", Role: "owner"})

	want := map[string]string{
		"X-Loop-Runtime-User-ID": "user-1",
		"X-Loop-Runtime-Tenant":  "tenant-1",
		"X-Loop-Runtime-Email":   "a@example.com",
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
