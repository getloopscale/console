# @getloopscale/storage

Official TypeScript client for **LoopScale tenant blob storage** — upload, download, list, delete, stat, and share files over the LoopScale `/v1/storage` API.

## Install

```sh
npm install @getloopscale/storage
```

## Usage

```ts
import { createStorageClient } from '@getloopscale/storage';

const storage = createStorageClient({
  baseUrl: 'https://api.getloopscale.com',
  apiKey: process.env.LOOPSCALE_STORAGE_KEY!, // a theo_live_* key with storage:read / storage:write
});

// Upload
await storage.upload('avatars/user1.png', bytes, 'image/png');

// Download
const data = await storage.download('avatars/user1.png');

// List a folder
const { files } = await storage.list('avatars/');

// Metadata
const info = await storage.stat('avatars/user1.png');

// Temporary share link (default 15 min, max 7 days)
const { url, expires_at } = await storage.share('avatars/user1.png', 3600);

// Delete
await storage.del('avatars/user1.png');
```

## Errors

Every method rejects with a typed error you can branch on:

| Error | HTTP | Meaning |
|---|---|---|
| `QuotaExceededError` | 402 | Your plan's total storage limit was reached |
| `FileTooLargeError` | 413 | The file exceeds your plan's per-file limit |
| `ScopeError` | 401 / 403 | The API key lacks `storage:read` / `storage:write` |
| `NotFoundError` | 404 | The file does not exist |
| `StorageError` | other | Base class; carries `status` and `code` |

```ts
import { QuotaExceededError } from '@getloopscale/storage';

try {
  await storage.upload('big.zip', bytes);
} catch (err) {
  if (err instanceof QuotaExceededError) {
    // prompt the user to upgrade or free space
  }
}
```

## License

Apache-2.0
