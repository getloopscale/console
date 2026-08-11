import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-024 / B-054 / B-057 — toda leitura de coleção declara um teto.
 *
 * ## O defeito, três vezes
 *
 * A auditoria pedia o histórico inteiro. As entidades de memória vinham todas e
 * a paginação acontecia no cliente — a barra de páginas dava a impressão de que
 * o servidor mandava uma página. O grafo vinha inteiro e o cliente reduzia
 * depois. Três telas, o mesmo formato: trabalho de rede e de memória feito para
 * ser jogado fora.
 *
 * O custo cresce com o uso. Quem tem mais dados — o cliente que mais usa o
 * produto — é quem paga primeiro, e a tela parece rápida em desenvolvimento
 * porque a base de teste é pequena.
 *
 * ## Por que quantificar
 *
 * Corrigir as três não impede a quarta. Este teste varre as leituras de coleção
 * e falha quando uma sai sem teto — a classe, não os casos.
 *
 * ## O que ele NÃO prova
 *
 * Que o servidor HONRA o `limit`. Vários endpoints vivem na engine, outro
 * repositório, e daqui não dá para verificar. Mandar um teto que o servidor
 * ignora é inofensivo; não mandar é que garante o pior caso. O teste cobre o
 * lado que este repositório controla, e dizer isso é parte do contrato dele.
 *
 * Também não cobre leitura de RECURSO ÚNICO (`/traces/{id}`), que não tem
 * cardinalidade para limitar — a heurística abaixo as exclui por terem `${` no
 * caminho ou não terminarem em plural.
 */

/** Caminhos de coleção conhecidos que legitimamente não paginam. */
const SEM_TETO_JUSTIFICADO = new Set([
  // Listas de cardinalidade fixa pelo domínio — o teto seria maior que o total.
  '/v1/dashboard/rag/collections', // uma workspace tem unidades, não milhares
  '/v1/dashboard/lens/datasets',
  '/v1/dashboard/lens/evaluators',
  '/v1/dashboard/lens/alert-rules',
  '/v1/dashboard/status/versions', // um por serviço do produto
  '/v1/billing',
  '/v1/auth/me',
  // Agregações, não coleções. A heurística abaixo as pega por terminarem em `s`;
  // um `limit` aqui não significaria nada — a resposta é um objeto de métricas,
  // não uma lista cuja cardinalidade cresça com o uso.
  '/v1/dashboard/memory/metrics',
  '/v1/dashboard/rag/analytics',
  '/v1/dashboard/storage/usage',
]);

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe('teto explícito nas leituras de coleção (B-024/B-054/B-057)', () => {
  it('nenhuma leitura de coleção sai sem limit', () => {
    const ofensores: string[] = [];

    for (const f of arquivos(SRC)) {
      if (f.includes('/lib/mocks/')) continue; // o mock É o servidor aqui
      const src = readFileSync(f, 'utf8');
      const rel = relative(SRC, f).replace(/\\/g, '/');

      // Só LEITURAS. Uma mutation não tem cardinalidade a limitar, e incluí-las
      // fazia o guard apontar `use-domains.ts` (POST/DELETE) como se pedisse uma
      // coleção — barulho que faria alguém desligar o teste em vez de atendê-lo.
      //
      // O discriminador é o segundo argumento: `{ method: 'POST' }`. Captura 120
      // caracteres depois do caminho para vê-lo.
      for (const m of src.matchAll(/(?:cloudFetch|engineFetch)<[^>]*>\(\s*[`']([^`'${]+)[`'][^)]{0,120}/g)) {
        if (/method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(m[0])) continue;
        const caminho = m[1].split('?')[0].replace(/\/$/, '');
        if (SEM_TETO_JUSTIFICADO.has(caminho)) continue;
        // Recurso único não tem cardinalidade a limitar.
        const ultimo = caminho.split('/').filter(Boolean).pop() ?? '';
        if (!/s$/.test(ultimo) && !/list|graph|audit|traces|history/.test(ultimo)) continue;

        // O teto pode estar no literal (`?limit=`) ou montado com URLSearchParams
        // no mesmo escopo — a busca é no arquivo, deliberadamente frouxa: o alvo
        // é a ausência total, não a forma exata.
        const temTeto = /[?&]limit=/.test(src) || /params\.set\(\s*'limit'/.test(src);
        if (!temTeto) ofensores.push(`${rel} → ${caminho}`);
      }
    }

    expect(
      ofensores,
      'Leitura de coleção sem teto. O request pede o conjunto inteiro, e o custo\n' +
        'cresce com o uso: quem tem mais dados paga primeiro, e a tela parece\n' +
        'rápida em desenvolvimento porque a base de teste é pequena.\n\n' +
        'Mande `limit` (e `offset` quando houver paginação). Se o servidor ignorar,\n' +
        'não custa nada; se honrar, fecha o pior caso.\n\n' +
        'Se a coleção tem cardinalidade fixa pelo domínio, acrescente o caminho a\n' +
        'SEM_TETO_JUSTIFICADO com o motivo.\n',
    ).toEqual([]);
  });
});
