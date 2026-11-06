// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package metrics

import "github.com/prometheus/client_golang/prometheus"

// CounterValue reads a counter's current value out of the default registry.
//
// # Why this exists (B-256)
//
// Thirteen helpers in this package — IncTokenExchange, IncDeviceFlow, IncAuthRejection,
// IncWebhook, IncCheckout, IncUsageDrift, IncSubscriptionFallback, ObserveTenantProvisioning and
// the *Value readers — were incremented by nothing but their own unit tests, which asserted they
// did not panic. Measured 2026-08-13:
//
//	grep -rn "metrics\.IncWebhook(" --include="*.go" . | grep -v _test.go   ->  nothing
//	grep -c "metrics\." internal/routes/memory_webhooks.go                  ->  0
//
// A counter with no emission site does not record a low number. It records a flat zero for ever,
// and a dashboard built on it reads "no auth rejection has ever happened" — which is the most
// expensive kind of wrong, because it looks like good news.
//
// Wiring them needs an oracle a test in ANOTHER package can use, and the pattern already here —
// one exported `XxxValue()` per counter — would have added thirteen more test-only exports of
// exactly the sort this item exists to retire. One gatherer serves all of them.
//
// `labelValues` are matched in the order the metric declares its labels. An absent metric, or one
// with no matching label set, is 0 rather than a panic: a test asserting "the counter moved" must
// fail on its assertion, not on its instrument.
func CounterValue(name string, labelValues ...string) float64 {
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		return 0
	}
	for _, family := range families {
		if family.GetName() != name {
			continue
		}
		for _, metric := range family.GetMetric() {
			pairs := metric.GetLabel()
			if len(pairs) != len(labelValues) {
				continue
			}
			match := true
			for i, pair := range pairs {
				if pair.GetValue() != labelValues[i] {
					match = false
					break
				}
			}
			if match {
				return metric.GetCounter().GetValue()
			}
		}
	}
	return 0
}
