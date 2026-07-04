// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package safehttp

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestIsDisallowedIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
		why  string
	}{
		{"127.0.0.1", true, "loopback v4"},
		{"::1", true, "loopback v6"},
		{"169.254.169.254", true, "cloud metadata (link-local)"},
		{"169.254.0.1", true, "link-local v4"},
		{"fe80::1", true, "link-local v6"},
		{"10.0.0.1", true, "RFC1918 10/8"},
		{"172.16.0.1", true, "RFC1918 172.16/12"},
		{"172.31.255.255", true, "RFC1918 172.31 edge"},
		{"192.168.1.1", true, "RFC1918 192.168/16"},
		{"fc00::1", true, "ULA fc00::/7"},
		{"fd12:3456::1", true, "ULA fd00::/8"},
		{"0.0.0.0", true, "unspecified v4"},
		{"::", true, "unspecified v6"},
		{"224.0.0.1", true, "multicast v4"},
		{"ff02::1", true, "multicast v6"},
		// RFC6598 CGNAT — Go's IsPrivate() does NOT cover this; AWS EKS
		// assigns pod IPs from 100.64.0.0/16 (theo-cloud#156).
		{"100.64.0.1", true, "RFC6598 CGNAT low edge (EKS pod CIDR)"},
		{"100.100.100.100", true, "RFC6598 CGNAT mid"},
		{"100.127.255.255", true, "RFC6598 CGNAT high edge"},
		{"100.63.255.255", false, "just below CGNAT = public"},
		{"100.128.0.1", false, "just past CGNAT = public"},
		// NAT64 well-known prefix — reaches internal IPv4 (incl. IMDS) via a
		// DNS64/NAT64 gateway; deny the whole prefix (theo-cloud#156).
		{"64:ff9b::a9fe:a9fe", true, "NAT64 embedding 169.254.169.254 (IMDS)"},
		{"64:ff9b::808:808", true, "NAT64 prefix (deny whole /96)"},
		// Other special-use ranges that must never be a webhook target.
		{"198.18.0.1", true, "RFC2544 benchmarking"},
		{"192.0.0.1", true, "IETF protocol assignments"},
		{"240.0.0.1", true, "reserved / Class E"},
		{"1.1.1.1", false, "public v4"},
		{"8.8.8.8", false, "public v4"},
		{"172.32.0.1", false, "just past RFC1918 172 range = public"},
		{"2606:4700:4700::1111", false, "public v6 (cloudflare)"},
	}
	for _, c := range cases {
		ip := net.ParseIP(c.ip)
		if ip == nil {
			t.Fatalf("bad test IP %q", c.ip)
		}
		if got := IsDisallowedIP(ip); got != c.want {
			t.Errorf("IsDisallowedIP(%s) = %v, want %v (%s)", c.ip, got, c.want, c.why)
		}
	}
	// nil IP must be treated as disallowed (fail-closed).
	if !IsDisallowedIP(nil) {
		t.Error("IsDisallowedIP(nil) = false, want true (fail-closed)")
	}
}

// controlFor rejects the resolved address at socket-connect time. This is the
// dial-time check that defeats DNS rebinding: the address here is the RESOLVED
// ip:port, not the original hostname.
func TestControl_RejectsPrivateResolvedAddress(t *testing.T) {
	var gotReasons []string
	ctl := control(func(reason string) { gotReasons = append(gotReasons, reason) })
	if err := ctl("tcp4", "169.254.169.254:80", nil); err == nil {
		t.Error("control allowed cloud-metadata address; want rejection")
	}
	if err := ctl("tcp4", "10.0.0.5:443", nil); err == nil {
		t.Error("control allowed RFC1918 address; want rejection")
	}
	if err := ctl("tcp4", "1.1.1.1:443", nil); err != nil {
		t.Errorf("control rejected public address: %v", err)
	}
	// The rejection observer fired once per blocked dial, with a classified
	// reason (and NOT for the allowed public IP).
	if len(gotReasons) != 2 || gotReasons[0] != "link_local" || gotReasons[1] != "rfc1918_ula" {
		t.Errorf("observer reasons = %v, want [link_local rfc1918_ula]", gotReasons)
	}
}

func TestDisallowedReason(t *testing.T) {
	cases := map[string]string{
		"127.0.0.1": "loopback", "169.254.169.254": "link_local",
		"10.0.0.1": "rfc1918_ula", "0.0.0.0": "unspecified",
		"224.0.0.1": "link_local", // 224.0.0.0/24 is link-local multicast
		"239.0.0.1": "multicast",  // general (non-link-local) multicast
		"100.64.0.1":         "cgnat",         // RFC6598 (theo-cloud#156)
		"64:ff9b::a9fe:a9fe": "nat64",         // NAT64 well-known prefix
		"198.18.0.1":         "special_range", // RFC2544
		"1.1.1.1":            "",
	}
	for ipStr, want := range cases {
		if got := DisallowedReason(net.ParseIP(ipStr)); got != want {
			t.Errorf("DisallowedReason(%s) = %q, want %q", ipStr, got, want)
		}
	}
}

// NewClient's guard must abort BEFORE a socket reaches the internal target:
// a loopback sentinel server must receive ZERO connections.
func TestNewClient_RefusesLoopback_ZeroSocket(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := NewClient(3 * time.Second)
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, srv.URL, nil)
	resp, err := client.Do(req)
	if err == nil {
		if resp != nil {
			_ = resp.Body.Close()
		}
		t.Fatal("guarded client reached a loopback server; want dial rejection")
	}
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Errorf("loopback sentinel received %d connections; want 0 (no socket to internal target)", got)
	}
}

// Redirects must NOT be followed — a public endpoint 302→internal is a bypass.
func TestNewClient_DoesNotFollowRedirects(t *testing.T) {
	var redirectTargetHits int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&redirectTargetHits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer internal.Close()

	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, internal.URL, http.StatusFound)
	}))
	defer redirector.Close()

	// The redirector itself is loopback, so this request is also guard-rejected;
	// the invariant we assert is that even if the first hop answered, the
	// redirect target is never dialed. Use the client's CheckRedirect directly
	// to prove the no-follow contract independent of the loopback guard.
	client := NewClient(3 * time.Second)
	if client.CheckRedirect == nil {
		t.Fatal("guarded client has nil CheckRedirect; want no-follow policy")
	}
	if err := client.CheckRedirect(nil, nil); err != http.ErrUseLastResponse {
		t.Errorf("CheckRedirect = %v, want http.ErrUseLastResponse (do not follow)", err)
	}
	_ = redirector
	if got := atomic.LoadInt32(&redirectTargetHits); got != 0 {
		t.Errorf("redirect target received %d hits; want 0", got)
	}
}
