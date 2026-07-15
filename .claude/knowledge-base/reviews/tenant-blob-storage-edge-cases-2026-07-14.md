# Edge Case Review — tenant-blob-storage (M7 plan)

Date: 2026-07-14
Plan analyzed: `.claude/knowledge-base/plans/tenant-blob-storage-plan.md` (v1.0 → v1.1)
Tasks analyzed: 15 (T1.1–T6.2)
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: S3 object key MUST be tenant-namespaced (cross-tenant data leak)
- **Affected task:** T1.2 (S3 client), T2.2 (handlers)
- **Family:** Security / tenant isolation
- **Scenario:** namespace is tenant-global in ONE bucket (grill decision 2). The client signature `PutObject(ctx, key, ...)` never specifies that `key` is prefixed by tenant. If the handler passes the raw `name`, tenant A's `avatars/x.png` and tenant B's `avatars/x.png` map to the SAME S3 object → overwrite + read across tenants.
- **Impact:** catastrophic isolation break — the exact failure the whole account-tenancy model (M0-M3) exists to prevent.
- **Fix:** the service derives the S3 key as `{tenant_id}/{name}` server-side (never from client input); the handler NEVER passes a client-controlled full key. Metadata `UNIQUE(tenant_id, name)` stays as-is. Add a test asserting two tenants uploading identical `name` produce DISTINCT S3 keys and cannot read each other's bytes.

### EC-2: Download/redemption MUST neutralize stored Content-Type (stored XSS)
- **Affected task:** T2.2 (download), T2.5 (share redemption — the unauthenticated route)
- **Family:** Security / content handling
- **Scenario:** `mime_type` is client-declared at upload (T2.2). Download/redemption sets `Content-Type` from it. An attacker uploads `evil.html` with `text/html`, mints a share link, sends it to a victim; the browser renders it inline → stored XSS in the platform's domain.
- **Impact:** stored XSS on the (only) unauthenticated surface; account/session theft.
- **Fix:** on BOTH download and share-redemption, set `X-Content-Type-Options: nosniff` AND `Content-Disposition: attachment; filename="..."` (force download, never inline render). Optionally allowlist inline-safe types later; MVP = always attachment. Add a test asserting both headers present on redemption.

## SHOULD TEST

### EC-3: `list` prefix + cursor must not cross tenant
- **Affected task:** T2.2 (list)
- **Suggested test:** assert `GET /v1/storage/objects?prefix=` is always AND-ed with `WHERE tenant_id=$1` and a crafted `cursor` from tenant A returns zero rows for tenant B (keyset is within-tenant only).

### EC-4: zero-byte + max-boundary uploads
- **Affected task:** T2.2, T2.3
- **Suggested test:** 0-byte object uploads/downloads cleanly (valid edge); a file of EXACTLY the per-file cap passes, cap+1 → 413 (boundary, per testing.md § 4.1).

## DOCUMENT

### EC-5: share redemption is the only unauthenticated route — abuse surface
- **Accepted risk:** bounded by token possession + TTL (max 7d) + rate limit (T2.5). Documented; secret rotation invalidates outstanding links (ADR D1 consequence). No additional mechanism in MVP.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| T1.2 | 1 | 1 (EC-1) | 0 | 0 |
| T2.2 | 2 | 1 (EC-1/EC-2 shared) | 1 (EC-3) | 0 |
| T2.3 | 1 | 0 | 1 (EC-4) | 0 |
| T2.5 | 2 | 1 (EC-2) | 0 | 1 (EC-5) |

**Verdict:** PLAN NEEDS ADJUSTMENT → 2 MUST FIX absorbed into v1.1 (T1.2 tenant-key derivation + T2.2/T2.5 content-type neutralization); 2 SHOULD TEST added to task TDD; 1 DOCUMENT accepted.
