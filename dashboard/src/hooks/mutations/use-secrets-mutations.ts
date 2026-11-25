import { useMutation, useQueryClient } from '@tanstack/react-query';
import { engineFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import type { Secret } from '@/lib/api/types';

/**
 * J-22 T2.2 — Secret mutations (Vercel-canonical Add / Rotate / Delete / Bulk).
 *
 * Each mutation invalidates `queryKeys.secrets.all` on success so the
 * /secrets table refreshes immediately.
 */

export interface CreateSecretInput {
  name: string;
  value: string;
  environments: string[];
  project?: string;
}

/** One secret the API answered for but did not save, with the reason it gave. */
export interface SecretSaveFailure {
  name: string;
  error: string;
}

/**
 * POST /secrets/bulk answers 200 even when an item was not saved: the failure is in that item's
 * `status: "failed"` and `error`. Thrown so a caller cannot read the 200 as success.
 */
export class SecretsNotSavedError extends Error {
  readonly failures: readonly SecretSaveFailure[];
  constructor(failures: readonly SecretSaveFailure[]) {
    super(failures.map((f) => `${f.name}: ${f.error}`).join('; '));
    this.name = 'SecretsNotSavedError';
    this.failures = failures;
  }
}

function failedItems(result: BulkUploadResult | null): SecretSaveFailure[] {
  return (result?.results ?? [])
    .filter((r) => r.status === 'failed')
    .map((r) => ({ name: r.name, error: r.error ?? 'the API gave no reason' }));
}

/**
 * Create a single secret across one or more environments.
 *
 * Routes via POST /api/v1/secrets/bulk (T1.1) with a 1-key payload so the
 * server-side per-key fan-out handles multi-env atomically (audit per env
 * via T1.2; plan-limit gate via T1.3). The single-secret POST endpoint
 * expects `environment` (singular string) which the UI Sheet cannot
 * forward without losing multi-env support; using /bulk eliminates the
 * schema mismatch class.
 *
 * Rejects on a non-2xx answer and on a 200 whose item says `failed`, so the sheet stays open with
 * the reason instead of closing as if the secret were set.
 */
export function useCreateSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSecretInput) => {
      const result = await engineFetch<BulkUploadResult>(
        '/api/v1/secrets/bulk',
        {
          method: 'POST',
          body: JSON.stringify({
            project: input.project,
            secrets: [
              { name: input.name, value: input.value, envs: input.environments },
            ],
          }),
        },
        { throwOnError: true },
      );
      const failures = failedItems(result);
      if (failures.length > 0) throw new SecretsNotSavedError(failures);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.all });
    },
  });
}

export interface RotateSecretInput {
  name: string;
  newValue: string;
  /** EC-13 — server rejects 409 STALE_VERSION when expected_version doesn't match. */
  expectedVersion: number;
  environment: string;
  project?: string;
}

/** PUT /api/v1/secrets/{name} — rotate value with optimistic concurrency. */
export function useRotateSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RotateSecretInput) =>
      engineFetch<Secret>(`/api/v1/secrets/${encodeURIComponent(input.name)}`, {
        method: 'PUT',
        body: JSON.stringify({
          value: input.newValue,
          environment: input.environment,
          project: input.project,
          expected_version: input.expectedVersion,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.all });
    },
  });
}

export interface DeleteSecretInput {
  name: string;
  environment: string;
  project?: string;
}

/** DELETE /api/v1/secrets/{name}?env=&project= — remove from one env. */
export function useDeleteSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteSecretInput) => {
      const params = new URLSearchParams({ environment: input.environment });
      if (input.project) params.set('project', input.project);
      return engineFetch(
        `/api/v1/secrets/${encodeURIComponent(input.name)}?${params.toString()}`,
        { method: 'DELETE' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.all });
    },
  });
}

export interface BulkUploadInput {
  project: string;
  secrets: Array<{ name: string; value: string; envs: string[] }>;
}

export interface BulkUploadResult {
  results: Array<{
    name: string;
    status: 'created' | 'failed';
    error?: string;
    sync_status: 'pending' | 'synced' | 'failed';
  }>;
}

/**
 * POST /api/v1/secrets/bulk — batch from .env upload (T1.1 endpoint).
 *
 * Resolves with the per-item results even when some items `failed`, since the caller shows
 * which keys were saved and retries only the rest. Rejects on a non-2xx answer.
 */
export function useBulkUploadSecrets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkUploadInput) =>
      engineFetch<BulkUploadResult>(
        '/api/v1/secrets/bulk',
        { method: 'POST', body: JSON.stringify(input) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.all });
    },
  });
}
