// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package routes

import "testing"

// cmd/main.go asks an API key for sandbox:execute on /v1/sandboxes. A scope the
// key routes cannot issue would leave that surface unreachable by any key.
func TestTheSandboxScopeIsIssuable(t *testing.T) {
	if !validScopes["sandbox:execute"] {
		t.Error(`"sandbox:execute" is not in validScopes: no API key can reach /v1/sandboxes`)
	}
}
