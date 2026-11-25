import { useCallback, useSyncExternalStore } from 'react';

/**
 * use-mutation-in-flight — Sponsor LIVE 2026-06-18 (generalized from
 * the original use-rollback-in-flight hook).
 *
 * Long-running deploy mutations (rollback ~90s, promote-to-production
 * ~90s, redeploy ~3-5min) all share the same UX gap: the toast trail
 * fires immediately but the grid + the deploy timeline hero still
 * show the OLD state until the DB commit lands. This hook publishes
 * "mutation in flight" state from the dialog so any view that wants
 * to honestly reflect the transitional state can render a pulsing
 * badge on the target row (e.g. "↻ Rolling back to <sha>…" or
 * "↑ Promoting <sha> to production…"), swapping to the canonical
 * "● Active" badge once the DB commit lands.
 *
 * The kind discriminator lets a single store hold one in-flight
 * mutation per project regardless of which mutation kind it is —
 * subscribers read the kind to render the right label. A project
 * cannot have two in-flight mutations at once (the backend serializes
 * them under withEnvironmentLock), so a single map slot per project
 * is the correct shape.
 *
 * Implementation: module-level Map<projectName, MutationInFlight>
 * with a subscribe/notify list. Bound to React via useSyncExternalStore
 * — the React 18 canonical primitive for external stores, with built-in
 * tearing protection. No QueryClient, no Context, no Zustand: keeps
 * the hook trivially testable and decoupled from the data-fetching
 * layer.
 *
 * Back-compat: the original use-rollback-in-flight.ts file remains as
 * a thin wrapper around this hook so existing rollback callers keep
 * working unchanged.
 */

type MutationKind = 'rollback' | 'promote' | 'redeploy';

export interface MutationInFlight {
  kind: MutationKind;
  projectName: string;
  targetBuildId: string;
  targetSha: string;
  startedAt: number;
}

type Listener = () => void;

// HMR-safe singleton: store + listener set live on globalThis so a Vite
// hot-update that re-instantiates this module does NOT create a fresh
// Map and a fresh listener Set. Sponsor LIVE-caught 2026-06-18: after
// HMR'ing the dialog and the grid in different reloads, the dialog
// published into one Map instance and the grid subscribed to another,
// so the transitional badge never lit up in /deployments even though
// the publish path ran correctly. globalThis bridges the two module
// instances across HMR boundaries; in production builds (single module
// instance) the behavior is identical.
interface MutationInFlightGlobals {
  __loopscaleMutationInFlightStore?: Map<string, MutationInFlight>;
  __loopscaleMutationInFlightListeners?: Set<Listener>;
}
const g = globalThis as MutationInFlightGlobals;
const store: Map<string, MutationInFlight> =
  g.__loopscaleMutationInFlightStore ??
  (g.__loopscaleMutationInFlightStore = new Map());
const listeners: Set<Listener> =
  g.__loopscaleMutationInFlightListeners ??
  (g.__loopscaleMutationInFlightListeners = new Set());

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(projectName: string | undefined): MutationInFlight | null {
  if (!projectName) return null;
  return store.get(projectName) ?? null;
}

/**
 * Subscribe to the in-flight mutation for a project (any kind).
 * Returns null when no mutation is in flight. Subscribers should
 * inspect `kind` to render the right transitional label.
 */
export function useMutationInFlight(
  projectName: string | undefined,
): MutationInFlight | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(projectName),
    () => null,
  );
}

/**
 * Publish that a mutation has started. Replaces any prior in-flight
 * entry for the same project (backend lock prevents real concurrency).
 */
export function useStartMutation(): (info: MutationInFlight) => void {
  return useCallback((info: MutationInFlight) => {
    store.set(info.projectName, info);
    notify();
  }, []);
}

/**
 * Clear the in-flight entry for a project. No-op when nothing is in
 * flight (avoids spurious re-renders).
 */
export function useEndMutation(): (projectName: string) => void {
  return useCallback((projectName: string) => {
    if (store.delete(projectName)) {
      notify();
    }
  }, []);
}

/**
 * Test-only: clear the entire store. Called by tests in their setup
 * so one test's publish doesn't leak into the next. Never used in
 * prod — dialogs clear each project explicitly via useEndMutation.
 */
export function __resetMutationInFlightStore(): void {
  if (store.size === 0) return;
  store.clear();
  notify();
}
