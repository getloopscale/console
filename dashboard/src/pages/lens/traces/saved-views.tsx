import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
} from '@usetheo/ui';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';

import { cloudFetch } from '@/lib/http/api';

export interface SavedView {
  id: string;
  name: string;
  query_string: string;
}
interface SavedViewsResult {
  saved_views: SavedView[];
}

/** Return the query string with a `viewId=` handle set (so the applied view is shareable by URL). */
function withViewId(queryString: string, id: string): string {
  const p = new URLSearchParams(queryString.replace(/^\?/, ''));
  p.set('viewId', id);
  return `?${p.toString()}`;
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
    queryFn: () => cloudFetch<SavedViewsResult>('/v1/dashboard/lens/saved-views', {}, { throwOnError: true }),
  });
  const invalidateViews = () => void queryClient.invalidateQueries({ queryKey: savedViewsKey });

  const views = savedViews.data?.saved_views ?? [];

  // M59 P3 — a view is shareable via a `?viewId=` handle: applying appends it (the active view is
  // highlighted); opening a bare `?viewId=X` link applies that view's stored query string ONCE (a ref
  // guards against a re-apply loop, since applying rewrites the URL). Per-tenant: `viewId` only ever
  // resolves against THIS workspace's Principal-scoped list, so it can never surface another tenant's view.
  const activeViewId = searchParams.get('viewId');
  const appliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeViewId || appliedRef.current === activeViewId) return;
    const view = views.find((v) => v.id === activeViewId);
    if (view) {
      appliedRef.current = activeViewId;
      onApply(withViewId(view.query_string, view.id));
    }
  }, [activeViewId, views, onApply]);

  const applyView = (v: SavedView) => {
    appliedRef.current = v.id; // this apply is intentional — don't let the effect re-fire it.
    onApply(withViewId(v.query_string, v.id));
  };

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
        {views.map((v) => (
          <span key={v.id} className="flex items-center gap-0.5">
            <Button
              variant={v.id === activeViewId ? 'primary' : 'secondary'}
              size="sm"
              aria-current={v.id === activeViewId ? 'true' : undefined}
              onClick={() => applyView(v)}
              aria-label={`Apply view ${v.name}`}
            >
              {v.name}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPendingView(v)} aria-label={`Delete view ${v.name}`}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </span>
        ))}
        {views.length === 0 ? <span className="text-xs text-muted-foreground">none yet</span> : null}
        <Button variant="ghost" size="sm" onClick={() => setSaveOpen(true)} aria-label="Save current view">
          <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
          Save current view
        </Button>
      </div>

      {/* M59 P3 — the naming Dialog (replaces the inline form). The stored query_string is the whole
          filter URL — including the M59 `cols=` (column visibility) + `density=` params — so a saved
          view captures the columns + density with no schema change (ADR D4). */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Save current view</Dialog.Title>
            <Dialog.Description>
              Names this filter, column, and density combination for one-click recall (per workspace).
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <form
              id="save-view-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (viewName.trim()) createView.mutate(viewName.trim());
              }}
            >
              <label htmlFor="saved-view-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                Name
              </label>
              <Input
                id="saved-view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="View name"
                aria-label="Saved view name"
                autoFocus
              />
            </form>
          </Dialog.Body>
          <Dialog.Footer>
            <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="save-view-form" disabled={!viewName.trim() || createView.isPending}>
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

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
