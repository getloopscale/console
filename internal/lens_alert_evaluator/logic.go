// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package lens_alert_evaluator evaluates per-tenant threshold alert rules (theo-lens M53) against the
// observability series and, on a breach, enqueues a webhook delivery for the existing J-16
// workspace_webhook_worker to dispatch. This file holds the PURE decision logic (comparator, metric
// extraction, anti-storm state machine) — deterministic + exhaustively unit-tested without a DB.
package lens_alert_evaluator

import "time"

// WindowToRange maps a rule's window (seconds) to theo-lens's observability `range` preset
// (1h/24h/7d/30d — the only values `GET /v1/metrics/observability?range=` accepts). The metric is then
// computed over the whole returned series, which spans that range. Exported for the main.go fetcher.
func WindowToRange(windowSeconds int) string {
	switch {
	case windowSeconds <= 3600:
		return "1h"
	case windowSeconds <= 86_400:
		return "24h"
	case windowSeconds <= 604_800:
		return "7d"
	default:
		return "30d"
	}
}

// evaluateBreach reports whether `value` satisfies `comparator` vs `threshold`.
func evaluateBreach(value, threshold float64, comparator string) bool {
	switch comparator {
	case "gt":
		return value > threshold
	case "gte":
		return value >= threshold
	case "lt":
		return value < threshold
	case "lte":
		return value <= threshold
	default:
		return false // unknown comparator never breaches (fail-safe)
	}
}

// observabilitySeries is the subset of theo-lens's GET /v1/metrics/observability response the evaluator
// reads. Field tags match the upstream JSON (traffic/latency/tokensByModel buckets).
type observabilitySeries struct {
	Traffic []struct {
		TraceCount float64 `json:"traceCount"`
		ErrorCount float64 `json:"errorCount"`
		ErrorRate  float64 `json:"errorRate"`
	} `json:"traffic"`
	Latency []struct {
		P95Ms float64 `json:"p95Ms"`
	} `json:"latency"`
	TokensByModel []struct {
		CostUsd float64 `json:"costUsd"`
	} `json:"tokensByModel"`
}

// metricFromSeries extracts the alert metric value over the window:
//   - error_rate: the overall window rate = sum(errorCount)/sum(traceCount) × 100 (percent; honest
//     aggregate, not a max-bucket proxy). No traffic → 0 (a no-data window is not a breach).
//   - cost: sum of per-model costUsd over the window.
//   - p95_latency: the worst per-bucket p95 over the window (bucket p95s are not re-aggregatable into an
//     overall p95, so "did p95 exceed X in any bucket" is the honest semantics).
func metricFromSeries(s observabilitySeries, metric string) float64 {
	switch metric {
	case "error_rate":
		var errs, total float64
		for _, t := range s.Traffic {
			errs += t.ErrorCount
			total += t.TraceCount
		}
		if total == 0 {
			return 0
		}
		return errs / total * 100
	case "cost":
		var sum float64
		for _, r := range s.TokensByModel {
			sum += r.CostUsd
		}
		return sum
	case "p95_latency":
		var max float64
		for _, l := range s.Latency {
			if l.P95Ms > max {
				max = l.P95Ms
			}
		}
		return max
	default:
		return 0
	}
}

// decision is the state-machine output: the next persisted status + whether to dispatch a notification.
type decision struct {
	nextStatus string // "OK" | "TRIGGERED"
	fire       bool   // dispatch a breach notification this tick
}

// nextAlertState is the fire-once-until-cleared anti-storm state machine (langfuse applyStateMachine):
//   - OK  + breach          → TRIGGERED, fire once.
//   - TRIGGERED + breach     → suppress (no fire) UNLESS an opt-in renotify interval has elapsed since the
//     last fire, in which case re-fire (bump last_triggered). This is the anti-storm keystone: a metric
//     breached for an hour fires once (or once per renotify interval), never once per tick.
//   - TRIGGERED + clear      → OK, no fire (recovery notification deferred — Unresolved).
//   - OK  + clear            → OK, no fire (never emits).
//
// `lastTriggered` is zero when the rule has never fired; `renotifyS <= 0` means never re-fire.
func nextAlertState(prevStatus string, breached bool, lastTriggered time.Time, renotifyS int, now time.Time) decision {
	if !breached {
		return decision{nextStatus: "OK", fire: false}
	}
	if prevStatus != "TRIGGERED" {
		return decision{nextStatus: "TRIGGERED", fire: true} // OK/UNKNOWN → breach: single fire
	}
	// Still breached. Suppress unless the opt-in renotify interval elapsed.
	if renotifyS > 0 && !lastTriggered.IsZero() && now.Sub(lastTriggered) >= time.Duration(renotifyS)*time.Second {
		return decision{nextStatus: "TRIGGERED", fire: true}
	}
	return decision{nextStatus: "TRIGGERED", fire: false} // anti-storm suppression
}
