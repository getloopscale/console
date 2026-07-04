// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// Package safehttp provides an egress-guarded *http.Client for outbound
// requests to customer-controlled URLs (webhook delivery).
//
// The guard defends against SSRF (theo-cloud#148): a customer registers a
// webhook whose URL — directly or via DNS rebinding / HTTP redirect — targets
// an internal address (cloud metadata 169.254.169.254, RFC1918, loopback, …).
// Without a guard the delivery worker would issue that request from inside the
// VPC with a trusted source IP.
//
// Two layers, both required:
//
//  1. Transport.DialContext uses a net.Dialer whose Control hook rejects the
//     RESOLVED IP at socket-connect time. Because DNS resolution happens before
//     Control runs, this defeats DNS rebinding (a hostname that is public at
//     registration and private at delivery is caught at the dial, not at parse).
//  2. CheckRedirect returns http.ErrUseLastResponse so a 3xx to an internal
//     Location is never followed (a redirect hop would otherwise bypass a
//     parse-time URL check).
//
// This client is shared by every webhook delivery worker (memory + workspace)
// so the guard lives in exactly one place (DRY).
package safehttp

import (
	"errors"
	"net"
	"net/http"
	"syscall"
	"time"
)

// ErrDestinationNotAllowed is returned by the dial guard when the resolved
// destination IP is on the deny list. It is a typed sentinel so callers can
// distinguish a policy rejection from a transport error.
var ErrDestinationNotAllowed = errors.New("safehttp: destination IP not allowed")

// IsDisallowedIP reports whether ip must NOT be dialed. Fail-closed: a nil IP
// is disallowed. Blocks loopback, link-local (unicast + multicast — covers the
// 169.254.169.254 cloud-metadata endpoint and fe80::/10), private (RFC1918 +
// fc00::/7 ULA via net.IP.IsPrivate), unspecified (0.0.0.0 / ::), and all
// multicast.
func IsDisallowedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified() ||
		ip.IsPrivate()
}

// control is the net.Dialer.Control hook. address is the RESOLVED "ip:port"
// (Go resolves DNS before invoking Control for each candidate address), so the
// IP parsed here is the actual dial target — the check runs at connect time,
// defeating rebinding.
func control() func(network, address string, c syscall.RawConn) error {
	return func(_ string, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return ErrDestinationNotAllowed
		}
		ip := net.ParseIP(host)
		if IsDisallowedIP(ip) {
			return ErrDestinationNotAllowed
		}
		return nil
	}
}

// NewClient returns an egress-guarded *http.Client with the given overall
// timeout. Redirects are NOT followed.
func NewClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   control(),
	}
	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		// Do not follow redirects — a 3xx to an internal Location would bypass
		// the parse-time URL and is never a legitimate webhook delivery target.
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}
