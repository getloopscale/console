import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', '..');

/**
 * B-019 / B-011 / B-036 — duas convenções de query key podem coexistir, desde
 * que nunca para o MESMO recurso.
 *
 * ## O que foi medido, e a premissa que caiu
 *
 * O item conta 208 sites: 130 com a tupla `['cloud', '/v1/...']`, 25 com
 * `queryKeys.*`, o resto disperso. A leitura óbvia — "as duas formas não se
 * cruzam, logo a invalidação está quebrada" — foi verificada e **não se
 * sustenta**: os 9 recursos que usam a factory a usam de ponta a ponta, e os
 * domínios que usam tupla literal não têm entrada na factory. Não há bug ativo.
 *
 * O risco é de composição, e é o que este arquivo guarda: no dia em que alguém
 * criar `queryKeys.skills` enquanto as telas de skills leem
 * `['cloud','/v1/dashboard/skills']`, nascem duas ilhas de cache que nenhuma
 * invalidação atravessa — e o sintoma é a tela mostrando o estado anterior, sem
 * erro e sem log.
 *
 * Não é hipótese. Esta sessão corrigiu **quatro** bugs exatamente assim
 * (domínios, times, ambientes), e os comentários de `query-keys.ts` registram
 * dois deles. Todos foram encontrados por acaso; nenhum tinha teste.
 *
 * ## O que este arquivo prova
 *
 * 1. Invalidação por prefixo alcança a chave que `use-api.ts` produz — o bullet
 *    literal do `dod` de B-019.
 * 2. Nenhum recurso tem as DUAS convenções ao mesmo tempo.
 * 3. Ninguém inventa um terceiro prefixo.
 *
 * ## O que ele NÃO prova
 *
 * Que a invalidação de uma mutation específica alcança a query certa — isso é
 * por caso, e `use-domains.test.tsx` / `use-team.test.tsx` cobrem os que já
 * quebraram. Aqui o alvo é a forma, não o par escrita-leitura.
 */
function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

const producao = () => arquivos(SRC).filter((f) => !/\.(test|spec)\.(ts|tsx)$/.test(f));

describe('convergência de query key (B-019/B-011/B-036)', () => {
  it('invalidação por prefixo alcança a chave que use-api produz', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    // A forma exata que `useCloudApi` monta: ['cloud', path, ...params].
    const comParams = ['cloud', '/v1/dashboard/skills', { q: 'db' }] as const;
    qc.setQueryData(comParams, { itens: [] });

    // Uma mutation invalida pelo prefixo do recurso, sem conhecer os params.
    await qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/skills'] });

    expect(
      qc.getQueryState(comParams)?.isInvalidated,
      'Invalidar por prefixo não alcançou a query com params. Se isto falhar, toda\n' +
        'mutation que invalida sem repetir os filtros da tela deixa cache velho.',
    ).toBe(true);
  });

  it('invalidar um recurso NÃO alcança outro — o prefixo precisa discriminar', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const outro = ['cloud', '/v1/dashboard/rag/collections'] as const;
    qc.setQueryData(outro, { itens: [] });
    await qc.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/skills'] });
    expect(
      qc.getQueryState(outro)?.isInvalidated,
      'O guarda do lado oposto: uma invalidação larga demais refetcha a aplicação\n' +
        'inteira a cada escrita, o que é pior que o defeito que ela conserta.',
    ).toBe(false);
  });

  it('nenhum recurso usa as DUAS convenções ao mesmo tempo', async () => {
    const { queryKeys } = await import('./query-keys');
    const naFactory = Object.keys(queryKeys as Record<string, unknown>);

    // Caminho literal -> arquivos que o usam.
    const literais = new Set<string>();
    for (const f of producao()) {
      for (const m of readFileSync(f, 'utf8').matchAll(/queryKey:\s*\[\s*'(?:cloud|engine)',\s*[`']([^`'?]+)/g)) {
        literais.add(m[1]);
      }
    }

    const conflitos: string[] = [];
    for (const rec of naFactory) {
      // `projectStatus` -> `project-status`; o recurso costuma aparecer no path.
      const alvo = rec.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      const raiz = alvo.split('-')[0];
      // Compara o ÚLTIMO segmento, não qualquer ancestral. `/api/v1/projects/build-envs`
      // é o recurso `build-envs` morando sob `/projects/` — ninguém o invalidaria por
      // `queryKeys.projects`, e tratá-lo como conflito faz o guard gritar onde não há
      // defeito. Um guard que grita à toa é desligado, e aí não guarda nada.
      const casados = [...literais].filter((p) => {
        const ultimo = p.split('/').filter(Boolean).pop();
        return ultimo === alvo || ultimo === raiz;
      });
      if (casados.length > 0) conflitos.push(`queryKeys.${rec} coexiste com tupla literal em: ${casados.join(', ')}`);
    }

    expect(
      conflitos,
      'Um recurso com as DUAS convenções tem duas ilhas de cache, e nenhuma\n' +
        'invalidação atravessa entre elas. Escolha UMA para o recurso:\n' +
        '  - se as telas já usam a tupla literal, NÃO crie a entrada na factory;\n' +
        '  - se criar a entrada, migre as telas do recurso na mesma mudança.\n' +
        'Ver B-019, e os comentários de query-keys.ts sobre B-018/B-060, que são\n' +
        'dois bugs desta classe que já custaram uma correção cada.\n',
    ).toEqual([]);
  });

  it('nenhum site inventa um terceiro prefixo', () => {
    const PERMITIDOS = new Set(['cloud', 'engine']);
    const ofensores: string[] = [];
    for (const f of producao()) {
      for (const m of readFileSync(f, 'utf8').matchAll(/queryKey:\s*\[\s*'([a-z][a-z0-9-]*)'/g)) {
        if (!PERMITIDOS.has(m[1])) ofensores.push(`${f.replace(SRC + '/', '')} -> '${m[1]}'`);
      }
    }
    expect(
      ofensores,
      'Query key literal com prefixo fora de {cloud, engine}. Um terceiro prefixo\n' +
        'cria uma terceira ilha de cache que nenhuma invalidação existente alcança.\n' +
        'Se for deliberado, a entrada tem de nascer na factory, não como literal solto.\n',
    ).toEqual([]);
  });
});
