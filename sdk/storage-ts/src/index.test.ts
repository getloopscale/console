// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi } from 'vitest';
import {
  createStorageClient,
  QuotaExceededError,
  FileTooLargeError,
  ScopeError,
  NotFoundError,
} from './index';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function client(fetchImpl: typeof fetch) {
  return createStorageClient({ baseUrl: 'https://api.test/', apiKey: 'theo_live_abc', fetch: fetchImpl });
}

describe('@usetheo/storage', () => {
  it('upload sends PUT with auth + content-type and returns the file', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.test/v1/storage/objects/docs/a.txt');
      expect(init?.method).toBe('PUT');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer theo_live_abc');
      return jsonResponse(201, { path: 'docs/a.txt', size: 5, content_type: 'text/plain' });
    });
    const out = await client(f as unknown as typeof fetch).upload('docs/a.txt', new Uint8Array([1, 2, 3, 4, 5]), 'text/plain');
    expect(out.path).toBe('docs/a.txt');
    expect(f).toHaveBeenCalledOnce();
  });

  it('download returns bytes', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([9, 8, 7]), { status: 200 }));
    const bytes = await client(f as unknown as typeof fetch).download('a');
    expect(Array.from(bytes)).toEqual([9, 8, 7]);
  });

  it('list returns files', async () => {
    const f = vi.fn(async () => jsonResponse(200, { files: [{ path: 'a.txt', size: 1, content_type: 'text/plain' }], next_cursor: '' }));
    const out = await client(f as unknown as typeof fetch).list('docs/');
    expect(out.files).toHaveLength(1);
    expect(out.files[0].path).toBe('a.txt');
  });

  it('share posts and returns url + expiry', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({ path: 'a', expires_in_seconds: 3600 });
      return jsonResponse(200, { url: '/v1/storage/shared/tok', expires_at: '2026-07-14T00:00:00Z' });
    });
    const out = await client(f as unknown as typeof fetch).share('a', 3600);
    expect(out.url).toContain('/shared/tok');
  });

  it('maps 402 → QuotaExceededError', async () => {
    const f = vi.fn(async () => jsonResponse(402, { error: { code: 'storage_quota_exceeded', message: 'limit reached' } }));
    await expect(client(f as unknown as typeof fetch).upload('p', new Uint8Array([1]))).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('maps 413 → FileTooLargeError', async () => {
    const f = vi.fn(async () => jsonResponse(413, { error: { code: 'file_too_large', message: 'too big' } }));
    await expect(client(f as unknown as typeof fetch).upload('p', new Uint8Array([1]))).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('maps 403 → ScopeError', async () => {
    const f = vi.fn(async () => jsonResponse(403, { error: { code: 'scope_required', message: 'need storage:read' } }));
    await expect(client(f as unknown as typeof fetch).list()).rejects.toBeInstanceOf(ScopeError);
  });

  it('maps 404 → NotFoundError', async () => {
    const f = vi.fn(async () => jsonResponse(404, { error: { code: 'file_not_found', message: 'nope' } }));
    await expect(client(f as unknown as typeof fetch).stat('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('encodes path segments (no traversal injection into the URL)', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toContain('a%20b/c%23d');
      return jsonResponse(200, { path: 'x', size: 0, content_type: 't' });
    });
    await client(f as unknown as typeof fetch).stat('a b/c#d');
  });
});
