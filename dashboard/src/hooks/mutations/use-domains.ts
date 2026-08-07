import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import type { Domain } from '@/lib/api/types';
import { queryKeys } from '@/lib/api/query-keys';

const DOMAINS_KEY = queryKeys.domains.all;

/**
 * B-017 — o payload aqui foi alinhado ao que o AddDomainSheet (o unico caminho de
 * CREATE que existe na UI) sempre enviou: { domain, project, app, environment }.
 * A assinatura anterior, { domain, project_id? }, nao correspondia a nenhum
 * chamador — o hook nasceu orfao e o sheet seguiu fazendo o POST cru, sem
 * invalidar cache. Divergencia de contrato entre um hook e o formulario que
 * deveria consumi-lo e exatamente o que produziu o AddSecretSheet quebrado.
 */
export function useAddDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      domain: string;
      project: string;
      app: string;
      environment: string;
    }) =>
      engineFetch<Domain>('/api/v1/domains', {
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
