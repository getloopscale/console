import { useQuery } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import type { AuditListResponse } from '@/lib/api/types';

export const AUDIT_PAGE_SIZE = 50;

/**
 * A filtered page of the audit log.
 *
 * `throwOnError` is not boilerplate on THIS screen. Without it a network failure became an empty
 * list and the page said "no audit entries" when the truth was "I could not ask" — and on an audit
 * screen, absence of record is exactly what someone investigating an incident is looking for. A
 * fabricated absence there is worse than an error.
 *
 * Worth recording why it went undetected for so long: the silent-null guard quantifies over
 * `useQuery` / `useInfiniteQuery` / `useSuspenseQuery`, and this used to be a bare `engineFetch`
 * inside an effect. Moving the read here puts it back under the guard's scope.
 */
export function useAuditLog(filters: { action: string; actor: string; page: number }) {
  const { action, actor, page } = filters;

  return useQuery({
    queryKey: ['engine', '/api/v1/audit', { actionFilter: action, actorFilter: actor, page }] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (action.trim()) params.set('action', action.trim());
      if (actor.trim()) params.set('actor', actor.trim());
      params.set('limit', String(AUDIT_PAGE_SIZE));
      params.set('offset', String((page - 1) * AUDIT_PAGE_SIZE));

      return engineFetch<AuditListResponse>(`/api/v1/audit?${params.toString()}`, {}, { throwOnError: true });
    },
  });
}
