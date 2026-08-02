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
      create_time: '2026-07-01T10:00:00Z',
      update_time: '2026-08-01T10:00:00Z',
    },
    {
      skill_id: 'sk_local',
      name: 'Preparar ambiente local',
      description: 'Traz script e roda na máquina do cliente.',
      state: 'live',
      latest_revision_id: 'rev_local_1',
      category: 'operação',
      execution: 'local',
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
  registerRoute('GET', base, async () =>
    Response.json({ skills: skillsDb.skills, next_page_token: null }),
  );

  registerRoute('GET', `${base}/{skillId}`, async (_req, params) => {
    const skill = skillsDb.skills.find((s) => s.skill_id === params.skillId);
    // 404 cobre inexistente e alheia — indistinguíveis de propósito, como no serviço real:
    // um 403 confirmaria a existência de uma skill cujo nome é adivinhável.
    return skill ? Response.json(skill) : Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  });

  registerRoute('GET', `${base}/{skillId}/versions`, async (_req, params) =>
    Response.json({ versions: skillsDb.versions[params.skillId] ?? [] }),
  );

  registerRoute('GET', `${base}/{skillId}/channels`, async (_req, params) =>
    Response.json({ channels: skillsDb.channels[params.skillId] ?? [] }),
  );

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
