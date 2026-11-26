// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// Package storage implements LoopScale's tenant blob-storage vertical: quota-enforced,
// metered object storage over an S3-compatible backend, accessed via scoped API
// keys. See .claude/knowledge-base/plans/tenant-blob-storage-plan.md (M7).
package storage

import "strings"

// Unlimited marks an uncapped dimension (Enterprise aggregate). A reserve check
// treats Unlimited as "never exceeded".
const Unlimited int64 = -1

const (
	mib = 1 << 20
	gib = 1 << 30
)

// Caps is the storage limit pair for a plan tier.
type Caps struct {
	AggregateBytes int64 // total bytes across the tenant's store; Unlimited (-1) = uncapped
	PerFileBytes   int64 // max size of a single object
}

// capsByTier is the authoritative per-tier caps table (blueprint ADR D4: declared
// locally, NOT in contracts, until a second consumer needs it). Values are
// the sponsor-grilled decision (product grill decision 8, 2026-07-14).
var capsByTier = map[string]Caps{
	"starter":    {AggregateBytes: 100 * mib, PerFileBytes: 25 * mib},
	"pro":        {AggregateBytes: 5 * gib, PerFileBytes: 100 * mib},
	"team":       {AggregateBytes: 25 * gib, PerFileBytes: 500 * mib},
	"enterprise": {AggregateBytes: Unlimited, PerFileBytes: 5 * gib},
}

// CapsForTier returns the caps for a plan tier. Lookup is case-insensitive; an
// unknown or empty tier falls back to the most restrictive real tier (starter) —
// fail-safe, so a mis-read tier never grants more storage than the customer paid
// for.
func CapsForTier(tier string) Caps {
	if c, ok := capsByTier[strings.ToLower(strings.TrimSpace(tier))]; ok {
		return c
	}
	return capsByTier["starter"]
}
