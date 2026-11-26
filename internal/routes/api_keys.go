// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

package routes

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/usetheoai/theo-cloud/internal/auth"
)

// API Key Rotation plan defaults.
const (
	defaultGraceWindowHours = 24
	minGraceWindowHours     = 1
	maxGraceWindowHours     = 168 // 7 days
)

// Plan 0 of dashboard-memory-section-roadmap.md (T0.3-T0.5).
// Platform unified API keys with scopes — single table, single key shape
// (theo_live_{base64url(32)}), gated by scope on read.
//
// ADRs locked by the plan (v1.2):
//   D1 — single unified theo_live_* key with multi-scope declaration
//   D2 — scope enum locked v0.1; reserved scopes recognised but rejected 503
//   D3 — secret format theo_live_{base64url(32)} (Stripe prefix discipline)
//   D4 — SHA-256 single-pass hashing (NOT bcrypt — 256-bit entropy already)
//   D5 — tenant scoping via Ory (subject, tenant_id) discriminator
//   D6 — expires_at optional at v0.1 (NULL = never)
//   D7 — revocation via soft-delete (revoked_at); hard DELETE forbidden
//   D8 — route → middleware dispatch: /v1/api-keys/* uses RequireJWT (session)
//
// Edge cases absorbed (v1.2 review):
//   EC-1 (list) — LIMIT 100 prevents runaway response
//   EC-2 (delete) — validate ID format BEFORE DB query (apk-{16hex} per pkg/id
//        convention; the plan's "ULID" wording is the older formulation, the
//        codebase-canonical format is the existing prefix-hex pattern from
//        pkg/id/id.go enforced by gate PKG-G06 — the security invariant
//        "validate-format-before-query" is preserved)
//   EC-3 (create) — reject expires_at in the past
//   EC-4 (create) — reject empty/over-long name BEFORE INSERT
//   EC-5 (create) — explicit rand.Read error check, never partial secrets

const (
	// SecretPrefix is the live-mode key prefix per D3. Stripe-style discipline:
	// a customer reading their secret-leak alerts immediately recognises
	// `theo_live_*` as a live credential.
	SecretPrefix = "theo_live_"

	// SecretRandomBytes is the entropy budget for the secret per D3.
	// 32 bytes = 256 bits — unguessable at any reasonable adversary cost.
	SecretRandomBytes = 32

	// RowIDPrefix is the project-canonical ID prefix per pkg/id (ADR-0028 +
	// gate PKG-G06 "Deterministic Naming And IDs"). Same shape as build-
	// / rel- / prev- / raa- — keeps the codebase coherent.
	RowIDPrefix = "apk-"

	// listLimit caps the list-handler response to prevent runaway payload
	// if a customer accumulates many keys (EC-1 absorption).
	//
	// B-114 — a query pede `listLimit + 1` e o handler corta em `listLimit`, devolvendo
	// `has_more`. Cortar em `listLimit` no SQL tornava "exatamente 100 chaves" e "mais de 100
	// chaves" indistinguíveis na resposta, e a 101ª sumia sem que nada dissesse.
	listLimit = 100

	// keyNameMaxLength mirrors the DB CHECK constraint at migration 000024.
	keyNameMaxLength = 64
)

// validScopes is the ACTIVE enum (D2). Lookup via map gives O(1) validation
// against typos like "momory:read". The Observability vertical (theo-lens,
// edge-integration M37-M46) is ACTIVE alongside Memory — a customer can issue a
// key carrying observability:* and use it against the unified /v1/lens edge.
// The RAG vertical (theo-rag, M12-M20) is ACTIVE too (#168) — a customer can issue
// a key carrying rag:read/write/delete for the unified /v1/rag edge + /mcp/rag. Note
// rag:admin is NOT here: it is theo-rag's broker-held key-lifecycle scope, never
// customer-issuable (least privilege — the forward-auth-rag broker's supported set
// is exactly {rag:read, rag:write, rag:delete}, cmd/main.go).
var validScopes = map[string]bool{
	"memory:read":          true,
	"memory:write":         true,
	"memory:delete":        true,
	"memory:admin":         true,
	"observability:read":   true,
	"observability:write":  true,
	"observability:delete": true,
	"observability:admin":  true,
	"rag:read":             true,
	"rag:write":            true,
	"rag:delete":           true,
	// Storage vertical (M7 tenant blob storage) — a customer issues a key carrying
	// storage:read/storage:write for the /v1/storage edge. No customer-issuable
	// storage:admin: the vertical is in-process (no broker key mint, unlike rag).
	"storage:read":  true,
	"storage:write": true,
	// Trust vertical (theo-trust, M10-M11 Model B L2) — a customer issues a key
	// carrying trust:read/write/delete for the unified /v1/trust edge.
	//
	// ESTAVA AUSENTE, e a ausência era invisível: medido em 2026-07-31, a cadeia
	// inteira já funcionava — borda roteando, forward-auth-trust ligado, broker
	// cunhando chave por tenant — e nenhum cliente podia alcançá-la, porque o escopo
	// que a borda exige não era emitível. Cada camada parecia correta isolada.
	//
	// O conjunto é EXATAMENTE o que o broker sabe cunhar (cmd/main.go:
	// KeyForTenantScoped). `trust:admin` e `trust:platform-admin` ficam de fora pelo
	// mesmo motivo de `rag:admin`/`storage:admin`: são credenciais de ciclo de vida,
	// do broker, nunca do consumidor.
	"trust:read":   true,
	"trust:write":  true,
	"trust:delete": true,
	// LT-012 / ADR 0009 (opção B) — ler o conteúdo BRUTO da conversa deixou de vir junto
	// de `trust:read`. `messages.content` guarda o texto original, inclusive o trecho que
	// o próprio scanner classificou como segredo, e servi-lo a toda credencial de leitura
	// tornava a ingestão um SEGUNDO lugar onde o segredo existe. Quem precisa do bruto
	// (auditoria, reprodução de incidente) pede este escopo explicitamente; o dashboard
	// NÃO o recebe, e é isso que reduz a exposição.
	"trust:content": true,
	// Promptly vertical (theo-promptly, M11 Model B L2) — a customer issues a key
	// carrying promptly:read/write for the /v1/promptly edge.
	//
	// TERCEIRA ocorrência do mesmo modo de falha, e a mais cara: medida em 2026-08-01
	// numa corrida de live-test, a cadeia estava inteira de pé — borda roteando,
	// `promptlyForwardAuthHandler` ligado em cmd/main.go exigindo `promptly:read`,
	// broker cunhando por tenant, `/v1/promptly/health` respondendo 401 — e o produto
	// era INUTILIZÁVEL: toda chamada com chave legítima morria em 403 SCOPE_REQUIRED,
	// porque o escopo que a borda cobra não existia neste mapa. Cada camada correta
	// isolada, a capacidade inalcançável, e nada vermelho em lugar nenhum.
	//
	// O escopo aqui é o que a BORDA exige (`promptly:*`), não o que o broker cunha
	// downstream: ele traduz `promptly:* → prompt:*`, e `prompt:read`/`prompt:write`
	// são credenciais internas — jamais emitíveis pelo cliente.
	//
	// `api_keys_edge_scope_parity_test.go` passou a derivar esta exigência do AST de
	// cmd/main.go em vez de repeti-la à mão, para que o QUARTO vertical não repita isto.
	"promptly:read":  true,
	"promptly:write": true,
	// Skills vertical (theo-skills, M22 Model B) — a customer issues a key carrying
	// skills:read/write/publish for the /v1/skills edge.
	//
	// O conjunto é EXATAMENTE o que o broker sabe cunhar (cmd/main.go: a lista
	// passada a skills.NewBroker). `skills:admin` fica de fora pelo mesmo motivo de
	// `rag:admin` e `trust:admin`: é a credencial de CICLO DE VIDA de chave, e uma
	// credencial cunhada pelo gateway jamais pode provisionar outras.
	//
	// Ao contrário do trust — cuja cadeia já estava de pé e só faltava o escopo —
	// aqui NADA existia: sem broker, sem forward-auth, sem rota de borda. Adicionar
	// o escopo antes dessas peças teria oferecido uma capacidade que não conecta,
	// que é o defeito oposto e igualmente silencioso.
	"skills:read":    true,
	"skills:write":   true,
	"skills:publish": true,
}

// reservedScopes are RESERVED for future verticals per D2. Requesting one
// gets a 503 scope_not_yet_active — honest "not implemented yet" instead
// of cryptic 403 "scope_required". (Observability graduated from reserved
// `traces:*` to the ACTIVE `observability:*` with M37-M46; RAG graduated from
// reserved `rag:*` to the ACTIVE `rag:read/write/delete` above with #168.)
var reservedScopes = map[string]bool{
	"agents:read":   true,
	"agents:invoke": true,
	"deploys:read":  true,
	"deploys:write": true,
}

// rowIDPattern matches the project-canonical row id `apk-{16hex}`.
var rowIDPattern = regexp.MustCompile(`^apk-[0-9a-f]{16}$`)

// IsValidAPIKeyID reports whether s matches the canonical apk-{16hex} format.
// Exported so other packages (e.g., audit log search) can validate without
// importing chi or the routes package.
func IsValidAPIKeyID(s string) bool { return rowIDPattern.MatchString(s) }

// APIKeysHandler owns CRUD for the unified theo_live_* API key surface.
// All endpoints require a PaaS session JWT (registered with RequireJWT
// in cloud/cmd/main.go per D8 dispatch). The Bearer-keyed `RequireScope`
// middleware lives in cloud/internal/auth/scope.go and is the consumer
// side (memory/* + future verticals) — NOT a CRUD authenticator on this
// resource (D8 forbids that loop).
type APIKeysHandler struct {
	db     *sql.DB
	logger *slog.Logger
}

// NewAPIKeysHandler creates the handler. logger may be nil — when nil,
// slog.Default is used (matches the convention in webhook_db_test.go).
func NewAPIKeysHandler(db *sql.DB, logger *slog.Logger) *APIKeysHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &APIKeysHandler{db: db, logger: logger}
}

// APIKeyView is the wire shape returned by ListKeys + on CreateKey response.
// Secret is empty on list — only the CreateKey response includes the raw
// secret (Plan invariant: show-once).
type APIKeyView struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	KeyPrefix  string     `json:"key_prefix"` // masked display: theo_live_Ab
	Scopes     []string   `json:"scopes"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
}

// ListKeys returns the authenticated user's active API keys, capped at 100.
// GET /v1/api-keys/list
func (h *APIKeysHandler) ListKeys(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	// EC-1: LIMIT 100 cap. Even if a customer accumulates many keys, the
	// response stays bounded. Combined with the D7 soft-delete filter, the
	// query rides the partial index idx_loopruntime_api_keys_tenant.
	// Model B leak-fix (GAP-4): exclude legacy BFF-minted shadow rows
	// (key_name='bff-dashboard', bff_minted=true) — they were an internal
	// gateway artifact, never user-created, and must never surface in the
	// customer's own key list. The BFFKeyVault that wrote them is removed; this
	// filter hides any rows that predate the removal.
	// O cap vem da constante `listLimit`, nao de um 100 digitado aqui. Antes a constante
	// existia sem uso e o 100 estava hardcoded na query: mudar uma nao mudava a outra, e o
	// comentario da constante prometia um cap que ela nao controlava. `%d` mantem o SQL
	// final e `LIMIT 101` desde o B-114: uma linha a mais do que se devolve, para saber que ha mais.
	q := fmt.Sprintf(`SELECT id, key_name, key_prefix, scopes, created_at, last_used_at, expires_at
		FROM loopruntime_api_keys
		WHERE subject = $1 AND tenant_id = $2 AND revoked_at IS NULL
		  AND COALESCE(bff_minted, false) = false
		ORDER BY created_at DESC
		LIMIT %d`, listLimit+1)

	rows, err := h.db.QueryContext(r.Context(), q, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("list api keys: query failed", "error", err, "subject", user.Subject)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not list API keys. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()

	// Always serialise as `[]` not `null` — UI consumers iterate the slice.
	keys := make([]APIKeyView, 0, 16)
	for rows.Next() {
		var (
			v         APIKeyView
			scopesRaw []byte
			lastUsed  sql.NullTime
			expires   sql.NullTime
		)
		if err := rows.Scan(&v.ID, &v.Name, &v.KeyPrefix, &scopesRaw, &v.CreatedAt, &lastUsed, &expires); err != nil {
			h.logger.Warn("list api keys: row scan failed", "error", err)
			continue
		}
		if err := json.Unmarshal(scopesRaw, &v.Scopes); err != nil {
			// EC-7 spirit: jsonb corruption is non-fatal HERE (list endpoint;
			// degraded view is acceptable so customers can still see the row
			// and revoke it). Middleware path is stricter — see scope.go.
			h.logger.Warn("list api keys: scope unmarshal failed", "id", v.ID, "error", err)
			v.Scopes = []string{}
		}
		if lastUsed.Valid {
			t := lastUsed.Time
			v.LastUsedAt = &t
		}
		if expires.Valid {
			t := expires.Time
			v.ExpiresAt = &t
		}
		keys = append(keys, v)
	}
	if err := rows.Err(); err != nil {
		h.logger.Warn("list api keys: rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not list API keys. Try again.")
		return
	}

	keys, temMais := truncar(keys, listLimit)
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys, "has_more": temMais})
}

// RevokeKey soft-deletes the key (D7). Cross-tenant attempts return 404
// (D5 existence-leak prevention).
// DELETE /v1/api-keys/{id}
func (h *APIKeysHandler) RevokeKey(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	keyID := chi.URLParam(r, "id")

	// EC-2: validate the ID format BEFORE touching the DB. Malformed IDs
	// (path-traversal attempts, SQL meta-chars, random strings) get a
	// 400 INVALID_ID and the DB query plan + slow-log + audit log stays
	// clean. The security invariant — format-check before query — is what
	// matters; the format used is the codebase-canonical apk-{16hex}.
	if !IsValidAPIKeyID(keyID) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "API key id must match apk-{16hex}.")
		return
	}

	const q = `UPDATE loopruntime_api_keys
		SET revoked_at = NOW()
		WHERE id = $1 AND subject = $2 AND tenant_id = $3 AND revoked_at IS NULL
		  AND COALESCE(bff_minted, false) = false`

	res, err := h.db.ExecContext(r.Context(), q, keyID, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("revoke api key: update failed", "error", err, "id", keyID)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not revoke API key. Try again.")
		return
	}
	affected, err := res.RowsAffected()
	if err != nil {
		h.logger.Warn("revoke api key: rows affected failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not revoke API key. Try again.")
		return
	}
	if affected == 0 {
		// Either: (a) row truly doesn't exist, (b) row belongs to a different
		// tenant, (c) row already revoked. ALL three return 404 — the cross-
		// tenant branch is the security-load-bearing one (D5 invariant: never
		// distinguish "exists but not yours" from "doesn't exist").
		writeError(w, http.StatusNotFound, "NOT_FOUND", "API key not found.")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// CreateKey generates a new theo_live_* secret + persists hash + scopes.
// The raw secret is returned ONCE in the response body and never again.
// POST /v1/api-keys
func (h *APIKeysHandler) CreateKey(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	// Reject obscenely large bodies before json.Decode allocates them — a
	// hostile caller could try to OOM the gateway with a multi-MB payload.
	body, err := io.ReadAll(io.LimitReader(r.Body, 16*1024))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Could not read request body.")
		return
	}

	var req struct {
		Name      string     `json:"name"`
		Scopes    []string   `json:"scopes"`
		ExpiresAt *time.Time `json:"expires_at,omitempty"`
		// NOTE: subject / tenant_id deliberately NOT decoded — these come
		// from auth.GetUser, never the request body (D5 invariant).
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body.")
		return
	}

	// EC-4: validate name BEFORE INSERT (CHECK constraint would surface as
	// 500). Trim whitespace so " " is rejected the same as "".
	trimmed := strings.TrimSpace(req.Name)
	if trimmed == "" {
		writeError(w, http.StatusBadRequest, "EMPTY_NAME", "API key name is required.")
		return
	}
	if len(req.Name) > keyNameMaxLength {
		writeError(w, http.StatusBadRequest, "NAME_TOO_LONG",
			fmt.Sprintf("API key name must be %d characters or fewer.", keyNameMaxLength))
		return
	}

	// EC-3: expires_at in the past = born-expired key = anti-pattern. Reject
	// upfront with a clear error code, not a silent 200-then-immediate-fail.
	if req.ExpiresAt != nil && req.ExpiresAt.Before(time.Now()) {
		writeError(w, http.StatusBadRequest, "EXPIRES_IN_PAST",
			"expires_at must be in the future.")
		return
	}

	if len(req.Scopes) == 0 {
		writeError(w, http.StatusBadRequest, "EMPTY_SCOPES", "At least one scope is required.")
		return
	}
	// Walk scopes in input order so the FIRST offending scope drives the
	// error message — predictable for customers debugging their request.
	for _, s := range req.Scopes {
		if reservedScopes[s] {
			writeError(w, http.StatusServiceUnavailable, "scope_not_yet_active",
				fmt.Sprintf("Scope %q is reserved for a future product surface.", s))
			return
		}
		if !validScopes[s] {
			writeError(w, http.StatusBadRequest, "UNKNOWN_SCOPE",
				fmt.Sprintf("Scope %q is not a known scope.", s))
			return
		}
	}

	// D3 secret generation. EC-5: rand.Read MUST be checked — Go's contract
	// is "returns full N bytes or non-nil error", but checking explicitly
	// hardens against accidental loss of the contract in future refactors.
	raw := make([]byte, SecretRandomBytes)
	if _, err := rand.Read(raw); err != nil {
		h.logger.Error("create api key: crypto/rand failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create API key. Try again.")
		return
	}
	secret := SecretPrefix + base64.RawURLEncoding.EncodeToString(raw)

	// D4 hash + first-12 prefix for masked display.
	sum := sha256.Sum256([]byte(secret))
	keyHash := hex.EncodeToString(sum[:])
	keyPrefix := secret[:12]

	id := generateAPIKeyRowID()
	scopesJSON, err := json.Marshal(req.Scopes)
	if err != nil {
		h.logger.Error("create api key: scopes marshal failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create API key. Try again.")
		return
	}

	// M0: persist the key's Account, DERIVED FROM ITS TENANT in the same INSERT
	// (the key inherits the Account of the tenant it is scoped to). The tenant is
	// the authoritative source: deriving account_id from the tenant row keeps the
	// key consistent with its tenant regardless of how the request authenticated.
	// (Post-M3 the session JWT does carry account_id via UserContext.AccountID, but
	// the tenant subquery remains the source of truth — it can't drift from the
	// tenant the key is scoped to. Post-000044 tenant.account_id is NOT NULL.)
	const q = `INSERT INTO loopruntime_api_keys
		(id, subject, tenant_id, account_id, key_name, key_hash, key_prefix, scopes, expires_at)
		VALUES ($1, $2, $3, (SELECT account_id FROM tenants WHERE id = $3), $4, $5, $6, $7, $8)`

	if _, err := h.db.ExecContext(r.Context(), q,
		id, user.Subject, user.TenantID, trimmed, keyHash, keyPrefix, scopesJSON, req.ExpiresAt,
	); err != nil {
		// Unique-violation on key_hash is astronomically unlikely (collision
		// in 256-bit space) but is the one branch we differentiate so we
		// don't lie about it being a generic error.
		if isUniqueViolation(err) {
			h.logger.Error("create api key: key_hash collision (astronomically unlikely)", "id", id)
		}
		h.logger.Warn("create api key: insert failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not create API key. Try again.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":         id,
		"name":       trimmed,
		"key_prefix": keyPrefix,
		"scopes":     req.Scopes,
		"secret":     secret, // raw — shown ONCE; never persisted plain
	})
}

// RotateKey rotates an existing key per API Key Rotation plan v1.0.
// POST /v1/api-keys/{id}/rotate
//
// Closes Plan 0 ADR D6 deferral.
//
// Body (optional): {"grace_window_hours": <int 1-168>} — default 24.
//
// Atomic single-tx:
//  1. SELECT FOR UPDATE old row (must exist, belong to authenticated
//     subject+tenant, not revoked, not already-expired). 404 otherwise.
//  2. INSERT new row with rotated_from = old.id, same scopes, fresh
//     `theo_live_*` secret + apk-{16hex} id, name suffixed with rotation date.
//  3. UPDATE old row's expires_at = NOW() + grace_window.
//  4. COMMIT.
//  5. Return 200 with new id + secret (shown ONCE per Plan 0 D3).
//
// D5: after grace, the existing RequireScope middleware naturally 401s
// the old key — no new dispatcher needed.
func (h *APIKeysHandler) RotateKey(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	oldID := chi.URLParam(r, "id")
	if !IsValidAPIKeyID(oldID) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "API key id must match apk-{16hex}.")
		return
	}

	// Optional body — body absence is permitted (default 24h grace).
	// Use *int so we can distinguish "absent" from "explicitly 0" — Go's
	// zero-value semantic would silently swallow an explicit 0 with omitempty.
	bodyBytes, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
	var req struct {
		GraceWindowHours *int `json:"grace_window_hours,omitempty"`
	}
	if len(bodyBytes) > 0 {
		if err := json.Unmarshal(bodyBytes, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid JSON body.")
			return
		}
	}
	graceHours := defaultGraceWindowHours
	if req.GraceWindowHours != nil {
		graceHours = *req.GraceWindowHours
	}
	if graceHours < minGraceWindowHours || graceHours > maxGraceWindowHours {
		writeError(w, http.StatusBadRequest, "INVALID_GRACE_WINDOW",
			fmt.Sprintf("grace_window_hours must be between %d and %d.", minGraceWindowHours, maxGraceWindowHours))
		return
	}
	graceWindow := time.Duration(graceHours) * time.Hour

	tx, err := h.db.BeginTx(r.Context(), nil)
	if err != nil {
		h.logger.Warn("rotate api key: begin tx failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not rotate API key. Try again.")
		return
	}
	rollback := true
	defer func() {
		if rollback {
			_ = tx.Rollback()
		}
	}()

	// SELECT FOR UPDATE the old row, scoped to authenticated tenant.
	const sel = `SELECT key_name, scopes, revoked_at, expires_at
		FROM loopruntime_api_keys
		WHERE id = $1 AND subject = $2 AND tenant_id = $3
		  AND COALESCE(bff_minted, false) = false
		FOR UPDATE`
	var (
		oldName   string
		scopesRaw []byte
		revokedAt sql.NullTime
		expiresAt sql.NullTime
	)
	if err := tx.QueryRowContext(r.Context(), sel, oldID, user.Subject, user.TenantID).
		Scan(&oldName, &scopesRaw, &revokedAt, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// D5 — cross-tenant + nonexistent collapse to 404.
			writeError(w, http.StatusNotFound, "NOT_FOUND", "API key not found.")
			return
		}
		h.logger.Warn("rotate api key: select failed", "error", err, "id", oldID)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not rotate API key. Try again.")
		return
	}
	// Revoked + already-expired collapse to 404 (refuses to extend an
	// already-terminal key).
	if revokedAt.Valid {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "API key not found.")
		return
	}
	if expiresAt.Valid && expiresAt.Time.Before(time.Now()) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "API key not found.")
		return
	}

	// Generate new secret per Plan 0 D3.
	raw := make([]byte, SecretRandomBytes)
	if _, err := rand.Read(raw); err != nil {
		h.logger.Error("rotate api key: crypto/rand failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not rotate API key. Try again.")
		return
	}
	newSecret := SecretPrefix + base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(newSecret))
	newKeyHash := hex.EncodeToString(sum[:])
	newKeyPrefix := newSecret[:12]
	newID := generateAPIKeyRowID()
	newName := oldName + " (rotated " + time.Now().UTC().Format("2006-01-02") + ")"
	// Length guard mirrors Plan 0 EC-4 — names > 64 chars would surface
	// as a CHECK violation. Truncate the rotated-name silently rather than
	// reject the whole flow.
	if len(newName) > keyNameMaxLength {
		newName = newName[:keyNameMaxLength]
	}

	const ins = `INSERT INTO loopruntime_api_keys
		(id, subject, tenant_id, key_name, key_hash, key_prefix, scopes, expires_at, rotated_from)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
	if _, err := tx.ExecContext(r.Context(), ins,
		newID, user.Subject, user.TenantID, newName, newKeyHash, newKeyPrefix,
		scopesRaw, nil, oldID,
	); err != nil {
		h.logger.Warn("rotate api key: insert failed", "error", err, "old_id", oldID)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not rotate API key. Try again.")
		return
	}

	// UPDATE the old key's expires_at to NOW() + grace_window.
	newExpiry := time.Now().Add(graceWindow)
	if _, err := tx.ExecContext(r.Context(),
		`UPDATE loopruntime_api_keys SET expires_at = $1 WHERE id = $2`,
		newExpiry, oldID,
	); err != nil {
		h.logger.Warn("rotate api key: update old expires_at failed", "error", err, "id", oldID)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not rotate API key. Try again.")
		return
	}

	if err := tx.Commit(); err != nil {
		h.logger.Warn("rotate api key: commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not rotate API key. Try again.")
		return
	}
	rollback = false

	writeJSON(w, http.StatusOK, map[string]any{
		"id":                 newID,
		"name":               newName,
		"key_prefix":         newKeyPrefix,
		"secret":             newSecret,
		"old_id":             oldID,
		"old_expires_at":     newExpiry.UTC().Format(time.RFC3339),
		"grace_window_hours": graceHours,
	})
}

// LineageKey returns the full rotation chain for the given key per API
// Key Lineage View plan v1.0 (closes API Key Rotation OOS #4).
// GET /v1/api-keys/{id}/lineage
//
// Walk strategy (D2): recursive CTE that traverses both directions
//
//	ancestors:   walk rotated_from backward from {id}
//	descendants: walk rows whose rotated_from points to any ancestor
//
// All filtered by the authenticated (subject, tenant_id) — defense in
// depth on top of the FK guarantee that rotations never cross tenants.
// Cross-tenant id → empty result → 404 (D3 + P0 D5 invariant).
//
// Response per D1: {"lineage": [Item, ...]} ordered ROOT FIRST → CURRENT LAST.
// Each Item carries {id, name, key_prefix, created_at, revoked_at,
// expires_at, is_current}.
//
// is_current per row: revoked_at IS NULL AND (expires_at IS NULL OR
// expires_at > NOW()).
func (h *APIKeysHandler) LineageKey(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "AUTH_REQUIRED", "Not authenticated. Run: loopscale login")
		return
	}

	keyID := chi.URLParam(r, "id")
	if !IsValidAPIKeyID(keyID) {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "API key id must match apk-{16hex}.")
		return
	}

	// Recursive CTE walks both directions. Anchor = the requested key;
	// recursive arms walk ancestors (via rotated_from) and descendants
	// (via reverse FK). LIMIT 100 per D2 defensive cap.
	const q = `
		WITH RECURSIVE
		ancestors AS (
		    SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at, rotated_from
		    FROM loopruntime_api_keys
		    WHERE id = $1 AND subject = $2 AND tenant_id = $3
		      AND COALESCE(bff_minted, false) = false
		    UNION
		    SELECT k.id, k.key_name, k.key_prefix, k.created_at, k.revoked_at, k.expires_at, k.rotated_from
		    FROM loopruntime_api_keys k
		    JOIN ancestors a ON a.rotated_from = k.id
		    WHERE k.subject = $2 AND k.tenant_id = $3
		),
		descendants AS (
		    SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at, rotated_from
		    FROM loopruntime_api_keys
		    WHERE id = $1 AND subject = $2 AND tenant_id = $3
		      AND COALESCE(bff_minted, false) = false
		    UNION
		    SELECT k.id, k.key_name, k.key_prefix, k.created_at, k.revoked_at, k.expires_at, k.rotated_from
		    FROM loopruntime_api_keys k
		    JOIN descendants d ON k.rotated_from = d.id
		    WHERE k.subject = $2 AND k.tenant_id = $3
		),
		full_chain AS (
		    SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at FROM ancestors
		    UNION
		    SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at FROM descendants
		)
		SELECT id, key_name, key_prefix, created_at, revoked_at, expires_at
		FROM full_chain
		ORDER BY created_at ASC
		LIMIT 100
	`
	rows, err := h.db.QueryContext(r.Context(), q, keyID, user.Subject, user.TenantID)
	if err != nil {
		h.logger.Warn("lineage api key: query failed", "error", err, "id", keyID)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load lineage. Try again.")
		return
	}
	defer func() { _ = rows.Close() }()

	type lineageItem struct {
		ID        string     `json:"id"`
		Name      string     `json:"name"`
		KeyPrefix string     `json:"key_prefix"`
		CreatedAt time.Time  `json:"created_at"`
		RevokedAt *time.Time `json:"revoked_at,omitempty"`
		ExpiresAt *time.Time `json:"expires_at,omitempty"`
		IsCurrent bool       `json:"is_current"`
	}

	out := make([]lineageItem, 0, 8)
	now := time.Now()
	for rows.Next() {
		var (
			item    lineageItem
			revoked sql.NullTime
			expires sql.NullTime
		)
		if err := rows.Scan(&item.ID, &item.Name, &item.KeyPrefix, &item.CreatedAt, &revoked, &expires); err != nil {
			h.logger.Warn("lineage api key: scan failed", "error", err)
			continue
		}
		if revoked.Valid {
			t := revoked.Time
			item.RevokedAt = &t
		}
		if expires.Valid {
			t := expires.Time
			item.ExpiresAt = &t
		}
		// D1 is_current: not revoked AND (no expiry OR expiry future).
		item.IsCurrent = !revoked.Valid && (!expires.Valid || expires.Time.After(now))
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		h.logger.Warn("lineage api key: rows error", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "Could not load lineage. Try again.")
		return
	}

	// D3 — empty result means the requested id doesn't belong to this
	// (subject, tenant_id) tuple. Surface as 404 to preserve the P0 D5
	// existence-leak invariant.
	if len(out) == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "API key not found.")
		return
	}

	// Multiple is_current=true items would indicate a data invariant
	// violation (two active keys in a single chain). The dashboard expects
	// exactly one; if the data violates this we still return the rows but
	// log for ops to investigate.
	currents := 0
	for _, it := range out {
		if it.IsCurrent {
			currents++
		}
	}
	if currents > 1 {
		h.logger.Warn("lineage api key: data invariant violation — multiple active in chain",
			"id", keyID, "active_count", currents)
	}

	writeJSON(w, http.StatusOK, map[string]any{"lineage": out})
}

// generateAPIKeyRowID returns an `apk-{16hex}` identifier per pkg/id
// convention. Inlined here rather than added to pkg/id to keep Plan 0
// scope minimal (pkg/ requires governance; the cloud package is loosely
// gated and self-sufficient on this kind of helper).
func generateAPIKeyRowID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Mirrors pkg/id behavior: crypto/rand failure is unrecoverable.
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return RowIDPrefix + hex.EncodeToString(b)
}

// isUniqueViolation reports whether the error chain contains a Postgres
// 23505 unique-violation. Uses string match against the pgx error text
// to avoid a hard dependency on the pgx error-code constants from this
// shallow check site.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return strings.Contains(err.Error(), "duplicate key value")
}
