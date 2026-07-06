import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Input } from '@usetheo/ui';

import { cloudFetch } from '@/lib/api';

export interface SavedView {
  id: string;
  name: string;
  query_string: string;
}
interface SavedViewsResult {
  saved_views: SavedView[];
}

export interface SavedViewsBarProps {
  /** The current filter URL search params — the query string a new view stores. */
  searchParams: URLSearchParams;
  /** Apply a saved view: replace the URL search with its stored query string. */
  onApply: (queryString: string) => void;
}

/**
 * M52 saved-views bar (extracted verbatim in M59 ADR D1): a per-tenant store of the current
 * filter URL. Apply = write the whole search string; share = the URL itself. Encapsulates its
 * own react-query fetch + create/delete mutations + the delete-confirm dialog; the page passes
 * only the current search params + an apply callback. Behavior-preserving in Phase 0.
 */
export function SavedViewsBar({ searchParams, onApply }: SavedViewsBarProps) {
  const queryClient = useQueryClient();
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [pendingView, setPendingView] = useState<SavedView | null>(null);

  const savedViewsKey = ['cloud', '/v1/dashboard/lens/saved-views'] as const;
  const savedViews = useQuery({
    queryKey: savedViewsKey,
    queryFn: () => cloudFetch<SavedViewsResult>('/v1/dashboard/lens/saved-views'),
  });
  const invalidateViews = () => void queryClient.invalidateQueries({ queryKey: savedViewsKey });

  const createView = useMutation({
    mutationFn: (name: string) =>
      cloudFetch<SavedView>('/v1/dashboard/lens/saved-views', {
        method: 'POST',
        // the query string IS the view — the current filter URL (or a bare "?" when no filter is set).
        body: JSON.stringify({ name, query_string: searchParams.toString() ? `?${searchParams.toString()}` : '?' }),
      }),
    onSuccess: () => {
      setSaveOpen(false);
      setViewName('');
      invalidateViews();
    },
  });

  const deleteView = useMutation({
    mutationFn: (id: string) =>
      cloudFetch<unknown>(`/v1/dashboard/lens/saved-views/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setPendingView(null);
      invalidateViews();
    },
  });

  return (
    <>
      {/* M52 — saved views: apply / delete a stored filter combination, or save the current one. */}
      <div className="flex flex-wrap items-center gap-2" aria-label="Saved views">
        <span className="text-xs font-medium text-muted-foreground">Saved views:</span>
        {(savedViews.data?.saved_views ?? []).map((v) => (
          <span key={v.id} className="flex items-center gap-0.5">
            <Button variant="secondary" size="sm" onClick={() => onApply(v.query_string)} aria-label={`Apply view ${v.name}`}>
              {v.name}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPendingView(v)} aria-label={`Delete view ${v.name}`}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </span>
        ))}
        {(savedViews.data?.saved_views ?? []).length === 0 ? (
          <span className="text-xs text-muted-foreground">none yet</span>
        ) : null}
        {saveOpen ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (viewName.trim()) createView.mutate(viewName.trim());
            }}
          >
            <Input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="View name"
              aria-label="Saved view name"
              className="w-[160px]"
            />
            <Button type="submit" size="sm" disabled={!viewName.trim() || createView.isPending}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setSaveOpen(true)} aria-label="Save current view">
            <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
            Save current view
          </Button>
        )}
      </div>

      {pendingView !== null ? (
        <ConfirmDialog
          open={pendingView !== null}
          onOpenChange={(o) => !o && setPendingView(null)}
          title={`Delete view "${pendingView.name}"?`}
          description={<p className="text-sm">This removes the saved view. Your current filters are unaffected.</p>}
          confirmLabel={deleteView.isPending ? 'Deleting…' : 'Delete view'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={deleteView.isPending}
          onConfirm={() => deleteView.mutate(pendingView.id)}
        />
      ) : null}
    </>
  );
}
