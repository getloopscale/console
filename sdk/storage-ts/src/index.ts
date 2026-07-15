// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

/**
 * @usetheo/storage — official TypeScript client for Theo tenant blob storage.
 *
 * ```ts
 * import { createStorageClient } from '@usetheo/storage';
 *
 * const storage = createStorageClient({
 *   baseUrl: 'https://api.usetheo.dev',
 *   apiKey: process.env.THEO_STORAGE_KEY!, // a theo_live_* key with storage:read/write
 * });
 *
 * await storage.upload('avatars/user1.png', bytes, 'image/png');
 * const file = await storage.download('avatars/user1.png');
 * const { url } = await storage.share('avatars/user1.png', 3600);
 * ```
 */

/** Options for {@link createStorageClient}. */
export interface StorageClientOptions {
  /** Base URL of the Theo API, e.g. `https://api.usetheo.dev`. */
  baseUrl: string;
  /** A `theo_live_*` API key carrying `storage:read` / `storage:write`. */
  apiKey: string;
  /** Optional fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
}

export interface StorageFile {
  path: string;
  size: number;
  content_type: string;
}

export interface ListResult {
  files: StorageFile[];
  next_cursor: string;
}

export interface ShareResult {
  url: string;
  expires_at: string;
}

/** Base class for all storage errors. `status` is the HTTP status. */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Thrown on HTTP 402 — the plan's aggregate storage limit was reached. */
export class QuotaExceededError extends StorageError {
  constructor(message: string) {
    super(message, 402, 'storage_quota_exceeded');
    this.name = 'QuotaExceededError';
  }
}

/** Thrown on HTTP 413 — the file exceeds the plan's per-file limit. */
export class FileTooLargeError extends StorageError {
  constructor(message: string) {
    super(message, 413, 'file_too_large');
    this.name = 'FileTooLargeError';
  }
}

/** Thrown on HTTP 401/403 — the key lacks the required storage scope. */
export class ScopeError extends StorageError {
  constructor(message: string, status: number) {
    super(message, status, 'scope_required');
    this.name = 'ScopeError';
  }
}

/** Thrown on HTTP 404 — the file does not exist. */
export class NotFoundError extends StorageError {
  constructor(message: string) {
    super(message, 404, 'file_not_found');
    this.name = 'NotFoundError';
  }
}

/** The Theo storage client. Create one with {@link createStorageClient}. */
export interface StorageClient {
  upload(path: string, body: Uint8Array | ArrayBuffer, contentType?: string): Promise<StorageFile>;
  download(path: string): Promise<Uint8Array>;
  /** One page of files. Pass `cursor` (from a prior result's `next_cursor`) to
   *  continue; an empty `next_cursor` means the last page. */
  list(prefix?: string, cursor?: string): Promise<ListResult>;
  /** Fetches EVERY page under prefix (follows next_cursor to completion). */
  listAll(prefix?: string): Promise<StorageFile[]>;
  stat(path: string): Promise<StorageFile>;
  del(path: string): Promise<void>;
  share(path: string, expiresInSeconds?: number): Promise<ShareResult>;
}

/** createStorageClient builds a {@link StorageClient}. */
export function createStorageClient(opts: StorageClientOptions): StorageClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const authHeaders: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}` };
  const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

  async function raise(resp: Response): Promise<never> {
    let code = 'storage_error';
    let message = `Storage request failed (${resp.status})`;
    try {
      const body = (await resp.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      /* non-JSON body */
    }
    switch (resp.status) {
      case 402:
        throw new QuotaExceededError(message);
      case 413:
        throw new FileTooLargeError(message);
      case 401:
      case 403:
        throw new ScopeError(message, resp.status);
      case 404:
        throw new NotFoundError(message);
      default:
        throw new StorageError(message, resp.status, code);
    }
  }

  return {
    async upload(path, body, contentType) {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
      const resp = await doFetch(`${base}/v1/storage/objects/${encPath(path)}`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': contentType ?? 'application/octet-stream',
          'Content-Length': String(bytes.byteLength),
        },
        // Uint8Array is a valid BufferSource body at runtime; the DOM BodyInit
        // type is narrower than the platform accepts, so cast explicitly.
        body: bytes as unknown as BodyInit,
      });
      if (!resp.ok) return raise(resp);
      return (await resp.json()) as StorageFile;
    },

    async download(path) {
      const resp = await doFetch(`${base}/v1/storage/objects/${encPath(path)}`, { headers: authHeaders });
      if (!resp.ok) return raise(resp);
      return new Uint8Array(await resp.arrayBuffer());
    },

    async list(prefix = '', cursor = '') {
      const qs = `prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const resp = await doFetch(`${base}/v1/storage/objects?${qs}`, { headers: authHeaders });
      if (!resp.ok) return raise(resp);
      return (await resp.json()) as ListResult;
    },

    async listAll(prefix = '') {
      const all: StorageFile[] = [];
      let cursor = '';
      // Follow next_cursor to completion. Bounded by the server page size; a
      // missing/empty next_cursor terminates.
      for (;;) {
        const page = await this.list(prefix, cursor);
        all.push(...page.files);
        if (!page.next_cursor) break;
        cursor = page.next_cursor;
      }
      return all;
    },

    async stat(path) {
      const resp = await doFetch(`${base}/v1/storage/stat/${encPath(path)}`, { headers: authHeaders });
      if (!resp.ok) return raise(resp);
      return (await resp.json()) as StorageFile;
    },

    async del(path) {
      const resp = await doFetch(`${base}/v1/storage/objects/${encPath(path)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!resp.ok && resp.status !== 204) return raise(resp);
    },

    async share(path, expiresInSeconds = 900) {
      const resp = await doFetch(`${base}/v1/storage/share`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, expires_in_seconds: expiresInSeconds }),
      });
      if (!resp.ok) return raise(resp);
      return (await resp.json()) as ShareResult;
    },
  };
}
