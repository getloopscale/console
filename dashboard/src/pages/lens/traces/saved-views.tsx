import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
} from '@getloopscale/ui';
import { AppModal } from '@/components/ui/app-modal';
import { ListTruncationNotice } from '@/components/ui/list-truncation-notice';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';

import {
  useSavedViews,
  useCreateSavedView,
  useDeleteSavedView,
  type SavedView,
} from '@/hooks/lens/use-saved-views';


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
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [pendingView, setPendingView] = useState<SavedView | null>(null);

  const savedViews = useSavedViews();

  const views = savedViews.data?.saved_views ?? [];
  const truncou = savedViews.data?.has_more === true;

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

  const createView = useCreateSavedView();
  const submitView = (name: string) =>
    createView.mutate(
      {
        name,
        // the query string IS the view — the current filter URL (or a bare "?" when no filter is set).
        query_string: searchParams.toString() ? `?${searchParams.toString()}` : '?',
      },
      {
        onSuccess: () => {
          setSaveOpen(false);
          setViewName('');
        },
      },
    );

  const deleteView = useDeleteSavedView();

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
      <ListTruncationNotice hasMore={truncou} total={views.length} substantivo="saved views" />

      {/* M59 P3 — the naming Dialog (replaces the inline form). The stored query_string is the whole
          filter URL — including the M59 `cols=` (column visibility) + `density=` params — so a saved
          view captures the columns + density with no schema change (ADR D4). */}
      <AppModal
      open={saveOpen}
      onClose={() => setSaveOpen(false)}
      title={<>Save current view</>}
      description={<>Names this filter, column, and density combination for one-click recall (per workspace).</>}
      footer={<><Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button><Button type="submit" form="save-view-form" disabled={!viewName.trim() || createView.isPending}>
              Save
            </Button></>}
    >
      <form
              id="save-view-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (viewName.trim()) submitView(viewName.trim());
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
    </AppModal>

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
          onConfirm={async () => {
            await deleteView.mutateAsync(pendingView.id);
            setPendingView(null);
          }}
        />
      ) : null}
    </>
  );
}
