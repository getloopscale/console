// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

package metrics

import "testing"

// B-256 — the emission sites need an oracle, and thirteen `*Value()` readers would be thirteen
// more test-only exports of exactly the kind this item exists to retire. One gatherer serves all
// of them, and it is the only new symbol.
func TestCounterValueReadsALabelledCounter(t *testing.T) {
	before := CounterValue("loopscale_billing_checkout_total", "started")
	IncCheckout(true)
	if got := CounterValue("loopscale_billing_checkout_total", "started"); got != before+1 {
		t.Fatalf("checkout counter: got %v, want %v", got, before+1)
	}
}

func TestCounterValueReadsAnUnlabelledCounter(t *testing.T) {
	before := CounterValue("loopscale_usage_drift_detected_total")
	IncUsageDrift()
	if got := CounterValue("loopscale_usage_drift_detected_total"); got != before+1 {
		t.Fatalf("usage drift: got %v, want %v", got, before+1)
	}
}

func TestCounterValueIsZeroForAnUnknownMetric(t *testing.T) {
	// Total, like every reader here: an absent metric is 0, never a panic. A test asserting
	// "the counter moved" must fail on the assertion, not on the instrument.
	if got := CounterValue("loopscale_no_such_metric_total"); got != 0 {
		t.Fatalf("unknown metric: got %v, want 0", got)
	}
}

func TestCounterValueDiscriminatesBetweenLabels(t *testing.T) {
	// Without this, a reader that ignored labels would report every emission as every emission,
	// and a test asserting "the FAILURE counter moved" would pass on a success.
	beforeErr := CounterValue("loopscale_billing_checkout_total", "error")
	IncCheckout(true)
	if got := CounterValue("loopscale_billing_checkout_total", "error"); got != beforeErr {
		t.Fatalf("a success moved the error counter: got %v, want %v", got, beforeErr)
	}
}
