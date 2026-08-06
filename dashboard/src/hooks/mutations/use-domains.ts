import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/api';
import { queryKeys } from '@/lib/api/query-keys';

const DOMAINS_KEY = queryKeys.domains.all;

export function useAddDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { domain: string; project_id?: string }) =>
      engineFetch('/api/v1/domains', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOMAINS_KEY });
    },
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) =>
      engineFetch(`/api/v1/domains/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOMAINS_KEY });
    },
  });
}

export function useVerifyDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) =>
      engineFetch(`/api/v1/domains/${encodeURIComponent(domain)}/verify`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOMAINS_KEY });
    },
  });
}
