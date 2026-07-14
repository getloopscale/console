// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package storage

import "testing"

// TestCapsForTier locks the grilled per-tier caps (product grill decision 8,
// sponsor-adjusted 2026-07-14: aggregates cut 10×). These are money-adjacent
// product invariants — a regression here silently over- or under-charges tenants.
func TestCapsForTier(t *testing.T) {
	const MB = 1 << 20
	const GB = 1 << 30
	cases := []struct {
		tier          string
		wantAggregate int64
		wantPerFile   int64
	}{
		{"starter", 100 * MB, 25 * MB},
		{"pro", 5 * GB, 100 * MB},
		{"team", 25 * GB, 500 * MB},
		{"enterprise", Unlimited, 5 * GB},
	}
	for _, tc := range cases {
		t.Run(tc.tier, func(t *testing.T) {
			caps := CapsForTier(tc.tier)
			if caps.AggregateBytes != tc.wantAggregate {
				t.Errorf("%s aggregate = %d, want %d", tc.tier, caps.AggregateBytes, tc.wantAggregate)
			}
			if caps.PerFileBytes != tc.wantPerFile {
				t.Errorf("%s per-file = %d, want %d", tc.tier, caps.PerFileBytes, tc.wantPerFile)
			}
		})
	}
}

// TestCapsForTier_UnknownDefaultsToStarter — a tenant with an unrecognized/absent
// tier gets the MOST restrictive real tier (fail-safe: never grant more than paid).
func TestCapsForTier_UnknownDefaultsToStarter(t *testing.T) {
	unknown := CapsForTier("mystery")
	starter := CapsForTier("starter")
	if unknown != starter {
		t.Errorf("unknown tier caps = %+v, want starter caps %+v", unknown, starter)
	}
}

// TestCapsForTier_CaseInsensitive — plan tier from the DB may be "Pro"/"PRO".
func TestCapsForTier_CaseInsensitive(t *testing.T) {
	if CapsForTier("PRO") != CapsForTier("pro") {
		t.Error("tier lookup must be case-insensitive")
	}
}
