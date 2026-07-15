import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2, Link2, Upload, Folder, FileText, FolderPlus, ChevronRight, Home } from 'lucide-react';
import { Button, Card, PageShell, Skeleton, EmptyState } from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';

/**
 * Workspace — the files and folders your project stores, browsed like a file
 * manager (folders you can open, a breadcrumb, new folder, upload). Backed by the
 * tenant storage (M7) `GET /v1/dashboard/storage/objects`; the store is flat, so
 * folders are derived from the `/` in each object's path (see `deriveEntries`).
 * Product language only — never "S3"/"bucket".
 */

export interface StorageFile {
  path: string;
  size: number;
  content_type: string;
}

interface ListResult {
  files: StorageFile[];
  next_cursor: string;
}

interface UsageInfo {
  used_bytes: number;
  aggregate_limit: number;
  tier: string;
  unlimited: boolean;
}

/** Empty marker object that makes an otherwise-empty folder visible; hidden from the file list. */
const FOLDER_MARKER = '.keep';

export function formatBytes(n: number): string {
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

export interface WorkspaceEntries {
  folders: string[];
  files: StorageFile[];
}

/**
 * Split a flat object list into the folders and files that live directly under
 * `prefix` (e.g. `""` for root, `"data/"` for a subfolder). Keys deeper than this
 * level contribute their first segment as a folder; the `.keep` marker is hidden.
 */
export function deriveEntries(all: StorageFile[], prefix: string): WorkspaceEntries {
  const folders = new Set<string>();
  const files: StorageFile[] = [];
  for (const f of all) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    if (rest === '') continue;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (rest === FOLDER_MARKER) continue; // marker, not a real file
      files.push(f);
    } else {
      folders.add(rest.slice(0, slash));
    }
  }
  return {
    folders: [...folders].sort((a, b) => a.localeCompare(b)),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

export function WorkspacePage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Workspace'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  // Current folder as a prefix, e.g. "" (root) or "data/notes/".
  const [prefix, setPrefix] = useState('');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filesQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/storage/objects'] as const,
    queryFn: () => cloudFetch<ListResult>('/v1/dashboard/storage/objects', {}, { throwOnError: true }),
  });
  const usageQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/storage/usage'] as const,
    queryFn: () => cloudFetch<UsageInfo>('/v1/dashboard/storage/usage', {}, { throwOnError: true }),
  });

  const entries = useMemo(
    () => deriveEntries(filesQuery.data?.files ?? [], prefix),
    [filesQuery.data, prefix],
  );

  const crumbs = prefix ? prefix.replace(/\/$/, '').split('/') : [];

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/storage/objects'] });
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/storage/usage'] });
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

  const onDelete = async (path: string) => {
    await cloudFetch(
      `/v1/dashboard/storage/objects/${encodePath(path)}`,
      { method: 'DELETE' },
      { throwOnError: true },
    );
    onRefresh();
  };

  const onNewFolder = async () => {
    const name = window.prompt('New folder name')?.trim();
    if (!name || name.includes('/')) return;
    await cloudFetch(
      `/v1/dashboard/storage/objects/${encodePath(`${prefix}${name}/${FOLDER_MARKER}`)}`,
      { method: 'PUT', body: new ArrayBuffer(0), headers: { 'Content-Type': 'application/octet-stream' } },
      { throwOnError: true },
    );
    onRefresh();
  };

  // Uploads land in the current folder: PUT /objects/{prefix}{filename}.
  const onUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        await cloudFetch(
          `/v1/dashboard/storage/objects/${encodePath(`${prefix}${file.name}`)}`,
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

  const usage = usageQuery.data;
  const usageLabel = usage
    ? usage.unlimited
      ? `${formatBytes(usage.used_bytes)} used`
      : `${formatBytes(usage.used_bytes)} of ${formatBytes(usage.aggregate_limit)}`
    : null;

  return (
    <PageShell
      title="Workspace"
      description="The files and folders your project stores — browse, upload, and share."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh, loading: filesQuery.isFetching }}
    >
      {shareLink && (
        <div data-testid="share-link" className="rounded border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
          Share link copied: {shareLink}
        </div>
      )}
      {uploadError && (
        <div data-testid="upload-error" className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {uploadError}
        </div>
      )}

      <Card className="overflow-hidden">
        {/* Toolbar: breadcrumb on the left, folder/upload actions on the right */}
        <div className="flex items-center justify-between gap-2 border-b p-2">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm min-w-0">
            <Button variant="ghost" size="sm" onClick={() => setPrefix('')} aria-label="Workspace root">
              <Home className="h-4 w-4" />
            </Button>
            {crumbs.map((seg, i) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <button
                  className="truncate hover:underline"
                  onClick={() => setPrefix(`${crumbs.slice(0, i + 1).join('/')}/`)}
                >
                  {seg}
                </button>
              </span>
            ))}
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            {usageLabel && <span className="hidden sm:block text-xs text-muted-foreground">{usageLabel}</span>}
            <Button variant="ghost" size="sm" onClick={() => void onNewFolder()} aria-label="New folder">
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button asChild variant="ghost" size="sm" aria-label="Upload files">
              <label className={uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer'}>
                <Upload className="h-4 w-4" />
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
        </div>

        {/* Folder + file list for the current level */}
        {filesQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : entries.folders.length === 0 && entries.files.length === 0 ? (
          <EmptyState
            title={prefix ? 'This folder is empty' : 'No files yet'}
            description="Upload a file, create a folder, or store files from your app with the Theo storage API, CLI, or SDK."
          />
        ) : (
          <div className="divide-y">
            {entries.folders.map((name) => (
              <button
                key={`d/${name}`}
                data-testid="folder-row"
                className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/50"
                onClick={() => setPrefix(`${prefix}${name}/`)}
              >
                <Folder className="h-4 w-4 text-primary" />
                <span className="text-sm">{name}</span>
              </button>
            ))}
            {entries.files.map((f) => (
              <div key={`f/${f.path}`} className="flex items-center justify-between p-3" data-testid="file-row">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{f.path.slice(prefix.length)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(f.size)} · {f.content_type}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => void onShare(f.path)} aria-label={`Share ${f.path}`}>
                    <Link2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void onDelete(f.path)} aria-label={`Delete ${f.path}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageShell>
  );
}
