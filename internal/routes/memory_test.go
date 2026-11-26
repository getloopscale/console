// EG-1 gateway-graphexpand-recall-ui T1.2 — MemoryHandler.Recall graphExpand
// boundary validation + passthrough. The handler is shared by both the SDK
// (/v1/memory/recall) and BFF (/v1/dashboard/memory/recall) surfaces, so this
// covers both (EC-3).
package routes

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getloopscale/loop-console/internal/auth"
	"github.com/getloopscale/loop-console/internal/loopmem"
)

// recallStubClient embeds the TheMemoryClient interface (only Recall is exercised)
// and captures the RecallOptions the handler passes through.
type recallStubClient struct {
	TheMemoryClient
	gotOpts loopmem.RecallOptions
}

func (s *recallStubClient) Recall(_ context.Context, _, _ string, opts loopmem.RecallOptions) (*loopmem.RecallResult, error) {
	s.gotOpts = opts
	return &loopmem.RecallResult{Results: []loopmem.RecallHit{}}, nil
}

func recallWithBody(t *testing.T, h *MemoryHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/memory/recall", strings.NewReader(body))
	req = req.WithContext(auth.WithUser(req.Context(), &auth.UserContext{Subject: "u1"}))
	w := httptest.NewRecorder()
	h.Recall(w, req)
	return w
}

func newRecallHandler() (*MemoryHandler, *recallStubClient) {
	stub := &recallStubClient{}
	return NewMemoryHandler(stub, slog.New(slog.NewTextHandler(io.Discard, nil))), stub
}

func TestRecall_GraphExpandBadHops_400(t *testing.T) {
	h, _ := newRecallHandler()
	w := recallWithBody(t, h, `{"query":"q","graphExpand":{"hops":3}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for hops=3, got %d", w.Code)
	}
}

func TestRecall_GraphExpandBadLimit_400(t *testing.T) {
	h, _ := newRecallHandler()
	w := recallWithBody(t, h, `{"query":"q","graphExpand":{"hops":1,"limit":9999}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for limit=9999, got %d", w.Code)
	}
}

func TestRecall_GraphExpandNegativeHops_400(t *testing.T) {
	// F-test-2: the lower-bound branch (Hops < 0) — only reachable via an explicit
	// negative literal (omitempty makes absent decode to 0, the valid omit case).
	h, _ := newRecallHandler()
	w := recallWithBody(t, h, `{"query":"q","graphExpand":{"hops":-1}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for hops=-1, got %d", w.Code)
	}
}

func TestRecall_GraphExpandPassthrough(t *testing.T) {
	h, stub := newRecallHandler()
	w := recallWithBody(t, h, `{"query":"q","graphExpand":{"hops":2}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if stub.gotOpts.GraphExpand == nil || stub.gotOpts.GraphExpand.Hops != 2 {
		t.Fatalf("graphExpand{hops:2} not passed through: %+v", stub.gotOpts.GraphExpand)
	}
}

func TestRecall_GraphExpandEmpty_EnablesDefault(t *testing.T) {
	// EC-1/EC-2: graphExpand:{} is valid (enable with provider default hops),
	// NOT a 400. The handler passes a non-nil GraphExpand with Hops 0 (omitted).
	h, stub := newRecallHandler()
	w := recallWithBody(t, h, `{"query":"q","graphExpand":{}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for graphExpand:{}, got %d", w.Code)
	}
	if stub.gotOpts.GraphExpand == nil {
		t.Fatalf("graphExpand:{} should pass a non-nil GraphExpand (enable), got nil")
	}
	if stub.gotOpts.GraphExpand.Hops != 0 {
		t.Fatalf("graphExpand:{} should have Hops 0 (provider default), got %d", stub.gotOpts.GraphExpand.Hops)
	}
}

func TestRecall_NoGraphExpand_Unchanged(t *testing.T) {
	h, stub := newRecallHandler()
	w := recallWithBody(t, h, `{"query":"q","topK":5}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if stub.gotOpts.GraphExpand != nil {
		t.Fatalf("no graphExpand should yield a nil GraphExpand, got %+v", stub.gotOpts.GraphExpand)
	}
}
