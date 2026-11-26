// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package storage

import "testing"

// TestKeyForTenant_IsolatesTenants is the EC-1 (cross-tenant isolation) unit
// proof at the key-derivation layer: two tenants uploading the identical path
// MUST produce DISTINCT S3 keys, so their bytes never collide in the shared
// bucket. This is the bytes-layer counterpart of the metadata UNIQUE(tenant,name).
func TestKeyForTenant_IsolatesTenants(t *testing.T) {
	a := KeyForTenant("tn-aaa", "avatars/x.png")
	b := KeyForTenant("tn-bbb", "avatars/x.png")
	if a == b {
		t.Fatalf("cross-tenant key collision: both = %q", a)
	}
	if a != "tn-aaa/avatars/x.png" {
		t.Errorf("key = %q, want tn-aaa/avatars/x.png", a)
	}
}

func TestKeyForTenant_StripsLeadingSlash(t *testing.T) {
	if got := KeyForTenant("tn", "/leading"); got != "tn/leading" {
		t.Errorf("key = %q, want tn/leading (no double slash)", got)
	}
}
