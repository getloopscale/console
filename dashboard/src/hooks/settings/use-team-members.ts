import { useQuery } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';

export interface Member {
  username?: string;
  name?: string;
  email: string;
  role: string;
  joined?: string;
}

/**
 * The workspace's team members.
 *
 * B-060 — the list has to live in the SAME key hierarchy the mutations invalidate. It used to read
 * through `useEngineApi` (key `['engine', path]`) while `useInviteMember` and `useRemoveMember`
 * invalidated `['team']`, so inviting or removing a member never refreshed the table. That is the
 * whole reason this read belongs beside its key rather than inside a page: the page had no way to
 * see the mismatch.
 *
 * `throwOnError` is deliberate, not the silent-null-ok escape hatch: the page never read the
 * `error` flag, so a network failure rendered an EMPTY list — the operator reads "your team has
 * nobody" when the truth is "I could not ask" (#274).
 *
 * B-167 — a previous version of that note claimed the failure reached the RouteBoundary. It does
 * not. `throwOnError` here is `cloudFetch`'s third argument, not the TanStack option; the sentence
 * had been copied from `infra/domains.tsx` along with the pattern. See `lib/list-state.ts`.
 */
export function useTeamMembers() {
  return useQuery({
    queryKey: queryKeys.team.list(),
    queryFn: () =>
      engineFetch<{ members: Member[] }>(
        `/api/v1/teams/members?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
  });
}
