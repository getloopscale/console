// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// M11 plan ADR D1 — scope translation between the cloud-facing capability
// namespace (`promptly:`) and the loopprompt service namespace (`prompt:`).
// The edge exposes `promptly:read/write` (what a consumer registers for); the
// loopprompt service checks `prompt:read/write` (M10). The broker translates
// BEFORE intersecting with the gateway's supported scopes and minting, so the
// seam is explicit and auditable, and least-privilege is preserved (a
// `promptly:read` consumer can never produce a `prompt:write` minted key).
package promptly

import "strings"

const (
	cloudPrefix   = "promptly:"
	servicePrefix = "prompt:"
)

// translateScopes maps each `promptly:X` consumer scope to its `prompt:X`
// service equivalent. Any scope NOT in the `promptly:` namespace (a foreign
// `memory:*`, or a bare service-namespace `prompt:*` the consumer should never
// hold directly) is dropped — total, deterministic, never escalating.
func translateScopes(want []string) []string {
	out := make([]string, 0, len(want))
	for _, s := range want {
		if rest, ok := strings.CutPrefix(s, cloudPrefix); ok {
			out = append(out, servicePrefix+rest)
		}
	}
	return out
}
