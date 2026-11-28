import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudFetch } from '@/lib/http/api';
import { queryKeys } from '@/lib/api/query-keys';
import { LIST_SAFETY_CEILING } from '@/lib/http/list-ceiling';
import { appendSample, type MetricsSample } from '@/lib/sandboxes/metrics-series';

/** A row of `GET /v1/sandboxes`, as the sandbox service documents it. */
export interface SandboxRow {
  id: string;
  image?: string;
  state: string;
  created_at: string;
  expires_at?: string;
  /** Labels given when the sandbox was created. */
  metadata?: Record<string, string>;
  /** Present only when the sandbox has outbound rules. */
  network?: { allow_out?: string[]; deny_out?: string[] };
}

/** How often the list is read again by default. A sandbox starts and ends without this screen. */
export const SANDBOXES_REFETCH_MS = 10_000;

/**
 * The organization's sandboxes that have not been destroyed.
 *
 * `/v1/sandboxes` is served by this console, which forwards it to the sandbox service, so the
 * request carries the session like any other console call. `throwOnError` makes a failed read an
 * error instead of `null`, which the screen would show as "no sandboxes".
 *
 * `refetchMs` is how often the list is read again; `false` reads it once.
 */
export function useSandboxes(refetchMs: number | false = SANDBOXES_REFETCH_MS) {
  return useQuery({
    queryKey: queryKeys.sandboxes.list(),
    queryFn: () =>
      cloudFetch<{ sandboxes: SandboxRow[] }>(
        `/v1/sandboxes?limit=${LIST_SAFETY_CEILING}`,
        {},
        { throwOnError: true },
      ),
    refetchInterval: refetchMs,
  });
}

/** Destroy one sandbox, then read the list again. */
export function useTerminateSandbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      cloudFetch(
        `/v1/sandboxes/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        { throwOnError: true },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes.all });
    },
  });
}

/** How often the page of one sandbox reads it again. */
const SANDBOX_REFETCH_MS = 5_000;

const sandboxPath = (id: string, suffix = '') => `/v1/sandboxes/${encodeURIComponent(id)}${suffix}`;

/** One sandbox, read again while its page is open. A sandbox that is gone is an error. */
export function useSandbox(id: string) {
  return useQuery({
    queryKey: queryKeys.sandboxes.detail(id),
    queryFn: () => cloudFetch<SandboxRow>(sandboxPath(id), {}, { throwOnError: true }),
    refetchInterval: SANDBOX_REFETCH_MS,
    retry: false,
  });
}

/** Pause or resume one sandbox, then read it and the list again. */
export function useSandboxTransition(id: string, transition: 'pause' | 'resume') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cloudFetch(sandboxPath(id, `/${transition}`), { method: 'POST' }, { throwOnError: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes.all });
    },
  });
}

/** The outbound rules of a sandbox, as the API writes them. */
export interface SandboxNetworkRules {
  allow_out: string[];
  deny_out: string[];
}

/** Replace the outbound rules of a running sandbox. They apply to its next connections. */
export function useUpdateSandboxNetwork(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: SandboxNetworkRules) =>
      cloudFetch<SandboxNetworkRules>(
        sandboxPath(id, '/network'),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rules) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes.all });
    },
  });
}

/** A connection the outbound rules refused. */
export interface SandboxNetworkDenial {
  time: string;
  /** Address and port the sandbox tried to reach. */
  destination: string;
  /** The name it asked for, when the protocol carried one. */
  host?: string;
  reason: string;
}

/** The most recent connections the rules of a sandbox refused. */
export function useSandboxNetworkDenials(id: string) {
  return useQuery({
    queryKey: queryKeys.sandboxes.denials(id),
    queryFn: () =>
      cloudFetch<{ denials: SandboxNetworkDenial[] }>(sandboxPath(id, '/network/denials'), {}, { throwOnError: true }),
    refetchInterval: SANDBOX_REFETCH_MS,
    retry: false,
  });
}

/** A chunk of output of a process of the sandbox. */
export interface SandboxLogEntry {
  pid: number;
  stream: 'stdout' | 'stderr';
  data: string;
  at: string;
}

/** The output the sandbox kept, read again while `enabled`. */
export function useSandboxLogs(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sandboxes.logs(id),
    queryFn: () =>
      cloudFetch<{ entries: SandboxLogEntry[]; truncated: boolean }>(sandboxPath(id, '/logs'), {}, { throwOnError: true }),
    refetchInterval: SANDBOX_REFETCH_MS,
    retry: false,
    enabled,
  });
}

/** How often the Monitoring tab takes a sample. A burst of CPU shows within two samples. */
const METRICS_SAMPLE_MS = 3_000;

/**
 * The CPU, memory and disk of a sandbox over the time its page has been open.
 *
 * The API answers the current figures and keeps no history, so each read adds
 * one sample to the series this query holds. The series starts when the tab
 * is first opened and is dropped with the page.
 */
export function useSandboxMetricsSeries(id: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.sandboxes.metrics(id);
  return useQuery({
    queryKey,
    queryFn: async () => {
      const sample = await cloudFetch<MetricsSample>(sandboxPath(id, '/metrics'), {}, { throwOnError: true });
      const series = queryClient.getQueryData<MetricsSample[]>(queryKey) ?? [];
      return sample ? appendSample(series, sample) : series;
    },
    refetchInterval: METRICS_SAMPLE_MS,
    retry: false,
    enabled,
  });
}

/** An entry of a directory of the sandbox. */
export interface SandboxFileEntry {
  name: string;
  size: number;
  is_dir: boolean;
}

/** The entries directly under a directory of the workspace, read while `enabled`. */
export function useSandboxFiles(id: string, directory: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sandboxes.files(id, directory),
    queryFn: () =>
      cloudFetch<{ files: SandboxFileEntry[] }>(
        sandboxPath(id, `/files?path=${encodeURIComponent(directory)}`),
        {},
        { throwOnError: true },
      ),
    refetchInterval: SANDBOX_REFETCH_MS,
    retry: false,
    enabled,
  });
}

/** A row of `GET /v1/templates`: one of the built-in images, or one the organization registered. */
export interface SandboxTemplate {
  name: string;
  image: string;
  description?: string;
  builtin?: boolean;
  id?: string;
  version?: string;
}

/** The templates a sandbox of this organization can start from. */
export function useSandboxTemplates() {
  return useQuery({
    queryKey: queryKeys.sandboxes.templates(),
    queryFn: () => cloudFetch<{ templates: SandboxTemplate[] }>('/v1/templates', {}, { throwOnError: true }),
  });
}

/** A secret of the organization. The API has no field for the value. */
export interface SandboxSecret {
  name: string;
  created_at: string;
  updated_at: string;
}

/** The names of the secrets a sandbox can receive as environment variables. */
export function useSandboxSecrets() {
  return useQuery({
    queryKey: queryKeys.sandboxes.secrets(),
    queryFn: () => cloudFetch<{ secrets: SandboxSecret[] }>('/v1/secrets', {}, { throwOnError: true }),
  });
}

/** Create a secret or replace its value, then read the list again. */
export function useSaveSandboxSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      cloudFetch(
        `/v1/secrets/${encodeURIComponent(name)}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) },
        { throwOnError: true },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes.secrets() });
    },
  });
}

/** Delete a secret, then read the list again. */
export function useDeleteSandboxSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      cloudFetch(`/v1/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }, { throwOnError: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes.secrets() });
    },
  });
}
