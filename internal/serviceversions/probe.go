package serviceversions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"syscall"
	"time"
)

// versionPath is the endpoint every data-plane service exposes, auth-exempt.
const versionPath = "/v1/version"

// maxPayloadBytes caps how much of a target's response we will read. A target
// that answers with a stream cannot exhaust the gateway's memory.
const maxPayloadBytes = 64 << 10

// Target is one service to probe. An empty BaseURL means the service is not
// configured in this environment: it is still listed, as not_deployed, because
// omitting it would hide that it exists and did not come up.
type Target struct {
	Name    string
	BaseURL string
}

// versionPayload is the subset of the target's /v1/version response we consume.
type versionPayload struct {
	Version string `json:"version"`
	BuiltAt string `json:"built_at"`
}

// probe reads one target's version and maps every outcome onto exactly one
// ServiceStatus variant.
//
// The per-service deadline of ADR D1 is derived from ctx rather than set on the
// client, so a caller that gives up cancels the in-flight request instead of
// waiting for a timeout it no longer cares about.
func probe(ctx context.Context, client *http.Client, t Target, perService time.Duration, now func() time.Time) ServiceStatus {
	if t.BaseURL == "" {
		return NotDeployed(t.Name, now())
	}

	sctx, scancel := context.WithTimeout(ctx, perService)
	defer scancel()

	url := strings.TrimSuffix(t.BaseURL, "/") + versionPath
	req, err := http.NewRequestWithContext(sctx, http.MethodGet, url, nil)
	if err != nil {
		return Unreachable(t.Name, reasonMalformedPayload, now())
	}

	resp, err := client.Do(req)
	if err != nil {
		// D10: the ctx.Err() test comes FIRST and is not redundant. A parent
		// cancellation surfaces as context.Canceled, which does not match the
		// DeadlineExceeded sentinel and would otherwise be classified as
		// unreachable — reporting a healthy service as down every time a
		// browser tab is closed.
		if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
			return Timeout(t.Name, now())
		}
		return Unreachable(t.Name, classify(err), now())
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return Unreachable(t.Name, fmt.Sprintf("http %d", resp.StatusCode), now())
	}

	var p versionPayload
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxPayloadBytes)).Decode(&p); err != nil {
		return Unreachable(t.Name, reasonMalformedPayload, now())
	}
	// A degenerate payload (empty or sentinel version) is caught by OK's guard.
	return OK(t.Name, p.Version, p.BuiltAt, now())
}

// classify maps a transport error onto a short, closed set of reasons.
//
// It deliberately never returns err.Error(): Go transport errors embed the
// target's host and port ("dial tcp 172.18.0.4:8787: connect: connection
// refused") and this value is serialized to the browser (R5). The full error
// belongs in the server-side structured log, not in the response.
func classify(err error) string {
	var dnsErr *net.DNSError
	switch {
	case errors.As(err, &dnsErr):
		return "dns failure"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "connection refused"
	case errors.Is(err, syscall.ECONNRESET):
		return "connection reset"
	default:
		return "transport error"
	}
}
