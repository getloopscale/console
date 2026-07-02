package rag

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

// DataClient is a read-only proxy to theo-rag's REST API for the theo-cloud dashboard
// BFF (M17). Mirrors internal/themory/client.go's Model B shape: it holds NO standing
// credential — a keyResolver resolves the PER-TENANT Bearer per request from context
// (the rag broker mints a rag:read-only key from the JWT-derived tenant). A resolver
// error FAILS CLOSED (no request, no master fallback). Only the two read methods the
// dashboard needs are implemented (YAGNI — the BFF is read-only).
type DataClient struct {
	baseURL     string
	httpClient  *http.Client
	keyResolver func(ctx context.Context) (string, error)
}

// NewDataClient constructs a rag DataClient. baseURL is theo-rag's REST root
// (e.g. http://host.docker.internal:18082). httpClient may be nil (http.DefaultClient).
func NewDataClient(baseURL string, httpClient *http.Client) *DataClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &DataClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

// WithKeyResolver wires the per-tenant Bearer resolver (Model B). The dashboard wires a
// resolver that mints a rag:read-only key; without it the client cannot authenticate.
func (c *DataClient) WithKeyResolver(r func(ctx context.Context) (string, error)) *DataClient {
	c.keyResolver = r
	return c
}

// Collection is one row of GET /v1/collections.
type Collection struct {
	ID        string         `json:"id"`
	Name      *string        `json:"name"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt string         `json:"created_at,omitempty"`
}

// CollectionsResult is the GET /v1/collections response.
type CollectionsResult struct {
	Items []Collection `json:"items"`
}

// AnalyticsResult is the GET /v1/analytics response (the M5 summary).
type AnalyticsResult struct {
	Window struct {
		Since string `json:"since"`
	} `json:"window"`
	Totals struct {
		Retrievals         int     `json:"retrievals"`
		Answers            int     `json:"answers"`
		EmptyRetrievalRate float64 `json:"empty_retrieval_rate"`
	} `json:"totals"`
	Latency struct {
		P50Ms float64 `json:"p50_ms"`
		P95Ms float64 `json:"p95_ms"`
	} `json:"latency"`
	Confidence struct {
		High   int `json:"high"`
		Medium int `json:"medium"`
		Low    int `json:"low"`
	} `json:"confidence"`
}

// ListCollections proxies GET /v1/collections?limit&offset with the per-tenant Bearer.
func (c *DataClient) ListCollections(ctx context.Context, limit, offset int) (*CollectionsResult, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		q.Set("offset", strconv.Itoa(offset))
	}
	var out CollectionsResult
	if err := c.getJSON(ctx, "/v1/collections", q, &out); err != nil {
		return nil, err
	}
	if out.Items == nil {
		out.Items = []Collection{}
	}
	return &out, nil
}

// Analytics proxies GET /v1/analytics?since with the per-tenant Bearer (M5 summary).
func (c *DataClient) Analytics(ctx context.Context, since string) (*AnalyticsResult, error) {
	q := url.Values{}
	if since != "" {
		q.Set("since", since)
	}
	var out AnalyticsResult
	if err := c.getJSON(ctx, "/v1/analytics", q, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// getJSON resolves the per-tenant Bearer (fail-closed) and performs the GET, decoding a
// 2xx JSON body into out. A resolver error means NO request is sent (no master fallback).
func (c *DataClient) getJSON(ctx context.Context, path string, q url.Values, out any) error {
	if c.keyResolver == nil {
		return fmt.Errorf("rag data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return fmt.Errorf("rag data client: resolve per-tenant key: %w", err)
	}
	u := c.baseURL + path
	if enc := q.Encode(); enc != "" {
		u += "?" + enc
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("rag data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("rag data client: GET %s: %w", path, err) // never leak the bearer
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("rag data client: GET %s: upstream %d: %s", path, resp.StatusCode, string(raw))
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("rag data client: decode %s: %w", path, err)
	}
	return nil
}
