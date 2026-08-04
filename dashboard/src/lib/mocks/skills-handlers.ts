import { registerRoute } from './server';

/**
 * M26 — o BFF de skills, para que a jornada do registro seja exercitável sem backend.
 *
 * As formas devolvidas aqui foram **medidas** na definição das rotas do `theo-skills`
 * (`packages/api/src/server/handlers/{skills,publishing}.ts`), não inventadas para o mock passar.
 * Um mock com forma inventada é pior que nenhum: ele deixa a tela verde contra um contrato que
 * não existe, e o defeito só aparece contra o serviço real — quando ninguém mais está olhando.
 *
 * O acervo abaixo é deliberadamente DESCONFORTÁVEL, e cada item existe por um motivo:
 *
 *  - `sk_ordering` tem versões `1.0.0`, `1.2.0` e `1.10.0` — a ordenação alfabética colocaria
 *    a mais nova no meio, e quem lesse "a primeira" promoveria a errada.
 *  - `sk_ordering` tem uma versão que NENHUM canal serve: é justamente a candidata a ser
 *    promovida, e uma tela que a filtrasse quebraria a jornada sem erro algum.
 *  - `sk_local` é `execution: local` e o serviço RECUSA sua instrução com 422 tipado. A tela
 *    tem de exibir a recusa como diagnóstico, não como "erro ao carregar".
 */
const skillsDb = {
  skills: [
    {
      skill_id: 'sk_ordering',
      name: 'Revisar pull request',
      description: 'Lê o diff e aponta riscos antes do merge.',
      state: 'live',
      latest_revision_id: 'rev_d',
      category: 'engenharia',
      execution: 'remote',
      lifecycle: 'active',
      deprecation_reason: null,
      superseded_by: null,
      visibility: 'public',
      embedded: true,
      create_time: '2026-07-01T10:00:00Z',
      update_time: '2026-08-01T10:00:00Z',
    },
    {
      skill_id: 'sk_velha',
      name: 'Converter moeda (v1)',
      description: 'Substituída por uma versão que também lê PDF.',
      state: 'live',
      latest_revision_id: 'rev_v1',
      category: 'finance',
      execution: 'remote',
      lifecycle: 'deprecated',
      deprecation_reason: 'não cobre cotação futura; use a v2',
      superseded_by: 'sk_ordering',
      visibility: 'private',
      embedded: true,
      create_time: '2026-05-01T10:00:00Z',
      update_time: '2026-07-20T10:00:00Z',
    },
    {
      skill_id: 'sk_local',
      name: 'Preparar ambiente local',
      description: 'Traz script e roda na máquina do cliente.',
      state: 'live',
      latest_revision_id: 'rev_local_1',
      category: 'operação',
      execution: 'local',
      lifecycle: 'active',
      deprecation_reason: null,
      superseded_by: null,
      visibility: 'private',
      embedded: false,
      create_time: '2026-07-05T10:00:00Z',
      update_time: '2026-07-20T10:00:00Z',
    },
  ],
  versions: {
    sk_ordering: [
      { version: '1.0.0', revision_id: 'rev_a' },
      { version: '1.2.0', revision_id: 'rev_c' },
      { version: '1.10.0', revision_id: 'rev_d' },
    ],
    sk_local: [{ version: '0.1.0', revision_id: 'rev_local_1' }],
  } as Record<string, { version: string; revision_id: string }[]>,
  channels: {
    // `stable` serve a revisão ANTIGA e `1.10.0` não é servida por canal algum — o estado
    // normal de quem publicou e ainda não promoveu.
    sk_ordering: [{ channel: 'stable', revision_id: 'rev_a', previous_revision_id: null }],
    sk_local: [],
  } as Record<string, { channel: string; revision_id: string; previous_revision_id: string | null }[]>,
  instructions: {
    sk_ordering: {
      skill_id: 'sk_ordering',
      instructions:
        '# Revisar pull request\n\nLeia o diff inteiro antes de comentar. Aponte o risco, não o estilo.',
      execution: 'remote',
      origin: 'own' as const,
    },
  } as Record<string, { skill_id: string; instructions: string; execution: string; origin: 'own' | 'public' }>,
};

/**
 * O prefixo depende de `window.__THEO_CONFIG__.API_URL`, vazio em dev (same-origin) e `/api`
 * atrás do gateway. Registrar os dois evita que o mock funcione numa configuração e
 * silenciosamente não na outra — o modo de falha que já custou a primeira execução do e2e de
 * guardrails, com a tela corretamente dizendo "não foi possível carregar".
 */
export function registerSkillsHandlers() {
  for (const prefix of ['', '/api']) registerSkillsRoutes(`${prefix}/v1/dashboard/skills`);
}

function registerSkillsRoutes(base: string) {
  // M31 — paginação REAL. O mock devolve `next_page_token` quando há mais, porque era
  // exatamente isso que a tela ignorava: o token vinha e o excedente sumia sem erro algum.
  registerRoute('GET', base, async (req) => {
    const url = new URL(req.url, 'http://x');
    const limit = Math.max(1, Number(url.searchParams.get('limit') ?? '100'));
    const token = url.searchParams.get('page_token');
    const inicio = token === null ? 0 : Number(token);
    const fatia = skillsDb.skills.slice(inicio, inicio + limit);
    const proximo = inicio + limit < skillsDb.skills.length ? String(inicio + limit) : null;
    return Response.json({ skills: fatia, next_page_token: proximo });
  });

  // M31 — AUTORIA. `:validate` NÃO cria nada: um mock que criasse deixaria a tela verde sobre um
  // contrato que não existe, e o defeito só apareceria contra o serviço real.
  registerRoute('POST', `${base}/:validate`, async (req) => {
    const body = (await req.json()) as { skill_md?: string };
    const md = body.skill_md ?? '';
    // O diagnóstico POSICIONADO — `field` e `line` — é o que o M30 entregou e nenhuma tela usava.
    if (!md.includes('name:')) {
      return Response.json(
        { error: 'invalid_frontmatter', message: 'frontmatter sem `name`', field: 'name', line: 2 },
        { status: 422 },
      );
    }
    const nome = /name:\s*(.+)/.exec(md)?.[1]?.trim() ?? 'sem nome';
    return Response.json({ ok: true, name: nome, description: 'd', execution: 'remote' });
  });

  // M34 — o diagnóstico de descobribilidade, no momento da autoria. NÃO executa a skill: o mock
  // reproduz a FORMA (causes + hints + embedder) e a regra que importa — descrição curta é a
  // causa mais comum de uma skill nova não ser achada.
  registerRoute('POST', `${base}/:discoverability`, async (req) => {
    const body = (await req.json()) as { description?: string; has_embedding?: boolean };
    const desc = body.description ?? '';
    const causes: string[] = [];
    const hints: string[] = [];
    if (desc.trim().length < 60) {
      causes.push('description_too_generic');
      hints.push('A descrição diz o que a skill é, mas não QUANDO usá-la.');
    }
    if (body.has_embedding !== true) {
      causes.push('no_embedding');
      hints.push('A revisão vigente não tem vetor: a skill só aparece para quem já sabe o nome.');
    }
    return Response.json({
      discoverable: causes.length === 0,
      causes,
      hints,
      // O embedder viaja SEMPRE: o número mede o embedder tanto quanto a skill.
      embedder: 'stub/stub',
    });
  });

  registerRoute('POST', base, async (req) => {
    const body = (await req.json()) as { skill_id?: string; skill_md?: string };
    const id = (body.skill_id ?? '').trim();
    if (id === '') return Response.json({ error: 'invalid_input' }, { status: 400 });
    skillsDb.skills.push({
      skill_id: id,
      name: /name:\s*(.+)/.exec(body.skill_md ?? '')?.[1]?.trim() ?? id,
      description: 'publicada pela tela',
      state: 'live',
      latest_revision_id: 'rev_novo',
      category: 'testing',
      execution: 'remote',
      lifecycle: 'active',
      deprecation_reason: null,
      superseded_by: null,
      create_time: '2026-08-04T12:00:00Z',
      update_time: '2026-08-04T12:00:00Z',
    } as never);
    // 202: ACEITO, não pronto — como o registro.
    return Response.json({ operation_id: `op_${id}` }, { status: 202 });
  });

  registerRoute('GET', '/v1/dashboard/operations/{operationId}', async (_req, params) =>
    // Já concluída: o mock não simula latência de ingestão porque o que a jornada precisa provar
    // é que a tela ACOMPANHA e reage ao estado terminal — não quanto tempo demora.
    Response.json({ operation_id: params.operationId, state: 'succeeded', error: null }),
  );

  registerRoute('GET', `${base}/:retrieve`, async (req) => {
    const url = new URL(req.url, 'http://x');
    const q = (url.searchParams.get('query') ?? '').toLowerCase();
    const incluirDescontinuadas = url.searchParams.get('include_deprecated') === 'true';

    // Casamento deliberadamente grosseiro — o mock não reimplementa RRF. O que ele precisa
    // reproduzir é a FORMA (`score` + `matched`) e o comportamento que a DoD cobra: a
    // descontinuada NÃO aparece sem opt-in.
    const candidatas = skillsDb.skills
      .filter((sk) => incluirDescontinuadas || (sk as { lifecycle?: string }).lifecycle !== 'deprecated')
      .filter((sk) => q === '' || sk.name.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q) || q.split(' ').some((t) => t.length > 3 && sk.description.toLowerCase().includes(t)));

    return Response.json({
      skills: candidatas.map((sk, i) => ({
        skill_id: sk.skill_id,
        name: sk.name,
        description: sk.description,
        score: Number((0.9 - i * 0.2).toFixed(3)),
        // Alterna as pernas de propósito: a tela precisa distinguir as três frases, e um mock
        // que devolvesse sempre a mesma deixaria duas delas sem cobertura.
        matched: i === 0 ? ['lexical', 'vector'] : i === 1 ? ['vector'] : ['lexical'],
      })),
    });
  });

  registerRoute('GET', `${base}/{skillId}`, async (_req, params) => {
    const skill = skillsDb.skills.find((s) => s.skill_id === params.skillId);
    // 404 cobre inexistente e alheia — indistinguíveis de propósito, como no serviço real:
    // um 403 confirmaria a existência de uma skill cujo nome é adivinhável.
    return skill ? Response.json(skill) : Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  });

  registerRoute('DELETE', `${base}/{skillId}`, async (_req, params) => {
    const i = skillsDb.skills.findIndex((sk) => sk.skill_id === params.skillId);
    if (i === -1) return new Response(null, { status: 404 });
    skillsDb.skills.splice(i, 1);
    // 204 SEM CORPO, como o registro. Um mock que devolvesse JSON aqui deixaria a tela verde
    // sobre um contrato que não existe.
    return new Response(null, { status: 204 });
  });

  registerRoute('GET', `${base}/{skillId}/versions`, async (_req, params) =>
    Response.json({ versions: skillsDb.versions[params.skillId] ?? [] }),
  );

  registerRoute('GET', `${base}/{skillId}/channels`, async (_req, params) =>
    Response.json({ channels: skillsDb.channels[params.skillId] ?? [] }),
  );

  // A promoção MUTA o estado do mock, de propósito. Um mock que aceitasse o PUT e devolvesse
  // sempre a mesma lista de canais deixaria passar exatamente o defeito que importa: a tela não
  // refletir o que o operador acabou de fazer. A jornada que o e2e prova é
  // promover → o canal passar a servir a revisão nova.
  registerRoute('PUT', `${base}/{skillId}/channels/{channel}`, async (req, params) => {
    const body = (await req.json().catch(() => null)) as { revision_id?: unknown } | null;
    const revisionId = typeof body?.revision_id === 'string' ? body.revision_id : '';
    if (revisionId === '') {
      return Response.json({ code: 'INVALID_REQUEST', message: 'informe a revisão' }, { status: 400 });
    }
    const lista = skillsDb.channels[params.skillId] ?? [];
    const atual = lista.find((c) => c.channel === params.channel);
    if (atual) {
      // `previous_revision_id` passa a ser o que saiu — é o dado que a confirmação seguinte usa
      // para dizer o que deixou de valer.
      skillsDb.channels[params.skillId] = lista.map((c) =>
        c.channel === params.channel
          ? { channel: c.channel, revision_id: revisionId, previous_revision_id: c.revision_id }
          : c,
      );
    } else {
      skillsDb.channels[params.skillId] = [
        ...lista,
        { channel: params.channel, revision_id: revisionId, previous_revision_id: null },
      ];
    }
    return Response.json({ skill_id: params.skillId, channel: params.channel, revision_id: revisionId });
  });

  registerRoute('PUT', `${base}/{skillId}/lifecycle`, async (req, params) => {
    const alvo = skillsDb.skills.find((sk) => sk.skill_id === params.skillId);
    if (alvo === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    const body = (await req.json()) as { lifecycle?: string; reason?: string; superseded_by?: string };
    if (typeof body.lifecycle !== 'string' || body.lifecycle === '') {
      return Response.json({ code: 'INVALID_REQUEST', message: 'informe o estágio' }, { status: 400 });
    }
    // Depreciar EXIGE motivo — como o serviço. Um mock permissivo aqui deixaria a tela verde
    // sobre uma regra que o registro real aplica, e o defeito só apareceria em produção.
    if (body.lifecycle === 'deprecated' && (body.reason ?? '') === '') {
      return Response.json({ code: 'INVALID_REQUEST', message: 'motivo obrigatório' }, { status: 400 });
    }
    const mutavel = alvo as { lifecycle?: string; deprecation_reason?: string | null; superseded_by?: string | null };
    mutavel.lifecycle = body.lifecycle;
    mutavel.deprecation_reason = body.lifecycle === 'deprecated' ? (body.reason ?? null) : null;
    mutavel.superseded_by = body.superseded_by ?? null;
    return Response.json({ skill_id: params.skillId, lifecycle: body.lifecycle });
  });

  registerRoute('GET', `${base}/{skillId}/instructions`, async (_req, params) => {
    const found = skillsDb.instructions[params.skillId];
    if (found) return Response.json(found);
    // Recusa TIPADA, com o mesmo código do serviço: a skill `local` traz script e suas
    // instruções referenciam arquivos que o agente remoto não tem. Devolver 500 aqui faria o
    // e2e provar um caminho de erro que o serviço real não percorre.
    return Response.json(
      {
        code: 'execution_is_local',
        message: 'skill traz script e roda na máquina do cliente; use `theoskill install`',
      },
      { status: 422 },
    );
  });
}

/**
 * M35 — a superfície de DISTRIBUIÇÃO (bundles, tokens delegados, adoção).
 *
 * As formas foram medidas em `packages/api/src/server/handlers/{publishing,distribution}.ts` e no
 * probe de aceitação da v0.14.0 — não inventadas para o mock passar.
 *
 * O acervo é desconfortável de propósito, e cada linha existe por um motivo:
 *
 *  - `dtk_expirado` já venceu e NÃO está revogado — a tela precisa distinguir os dois estados,
 *    porque levam a ações diferentes (renovar × investigar quem cortou).
 *  - `dtk_revogado` está revogado E dentro do prazo: se a precedência estiver invertida, ele
 *    aparece como ativo e a tela oferece revogar de novo algo já cortado.
 *  - `dtk_sem_rotulo` tem `label: null` — a célula precisa dizer "sem rótulo", não ficar em branco.
 *  - A adoção do `bdl_vazio` tem `total_installs: 0`, que é o caso em que a proporção honesta é
 *    "—" e não "0%".
 *  - A adoção do `bdl_ativo` tem soma das linhas MENOR que o total: é o recorte que prova por que
 *    o denominador não pode ser a soma do que veio.
 */
const distribuicaoDb = {
  bundles: [
    {
      bundle_id: 'bdl_ativo',
      name: 'Skills de atendimento',
      create_time: '2026-06-01T09:00:00Z',
      items: [{ skill_id: 'sk_ordering', channel: 'stable' }],
    },
    { bundle_id: 'bdl_vazio', name: 'Pacote recém-criado', create_time: '2026-08-01T09:00:00Z', items: [] },
  ],
  tokens: {
    bdl_ativo: [
      {
        token_id: 'dtk_ativo',
        label: 'pipeline de CI',
        quota_per_window: 600,
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: null,
        create_time: '2026-07-01T09:00:00.000Z',
      },
      {
        token_id: 'dtk_expirado',
        label: 'piloto de junho',
        quota_per_window: null,
        expires_at: '2026-06-30T00:00:00.000Z',
        revoked_at: null,
        create_time: '2026-06-01T09:00:00.000Z',
      },
      {
        token_id: 'dtk_revogado',
        label: 'parceiro desligado',
        quota_per_window: null,
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: '2026-07-20T12:00:00.000Z',
        create_time: '2026-05-01T09:00:00.000Z',
      },
      {
        token_id: 'dtk_sem_rotulo',
        label: null,
        quota_per_window: null,
        expires_at: '2099-01-01T00:00:00.000Z',
        revoked_at: null,
        create_time: '2026-07-25T09:00:00.000Z',
      },
    ] as {
      token_id: string;
      label: string | null;
      quota_per_window: number | null;
      expires_at: string;
      revoked_at: string | null;
      create_time: string;
    }[],
    bdl_vazio: [] as {
      token_id: string;
      label: string | null;
      quota_per_window: number | null;
      expires_at: string;
      revoked_at: string | null;
      create_time: string;
    }[],
  } as Record<
    string,
    {
      token_id: string;
      label: string | null;
      quota_per_window: number | null;
      expires_at: string;
      revoked_at: string | null;
      create_time: string;
    }[]
  >,
  adoption: {
    bdl_ativo: {
      // Soma das linhas = 9; total da janela = 14. A diferença é o recorte, e é exatamente por
      // isso que a proporção precisa do total e não da soma.
      total_installs: 14,
      adoption: [
        { skill_id: 'sk_ordering', version: '1.10.0', installs: 6 },
        { skill_id: 'sk_ordering', version: '1.2.0', installs: 3 },
      ],
    },
    bdl_vazio: { total_installs: 0, adoption: [] },
  } as Record<string, { total_installs: number; adoption: { skill_id: string; version: string; installs: number }[] }>,
};

export function registerSkillsDistributionHandlers() {
  const base = '/v1/dashboard/bundles';

  registerRoute('GET', base, async () => Response.json({ bundles: distribuicaoDb.bundles }));

  // M34 — o diagnóstico de descobribilidade, no momento da autoria. NÃO executa a skill: o mock
  // reproduz a FORMA (causes + hints + embedder) e a regra que importa — descrição curta é a
  // causa mais comum de uma skill nova não ser achada.
  registerRoute('POST', `${base}/:discoverability`, async (req) => {
    const body = (await req.json()) as { description?: string; has_embedding?: boolean };
    const desc = body.description ?? '';
    const causes: string[] = [];
    const hints: string[] = [];
    if (desc.trim().length < 60) {
      causes.push('description_too_generic');
      hints.push('A descrição diz o que a skill é, mas não QUANDO usá-la.');
    }
    if (body.has_embedding !== true) {
      causes.push('no_embedding');
      hints.push('A revisão vigente não tem vetor: a skill só aparece para quem já sabe o nome.');
    }
    return Response.json({
      discoverable: causes.length === 0,
      causes,
      hints,
      // O embedder viaja SEMPRE: o número mede o embedder tanto quanto a skill.
      embedder: 'stub/stub',
    });
  });

  registerRoute('POST', base, async (req) => {
    const body = (await req.json()) as { name?: string };
    const name = (body.name ?? '').trim();
    if (name === '') {
      return Response.json({ code: 'INVALID_REQUEST', message: 'dê um nome ao pacote' }, { status: 400 });
    }
    const bundle = {
      bundle_id: `bdl_${distribuicaoDb.bundles.length + 1}`,
      name,
      create_time: '2026-08-04T12:00:00Z',
      items: [] as { skill_id: string; channel: string }[],
    };
    distribuicaoDb.bundles = [...distribuicaoDb.bundles, bundle];
    distribuicaoDb.tokens[bundle.bundle_id] = [];
    distribuicaoDb.adoption[bundle.bundle_id] = { total_installs: 0, adoption: [] };
    return Response.json(bundle, { status: 201 });
  });

  registerRoute('GET', `${base}/{bundleId}/tokens`, async (_req, params) => {
    const tokens = distribuicaoDb.tokens[params.bundleId];
    // 404 para pacote que não existe — o serviço real não enumera o acervo alheio, e um mock que
    // devolvesse lista vazia esconderia a diferença entre "não é seu" e "não tem token".
    if (tokens === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ bundle_id: params.bundleId, tokens });
  });

  registerRoute('POST', `${base}/{bundleId}/tokens`, async (req, params) => {
    const body = (await req.json()) as { ttl_days?: number; label?: string };
    if (typeof body.ttl_days !== 'number' || body.ttl_days <= 0) {
      return Response.json({ code: 'INVALID_REQUEST', message: 'informe a validade em dias' }, { status: 400 });
    }
    const lista = distribuicaoDb.tokens[params.bundleId];
    if (lista === undefined) return Response.json({ error: 'not_found' }, { status: 404 });

    const token_id = `dtk_novo_${lista.length + 1}`;
    lista.push({
      token_id,
      label: body.label ?? null,
      quota_per_window: null,
      expires_at: '2099-01-01T00:00:00.000Z',
      revoked_at: null,
      create_time: '2026-08-04T12:00:00.000Z',
    });
    // O valor em claro atravessa AQUI e só aqui — como no serviço real. Um mock que o devolvesse
    // também na listagem faria a tela passar num contrato que não existe.
    return Response.json({ token_id, token: `dtk_secret_${token_id}` }, { status: 201 });
  });

  registerRoute('DELETE', `${base}/{bundleId}/tokens/{tokenId}`, async (_req, params) => {
    const lista = distribuicaoDb.tokens[params.bundleId];
    if (lista === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    const alvo = lista.find((t) => t.token_id === params.tokenId);
    if (alvo === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    // Revogar NÃO remove da lista: o registro mantém para auditoria, e a tela precisa refletir
    // isso, senão o operador acha que o token sumiu do histórico.
    alvo.revoked_at = '2026-08-04T12:05:00.000Z';
    return Response.json({ revoked: true });
  });

  registerRoute('PUT', `${base}/{bundleId}/items`, async (req, params) => {
    const alvo = distribuicaoDb.bundles.find((b) => b.bundle_id === params.bundleId);
    if (alvo === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    const body = (await req.json()) as { items?: { skill_id: string; channel: string }[] };
    if (!Array.isArray(body.items)) {
      return Response.json({ code: 'INVALID_REQUEST', message: 'items deve ser uma lista' }, { status: 400 });
    }
    // SUBSTITUI, não mescla — como o registro. Um mock que mesclasse deixaria a tela verde sobre
    // um contrato que não existe, e a remoção só falharia contra o serviço real.
    alvo.items = body.items;
    return Response.json({ bundle_id: params.bundleId, items: alvo.items });
  });

  registerRoute('GET', `${base}/{bundleId}/adoption`, async (_req, params) => {
    const dados = distribuicaoDb.adoption[params.bundleId];
    if (dados === undefined) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(dados);
  });
}
