/**
 * Presigned upload/download orchestration for the Workspace (M4). The bytes go
 * DIRECTLY to/from object storage via a short-lived signed URL — the dashboard API
 * only mints the URL + records metadata, never proxying the file. Kept as pure
 * functions with injected `cloudFetch` + `fetch` so the 3-step upload handshake is
 * unit-testable without a browser or a live backend.
 */

interface MintResult {
  readonly url: string;
  readonly method?: string;
  readonly expires_at?: string;
}

type CloudFetch = <T>(
  path: string,
  options?: RequestInit,
  cfg?: { throwOnError?: boolean },
) => Promise<T | null>;

export interface PresignDeps {
  readonly cloudFetch: CloudFetch;
  readonly fetch: typeof fetch;
}

export interface UploadFile {
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function contentTypeOf(file: UploadFile): string {
  return file.type || 'application/octet-stream';
}

/**
 * presignedUpload runs the two-phase direct-to-S3 upload: (1) mint a PUT URL
 * (reserves quota + a pending row), (2) PUT the bytes straight to storage, (3)
 * commit (the API HEADs storage to confirm + finalizes). A failure at step 2/3
 * leaves the reservation to be reclaimed server-side; the caller surfaces the error.
 */
export async function presignedUpload(deps: PresignDeps, path: string, file: UploadFile): Promise<void> {
  const mint = await deps.cloudFetch<MintResult>(
    '/v1/dashboard/storage/presign-upload',
    {
      method: 'POST',
      body: JSON.stringify({ path, size: file.size, content_type: contentTypeOf(file) }),
      headers: JSON_HEADERS,
    },
    { throwOnError: true },
  );
  if (!mint?.url) throw new Error('presign-upload returned no url');

  const put = await deps.fetch(mint.url, {
    method: 'PUT',
    body: await file.arrayBuffer(),
    headers: { 'Content-Type': contentTypeOf(file) },
  });
  if (!put.ok) {
    const e = new Error(`direct upload failed: ${put.status}`) as Error & { status?: number };
    e.status = put.status;
    throw e;
  }

  await deps.cloudFetch(
    '/v1/dashboard/storage/presign-commit',
    { method: 'POST', body: JSON.stringify({ path }), headers: JSON_HEADERS },
    { throwOnError: true },
  );
}

/** presignedDownloadURL mints a short-lived GET URL for a committed object. */
export async function presignedDownloadURL(deps: PresignDeps, path: string): Promise<string> {
  const mint = await deps.cloudFetch<MintResult>(
    '/v1/dashboard/storage/presign-download',
    { method: 'POST', body: JSON.stringify({ path }), headers: JSON_HEADERS },
    { throwOnError: true },
  );
  if (!mint?.url) throw new Error('presign-download returned no url');
  return mint.url;
}
