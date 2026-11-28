/** The states a sandbox that still exists can be in. */
export type SandboxStateFilter = 'all' | 'running' | 'paused' | 'pending';
export type StartOrder = 'newest' | 'oldest';

export interface ListView {
  /** Text the id must contain. Empty keeps every sandbox. */
  search: string;
  state: SandboxStateFilter;
  order: StartOrder;
}

interface Listed {
  id: string;
  state: string;
  created_at: string;
}

/** The sandboxes the list shows for a search text, a state and an order. */
export function visibleSandboxes<T extends Listed>(sandboxes: T[], view: ListView): T[] {
  const needle = view.search.trim().toLowerCase();
  const kept = sandboxes.filter(
    (s) =>
      (view.state === 'all' || s.state === view.state) &&
      (needle === '' || s.id.toLowerCase().includes(needle)),
  );
  const direction = view.order === 'newest' ? -1 : 1;
  return kept.sort((a, b) => direction * (Date.parse(a.created_at) - Date.parse(b.created_at)));
}

/** How many sandboxes exist, and how many are in each state. */
export function countByState(sandboxes: Listed[]): Record<SandboxStateFilter, number> {
  const counts: Record<SandboxStateFilter, number> = { all: sandboxes.length, running: 0, paused: 0, pending: 0 };
  for (const s of sandboxes) {
    if (s.state === 'running' || s.state === 'paused' || s.state === 'pending') counts[s.state] += 1;
  }
  return counts;
}

function span(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** How long ago the sandbox started, as "42s", "7m 5s" or "3h 20m". */
export function runningFor(createdAt: string, nowMs: number): string {
  const started = Date.parse(createdAt);
  return Number.isNaN(started) ? '—' : span(nowMs - started);
}

/** How long until the sandbox expires, in the same form. "0s" once the time has passed. */
export function expiresIn(expiresAt: string | undefined, nowMs: number): string {
  const end = Date.parse(expiresAt ?? '');
  return Number.isNaN(end) ? '—' : span(end - nowMs);
}

/** The entries of a rule list typed one per line: trimmed, without the empty lines. */
export function ruleLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The labels of a sandbox as "key=value", ordered by key. */
export function metadataPairs(metadata: Record<string, string> | undefined): string[] {
  return Object.entries(metadata ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
}
