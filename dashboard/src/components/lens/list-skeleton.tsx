import { Skeleton } from '@usetheo/ui';

/**
 * A table-shaped, screen-reader-labelled loading placeholder for the lens list screens — the loading
 * leg of the loading→empty→error triad. Replaces the bare `<Skeleton/>` sites (no dimensions, no aria)
 * with a block of full-width rows carrying `role="status"` + `aria-label="Loading {label}"`, mirroring
 * the `dashboards.tsx` sized-skeleton exemplar so the placeholder previews the table it becomes.
 */
export function ListSkeleton({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label={`Loading ${label}`} className="space-y-2">
      {/* The container owns the single announcement; the inner Skeletons (which default to their own
          role="status" + aria-live="polite") are muted so screen readers hear "Loading X" once, not
          N times, and tests get one unambiguous status region. */}
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} aria-live="off" aria-hidden="true" className="h-9 w-full rounded-md" />
      ))}
    </div>
  );
}
