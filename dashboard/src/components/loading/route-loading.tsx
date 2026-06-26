/**
 * RouteLoading — Sprint 3 Phase 2 (#17) v1.1 ADR D1.
 *
 * Visible loading state rendered by React Suspense between a route URL change
 * and the moment the lazy-loaded route chunk arrives. Replaces the previous
 * PageLoader with a `role="status"` element so assistive technologies announce
 * the transition AND so the QA Red Team regression test can detect the
 * presence of a loading state during navigation.
 *
 * Per plan ADR D1: this is the canonical React Suspense pattern. The visible
 * loading state is honest UX — user sees that navigation is in progress, not
 * a frozen page that still shows the previous route's content.
 */
import { Loader2 } from 'lucide-react';

export function RouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="min-h-screen bg-background flex items-center justify-center"
    >
      <Loader2 className="size-6 text-primary animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
