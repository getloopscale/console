import { useState } from 'react';

import { useToast } from '@usetheo/ui';

import { cloudFetch } from '@/lib/api';
import type { StorageFile } from './workspace/helpers';

/**
 * Selection + bulk-delete model for the Workspace folder-browser. A selection key
 * that ends in "/" is a FOLDER (a prefix); any other key is a FILE path. This lets
 * the bulk delete build `{paths, prefixes}` straight from the selected keys (D2).
 * Extracted from workspace.tsx to keep that file under the LoC budget
 * (docs/adr/0002-orcamento-de-loc-por-arquivo.md) and to give selection + its
 * mutation a single owner (SRP).
 */
export interface BulkRequest {
  paths: string[];
  prefixes: string[];
}

interface BulkResponse {
  deleted: number;
  freed_bytes: number;
  failed?: { path: string; reason: string }[];
  truncated?: boolean;
}

const FOLDER_MARKER = '.keep';

/** Split selection keys into files (paths) and folders (prefixes ending in "/"). */
export function toBulkRequest(keys: Iterable<string>): BulkRequest {
  const paths: string[] = [];
  const prefixes: string[] = [];
  for (const k of keys) (k.endsWith('/') ? prefixes : paths).push(k);
  return { paths, prefixes };
}

/**
 * Count + total size of the loaded objects a bulk request would remove. A file
 * matches when its path is selected directly OR it lives under a selected folder
 * prefix; overlaps (a folder AND a file inside it) are counted once, and hidden
 * `.keep` markers are excluded. When the listing is paginated the true total can
 * be larger, so the caller labels it "at least N" (EC-4).
 */
export function selectionStats(all: StorageFile[], req: BulkRequest): { count: number; size: number } {
  const matched = new Map<string, number>();
  for (const f of all) {
    const under = req.paths.includes(f.path) || req.prefixes.some((p) => f.path.startsWith(p));
    if (under && !f.path.endsWith(`/${FOLDER_MARKER}`) && f.path !== FOLDER_MARKER) {
      matched.set(f.path, f.size);
    }
  }
  let size = 0;
  for (const s of matched.values()) size += s;
  return { count: matched.size, size };
}

interface SelectionOpts {
  files: StorageFile[];
  prefix: string;
  onRefresh: () => void;
  onNavigateRoot: () => void;
}

/** Selection state + the bulk/folder-delete mutation for the Workspace page. */
export function useWorkspaceSelection(opts: SelectionOpts) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<BulkRequest | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isSelected = (key: string) => selected.has(key);
  const clear = () => setSelected(new Set());
  const toggleAll = (visibleKeys: string[]) =>
    setSelected((prev) => {
      const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => prev.has(k));
      return allSelected ? new Set() : new Set(visibleKeys);
    });

  const requestDelete = (req: BulkRequest) => setBulkTarget(req);
  const deleteSelected = () => setBulkTarget(toBulkRequest(selected));
  const cancelBulk = () => setBulkTarget(null);
  const stats = bulkTarget ? selectionStats(opts.files, bulkTarget) : null;

  const confirmBulk = async () => {
    if (!bulkTarget) return;
    setBulkDeleting(true);
    try {
      const res = await cloudFetch<BulkResponse>(
        '/v1/dashboard/storage/bulk-delete',
        { method: 'POST', body: JSON.stringify(bulkTarget) },
        { throwOnError: true },
      );
      const failed = res?.failed ?? [];
      // EC-5: keep exactly the failed items selected so a retry deletes only what remains.
      setSelected(new Set(failed.map((f) => f.path)));
      // If we just deleted the folder we're standing in, go back to the root.
      if (bulkTarget.prefixes.some((p) => opts.prefix.startsWith(p))) opts.onNavigateRoot();
      const wasFolders = bulkTarget.prefixes.length > 0;
      setBulkTarget(null);
      opts.onRefresh();
      if (res?.truncated) {
        toast({ variant: 'default', title: 'Some files remain', description: 'Delete again to finish removing this folder.' });
      } else if (failed.length) {
        toast({ variant: 'destructive', title: `${failed.length} ${failed.length === 1 ? 'file' : 'files'} could not be deleted`, description: 'The rest were removed. Try again for the remaining items.' });
      } else {
        toast({ variant: 'default', title: `Deleted ${res?.deleted ?? 0} ${wasFolders ? 'items' : 'files'}` });
      }
    } catch {
      setBulkTarget(null); // keep the selection so the user can retry
      toast({ variant: 'destructive', title: 'Delete failed', description: 'Please check your connection and try again.' });
    } finally {
      setBulkDeleting(false);
    }
  };

  return {
    selected, toggle, isSelected, clear, toggleAll,
    bulkTarget, bulkDeleting, stats, requestDelete, deleteSelected, cancelBulk, confirmBulk,
  };
}
