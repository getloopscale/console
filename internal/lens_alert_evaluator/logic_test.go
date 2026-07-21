// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package lens_alert_evaluator

import (
	"math"
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
	if got, ok := metricFromSeries(s, "error_rate"); got != 20 || !ok {
		t.Errorf("error_rate = %v, ok=%v, want 20, true", got, ok)
	}
	// cost = 0.5 + 1.25 = 1.75
	if got, ok := metricFromSeries(s, "cost"); got != 1.75 || !ok {
		t.Errorf("cost = %v, ok=%v, want 1.75, true", got, ok)
	}
	// p95_latency = max(900, 1500) = 1500
	if got, ok := metricFromSeries(s, "p95_latency"); got != 1500 || !ok {
		t.Errorf("p95_latency = %v, ok=%v, want 1500, true", got, ok)
	}
}

// The previous name and comment here asserted that an empty window "is not a
// breach". The test only checked the value was 0 -- which was true -- while the
// claim it was standing in for was false for lt/lte. That gap was #247: the
// belief lived in a comment and only the true half was tested.
func TestMetricFromSeries_EmptyReportsAbsenceNotZero(t *testing.T) {
	var s observabilitySeries // no traffic
	got, ok := metricFromSeries(s, "error_rate")
	if ok {
		t.Errorf("empty window reported ok=true (value %v); absence must be representable", got)
	}
	if math.IsNaN(got) {
		t.Error("empty error_rate must not be NaN")
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

// TestMetricFromSeries_NoDataDoesNotBreach is the composition test neither this
// suite nor the reference had, and it is exactly how theo-cloud#247 survived:
// the empty-window value was asserted (`empty error_rate = 0`) and the comment
// claimed that meant "not a breach", but nothing composed metricFromSeries with
// evaluateBreach under a below-comparator.
//
// It is not: an empty window yielded 0, `lt`/`lte` are accepted comparators
// (internal/routes/lens_alert_rules.go:38), and 0 < threshold is true. A
// traffic-free workspace therefore fired a permanent false alert on any
// "alert if X drops below N" rule -- the rule shape you use to detect that your
// pipeline STOPPED -- latched by the anti-storm state machine so the user could
// not clear it.
//
// The fix makes absence representable rather than special-casing the
// comparators: a third below-comparator would otherwise reintroduce it.
func TestMetricFromSeries_NoDataDoesNotBreach(t *testing.T) {
	var empty observabilitySeries // no traffic, no latency, no cost

	for _, tc := range []struct {
		metric     string
		comparator string
		threshold  float64
	}{
		{"error_rate", "lt", 10},
		{"error_rate", "lte", 10},
		{"cost", "lt", 100},
		{"cost", "lte", 100},
		{"p95_latency", "lt", 500},
		{"bogus_metric", "lt", 1}, // the default: fallthrough must not read as a measurement either
	} {
		value, ok := metricFromSeries(empty, tc.metric)
		if ok {
			t.Errorf("%s: empty window reported ok=true (value %v) -- absence must be representable",
				tc.metric, value)
			continue
		}
		// The call site must SKIP on absence. Asserting the contract here keeps
		// the invariant next to the function that owns it.
		if evaluateBreach(value, tc.threshold, tc.comparator) && !ok {
			// value is meaningless when !ok; this documents why the caller must
			// not reach evaluateBreach at all.
			t.Logf("%s/%s: value %v would breach if evaluated -- caller MUST skip",
				tc.metric, tc.comparator, value)
		}
	}
}

// TestMetricFromSeries_GenuineZeroStillEvaluates is the negative case that keeps
// the fix honest. A window WITH traffic whose error rate is truly 0 must still be
// compared -- skipping it would trade a false positive for a false negative.
func TestMetricFromSeries_GenuineZeroStillEvaluates(t *testing.T) {
	s := observabilitySeries{}
	s.Traffic = append(s.Traffic, struct {
		TraceCount float64 `json:"traceCount"`
		ErrorCount float64 `json:"errorCount"`
		ErrorRate  float64 `json:"errorRate"`
	}{TraceCount: 100, ErrorCount: 0, ErrorRate: 0})

	value, ok := metricFromSeries(s, "error_rate")
	if !ok {
		t.Fatal("a window with traffic and a genuinely zero error rate must report ok=true")
	}
	if value != 0 {
		t.Errorf("error_rate = %v, want 0", value)
	}
	if !evaluateBreach(value, 10, "lt") {
		t.Error("a real zero below the threshold SHOULD breach an lt rule")
	}
}
