import { describe, it, expect, vi } from 'vitest';

import { presignedUpload, presignedDownloadURL, type PresignDeps } from './workspace-presign';

function fakeFile(bytes: number, type = 'text/plain') {
  return { type, size: bytes, arrayBuffer: async () => new ArrayBuffer(bytes) };
}

describe('presignedUpload (M4 direct-to-S3)', () => {
  it('mints a PUT url, uploads the bytes directly, then commits — in that order', async () => {
    const calls: string[] = [];
    const cloudFetch = vi.fn(async (path: string, _opts?: RequestInit) => {
      calls.push('api:' + path);
      if (path.endsWith('/presign-upload')) return { url: 'https://s3.example/put?X-Amz-Signature=x' };
      return { committed: true };
    });
    const fetchMock = vi.fn(async (url: string) => {
      calls.push('s3:PUT ' + url);
      return { ok: true, status: 200 } as Response;
    });
    const deps = { cloudFetch, fetch: fetchMock } as unknown as PresignDeps;

    await presignedUpload(deps, 'data/x.txt', fakeFile(11));

    expect(calls).toEqual([
      'api:/v1/dashboard/storage/presign-upload',
      's3:PUT https://s3.example/put?X-Amz-Signature=x',
      'api:/v1/dashboard/storage/presign-commit',
    ]);
    // the mint request carried the declared size + content-type
    const mintBody = JSON.parse((cloudFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(mintBody).toMatchObject({ path: 'data/x.txt', size: 11, content_type: 'text/plain' });
  });

  it('does NOT commit when the direct S3 PUT fails', async () => {
    const cloudFetch = vi.fn(async (path: string) =>
      path.endsWith('/presign-upload') ? { url: 'https://s3/put' } : {},
    );
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403 }) as Response);
    const deps = { cloudFetch, fetch: fetchMock } as unknown as PresignDeps;

    await expect(presignedUpload(deps, 'p', fakeFile(5))).rejects.toThrow(/direct upload failed: 403/);
    // presign-commit must never be called after a failed upload
    expect(cloudFetch.mock.calls.some((c) => String(c[0]).endsWith('/presign-commit'))).toBe(false);
  });

  it('throws when the mint returns no url', async () => {
    const cloudFetch = vi.fn(async () => ({}));
    const fetchMock = vi.fn();
    const deps = { cloudFetch, fetch: fetchMock } as unknown as PresignDeps;
    await expect(presignedUpload(deps, 'p', fakeFile(1))).rejects.toThrow(/no url/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('presignedDownloadURL (M4)', () => {
  it('returns the minted GET url', async () => {
    const cloudFetch = vi.fn(async () => ({ url: 'https://s3.example/get?X-Amz-Signature=y', method: 'GET' }));
    const deps = { cloudFetch, fetch: vi.fn() } as unknown as PresignDeps;
    expect(await presignedDownloadURL(deps, 'data/x.txt')).toBe('https://s3.example/get?X-Amz-Signature=y');
  });
});
