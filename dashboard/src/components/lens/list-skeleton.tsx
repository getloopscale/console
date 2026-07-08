import { Skeleton } from '@usetheo/ui';

/**
 * A table-shaped, screen-reader-labelled loading placeholder for the lens list screens — the loading
 * leg of the loading→empty→error triad. Replaces the bare `<Skeleton/>` sites (no dimensions, no aria)
 * with a block of full-width rows carrying `role="status"` + `aria-label="Loading {label}"`, mirroring
 * the `dashboards.tsx` sized-skeleton exemplar so the placeholder previews the table it becomes.
 */
export function ListSkeleton({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={`Loading ${label}`} className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded-md" />
      ))}
    </div>
  );
}
