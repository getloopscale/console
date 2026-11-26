---
type: Product Surface
title: Storage
description: File storage for a customer app, reachable three ways over one `/v1/storage/*` surface — the API, the CLI and the TypeScript SDK.
resource: https://api.getloopscale.com/v1/storage
tags: [storage, api, cli, sdk, product, share-link]
generated: { by: claude-opus-5/okf-export, at: 2026-08-05 }
status: stable
sources:
  - id: repo-history
    resource: docs/storage.md
    title: Storage reference, at its pre-bundle path in this repository
    last_modified: 2026-07-14
---

# Storage — file storage for your app

LoopScale storage lets your app store and serve files without running its own file
infrastructure. Files are private by default and accessed through your LoopScale API
key; a temporary **share link** lets you hand out read access to a single file.

Reach it three ways — the **API**, the **CLI**, or the **TypeScript SDK** — all
backed by the same `/v1/storage/*` surface, authenticated by a `theo_live_*` key
carrying the `storage:read` / `storage:write` scopes.

## Concepts

- **Store** — one file namespace per team. No buckets to create.
- **Path** — a file key with `/`-delimited folders, e.g. `avatars/user1.png`.
  Folders are virtual (there is nothing to create or delete).
- **Share link** — a short-lived signed URL granting read access to ONE file
  (default 15 minutes, max 7 days).
- **Limits** — each plan has a total-storage cap and a per-file cap. Exceeding
  the total returns **402**; a file over the per-file cap returns **413**.

## The six operations

| Operation | API | CLI | SDK |
|---|---|---|---|
| Upload | `PUT /v1/storage/objects/{path}` | `loopscale storage upload <file> <path>` | `storage.upload(path, bytes, contentType?)` |
| Download | `GET /v1/storage/objects/{path}` | `loopscale storage download <path> [dest]` | `storage.download(path)` |
| List | `GET /v1/storage/objects?prefix=` | `loopscale storage list [prefix]` | `storage.list(prefix?)` |
| Stat (metadata) | `GET /v1/storage/stat/{path}` | `loopscale storage stat <path>` | `storage.stat(path)` |
| Delete | `DELETE /v1/storage/objects/{path}` | `loopscale storage delete <path>` | `storage.del(path)` |
| Share | `POST /v1/storage/share` | `loopscale storage share <path> --expires <s>` | `storage.share(path, seconds?)` |

Downloads and share redemptions always send `Content-Disposition: attachment`
and `X-Content-Type-Options: nosniff` — files are served for download, never
rendered inline (they cannot execute in a browser).

## API

```sh
# Upload
curl -X PUT https://api.getloopscale.com/v1/storage/objects/avatars/user1.png \
  -H "Authorization: Bearer $LOOPSCALE_KEY" \
  -H "Content-Type: image/png" \
  --data-binary @user1.png

# Create a 1-hour share link
curl -X POST https://api.getloopscale.com/v1/storage/share \
  -H "Authorization: Bearer $LOOPSCALE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"path":"avatars/user1.png","expires_in_seconds":3600}'
# → {"url":"/v1/storage/shared/<token>","expires_at":"..."}
```

Errors are JSON `{"error":{"code","message"}}`. Status codes: `400` invalid path,
`402` storage limit reached, `413` file too large, `404` not found, `410` share
link expired, `403` share link invalid / missing scope, `503` temporarily
unavailable.

## CLI

```sh
loopscale storage upload ./report.pdf reports/2026-q3.pdf
loopscale storage list reports/
loopscale storage share reports/2026-q3.pdf --expires 3600
loopscale storage download reports/2026-q3.pdf ./local.pdf
loopscale storage delete reports/2026-q3.pdf
```

Add `--json` for machine-readable output. Exit codes follow the LoopScale contract:
`0` success, `1` usage/limit, `4` auth, `5` partial/network.

## SDK (TypeScript)

```sh
npm install @getloopscale/storage
```

```ts
import { createStorageClient, QuotaExceededError } from '@getloopscale/storage';

const storage = createStorageClient({ baseUrl: 'https://api.getloopscale.com', apiKey: process.env.LOOPSCALE_KEY! });

await storage.upload('avatars/user1.png', bytes, 'image/png');
const { url } = await storage.share('avatars/user1.png', 3600);
```

See `sdk/storage-ts/README.md` for the full error table.

> A Python SDK is planned but not yet available (named deferral, 2026-07-14).

## Related

- [`roadmaps/presigned-storage`](/roadmaps/presigned-storage.md) changes how the bytes of these six
  operations travel: upload and download move off the BFF proxy onto presigned URLs. The operation
  table above describes the proxy path, which stays supported for small files and non-browser clients.
