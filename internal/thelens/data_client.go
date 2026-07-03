// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

// M41 — DataClient is a per-tenant proxy to theo-lens's REST API for the theo-cloud
// dashboard BFF (read half). Mirrors internal/rag/data_client.go's Model B shape: it
// holds NO standing credential — a keyResolver resolves the PER-TENANT Bearer per
// request from context (the lens broker mints a lens:read key from the JWT-derived
// tenant). A resolver error FAILS CLOSED (no request, no master fallback).
//
// M41 ships the READS only (traces / sessions / observability / cost); the write
// surface is M44. The reads pass the upstream body through as json.RawMessage — a thin
// proxy that never re-models theo-lens's response shape (so it cannot drift; the
// frontend renders theo-lens's shape directly). The load-bearing correctness is the
// upstream PATH mapping (observability lives under /v1/metrics, cost under /v1/analytics)
// — pinned by the real-schema contract test (data_client_test.go).
package thelens

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// DataClient is the per-tenant read proxy to theo-lens for the dashboard BFF.
type DataClient struct {
	baseURL     string
	httpClient  *http.Client
	keyResolver func(ctx context.Context) (string, error)
}

// NewDataClient constructs a lens DataClient. baseURL is theo-lens's REST root
// (e.g. http://host.docker.internal:18084). httpClient may be nil (http.DefaultClient).
func NewDataClient(baseURL string, httpClient *http.Client) *DataClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &DataClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

// WithKeyResolver wires the per-tenant Bearer resolver (Model B). The dashboard wires a
// resolver that mints a per-tenant lens:read key; without it the client cannot authenticate.
func (c *DataClient) WithKeyResolver(r func(ctx context.Context) (string, error)) *DataClient {
	c.keyResolver = r
	return c
}

// ListTraces proxies GET /v1/traces?limit&offset with the per-tenant Bearer.
func (c *DataClient) ListTraces(ctx context.Context, limit, offset int) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/traces", pageQuery(limit, offset))
}

// ListSessions proxies GET /v1/sessions?limit&offset with the per-tenant Bearer.
func (c *DataClient) ListSessions(ctx context.Context, limit, offset int) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/sessions", pageQuery(limit, offset))
}

// Observability proxies GET /v1/metrics/observability (theo-lens's observability summary
// lives under /v1/metrics, NOT /v1/observability — the schema-lesson).
func (c *DataClient) Observability(ctx context.Context) (json.RawMessage, error) {
	return c.getRaw(ctx, "/v1/metrics/observability", nil)
}

// Cost proxies GET /v1/analytics/cost?since (theo-lens's cost summary lives under
// /v1/analytics, NOT /v1/cost — the schema-lesson).
func (c *DataClient) Cost(ctx context.Context, since string) (json.RawMessage, error) {
	q := url.Values{}
	if since != "" {
		q.Set("since", since)
	}
	return c.getRaw(ctx, "/v1/analytics/cost", q)
}

// pageQuery builds the limit/offset query shared by the list reads.
func pageQuery(limit, offset int) url.Values {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		q.Set("offset", strconv.Itoa(offset))
	}
	return q
}

// getRaw resolves the per-tenant Bearer (fail-closed) and GETs path, returning the 2xx
// body verbatim. A resolver error means NO request is sent (no master fallback). The
// bearer is NEVER included in a returned error.
func (c *DataClient) getRaw(ctx context.Context, path string, q url.Values) (json.RawMessage, error) {
	if c.keyResolver == nil {
		return nil, fmt.Errorf("thelens data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: resolve per-tenant key: %w", err)
	}
	u := c.baseURL + path
	if enc := q.Encode(); enc != "" {
		u += "?" + enc
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("thelens data client: GET %s: %w", path, err) // never leak the bearer
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("thelens data client: GET %s: upstream %d: %s", path, resp.StatusCode, string(raw))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("thelens data client: read %s: %w", path, err)
	}
	return json.RawMessage(body), nil
}
