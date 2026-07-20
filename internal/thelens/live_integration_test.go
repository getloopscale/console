package thelens_test

// M50 edge Model-B LIVE integration — the REAL theo-cloud thelens.Broker driven against
// a REAL running theo-lens over the network (the dev-public seam), not an httptest stub.
// Gated by THEOLENS_LIVE_URL so it is a no-op in normal CI; run it with a live theo-lens:
//
//   THEOLENS_LIVE_URL=http://localhost:18084 \
//   THEOLENS_LIVE_BOOTSTRAP=dev-bootstrap-token-change-me-min-32-chars \
//   go test ./internal/thelens/ -run TestLive_ModelB -v -count=1
//
// Proves end-to-end: bootstrap-mint a platform-admin key against the live theo-lens →
// build the REAL Broker over the real AdminClient → KeyForTenantScoped mints a per-tenant
// key over the wire → (1) the minted key is NOT the platform key (customer key never
// reaches the origin), and (2) the minted key actually works: it POSTs a real
// Claude-Code-shaped OTLP trace to the live theo-lens and is accepted (200).

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/usetheodev/theo-cloud/internal/thelens"
)

func TestLive_ModelB_MintAndIngest(t *testing.T) {
	base := os.Getenv("THEOLENS_LIVE_URL")
	boot := os.Getenv("THEOLENS_LIVE_BOOTSTRAP")
	if base == "" || boot == "" {
		t.Skip("THEOLENS_LIVE_URL / THEOLENS_LIVE_BOOTSTRAP unset — live seam test skipped")
	}
	hc := &http.Client{Timeout: 10 * time.Second}

	// 1) mint a platform-admin key against the LIVE theo-lens (as lens-up.sh does)
	platformKey := mintLiveKey(t, hc, base, boot, "m50-live-platform", "default",
		[]string{"observability:platform-admin", "observability:admin", "observability:read", "observability:write", "observability:delete"})
	if platformKey == "" {
		t.Fatal("could not mint platform-admin against live theo-lens")
	}

	// 2) REAL broker over the REAL admin client → mint a per-tenant key OVER THE WIRE
	broker, err := thelens.NewBroker(
		thelens.NewAdminClient(base, platformKey, hc),
		16, time.Hour,
		[]string{"observability:read", "observability:write", "observability:delete"},
	)
	if err != nil {
		t.Fatalf("NewBroker: %v", err)
	}
	minted, err := broker.KeyForTenantScoped(context.Background(), "acct-m50", "tenant-m50",
		[]string{"observability:read", "observability:write"})
	if err != nil {
		t.Fatalf("KeyForTenantScoped (live mint): %v", err)
	}

	// (1) Model-B swap: the minted per-tenant key is NOT the platform key
	if minted == "" || minted == platformKey {
		t.Fatalf("Model-B swap failed: minted=%q must be non-empty and != platform key", redact(minted))
	}
	t.Logf("MODEL_B_SWAP_OK minted!=platform (minted prefix=%s)", prefix(minted))

	// (2) the minted per-tenant key actually works against the live theo-lens ingest
	otlp := `{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"claude-code"}}]},` +
		`"scopeSpans":[{"spans":[` +
		`{"traceId":"cc2222222222222a","spanId":"ccb0000000000001","startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000005000000000","status":{"code":0},"name":"claude_code.llm_request","attributes":[{"key":"gen_ai.request.model","value":{"stringValue":"claude-opus-4-8"}},{"key":"gen_ai.system","value":{"stringValue":"anthropic"}},{"key":"input_tokens","value":{"intValue":"1000"}},{"key":"output_tokens","value":{"intValue":"20"}}]}` +
		`]}]}]}`
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/traces", bytes.NewBufferString(otlp))
	req.Header.Set("Authorization", "Bearer "+minted)
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		t.Fatalf("ingest with minted key: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("minted key ingest expected 200, got %d body=%s", resp.StatusCode, string(body))
	}
	t.Logf("MINTED_KEY_INGEST_OK status=200 body=%s", string(body))
}

func mintLiveKey(t *testing.T, hc *http.Client, base, boot, name, ws string, scopes []string) string {
	t.Helper()
	payload, _ := json.Marshal(map[string]any{"name": name, "workspace_id": ws, "scopes": scopes})
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/admin/keys", bytes.NewBuffer(payload))
	req.Header.Set("Authorization", "Bearer "+boot)
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		t.Fatalf("mint request: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		Secret string `json:"secret"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.Secret
}

func prefix(s string) string {
	if len(s) < 10 {
		return "<short>"
	}
	return s[:10]
}
func redact(s string) string {
	if s == "" {
		return "<empty>"
	}
	return prefix(s) + "…"
}
