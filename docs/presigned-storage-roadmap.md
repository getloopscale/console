# Presigned upload/download — architecture roadmap

Status: in progress (2026-07-18). Owner: platform. Repo: `theo-cloud` (BFF) + `dashboard`.

## Why (bottleneck being removed)

Today the storage data plane is **proxied through the BFF**: `PUT/GET /v1/storage/objects/*`
streams every byte through the Go server (`internal/routes/storage.go` → `orchestrator.PutObject`
→ `s3x.PutObject`; downloads `io.Copy(w, rc)`). This couples the file data plane to the BFF's
CPU/memory/goroutine budget and to the PG pool's request lifetime. For large files and concurrent
uploads it is the throughput bottleneck.

**Presigned URLs** move the bytes off the BFF: the BFF only *mints a signed URL* (metadata-plane,
milliseconds) and the client transfers bytes **directly to/from S3**. The BFF keeps ownership of
auth, tenant-key derivation, quota, and metadata — never the bytes.

## Prior art (already in-repo)

- `discoveries/blueprints/tenant-blob-storage-blueprint.md` — studied supabase/storage,
  nhost/hasura-storage (`storage/s3.go::CreatePresignedURL`), pocketbase (`s3blob`), go-cloud.
  ADR D2 chose the **hand-rolled SigV4** client (`internal/storage/s3x`) over aws-sdk.
- `internal/storage/s3x/sign.go` — a working **header-based** SigV4 `Signer` (Authorization header).
  Presign is the **query-string** variant of the same algorithm; all helpers (`escapePath`,
  `escapeQuery`, `uriEncode`, signing-key derivation) are reused.

## Design decisions (ADRs)

- **ADR-P1 — Query-string SigV4 presign, hand-rolled.** Reuse the s3x signer; do NOT add aws-sdk
  (consistent with blueprint ADR D2). Only `host` is a signed header; payload `UNSIGNED-PAYLOAD`;
  `X-Amz-Expires` bounds the URL. Alternatives rejected: aws-sdk presign (~18 modules, contradicts
  D2); proxy-forever (the bottleneck we are removing).
- **ADR-P2 — Two-phase upload commit.** The BFF cannot see the bytes, so metadata is created
  `pending` at mint time (quota reserved), and a separate `commit` call HEADs S3 to confirm the
  object exists and its size, then marks `committed` (quota committed). Crash between = `pending`
  row + maybe orphan S3 object, reclaimed by a reaper (existing `status` column already models this).
  Alternative rejected: trust the client's "done" without HEAD (lets a client inflate quota / fake
  uploads).
- **ADR-P3 — Server-derived key, always.** The signed URL is minted for `KeyForTenant(tenant, path)`;
  the client never controls the S3 key. Cross-tenant isolation at the bytes layer is preserved
  (blueprint EC-1). Short TTL (default 5 min upload / 5 min download) bounds URL leakage.
- **ADR-P4 — Backward-compatible.** The existing proxy `PUT/GET` endpoints stay (small files, curl,
  non-browser clients). Presign is additive; the dashboard opts in.

## Milestones

- **M1 — Presign core (s3x).** `Signer.Presign(method, url, expires, now)` + `Client.PresignPut/
  PresignGet`; extend `ObjectStore`. TDD: deterministic unit (fixed clock/creds → stable signature +
  required `X-Amz-*` params) + **MinIO integration round-trip** (presign PUT → upload → presign GET →
  read back) — the only proof the signature actually works.
- **M2 — Presigned-upload two-phase.** `POST /objects/{path}/presign` (quota reserve + pending
  metadata + mint PUT URL) + `POST /objects/{path}/commit` (HEAD S3 + mark committed + quota commit;
  compensate on failure).
- **M3 — Presigned-download.** `GET /objects/{path}/presign-download` → short-TTL signed GET URL.
- **M4 — Frontend + CORS.** `workspace.tsx` uploads/downloads direct to S3; bucket CORS for browser
  PUT/GET. LIVE on app-dev.
- **M5 — Benchmark + LIVE.** proxy vs presign (BFF memory/throughput/latency), end-to-end LIVE proof,
  final release.

## Global DoD (every milestone)

- TDD RED→GREEN→REFACTOR; `go test ./...` green; typecheck/lint clean.
- Security code (SigV4) validated by round-trip against real MinIO, not just format asserts.
- No new heavy dependency (ADR-P1). Typed errors. Tenant isolation preserved.
- LIVE evidence + (M5) benchmark data. Release cut develop→main + self-merge.
