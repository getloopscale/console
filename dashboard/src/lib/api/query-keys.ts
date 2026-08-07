// T1.2: Centralized queryKey factories for TanStack Query.
//
// EC-05 fold: list factories accept optional filter object so that URL
// state changes (e.g., status filter in T2.3) produce distinct cache keys
// = automatic refetch. Without the filter param, cache hit would return
// stale data when filters change.
//
// Naming convention: hierarchical tuples enable invalidate(['projects'])
// to nuke all project-related queries (list, detail, sub-resources).

export const queryKeys = {
  projects: {
    all: ['projects'] as const,
    list: (filters?: Record<string, unknown>) =>
      ['projects', 'list', filters ?? {}] as const,
    detail: (name: string) => ['projects', name] as const,
  },
  builds: {
    all: ['builds'] as const,
    list: (project: string | undefined, filters?: Record<string, unknown>) =>
      ['builds', 'list', project, filters ?? {}] as const,
    detail: (id: string) => ['builds', id] as const,
  },
  secrets: {
    all: ['secrets'] as const,
    list: (filters?: Record<string, unknown>) =>
      ['secrets', 'list', filters ?? {}] as const,
  },
  previews: {
    all: ['previews'] as const,
    list: (project: string | undefined, filters?: Record<string, unknown>) =>
      ['previews', 'list', project, filters ?? {}] as const,
  },
  projectStatus: {
    all: ['project-status'] as const,
    detail: (project: string | undefined) => ['project-status', project] as const,
  },
  whoami: {
    all: ['whoami'] as const,
  },
  // Plan J-10 v1.1 — environments queryKey canonical. Replaces the legacy
  // local ENVS_KEY = ['environments'] used in use-environments.ts so
  // invalidation by canonical key works across hooks.
  environments: {
    all: ['environments'] as const,
    list: (filters?: Record<string, unknown>) =>
      ['environments', 'list', filters ?? {}] as const,
    cascadePreview: (envName: string) =>
      ['environments', 'cascade-preview', envName] as const,
  },
  // J-20 Scale plan v1.1 — scale queryKey canonical. The hook is a
  // mutation (no list query yet) so only `all` is defined. Future read
  // endpoints (e.g., GET current scaling state per env) attach here.
  // B-018 — o recurso domains tinha DOIS namespaces independentes: as mutations
  // invalidavam ['domains'] e o polling de status lia ['engine', '/api/v1/domains/:name'].
  // Invalidar um nunca alcancava o outro, entao um verify/delete bem-sucedido deixava
  // o detalhe servindo dado velho ate o gc. Uma hierarquia unica resolve: invalidar
  // ['domains'] agora alcanca lista E detalhe.
  domains: {
    all: ['domains'] as const,
    list: (filters?: Record<string, unknown>) =>
      ['domains', 'list', filters ?? {}] as const,
    detail: (name: string | undefined) => ['domains', 'detail', name] as const,
  },
  // B-060 — mesmo defeito de domains (B-017/B-018): as mutations invalidavam
  // ['team'] enquanto team.tsx lia a lista com useEngineApi, cuja chave e
  // ['engine', '/api/v1/teams/members']. Arvores disjuntas, entao convidar ou
  // remover um membro nunca atualizava a tabela.
  team: {
    all: ['team'] as const,
    list: (filters?: Record<string, unknown>) =>
      ['team', 'list', filters ?? {}] as const,
  },
  // B-052 — o dominio trust tinha DUAS convencoes ao mesmo tempo: overview.tsx
  // lia `['cloud', '/v1/dashboard/trust/policy-violations']` e guardrails.tsx um
  // `QUERY_KEY` local. Arvores disjuntas, entao criar um guardrail nunca
  // atualizava a contagem do overview — o mesmo defeito de domains (B-018) e de
  // team (B-060), pela terceira vez.
  trust: {
    all: ['trust'] as const,
    violations: (filters?: Record<string, unknown>) =>
      ['trust', 'violations', filters ?? {}] as const,
    validators: () => ['trust', 'validators'] as const,
    enforcement: (limit: number) => ['trust', 'enforcement', limit] as const,
    conversation: (id: string | null) => ['trust', 'conversation', id] as const,
  },
  scale: {
    all: ['scale'] as const,
    detail: (project: string, env: string) =>
      ['scale', project, env] as const,
  },
} as const;
