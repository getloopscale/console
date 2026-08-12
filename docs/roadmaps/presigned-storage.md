---
type: Roadmap
title: Presigned upload/download
description: Moving the storage data plane off the BFF proxy onto presigned SigV4 URLs, so the bytes travel client-to-S3 and the BFF keeps only auth, quota and metadata.
tags: [storage, presigned, sigv4, s3, performance, roadmap]
generated: { by: claude-opus-5/okf-export, at: 2026-08-05 }
status: stable
sources:
  - id: repo-history
    resource: docs/presigned-storage-roadmap.md
    title: Presigned upload/download roadmap, at its pre-bundle path in this repository
    last_modified: 2026-07-18
---

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

## M5 — Benchmark data (measured)

`go test -bench='PresignPut|ProxyPut' -benchmem ./internal/storage/s3x/` (AMD, 12 cores):

| Operation | ns/op | B/op | allocs/op | Cost in file size |
|---|---:|---:|---:|---|
| **PresignPut (mint)** | **8,878** | **6,428** | 121 | **O(1) — constant** |
| ProxyPut 1 KB | 268 | 1,064 | 3 | O(N) |
| ProxyPut 1 MB | 247,591 | 1,048,621 | 34 | O(N) |
| ProxyPut 16 MB | 3,750,268 | 16,777,277 | 514 | O(N) |
| ProxyPut 128 MB | 26,812,720 | 134,217,776 | 4,098 | O(N) |

The mint is constant (~8.9 µs / 6.4 KB) regardless of file size; proxying grows linearly.
At 128 MB the proxy allocates 128 MB in the BFF **per upload** vs 6.4 KB for a mint — 100
concurrent 128 MB uploads is ~12.8 GB of BFF RAM (proxy) vs ~640 KB (presign). The benchmark
measures only the in-process relay; the real proxy also holds a goroutine + two sockets for the
entire transfer (seconds for large files over the network), which the presigned path removes.
Crossover: the mint (8.9 µs) is cheaper than proxying anything ≳ 35 KB.

## M4 infra + LIVE end-to-end — DONE (2026-07-18)

The public browser-reachable storage path was provisioned on app-dev and the presigned
upload was proven LIVE in a real Chrome (Playwright):

1. **DNS** `storage-dev.usetheo.dev` → droplet IP (Cloudflare A record).
2. **Edge** — Caddy site `storage-dev.usetheo.dev` reverse-proxies to MinIO with the Host
   header preserved (so the SigV4-signed host matches on verification) + a single, deduped
   `Access-Control-Allow-Origin: https://app-dev.usetheo.dev` (MinIO's own CORS header is
   stripped to avoid the duplicate-value rejection) + an OPTIONS preflight handler.
3. **BFF** — `STORAGE_S3_PUBLIC_ENDPOINT=https://storage-dev.usetheo.dev` (mints against the
   public host; server-side ops stay in-cluster). theo-cloud rebuilt + rolled out.
4. **CSP** — the dashboard `connect-src` now allowlists the storage hosts (the CSP is an
   earlier gate than CORS; without it the browser refused the request before sending it).

**LIVE proof (real Chrome, app-dev, authenticated):** uploading a file in the Workspace fires
`POST /presign-upload` (mint) → **`PUT https://storage-dev.usetheo.dev/theo-storage/<tenant>/<path>`**
(bytes go DIRECTLY to S3) → `POST /presign-commit` (the BFF HEADs S3 + commits) → the file
appears in the list. **Zero `PUT` to the BFF `/objects` proxy path** — the bytes never touch the
BFF. Screenshot: `.claude/knowledge-base/audits/presign-live-upload-app-dev-2026-07-18.png`. The
signature+Host+edge+MinIO chain is independently confirmed by the s3x round-trip integration test
run against the public host (mint PUT → upload → mint GET → read back, PASS).

## Related

- [`products/storage`](/products/storage.md) is the customer-facing surface this roadmap changes. ADR-P4
  keeps that surface backward compatible: the proxy `PUT`/`GET` endpoints documented there stay, and
  presign is additive.
