package rag

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
)

// DataClient is a per-tenant proxy to looprag's REST API for the loop-console dashboard
// BFF. Mirrors internal/loopmem/client.go's Model B shape: it holds NO standing
// credential — a keyResolver resolves the PER-TENANT Bearer per request from context
// (the rag broker mints a key from the JWT-derived tenant). A resolver error FAILS
// CLOSED (no request, no master fallback). M17 shipped the reads; M21 added the write
// surface (create/delete collections + documents, ask) — the dashboard mints
// rag:read+write+delete, and looprag's per-verb scope gates every verb.
type DataClient struct {
	baseURL     string
	httpClient  *http.Client
	keyResolver func(ctx context.Context) (string, error)
}

// NewDataClient constructs a rag DataClient. baseURL is looprag's REST root
// (e.g. http://host.docker.internal:18082). httpClient may be nil (http.DefaultClient).
func NewDataClient(baseURL string, httpClient *http.Client) *DataClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &DataClient{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

// WithKeyResolver wires the per-tenant Bearer resolver (Model B). The dashboard wires a
// resolver that mints a per-tenant rag key; without it the client cannot authenticate.
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

// AnalyticsResult is the GET /v1/analytics response (the M5 summary + ROADMAP-v8 M7
// per-collection scale block, attached ONLY when ?collection_id= is set).
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
	// Scale is looprag rc.80+ per-collection observability. Pointer + omitempty so
	// dashboard requests without a collection_id emit the M5 shape unchanged (backward-compat).
	Scale *ScaleObservability `json:"scale,omitempty"`
}

// ScaleObservability is looprag rc.80 ROADMAP-v8 M7 per-collection scale block:
// LLM extraction token cost, community count/level, corpus size. Wire shape mirrors
// looprag's AnalyticsSummary.scale (packages/api/src/server/handlers/analytics.ts).
type ScaleObservability struct {
	CollectionID string           `json:"collection_id"`
	Corpus       ScaleCorpus      `json:"corpus"`
	Communities  ScaleCommunities `json:"communities"`
	Extraction   ScaleExtraction  `json:"extraction"`
}

// ScaleCorpus is the corpus-size sub-block (documents + chunks + size_bytes).
type ScaleCorpus struct {
	Documents int `json:"documents"`
	Chunks    int `json:"chunks"`
	SizeBytes int `json:"size_bytes"`
}

// ScaleCommunities is the graph-communities sub-block (total, max_level, per_level).
// per_level is a level-keyed map (string keys — looprag emits `oz.record(oz.number())`).
type ScaleCommunities struct {
	Total    int            `json:"total"`
	MaxLevel int            `json:"max_level"`
	PerLevel map[string]int `json:"per_level"`
}

// ScaleExtraction is the LLM-extraction sub-block (persisted token cost per collection).
type ScaleExtraction struct {
	Tokens int `json:"tokens"`
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

// Analytics proxies GET /v1/analytics?collection_id&since with the per-tenant Bearer.
// collectionID is the ROADMAP-v8 M7 opt-in: when non-empty looprag attaches a
// per-collection `scale` block to the response (extraction tokens, communities,
// corpus size). An empty collectionID keeps the M5 summary shape (scale=nil,
// backward-compat).
func (c *DataClient) Analytics(ctx context.Context, collectionID, since string) (*AnalyticsResult, error) {
	q := url.Values{}
	if collectionID != "" {
		q.Set("collection_id", collectionID)
	}
	if since != "" {
		q.Set("since", since)
	}
	var out AnalyticsResult
	if err := c.getJSON(ctx, "/v1/analytics", q, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GraphView proxies GET /v1/collections/:id/graph — the persisted knowledge graph (top-N nodes
// by degree + the edges among them) for the GraphRAG explorer (M10). Forwarded opaquely: the BFF
// does not parse the graph, the dashboard renders it. The rag:read key gates it at looprag.
func (c *DataClient) GraphView(ctx context.Context, collectionID, level, limit string) (json.RawMessage, error) {
	q := url.Values{}
	if level != "" {
		q.Set("level", level)
	}
	if limit != "" {
		q.Set("limit", limit)
	}
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/collections/"+url.PathEscape(collectionID)+"/graph", q, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Communities proxies GET /v1/collections/:id/communities — the graph communities + their report
// summary + members for the GraphRAG explorer (M10). Forwarded opaquely; rag:read gated.
func (c *DataClient) Communities(ctx context.Context, collectionID, level string) (json.RawMessage, error) {
	q := url.Values{}
	if level != "" {
		q.Set("level", level)
	}
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/collections/"+url.PathEscape(collectionID)+"/communities", q, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CommunityReport proxies GET /v1/collections/:id/communities/:key/report — the full community
// report (title + full_content + findings) for the explorer's report drill-down (M13). Forwarded
// opaquely; rag:read gated. Upstream 404 (no report) surfaces as an error the handler maps.
func (c *DataClient) CommunityReport(ctx context.Context, collectionID, communityKey, level string) (json.RawMessage, error) {
	q := url.Values{}
	if level != "" {
		q.Set("level", level)
	}
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/collections/"+url.PathEscape(collectionID)+"/communities/"+url.PathEscape(communityKey)+"/report", q, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// --- Write surface (M21 dashboard read+write) --------------------------------
// The dashboard session mints a rag:read+write+delete per-tenant key; these proxy
// the mutating verbs so a human can manage RAG from the UI. Every write goes through
// `do` (same fail-closed per-tenant-bearer discipline as the reads).

// CreateCollectionInput is the POST /v1/collections body.
type CreateCollectionInput struct {
	Name string `json:"name"`
}

// AskInput is the POST /v1/answers body (query + collection).
//
// M9 — Strategy is the optional retrieval strategy the caller selects
// (vector|keyword|hybrid|graph|global). Empty ⇒ looprag defaults to vector
// (backward-compatible); graph + global (GraphRAG) fail-close to vector upstream
// when the collection has no graph. `omitempty` so an unset strategy is not even
// sent — the pre-M9 request shape is preserved byte-for-byte.
type AskInput struct {
	CollectionID string `json:"collection_id"`
	Question     string `json:"question"`
	Strategy     string `json:"strategy,omitempty"`
}

// IngestInput is the POST /v1/documents/raw body (text ingest; async 202).
type IngestInput struct {
	CollectionID string `json:"collection_id"`
	Text         string `json:"text"`
	Name         string `json:"name,omitempty"`
}

// Document is one row of GET /v1/documents (async-ingest status surfaced to the UI).
type Document struct {
	ID           string `json:"id"`
	CollectionID string `json:"collection_id,omitempty"`
	Name         string `json:"name,omitempty"`
	Status       string `json:"status,omitempty"`
	CreatedAt    string `json:"created_at,omitempty"`
}

// DocumentsResult is the GET /v1/documents response.
type DocumentsResult struct {
	Items []Document `json:"items"`
}

// ListDocuments proxies GET /v1/documents?collection_id&limit&offset (M21 — the UI lists
// a collection's documents + their ingest status).
func (c *DataClient) ListDocuments(ctx context.Context, collectionID string, limit, offset int) (*DocumentsResult, error) {
	q := url.Values{}
	if collectionID != "" {
		q.Set("collection_id", collectionID)
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		q.Set("offset", strconv.Itoa(offset))
	}
	var out DocumentsResult
	if err := c.getJSON(ctx, "/v1/documents", q, &out); err != nil {
		return nil, err
	}
	if out.Items == nil {
		out.Items = []Document{}
	}
	return &out, nil
}

// CreateCollection proxies POST /v1/collections. Returns the created row.
func (c *DataClient) CreateCollection(ctx context.Context, in CreateCollectionInput) (*Collection, error) {
	var out Collection
	if err := c.do(ctx, http.MethodPost, "/v1/collections", nil, in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteCollection proxies DELETE /v1/collections/{id}.
func (c *DataClient) DeleteCollection(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/v1/collections/"+url.PathEscape(id), nil, nil, nil)
}

// IngestDocument proxies POST /v1/documents/raw (async — looprag returns 202 + a doc id).
func (c *DataClient) IngestDocument(ctx context.Context, in IngestInput) (json.RawMessage, error) {
	// looprag's POST /v1/documents/raw contract requires `content` (NOT `text`) and a
	// non-empty `name` (see looprag documents.routes.ts). The dashboard→BFF body uses
	// `text` (IngestInput); map it to looprag's wire shape here. Default an empty name
	// so an unnamed upload does not 422 (looprag requires name).
	name := in.Name
	if name == "" {
		name = "untitled"
	}
	body := ragRawIngestBody{CollectionID: in.CollectionID, Content: in.Text, Name: name}
	var out json.RawMessage
	if err := c.do(ctx, http.MethodPost, "/v1/documents/raw", nil, body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ragRawIngestBody is looprag's POST /v1/documents/raw wire shape — `content`, not the
// dashboard-facing `text` (IngestInput). Kept separate so the two contracts never drift.
type ragRawIngestBody struct {
	CollectionID string `json:"collection_id"`
	Content      string `json:"content"`
	Name         string `json:"name"`
}

// DeleteDocument proxies DELETE /v1/documents/{id}.
func (c *DataClient) DeleteDocument(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/v1/documents/"+url.PathEscape(id), nil, nil, nil)
}

// Ask proxies POST /v1/answers — a query returns a cited answer.
func (c *DataClient) Ask(ctx context.Context, in AskInput) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.do(ctx, http.MethodPost, "/v1/answers", nil, in, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// --- Connectors (loop-console #191 — dashboard connectors surface) --------------

// Connection is the non-secret view of a connector connection (looprag presentConnection).
type Connection struct {
	ID           string  `json:"id"`
	WorkspaceID  string  `json:"workspace_id"`
	CollectionID string  `json:"collection_id"`
	ProviderID   string  `json:"provider_id"`
	Status       string  `json:"status"`
	Cursor       *string `json:"cursor"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

// ConnectionsResult is the GET /v1/connectors response.
type ConnectionsResult struct {
	Items []Connection `json:"items"`
}

// ListConnectors proxies GET /v1/connectors — the workspace's connector connections.
func (c *DataClient) ListConnectors(ctx context.Context) (*ConnectionsResult, error) {
	var out ConnectionsResult
	if err := c.getJSON(ctx, "/v1/connectors", nil, &out); err != nil {
		return nil, err
	}
	if out.Items == nil {
		out.Items = []Connection{}
	}
	return &out, nil
}

// ConnectConnector proxies POST /v1/connectors/{provider}/connect (M8). The credential body
// (refresh_token / token / static creds / crawler config, per provider) is forwarded OPAQUELY
// — the BFF never inspects, transforms, or logs it (Rule 8); looprag encrypts it at rest and
// never echoes it. `provider` is path-escaped defensively (the handler validates it against the
// enum first). Returns looprag's non-secret Connection view.
func (c *DataClient) ConnectConnector(ctx context.Context, provider string, body json.RawMessage) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.do(ctx, http.MethodPost, "/v1/connectors/"+url.PathEscape(provider)+"/connect", nil, body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SyncConnector proxies POST /v1/connectors/{id}/sync — enqueues a sync (looprag returns 202).
func (c *DataClient) SyncConnector(ctx context.Context, id string) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.do(ctx, http.MethodPost, "/v1/connectors/"+url.PathEscape(id)+"/sync", nil, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteConnector proxies DELETE /v1/connectors/{id} (looprag refuses with 409 while syncing).
func (c *DataClient) DeleteConnector(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/v1/connectors/"+url.PathEscape(id), nil, nil, nil)
}

// ListDocumentChunks proxies GET /v1/documents/{id}/chunks (chunk-editor, rag:read). Paginated by index cursor.
func (c *DataClient) ListDocumentChunks(ctx context.Context, documentID, cursor string) (json.RawMessage, error) {
	q := url.Values{}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/documents/"+url.PathEscape(documentID)+"/chunks", q, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetChunk proxies GET /v1/chunks/{id} (chunk-editor, rag:read).
func (c *DataClient) GetChunk(ctx context.Context, id string) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/chunks/"+url.PathEscape(id), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateChunk proxies PATCH /v1/chunks/{id} (chunk-editor, rag:write). The body ({text}) is
// forwarded opaquely; looprag re-embeds the chunk server-side.
func (c *DataClient) UpdateChunk(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.do(ctx, http.MethodPatch, "/v1/chunks/"+url.PathEscape(id), nil, body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListWikiPages proxies GET /v1/wiki/pages?collection_id= (Open Wiki, rag:read).
func (c *DataClient) ListWikiPages(ctx context.Context, collectionID string) (json.RawMessage, error) {
	q := url.Values{}
	q.Set("collection_id", collectionID)
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/wiki/pages", q, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetWikiPage proxies GET /v1/wiki/pages/{id} (Open Wiki, rag:read).
func (c *DataClient) GetWikiPage(ctx context.Context, id string) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/wiki/pages/"+url.PathEscape(id), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CreateWikiPage proxies POST /v1/wiki/pages (Open Wiki, rag:write). Body {collection_id,name,content}.
func (c *DataClient) CreateWikiPage(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.do(ctx, http.MethodPost, "/v1/wiki/pages", nil, body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateWikiPage proxies PUT /v1/wiki/pages/{id} (KB0 page lifecycle, rag:write). Body
// {name?,content}; looprag re-parses the OKF frontmatter, re-embeds, and treats a changed
// frontmatter `path` as a rename/move.
func (c *DataClient) UpdateWikiPage(ctx context.Context, id string, body json.RawMessage) (json.RawMessage, error) {
	var out json.RawMessage
	if err := c.do(ctx, http.MethodPut, "/v1/wiki/pages/"+url.PathEscape(id), nil, body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteWikiPage proxies DELETE /v1/documents/{id} (KB0 page lifecycle, rag:delete). A wiki
// page is a document, so deletion goes through the documents surface.
func (c *DataClient) DeleteWikiPage(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/v1/documents/"+url.PathEscape(id), nil, nil, nil)
}

// WikiIndex proxies GET /v1/wiki/index?collection_id= (M26 OKF directory, rag:read).
func (c *DataClient) WikiIndex(ctx context.Context, collectionID string) (json.RawMessage, error) {
	q := url.Values{}
	q.Set("collection_id", collectionID)
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/wiki/index", q, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// WikiLog proxies GET /v1/wiki/log?collection_id= (M26 OKF changelog, rag:read).
func (c *DataClient) WikiLog(ctx context.Context, collectionID string) (json.RawMessage, error) {
	q := url.Values{}
	q.Set("collection_id", collectionID)
	var out json.RawMessage
	if err := c.getJSON(ctx, "/v1/wiki/log", q, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// getJSON is the read wrapper (kept for the M17 read methods) — a GET via `do`.
func (c *DataClient) getJSON(ctx context.Context, path string, q url.Values, out any) error {
	return c.do(ctx, http.MethodGet, path, q, nil, out)
}

// do resolves the per-tenant Bearer (fail-closed) and performs the request, JSON-encoding
// `body` (when non-nil) and decoding a 2xx body into `out` (when non-nil). A resolver error
// means NO request is sent (no master fallback) — the same Model B discipline as the reads.
func (c *DataClient) do(ctx context.Context, method, path string, q url.Values, body, out any) error {
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
	var reqBody io.Reader
	if body != nil {
		b, mErr := json.Marshal(body)
		if mErr != nil {
			return fmt.Errorf("rag data client: encode body for %s %s: %w", method, path, mErr)
		}
		reqBody = strings.NewReader(string(b))
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reqBody)
	if err != nil {
		return fmt.Errorf("rag data client: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("rag data client: %s %s: %w", method, path, err) // never leak the bearer
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("rag data client: %s %s: upstream %d: %s", method, path, resp.StatusCode, string(raw))
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("rag data client: decode %s: %w", path, err)
	}
	return nil
}

// UploadFileInput is a multipart file upload for POST /v1/documents (async 202).
// File is STREAMED to the upstream — a large PDF is never buffered whole in the BFF.
type UploadFileInput struct {
	File         io.Reader // the file bytes (streamed via io.Pipe)
	Filename     string
	ContentType  string // MIME; looprag validates it against its supported set
	CollectionID string
	Name         string // optional display name; defaults to the filename upstream
	Mode         string // "fast" | "hi_res"; empty defaults to fast upstream
}

// uploadFilePart opens a multipart "file" part carrying the caller's declared MIME
// so looprag's isSupportedMime(file.type) sees the real content type (multipart's
// CreateFormFile would hardcode application/octet-stream and break the check).
func uploadFilePart(mw *multipart.Writer, filename, contentType string) (io.Writer, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	h.Set("Content-Type", contentType)
	return mw.CreatePart(h)
}

// UploadDocumentFile proxies a multipart file upload to looprag's POST /v1/documents
// with the per-tenant Bearer. The file is streamed via io.Pipe so a large PDF is never
// buffered whole. Upstream returns 202 + a document id (async ingest). Any upstream
// >=400 surfaces as a typed error — never a silent success (Error Handling: fail-loud).
func (c *DataClient) UploadDocumentFile(ctx context.Context, in UploadFileInput) (json.RawMessage, error) {
	if c.keyResolver == nil {
		return nil, fmt.Errorf("rag data client: no key resolver wired (misconfiguration)")
	}
	bearer, err := c.keyResolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("rag data client: resolve per-tenant key: %w", err)
	}

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		// Any write error closes the pipe WITH that error, so httpClient.Do returns it
		// rather than shipping a truncated upload.
		var werr error
		defer func() { _ = pw.CloseWithError(werr) }()
		if in.CollectionID != "" {
			if werr = mw.WriteField("collection_id", in.CollectionID); werr != nil {
				return
			}
		}
		if in.Name != "" {
			if werr = mw.WriteField("name", in.Name); werr != nil {
				return
			}
		}
		if in.Mode != "" {
			if werr = mw.WriteField("mode", in.Mode); werr != nil {
				return
			}
		}
		part, perr := uploadFilePart(mw, in.Filename, in.ContentType)
		if perr != nil {
			werr = perr
			return
		}
		if _, werr = io.Copy(part, in.File); werr != nil {
			return
		}
		werr = mw.Close()
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/documents", pr)
	if err != nil {
		return nil, fmt.Errorf("rag data client: build upload request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("rag data client: POST /v1/documents: %w", err) // never leak the bearer
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("rag data client: POST /v1/documents: upstream %d: %s", resp.StatusCode, string(raw))
	}
	out, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("rag data client: read upload response: %w", err)
	}
	return json.RawMessage(out), nil
}
