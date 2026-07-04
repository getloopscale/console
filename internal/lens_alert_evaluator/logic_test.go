// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import (
	"encoding/json"
	"testing"
	"time"
)

func TestEvaluateBreach(t *testing.T) {
	cases := []struct {
		val, thr float64
		cmp      string
		want     bool
	}{
		{6, 5, "gt", true}, {5, 5, "gt", false},
		{5, 5, "gte", true}, {4, 5, "gte", false},
		{4, 5, "lt", true}, {5, 5, "lt", false},
		{5, 5, "lte", true}, {6, 5, "lte", false},
		{6, 5, "bogus", false}, // unknown comparator never breaches
	}
	for _, c := range cases {
		if got := evaluateBreach(c.val, c.thr, c.cmp); got != c.want {
			t.Errorf("evaluateBreach(%v,%v,%q) = %v, want %v", c.val, c.thr, c.cmp, got, c.want)
		}
	}
}

func TestMetricFromSeries(t *testing.T) {
	raw := `{
		"traffic":[{"traceCount":80,"errorCount":16,"errorRate":0.2},{"traceCount":20,"errorCount":4,"errorRate":0.2}],
		"latency":[{"p95Ms":900},{"p95Ms":1500}],
		"tokensByModel":[{"costUsd":0.5},{"costUsd":1.25}]
	}`
	var s observabilitySeries
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatal(err)
	}
	// error_rate = (16+4)/(80+20) * 100 = 20%
	if got := metricFromSeries(s, "error_rate"); got != 20 {
		t.Errorf("error_rate = %v, want 20", got)
	}
	// cost = 0.5 + 1.25 = 1.75
	if got := metricFromSeries(s, "cost"); got != 1.75 {
		t.Errorf("cost = %v, want 1.75", got)
	}
	// p95_latency = max(900, 1500) = 1500
	if got := metricFromSeries(s, "p95_latency"); got != 1500 {
		t.Errorf("p95_latency = %v, want 1500", got)
	}
}

func TestMetricFromSeries_EmptyIsZeroNotNaN(t *testing.T) {
	var s observabilitySeries // no traffic → error_rate must be 0 (no-data window is not a breach), not NaN
	if got := metricFromSeries(s, "error_rate"); got != 0 {
		t.Errorf("empty error_rate = %v, want 0", got)
	}
}

func TestNextAlertState_FireOnceUntilCleared(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	// OK + breach → TRIGGERED, fire once
	if d := nextAlertState("OK", true, time.Time{}, 0, now); d.nextStatus != "TRIGGERED" || !d.fire {
		t.Fatalf("OK+breach = %+v, want {TRIGGERED, fire}", d)
	}
	// TRIGGERED + still breached (no renotify) → suppress (the anti-storm keystone)
	if d := nextAlertState("TRIGGERED", true, now.Add(-time.Hour), 0, now); d.nextStatus != "TRIGGERED" || d.fire {
		t.Fatalf("TRIGGERED+breach(no renotify) = %+v, want {TRIGGERED, no-fire}", d)
	}
	// TRIGGERED + clear → OK, no fire
	if d := nextAlertState("TRIGGERED", false, now.Add(-time.Hour), 0, now); d.nextStatus != "OK" || d.fire {
		t.Fatalf("TRIGGERED+clear = %+v, want {OK, no-fire}", d)
	}
	// OK + clear → OK, no fire (never emits)
	if d := nextAlertState("OK", false, time.Time{}, 0, now); d.nextStatus != "OK" || d.fire {
		t.Fatalf("OK+clear = %+v, want {OK, no-fire}", d)
	}
}

func TestNextAlertState_RenotifyInterval(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	// still breached, renotify 300s, last fired 100s ago → suppress
	if d := nextAlertState("TRIGGERED", true, now.Add(-100*time.Second), 300, now); d.fire {
		t.Errorf("renotify not yet elapsed should suppress, got fire")
	}
	// still breached, renotify 300s, last fired 400s ago → re-fire
	if d := nextAlertState("TRIGGERED", true, now.Add(-400*time.Second), 300, now); !d.fire {
		t.Errorf("renotify elapsed should re-fire, got suppress")
	}
}

// The N-ticks-fire-once assertion: a metric breached across many ticks fires exactly once.
func TestNextAlertState_NBreachedTicksFireOnce(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	status := "OK"
	var lastTriggered time.Time
	fires := 0
	for i := 0; i < 20; i++ { // 20 consecutive breached evaluations, no renotify
		d := nextAlertState(status, true, lastTriggered, 0, now.Add(time.Duration(i)*time.Minute))
		status = d.nextStatus
		if d.fire {
			fires++
			lastTriggered = now.Add(time.Duration(i) * time.Minute)
		}
	}
	if fires != 1 {
		t.Fatalf("20 breached ticks fired %d times, want exactly 1 (anti-storm)", fires)
	}
}
