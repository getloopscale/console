import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch, cloudFetchRaw } from '@/lib/http/api';

export interface UsageInfo {
  used_bytes: number;
  aggregate_limit: number;
  tier: string;
  unlimited: boolean;
}

/**
 * B-024 (class) — the file browser used to download the whole bucket and derive the folders on the
 * client. The cost grows with every upload, and the most-used workspace is the first to stall.
 *
 * 1000 is a choice, and deliberately high: `deriveEntries` builds the prefix tree from the flat
 * list, so a low ceiling would hide entire FOLDERS rather than just the files at the end. The
 * screen says so when the ceiling bites.
 *
 * It lives with the request that carries it rather than with the tree-building helper: the limit is
 * a property of what we ask the store for, and the helper only ever consumed it second-hand.
 */
export const STORAGE_OBJECT_LIMIT = 1000;

const BASE = '/v1/dashboard/storage';

const keys = {
  objects: ['cloud', `${BASE}/objects`] as const,
  usage: ['cloud', `${BASE}/usage`] as const,
};

/** Percent-encode each path segment while keeping the `/` separators the store uses as folders. */
function encodeStoragePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

/**
 * The object listing.
 *
 * Generic over the file shape, which is owned by the storage types under `pages/` (`src/hooks` may
 * not import from `src/pages`, B-070). The listing is capped: B-024 (class) — the screen states the
 * ceiling when it bites, because a truncated listing that does not say so reads as a complete one.
 */
export function useStorageObjects<F>() {
  return useQuery({
    queryKey: keys.objects,
    queryFn: () =>
      cloudFetch<{ files: F[]; next_cursor: string }>(
        `${BASE}/objects?limit=${STORAGE_OBJECT_LIMIT}`,
        {},
        { throwOnError: true },
      ),
  });
}

export function useStorageUsage() {
  return useQuery({
    queryKey: keys.usage,
    queryFn: () => cloudFetch<UsageInfo>(`${BASE}/usage`, {}, { throwOnError: true }),
  });
}

/**
 * Refresh both reads together.
 *
 * They are always invalidated as a pair, and that is the point of exposing it as one function:
 * every write on this screen changes the listing AND the quota, so refreshing one alone leaves the
 * usage bar stating a number that no longer matches the files above it.
 */
export function useRefreshStorage() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: keys.objects });
    void queryClient.invalidateQueries({ queryKey: keys.usage });
  };
}

/**
 * Fetch one object's bytes for the preview panel.
 *
 * Uses `cloudFetchRaw` because the caller needs the Response itself — a blob for an image, text for
 * everything else — which the JSON-decoding wrapper cannot give it.
 */
export function fetchStorageObject(path: string): Promise<Response | null> {
  return cloudFetchRaw(`${BASE}/objects/${encodeStoragePath(path)}`);
}

/**
 * Materialise a folder.
 *
 * The flat store has no folders; a folder exists because an object's key contains a `/`. The marker
 * is one byte on purpose: the store rejects a 0-byte object with a 503, and a newline is the
 * cheapest thing that is not zero. The marker itself stays hidden from the file list.
 */
export function createFolderMarker(markerPath: string): Promise<unknown> {
  return cloudFetch(
    `${BASE}/objects/${encodeStoragePath(markerPath)}`,
    {
      method: 'PUT',
      body: new Uint8Array([10]),
      headers: { 'Content-Type': 'application/octet-stream' },
    },
    { throwOnError: true },
  );
}

export function shareObject(path: string): Promise<{ url: string; expires_at: string } | null> {
  return cloudFetch<{ url: string; expires_at: string }>(
    `${BASE}/share`,
    { method: 'POST', body: JSON.stringify({ path, expires_in_seconds: 3600 }) },
    { throwOnError: true },
  );
}

export function deleteObject(path: string): Promise<unknown> {
  return cloudFetch(
    `${BASE}/objects/${encodeStoragePath(path)}`,
    { method: 'DELETE' },
    { throwOnError: true },
  );
}
