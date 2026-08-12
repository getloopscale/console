import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Trash2, Link2, Upload, Folder, FileText, FileCode, FileImage,
  FolderPlus, ChevronRight, Home,
} from 'lucide-react';
import {
  Button,
  Card,
  PageShell,
  Skeleton,
  EmptyState,
  Badge,
  Checkbox,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { triggerBlobDownload } from '@/lib/export/download';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch, cloudFetchRaw } from '@/lib/http/api';
import { presignedUpload, presignedDownloadURL, type PresignDeps } from './workspace-presign';
import { useWorkspaceSelection } from './use-workspace-selection';

// Dominio do workspace mora em ./workspace/helpers para que use-workspace-selection
// e workspace-preview-sheet possam consumi-lo sem importar desta pagina — era esse
// import de volta que fechava os dois ciclos (B-038). O re-export mantem
// `@/pages/workspace` como superficie publica.
import {
  FOLDER_MARKER,
  deriveEntries,
  STORAGE_OBJECT_LIMIT,
  formatBytes,
  previewKind,
  type StorageFile,
} from './helpers';
export {
  deriveEntries,
  formatBytes,
  previewKind,
  type StorageFile,
  type WorkspaceEntries,
  type PreviewKind,
} from './helpers';
import { WorkspacePreviewSheet } from './workspace-preview-sheet';
import { NewFolderDialog } from '@/components/dialogs/new-folder-dialog';

/**
 * Workspace — a folder-browser over the flat tenant store (M7): navigable folders
 * (derived from the `/` in each object key), multi-select + bulk/folder delete,
 * upload, in-app New-folder dialog, and a side-panel preview. Product language only.
 */

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

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
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
    queryFn: () => cloudFetch<ListResult>(
        `/v1/dashboard/storage/objects?limit=${STORAGE_OBJECT_LIMIT}`,
        {},
        { throwOnError: true },
      ),
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

  // Multi-select + bulk / folder delete (state + mutation live in the hook).
  const sel = useWorkspaceSelection({
    files: filesQuery.data?.files ?? [],
    prefix,
    onRefresh,
    onNavigateRoot: () => setPrefix(''),
  });

  // Navigating into a folder (or via the breadcrumb) clears the selection so
  // stale keys from another level never linger.
  const navigate = (p: string) => {
    setPrefix(p);
    sel.clear();
  };

  // Content preview for the open file (text → CodeBlock, image → object URL).
  const previewQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/storage/objects', preview?.path] as const,
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

  // M4 — the presigned data plane: the bytes go straight to/from object storage via
  // a short-lived signed URL; the dashboard API only mints the URL. `fetch` is bound
  // to window so the direct S3 request carries NO Bearer token (the auth is the
  // signature in the query), and the cross-origin request relies on bucket CORS.
  const presignDeps: PresignDeps = { cloudFetch, fetch: window.fetch.bind(window) };

  // Download: mint a presigned GET, fetch the bytes directly from storage, then
  // trigger a browser download from the blob.
  const onDownload = async (file: StorageFile) => {
    const url = await presignedDownloadURL(presignDeps, file.path);
    const res = await window.fetch(url);
    // B-230 — o `return` silencioso continuava aqui: um download que falhava não dizia nada, e a
    // pessoa ficava esperando um arquivo que nunca vinha.
    if (!res.ok) {
      setUploadError(`Could not download ${file.path}. The storage service refused the request.`);
      return;
    }
    // B-230 — era a TERCEIRA cópia do padrão Blob+âncora, e a que tinha perdido as duas
    // proteções que a fonte canônica documenta (appendChild e revoke adiado).
    triggerBlobDownload(file.path.split('/').pop() ?? file.path, await res.blob());
  };

  const onUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await presignedUpload(presignDeps, `${prefix}${file.name}`, file);
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

  // Keys for the visible rows (folders as prefixes, files as paths) — the units of selection.
  const folderKey = (name: string) => `${prefix}${name}/`;
  const visibleKeys = [...entries.folders.map(folderKey), ...entries.files.map((f) => f.path)];
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => sel.isSelected(k));
  const someSelected = sel.selected.size > 0;
  const bulkCountLabel = sel.stats
    ? `${filesQuery.data?.next_cursor ? 'at least ' : ''}${sel.stats.count} ${sel.stats.count === 1 ? 'item' : 'items'} · ${formatBytes(sel.stats.size)}`
    : '';

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
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" onClick={() => navigate('')} aria-label="Workspace root">
              <Home className="h-3.5 w-3.5" />
              <span className="text-muted-foreground">workspace</span>
            </Button>
            {crumbs.map((seg, i) => (
              <span key={i} className="flex min-w-0 items-center">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <button
                  className="truncate rounded px-1.5 py-1 font-mono text-[13px] hover:bg-muted/60 hover:text-foreground"
                  onClick={() => navigate(`${crumbs.slice(0, i + 1).join('/')}/`)}
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

        {/* Selection action bar — appears when ≥1 item is selected */}
        {someSelected && (
          <div data-testid="selection-bar" className="flex items-center justify-between gap-2 border-b border-border/60 bg-primary/5 px-3 py-1.5 text-sm">
            <span className="font-medium">{sel.selected.size} selected</span>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-7" onClick={() => sel.clear()}>Clear</Button>
              <Button variant="destructive" size="sm" className="h-7 gap-1.5" onClick={() => sel.deleteSelected()}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
        )}

        {/* Select-all header (only when the level has rows) */}
        {!filesQuery.isLoading && visibleKeys.length > 0 && (
          <div className="flex items-center gap-3 border-b border-border/60 bg-muted/10 px-3 py-1.5">
            <Checkbox
              aria-label="Select all"
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={() => sel.toggleAll(visibleKeys)}
            />
            <span className="text-xs text-muted-foreground">Select all</span>
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
              <li key={`d/${name}`} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
                <Checkbox
                  aria-label={`Select folder ${name}`}
                  checked={sel.isSelected(folderKey(name))}
                  onCheckedChange={() => sel.toggle(folderKey(name))}
                />
                <button
                  data-testid="folder-row"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => navigate(`${prefix}${name}/`)}
                >
                  <Folder className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium">{name}</span>
                  <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                </button>
                <Button
                  variant="ghost" size="sm"
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={() => sel.requestDelete({ paths: [], prefixes: [folderKey(name)] })}
                  aria-label={`Delete folder ${name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
            {entries.files.map((f) => {
              const Icon = fileIcon(f.content_type);
              return (
                <li key={`f/${f.path}`} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
                  <Checkbox
                    aria-label={`Select ${f.path.slice(prefix.length)}`}
                    checked={sel.isSelected(f.path)}
                    onCheckedChange={() => sel.toggle(f.path)}
                  />
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
          {(filesQuery.data?.files?.length ?? 0) === STORAGE_OBJECT_LIMIT ? (
            /*
             * B-024 (classe) — a listagem tem teto (ver STORAGE_OBJECT_LIMIT). Aqui
             * o silencio seria pior que numa tabela comum: `deriveEntries` monta as
             * PASTAS a partir da lista plana, entao um corte esconde diretorios
             * inteiros — a tela nao pareceria truncada, pareceria vazia naquele
             * ramo. Dizer que ha mais e o que impede alguem de concluir que apagou
             * o que nao apagou.
             */
            <p className="border-t px-3 py-2.5 text-body-sm text-muted-foreground" role="status">
              Showing the first {STORAGE_OBJECT_LIMIT.toLocaleString()} objects. Some folders and
              files may not appear — narrow the path to see the rest.
            </p>
          ) : null}
      </Card>

      <NewFolderDialog
        open={newFolderOpen}
        prefix={prefix}
        name={newFolderName}
        error={newFolderError}
        creating={creatingFolder}
        onNameChange={setNewFolderName}
        onCreate={() => void onCreateFolder()}
        onClose={() => setNewFolderOpen(false)}
      />

      {/* File preview — side panel (extracted component) */}
      <WorkspacePreviewSheet
        preview={preview}
        prefix={prefix}
        query={previewQuery}
        shareUrl={shareUrl}
        onClose={() => setPreview(null)}
        onDownload={(f) => void onDownload(f)}
        onShare={(p) => void onShare(p)}
        onDelete={(f) => setDeleteTarget(f)}
      />

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

      {/* Bulk / folder delete — shows the blast radius (count + size) before commit */}
      <ConfirmDialog
        open={!!sel.bulkTarget}
        onOpenChange={(o) => { if (!o) sel.cancelBulk(); }}
        title={sel.bulkTarget?.prefixes.length ? 'Delete folder?' : 'Delete selected?'}
        description={`This permanently removes ${bulkCountLabel} from your workspace. This cannot be undone.`}
        confirmLabel="Delete"
        loading={sel.bulkDeleting}
        onConfirm={sel.confirmBulk}
      />
    </PageShell>
  );
}
