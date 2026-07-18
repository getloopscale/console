// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import "testing"

// TestLikeEscape is the MEDIUM-2 regression: a prefix containing LIKE
// metacharacters (%, _, \) must be escaped so `%` does not list the whole store.
func TestLikeEscape(t *testing.T) {
	cases := map[string]string{
		"docs/": "docs/",
		"a%b":   `a\%b`,
		"a_b":   `a\_b`,
		`a\b`:   `a\\b`,
		"%":     `\%`,
		"_x":    `\_x`,
	}
	for in, want := range cases {
		if got := likeEscape(in); got != want {
			t.Errorf("likeEscape(%q) = %q, want %q", in, got, want)
		}
	}
}
