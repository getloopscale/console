import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Trash2, Link2, Upload, Folder, FileText, FileCode, FileImage,
  FolderPlus, ChevronRight, Home, Download,
} from 'lucide-react';
import {
  Button, Card, PageShell, Skeleton, EmptyState, Badge, Input, Label,
  Dialog, Sheet, ConfirmDialog, CopyButton, CodeBlock,
} from '@usetheo/ui';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch, cloudFetchRaw } from '@/lib/api';

/**
 * Workspace — the files and folders your project stores, browsed like a modern
 * cloud drive: navigable folders, a breadcrumb, an in-app New-folder dialog, an
 * upload control, and a side-panel preview (text/code/image + share + delete).
 * Backed by the tenant store (M7) `GET /v1/dashboard/storage/objects`; the store
 * is flat, so folders are derived from the `/` in each object's path.
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
      if (rest === FOLDER_MARKER) continue;
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

type PreviewKind = 'text' | 'image' | 'none';
function previewKind(ct: string): PreviewKind {
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('text/') || /(json|javascript|typescript|xml|yaml|markdown|csv|x-sh|html)/i.test(ct)) return 'text';
  return 'none';
}

function fileIcon(ct: string) {
  const k = previewKind(ct);
  if (k === 'image') return FileImage;
  if (k === 'text') return FileCode;
  return FileText;
}

export function WorkspacePage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Workspace'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [prefix, setPrefix] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New-folder dialog (replaces the native window.prompt).
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderError, setNewFolderError] = useState<string | null>(null);

  // Preview side-panel + delete confirmation.
  const [preview, setPreview] = useState<StorageFile | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StorageFile | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  // Content preview for the open file (text → CodeBlock, image → object URL).
  const previewQuery = useQuery({
    queryKey: ['storage-object', preview?.path] as const,
    enabled: !!preview && previewKind(preview.content_type) !== 'none',
    queryFn: async () => {
      const res = await cloudFetchRaw(`/v1/dashboard/storage/objects/${encodePath(preview!.path)}`);
      if (!res || !res.ok) throw new Error(res ? String(res.status) : 'unauthenticated');
      if (previewKind(preview!.content_type) === 'image') {
        return { kind: 'image' as const, url: URL.createObjectURL(await res.blob()) };
      }
      return { kind: 'text' as const, text: await res.text() };
    },
  });
  // Revoke the object URL when the preview closes/changes.
  useEffect(() => {
    const url = previewQuery.data && previewQuery.data.kind === 'image' ? previewQuery.data.url : null;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [previewQuery.data]);

  const openPreview = (f: StorageFile) => {
    setShareUrl(null);
    setPreview(f);
  };

  const onCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || name.includes('/')) return;
    setCreatingFolder(true);
    setNewFolderError(null);
    try {
      await cloudFetch(
        `/v1/dashboard/storage/objects/${encodePath(`${prefix}${name}/${FOLDER_MARKER}`)}`,
        // 1-byte marker: the store rejects a 0-byte object (503); a newline is enough
        // to materialize an empty folder (the marker stays hidden from the file list).
        { method: 'PUT', body: new Uint8Array([10]), headers: { 'Content-Type': 'application/octet-stream' } },
        { throwOnError: true },
      );
      setNewFolderOpen(false);
      setNewFolderName('');
      onRefresh();
    } catch {
      setNewFolderError('Could not create the folder. Please try again.');
    } finally {
      setCreatingFolder(false);
    }
  };

  // Download a file with the same auth the JSON path uses (a plain <a> link can't
  // send the Bearer token), then trigger a browser download from the blob.
  const onDownload = async (file: StorageFile) => {
    const res = await cloudFetchRaw(`/v1/dashboard/storage/objects/${encodePath(file.path)}`);
    if (!res || !res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.split('/').pop() ?? file.path;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const onShare = async (path: string) => {
    const res = await cloudFetch<{ url: string; expires_at: string }>(
      '/v1/dashboard/storage/share',
      { method: 'POST', body: JSON.stringify({ path, expires_in_seconds: 3600 }) },
      { throwOnError: true },
    );
    if (res) setShareUrl(res.url);
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await cloudFetch(
        `/v1/dashboard/storage/objects/${encodePath(deleteTarget.path)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      );
      if (preview?.path === deleteTarget.path) setPreview(null);
      setDeleteTarget(null);
      onRefresh();
    } finally {
      setDeleting(false);
    }
  };

  const usage = usageQuery.data;
  const usedPct = usage && !usage.unlimited && usage.aggregate_limit > 0
    ? Math.min(100, Math.round((usage.used_bytes / usage.aggregate_limit) * 100))
    : 0;

  return (
    <PageShell
      title="Workspace"
      description="The files and folders your project stores — browse, upload, and share."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh, loading: filesQuery.isFetching }}
    >
      {uploadError && (
        <div data-testid="upload-error" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {uploadError}
        </div>
      )}

      <Card className="overflow-hidden">
        {/* Toolbar — breadcrumb on the left, actions + usage on the right */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 text-sm">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" onClick={() => setPrefix('')} aria-label="Workspace root">
              <Home className="h-3.5 w-3.5" />
              <span className="text-muted-foreground">workspace</span>
            </Button>
            {crumbs.map((seg, i) => (
              <span key={i} className="flex min-w-0 items-center">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <button
                  className="truncate rounded px-1.5 py-1 font-mono text-[13px] hover:bg-muted/60 hover:text-foreground"
                  onClick={() => setPrefix(`${crumbs.slice(0, i + 1).join('/')}/`)}
                >
                  {seg}
                </button>
              </span>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            {usage && (
              <Badge variant="outline" className="mr-1 hidden font-normal sm:inline-flex">
                {usage.unlimited ? `${formatBytes(usage.used_bytes)} used` : `${formatBytes(usage.used_bytes)} / ${formatBytes(usage.aggregate_limit)}`}
              </Badge>
            )}
            <Button variant="secondary" size="sm" className="h-7 gap-1.5" onClick={() => { setNewFolderName(''); setNewFolderError(null); setNewFolderOpen(true); }}>
              <FolderPlus className="h-3.5 w-3.5" /> New folder
            </Button>
            <Button asChild size="sm" className="h-7 gap-1.5" aria-label="Upload files">
              <label className={uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer'}>
                <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload'}
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

        {/* Usage bar — a thin accent under the toolbar */}
        {usage && !usage.unlimited && (
          <div className="h-0.5 w-full bg-muted" role="progressbar" aria-valuenow={usedPct} aria-label="Storage used">
            <div className="h-full bg-primary/70 transition-[width]" style={{ width: `${usedPct}%` }} />
          </div>
        )}

        {/* Folder + file list for the current level */}
        {filesQuery.isLoading ? (
          <div className="divide-y divide-border/50">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="m-3 h-6 w-64" />)}
          </div>
        ) : entries.folders.length === 0 && entries.files.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title={prefix ? 'This folder is empty' : 'Your workspace is empty'}
            description="Upload a file, create a folder, or store files from your app with the Theo storage API, CLI, or SDK."
          />
        ) : (
          <ul className="divide-y divide-border/50">
            {entries.folders.map((name) => (
              <li key={`d/${name}`}>
                <button
                  data-testid="folder-row"
                  className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                  onClick={() => setPrefix(`${prefix}${name}/`)}
                >
                  <Folder className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium">{name}</span>
                  <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                </button>
              </li>
            ))}
            {entries.files.map((f) => {
              const Icon = fileIcon(f.content_type);
              return (
                <li key={`f/${f.path}`} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
                  <button
                    data-testid="file-row"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => openPreview(f)}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm">{f.path.slice(prefix.length)}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setShareUrl(null); void onShare(f.path); setPreview(f); }} aria-label={`Share ${f.path}`}>
                      <Link2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(f)} aria-label={`Delete ${f.path}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* New folder — in-app dialog (no native prompt) */}
      <Dialog open={newFolderOpen} onOpenChange={(o) => { if (!o) setNewFolderOpen(false); }}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>New folder</Dialog.Title>
            <Dialog.Description>
              Create a folder{prefix ? <> in <span className="font-mono">{prefix.replace(/\/$/, '')}</span></> : ' at the workspace root'}.
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <div className="space-y-1.5">
              <Label htmlFor="new-folder-name">Folder name</Label>
              <Input
                id="new-folder-name"
                autoFocus
                placeholder="e.g. images"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void onCreateFolder(); }}
              />
              {newFolderName.includes('/') && (
                <p className="text-xs text-destructive">Folder names can’t contain “/”.</p>
              )}
              {newFolderError && <p className="text-xs text-destructive">{newFolderError}</p>}
            </div>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="secondary" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void onCreateFolder()}
              disabled={creatingFolder || !newFolderName.trim() || newFolderName.includes('/')}
            >
              {creatingFolder ? 'Creating…' : 'Create folder'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* File preview — side panel */}
      <Sheet open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <Sheet.Content side="right" className="flex w-full flex-col sm:max-w-xl">
          {preview && (
            <>
              <Sheet.Header>
                <Sheet.Title className="flex items-center gap-2 pr-6">
                  <span className="truncate font-mono text-sm">{preview.path.slice(prefix.length)}</span>
                  <Badge variant="outline" className="shrink-0 font-normal">{preview.content_type}</Badge>
                </Sheet.Title>
                <Sheet.Description>
                  {formatBytes(preview.size)} · <span className="font-mono">{preview.path}</span>
                </Sheet.Description>
              </Sheet.Header>

              <div className="min-h-0 flex-1 overflow-auto p-4">
                {previewKind(preview.content_type) === 'none' ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                    <FileText className="h-8 w-8" />
                    <p className="text-sm">No inline preview for this file type.</p>
                  </div>
                ) : previewQuery.isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : previewQuery.isError ? (
                  <p className="text-sm text-destructive">Could not load this file.</p>
                ) : previewQuery.data?.kind === 'image' ? (
                  <img src={previewQuery.data.url} alt={preview.path} className="mx-auto max-h-[60vh] rounded-lg border border-border/60" />
                ) : previewQuery.data ? (
                  <CodeBlock code={previewQuery.data.text} language={preview.content_type.includes('json') ? 'json' : 'text'} />
                ) : null}
              </div>

              <div className="space-y-3 border-t border-border/60 p-4">
                {shareUrl && (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2" data-testid="share-link">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{shareUrl}</span>
                    <CopyButton value={shareUrl} variant="ghost" size="sm" />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => void onDownload(preview)}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                  <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => void onShare(preview.path)}>
                    <Link2 className="h-3.5 w-3.5" /> Share link
                  </Button>
                  <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(preview)}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </div>
            </>
          )}
        </Sheet.Content>
      </Sheet>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title={deleteTarget ? `Delete “${deleteTarget.path}”?` : 'Delete file?'}
        description="This permanently removes the file from your workspace. This cannot be undone."
        confirmLabel="Delete file"
        loading={deleting}
        onConfirm={onConfirmDelete}
      />
    </PageShell>
  );
}
