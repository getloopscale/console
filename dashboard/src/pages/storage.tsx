import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2, Link2, HardDrive, Upload } from 'lucide-react';
import { Button, Card, PageShell, Skeleton, EmptyState } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * Storage (M7) — manage the files your app stores. Mirrors the Knowledge Base /
 * Memory pages (Rule 9): a usage bar from `GET /v1/dashboard/storage/usage` + a
 * file list from `GET /v1/dashboard/storage/objects`, with per-file share + delete.
 * Product language only — never "S3"/"bucket".
 */

interface UsageInfo {
  used_bytes: number;
  aggregate_limit: number;
  per_file_limit: number;
  tier: string;
  unlimited: boolean;
}

interface StorageFile {
  path: string;
  size: number;
  content_type: string;
}

interface ListResult {
  files: StorageFile[];
  next_cursor: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function StoragePage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Storage'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const usageQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/storage/usage'] as const,
    queryFn: () => cloudFetch<UsageInfo>('/v1/dashboard/storage/usage', {}, { throwOnError: true }),
  });

  const filesQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/storage/objects'] as const,
    queryFn: () => cloudFetch<ListResult>('/v1/dashboard/storage/objects', {}, { throwOnError: true }),
  });

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/storage/usage'] });
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/storage/objects'] });
  };

  const onShare = async (path: string) => {
    const res = await cloudFetch<{ url: string; expires_at: string }>(
      '/v1/dashboard/storage/share',
      { method: 'POST', body: JSON.stringify({ path, expires_in_seconds: 3600 }) },
      { throwOnError: true },
    );
    if (!res) return;
    setShareLink(res.url);
    void navigator.clipboard?.writeText(res.url);
  };

  // Upload the selected file(s) via the BFF PUT (PUT /v1/dashboard/storage/objects/{name}).
  // The object name is the file name; the raw bytes go in the body with the file's own
  // Content-Type (never JSON). Quota/size rejections (402/413) surface as a typed error.
  const onUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        await cloudFetch(
          `/v1/dashboard/storage/objects/${file.name.split('/').map(encodeURIComponent).join('/')}`,
          { method: 'PUT', body: buf, headers: { 'Content-Type': file.type || 'application/octet-stream' } },
          { throwOnError: true },
        );
      }
      onRefresh();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setUploadError(
        status === 413
          ? 'That file is larger than your plan allows.'
          : status === 402
            ? "You've reached your plan's storage limit. Delete files or upgrade."
            : 'Upload failed. Please try again.',
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onDelete = async (path: string) => {
    await cloudFetch(
      `/v1/dashboard/storage/objects/${path.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'DELETE' },
      { throwOnError: true },
    );
    onRefresh();
  };

  const usage = usageQuery.data;
  const usedPct =
    usage && !usage.unlimited && usage.aggregate_limit > 0
      ? Math.min(100, Math.round((usage.used_bytes / usage.aggregate_limit) * 100))
      : 0;

  return (
    <PageShell
      title="Storage"
      description="Store and serve files for your app — with a link you can share."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh, loading: usageQuery.isFetching }}
    >
      {shareLink && (
        <div
          data-testid="share-link"
          className="rounded border border-primary/30 bg-primary/5 p-3 text-sm"
          role="status"
        >
          Share link copied: {shareLink}
        </div>
      )}

      {/* Upload — a native <label> wrapping the file input (rendered with the
          Button's styles via asChild). Clicking the label opens the OS file
          picker natively, so it never depends on a scripted `.click()` +
          user-gesture chain (the fragile `display:none` + ref.click() pattern
          silently no-op'd for real clicks). */}
      <div className="flex items-center gap-3">
        <Button asChild aria-label="Upload files">
          <label className={uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer'}>
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? 'Uploading…' : 'Upload files'}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              data-testid="file-input"
              disabled={uploading}
              onChange={(e) => void onUploadFiles(e.target.files)}
            />
          </label>
        </Button>
      </div>
      {uploadError && (
        <div
          data-testid="upload-error"
          className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {uploadError}
        </div>
      )}

      {/* Usage bar */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <HardDrive className="h-4 w-4" />
          <span className="font-medium">Usage</span>
        </div>
        {usageQuery.isLoading ? (
          <Skeleton className="h-6 w-48" />
        ) : usage ? (
          <div>
            <div className="text-sm text-muted-foreground">
              {formatBytes(usage.used_bytes)}
              {usage.unlimited ? ' used' : ` of ${formatBytes(usage.aggregate_limit)} (${usage.tier})`}
            </div>
            {!usage.unlimited && (
              <div className="mt-2 h-2 w-full rounded bg-muted" role="progressbar" aria-valuenow={usedPct}>
                <div className="h-2 rounded bg-primary" style={{ width: `${usedPct}%` }} />
              </div>
            )}
          </div>
        ) : null}
      </Card>

      {/* File list */}
      {filesQuery.isLoading ? (
        <Skeleton className="h-32 w-full mt-4" />
      ) : filesQuery.data && filesQuery.data.files.length > 0 ? (
        <Card className="mt-4 divide-y">
          {filesQuery.data.files.map((f) => (
            <div key={f.path} className="flex items-center justify-between p-3" data-testid="file-row">
              <div>
                <div className="font-mono text-sm">{f.path}</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(f.size)} · {f.content_type}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => void onShare(f.path)} aria-label={`Share ${f.path}`}>
                  <Link2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void onDelete(f.path)} aria-label={`Delete ${f.path}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState
          className="mt-4"
          title="No files yet"
          description="Upload a file above, or store files from your app with the Theo storage API, CLI, or SDK."
        />
      )}
    </PageShell>
  );
}
