# M12 — Connect data sources: LIVE validation record + benchmark

Date: 2026-07-18
Cycle: DISCOVER → (code already shipped) → LIVE-validation for milestone M12 (`dashboard-connectors-usable`).
Target: dev-public (`app-dev.usetheo.dev`), admin@usetheo.dev.

## DISCOVER finding

M12's theo-cloud engineering was **already implemented and committed** (M8 broker + a prior
M12 pass): the paste-credential form (`dashboard/src/pages/rag/connectors.tsx` CRED_PROVIDERS
+ form, 9 tests), the OAuth authorization broker (`internal/routes/rag_connectors_oauth.go`),
and the connect/sync BFF proxy (`internal/routes/rag_dashboard.go`). `CONNECTOR_VAULT_KEY` is
owned by the theo-rag data-plane (not theo-cloud). The remaining M12 work was therefore
**LIVE-validation**, not new code (one stale empty-state copy line was fixed this cycle).

## LIVE evidence (dev-public, via the dashboard BFF with a real Kratos-minted JWT)

| DoD bullet | LIVE proof | Result |
|---|---|---|
| **#1 OAuth provider registered** | `GET /v1/dashboard/rag/connectors/providers` | `{"providers":["google-drive"]}` — registered |
| **#1 OAuth authorize runs** | `GET /v1/rag-connect/google-drive/authorize?collection_id=…` | `302 → https://accounts.google.com` with `client_id` + `code_challenge` (PKCE) + `redirect_uri` + `scope` |
| **#2 Paste-credential form posts** | `POST /v1/dashboard/rag/connectors/web/connect` from dashboard path | `201` connection `active` (form shipped + 9 unit tests) |
| **#3 CONNECTOR_VAULT_KEY configured** | same connect POST | `201` (NOT `503 connector_vault_unconfigured`) → vault set, credential accepted/encrypted at rest |
| **#4 LIVE connect + first sync ingests docs** | fresh collection (0 docs) → web connect (`example.com`) → `POST …/{id}/sync` → poll | **0 → 1 document** ingested (`doc_bhuwasqlnt7l3ava2xjzfovx`) |

### Reproduction (exact chain)

```
# JWT: Kratos login (auth-dev) → POST app-dev/v1/auth/session/token  → Bearer JWT (446 chars)
GET  app-dev/v1/dashboard/rag/connectors/providers        -> 200 {"providers":["google-drive"]}
POST app-dev/v1/dashboard/rag/collections {"name":"m12-live-proof"}  -> col_… (0 docs)
POST app-dev/v1/dashboard/rag/connectors/web/connect
     {"collection_id":"col_…","seed_url":"https://example.com","max_pages":"1"}  -> 201 active
POST app-dev/v1/dashboard/rag/connectors/{conn}/sync       -> 202 {"status":"enqueued"}
GET  app-dev/v1/dashboard/rag/documents?collection_id=col_…  -> docs: 0 → 1  (~12s)
GET  app-dev/v1/rag-connect/google-drive/authorize?collection_id=col_…  -> 302 accounts.google.com (PKCE)
```

Probe collections/connectors created for this proof were deleted afterward (204).

## Benchmark (measured, LIVE)

| Metric | Value |
|---|---|
| Dashboard connect (`POST …/web/connect`) | `201` synchronous (connection row created immediately) |
| Sync enqueue (`POST …/{id}/sync`) | `202 enqueued` |
| **End-to-end web connect → first document ingested** | **≤ 12 s** (first poll bucket; fresh collection 0 → 1) |
| OAuth authorize redirect build | single `302`, all OAuth params present (client_id/PKCE/redirect_uri/scope) |
| Credential handling | BFF forwards body opaquely (Rule 8 — never logged); vault-encrypted at theo-rag |

## Honest status of DoD #1 (OAuth consent round-trip)

Fully LIVE-proven: the provider is **registered** and the authorize endpoint correctly
**redirects to Google's consent** with valid PKCE + scope + redirect_uri. The connect + first-sync
back half of the OAuth path is the **same BFF→theo-rag chain proven LIVE via paste-credential**
(0→1 ingest). The only step not executed autonomously is a human clicking **"Allow"** on Google's
consent screen with a real Drive account — inherently interactive and flagged in M12 risk #1
("the OAuth-consent half needs a real app"). DoD #4 explicitly accepts "OAuth **or**
paste-credential" for the LIVE-validation, which is satisfied.

## Code delta this cycle

- Fixed the stale empty-state copy in `connectors.tsx` that told users to use the CLI for
  paste-credential sources — it now points to the in-page "connect with a credential" form
  (the dashboard form that M12 shipped). typecheck + eslint clean; 9/9 connectors tests green.

## Verdict

M12 LIVE-validated on dev-public: connect + first-sync ingests documents (bullet #4 fully),
paste-credential form + vault (#2/#3) fully, OAuth registered + authorize→Google (#1 mechanism)
— the OAuth consent click is the one inherently-human step (risk #1). READY to flip M14-style.
