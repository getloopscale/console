// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchRoute, resetRoutes } from './server';
import { registerAllMockHandlers, resetMockDB } from './handlers';
import { CAPACIDADES, estadoDaCapacidade } from '@/pages/overview/capabilities';

/**
 * O ambiente onde a Overview de plataforma é validada (B-112, fase 3).
 *
 * ## O defeito que este arquivo trava
 *
 * Medido em 2026-08-10: `memory/metrics`, `rag/analytics`, `lens/observability` e
 * `storage/usage` **não tinham mock**. Em modo mock elas escapavam para o proxy do Vite e
 * voltavam 500 — que é como a medição do DISCOVER as encontrou.
 *
 * O custo não é estético. A DoD do item exige que "não consegui ler" e "não adotada" sejam
 * distinguíveis na tela, e no único ambiente onde alguém valida telas quatro de sete capacidades
 * mostravam a mesma coisa: erro. Quem valida não distingue produto de ambiente — e a decisão D5
 * de `platform-overview-plan.md` é o que fecha isso.
 *
 * ## Por que quantificar sobre o registro
 *
 * Listar as quatro rotas aqui passaria verde no dia em que a nona capacidade chegasse com sinal e
 * sem mock — o mesmo defeito, um nível acima, que é a forma como estas quatro nasceram.
 */

function rotasDeclaradas(): string[] {
  return CAPACIDADES.flatMap((c) => ('rota' in c.sinal ? [c.sinal.rota] : []));
}

beforeEach(() => {
  resetRoutes();
  resetMockDB();
  registerAllMockHandlers();
});

afterEach(() => {
  resetRoutes();
  resetMockDB();
});

describe('toda capacidade da Overview é legível em modo mock', () => {
  it('nenhuma rota declarada escapa para o proxy', () => {
    const semHandler = rotasDeclaradas().filter(
      (rota) => matchRoute('GET', rota.split('?')[0]) === null,
    );

    expect(
      semHandler,
      'Rota de capacidade SEM handler de mock.\n\n' +
        'Em modo mock ela escapa para o proxy do Vite e volta 500, e o card da capacidade\n' +
        'mostra "couldn\'t load". Quem valida a tela não consegue distinguir isso de um\n' +
        'defeito do produto — que é a confusão exata que esta fase existe para remover.\n',
    ).toEqual([]);
  });

  it('cada rota responde 200 com um corpo que o extrator da capacidade sabe ler', async () => {
    // A parte que o registro sozinho não prova. Um handler registrado que devolve `{}` deixa a
    // rota "coberta" e o card em `nao-lida` — mock presente, defeito idêntico.
    for (const c of CAPACIDADES) {
      if (!('rota' in c.sinal)) continue;
      const pathname = c.sinal.rota.split('?')[0];
      const casado = matchRoute('GET', pathname);
      expect(casado, `sem handler para ${c.path}`).not.toBeNull();

      const res = await casado!.route.handler(
        new Request(`https://test${c.sinal.rota}`),
        casado!.params,
      );
      expect(res.status, `${c.path} → ${c.sinal.rota}`).toBe(200);

      const dados: unknown = await res.json();
      const estado = estadoDaCapacidade(c.sinal, { failed: false, loading: false, dados });

      // `em-uso` e não apenas "não é nao-lida": um fixture com zero deixaria a tela dizendo "not
      // set up yet" para tudo, e o estado `em-uso` — o que o dono quer ver ao validar — nunca
      // seria exercitável sem backend.
      expect(estado, `${c.path} → ${c.sinal.rota} devolveu um corpo que não vira 'em-uso'`).toBe(
        'em-uso',
      );
    }
  });
});
