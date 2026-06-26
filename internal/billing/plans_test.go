// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package billing

import "testing"

// Plan release-blockers-2026-06-25-set T4.1 — canonical positive-enumeration
// helper that distinguishes "the plan name is in the allow-list" from "the
// Stripe Price ID env var is configured". Closes theo-cloud#39.

// TestIsValidPlanName_Canonical enumerates positively per CLAUDE.md Common
// Mistakes ("enumeration-by-negation"): starter, pro, team are user-purchasable;
// enterprise is sales-led (no public signup per MEET-2026-05-12 D4).
func TestIsValidPlanName_Canonical(t *testing.T) {
	cases := []struct {
		name string
		plan string
		want bool
	}{
		{"starter — Free tier", "starter", true},
		{"pro — paid tier", "pro", true},
		{"team — Early Access tier", "team", true},
		{"enterprise — sales-led, not user-purchasable", "enterprise", false},
		{"unknown plan name", "anything", false},
		{"empty string", "", false},
		// Case-sensitivity guard: positive enumeration is exact.
		{"uppercase Pro NOT valid (caller must lowercase)", "Pro", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsValidPlanName(tc.plan); got != tc.want {
				t.Errorf("IsValidPlanName(%q) = %v, want %v", tc.plan, got, tc.want)
			}
		})
	}
}
