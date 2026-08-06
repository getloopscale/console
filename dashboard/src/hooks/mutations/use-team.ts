import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { TeamMember } from '@/lib/api/types';

const TEAM_KEY = queryKeys.team.all;

export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: string }) =>
      engineFetch<TeamMember>('/api/v1/teams/members', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      engineFetch(`/api/v1/teams/members/${encodeURIComponent(memberId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    },
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      engineFetch(`/api/v1/teams/members/${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEAM_KEY });
    },
  });
}
