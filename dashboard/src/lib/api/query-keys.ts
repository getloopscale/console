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
  // B-052 — o dominio skills tinha o pior caso dos tres: o MESMO prefixo
  // `['cloud', '/v1/dashboard/skills', X]` carregava tres coisas diferentes no
  // slot X — um token de pagina (overview.tsx:77), um id de skill
  // (detail.tsx:61) e um limite numerico (bundle-detail.tsx:104). Tupla
  // posicional com slot sem tipo colide por coincidencia de valor, e o defeito
  // aparece como "a tela mostrou o dado de outra coisa", que ninguem liga a
  // cache.
  //
  // Aqui cada leitura tem nome proprio, entao o slot nao e mais posicional.
  skills: {
    all: ['skills'] as const,
    // O LIMITE entra na chave junto do token. `overview.tsx:78` e
    // `catalog.tsx:47` fazem a MESMA chamada `fetchSkills(PAGE_LIMIT, token)` e
    // usavam chaves diferentes — mesmo dado, dois caches. E nenhuma das duas
    // carregava o limite, o que e a mesma armadilha que `trust` tinha entre
    // limite 200 e 100.
    catalog: (limit: number, token: string | null) =>
      ['skills', 'catalog', limit, token ?? 'primeira'] as const,
    detail: (id: string | undefined) => ['skills', 'detail', id] as const,
    instructions: (id: string | undefined) => ['skills', 'detail', id, 'instructions'] as const,
    versions: (id: string | undefined) => ['skills', 'detail', id, 'versions'] as const,
    channels: (id: string | undefined) => ['skills', 'detail', id, 'channels'] as const,
    discovery: (q: string, rascunhos: boolean, descontinuadas: boolean) =>
      ['skills', 'discovery', q, rascunhos, descontinuadas] as const,
    operation: (id: string | undefined) => ['skills', 'operation', id] as const,
  },
  // Bundles sao do mesmo dominio de produto, mas com raiz propria: invalidar
  // `skills.all` depois de criar um bundle refaria o catalogo inteiro sem
  // motivo, e invalidar `bundles.all` depois de publicar uma skill idem.
  bundles: {
    all: ['bundles'] as const,
    list: () => ['bundles', 'list'] as const,
    tokens: (bundleId: string | undefined) => ['bundles', bundleId, 'tokens'] as const,
    adoption: (bundleId: string | undefined, dias: number) =>
      ['bundles', bundleId, 'adoption', dias] as const,
  },
  // B-052 — promptly era o unico dos tres com UMA chave declarada
  // (`CATALOG_QUERY_KEY`, promptly-api.ts:23) e o resto escrito a mao nas telas.
  // Mover a declarada para ca MUDA a forma da chave, entao ha um refetch unico
  // no deploy — declarado no CHANGELOG, porque uma tela que recarrega sozinha
  // sem explicacao e um susto que ninguem consegue diagnosticar depois.
  promptly: {
    all: ['promptly'] as const,
    catalog: (filtros?: Record<string, unknown>) =>
      ['promptly', 'catalog', filtros ?? {}] as const,
    prompt: (name: string | undefined) => ['promptly', 'prompt', name] as const,
    resolved: (name: string | undefined) => ['promptly', 'prompt', name, 'resolved'] as const,
    dependents: (name: string | undefined) => ['promptly', 'prompt', name, 'dependents'] as const,
    labels: (name: string | undefined) => ['promptly', 'prompt', name, 'labels'] as const,
    revisions: (name: string | undefined, limit: number, after = 0) =>
      ['promptly', 'prompt', name, 'revisions', limit, after] as const,
    diff: (name: string | undefined) => ['promptly', 'prompt', name, 'diff'] as const,
    policy: (name: string | undefined, label: string | undefined) =>
      ['promptly', 'prompt', name, 'policy', label] as const,
    usage: (name: string | undefined, dias: number) =>
      ['promptly', 'prompt', name, 'usage', dias] as const,
    comments: (name: string | undefined, version: number) =>
      ['promptly', 'prompt', name, 'comments', version] as const,
  },
  scale: {
    all: ['scale'] as const,
    detail: (project: string, env: string) =>
      ['scale', project, env] as const,
  },
} as const;
