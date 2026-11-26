import { useMutation } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';

interface RememberedItem {
  id: string;
  content: string;
}

interface RecallHit {
  id: string;
  content: string;
  score: number;
}

interface DerivedMemory {
  id: string;
  text: string;
  derivedFrom?: string[];
}

interface ReflectResult {
  higherOrderMemories?: DerivedMemory[];
  [key: string]: unknown;
}

interface RememberInput {
  text: string;
  category?: string;
  /** v1.1 `attributedTo` — the peer this fact is about. */
  attributedTo?: string;
}

interface RecallInput {
  query: string;
  topK: number;
  /** RFC3339 UTC instant; the provider's `asOf` is `z.string().datetime()`. */
  asOf?: string;
  /** EG-1 (loopmem v0.20.0) — opt-in entity-graph expansion. */
  graphExpand?: { hops: number };
}

/**
 * The three live memory operations behind the Playground.
 *
 * These are deliberately mutations rather than queries even though `recall` reads: each one runs
 * when the operator presses a button, and a query would re-run them on focus and cache their
 * result — which for a screen whose whole purpose is "try it and see what comes back" would show a
 * stale answer to a new question.
 */
export function useRemember() {
  return useMutation({
    mutationFn: (input: RememberInput) =>
      cloudFetch<{ items: RememberedItem[] }>(
        '/v1/dashboard/memory/remember',
        { method: 'POST', body: JSON.stringify(input) },
        { throwOnError: true },
      ),
  });
}

export function useRecall() {
  return useMutation({
    mutationFn: (input: RecallInput) =>
      cloudFetch<{ results: RecallHit[] }>(
        '/v1/dashboard/memory/recall',
        { method: 'POST', body: JSON.stringify(input) },
        { throwOnError: true },
      ),
  });
}

/**
 * Run a reflection over the scope's memories — the same consolidation pipeline the agent triggers
 * automatically.
 *
 * The body is empty by design: the endpoint reflects over the caller's scope, and there is nothing
 * for the screen to choose. Passing `{}` explicitly rather than omitting the body keeps the request
 * a well-formed JSON POST.
 */
export function useReflect() {
  return useMutation({
    mutationFn: () =>
      cloudFetch<ReflectResult>(
        '/v1/dashboard/memory/reflect',
        { method: 'POST', body: '{}' },
        { throwOnError: true },
      ),
  });
}
