// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package memory_webhook_worker

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// Regression for theo-cloud#148 (CRITICAL SSRF): the worker's DEFAULT HTTP
// client (used when Config.HTTPClient is nil, i.e. the production path) must be
// egress-guarded. A delivery whose URL targets a loopback/internal address must
// NOT be delivered and must open ZERO sockets to the target.
func TestWorker_DefaultClientRejectsInternalTarget_Issue148(t *testing.T) {
	var hits int32
	sentinel := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer sentinel.Close()

	// New(nil cfg) constructs the production default client (the vuln path).
	w := New(nil, nil, nil)

	d := &Delivery{
		ID:        "mwd-issue148",
		WebhookID: "mwh-0011223344556677",
		URL:       sentinel.URL, // loopback — the internal target
		EventType: "memory.forgotten",
		Payload:   []byte(`{"probe":true}`),
	}
	res := Dispatch(context.Background(), w.httpc, slog.Default(), d)

	if res.Delivered {
		t.Fatalf("delivery to a loopback target was marked delivered (status=%d); SSRF guard missing", res.StatusCode)
	}
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Errorf("loopback sentinel received %d connections; want 0 (guard must reject before the socket)", got)
	}
}
