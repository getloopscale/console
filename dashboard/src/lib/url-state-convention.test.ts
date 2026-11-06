// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-046 / ADR-0010 — num arquivo que usa `nuqs`, escrever a URL sem a forma
 * funcional apaga os filtros dele.
 *
 * ## O que este guard NÃO é
 *
 * Não é um guard de migração. O item pedia "escolha uma das duas
 * implementações", e a medição desmentiu a premissa: `nuqs` aparece em 7
 * arquivos, `useSearchParams` em 28, e **exatamente um** usa os dois —
 * `pages/lens/traces.tsx`, onde os dois estão certos e coordenados. Ver
 * `docs/adr/0010`.
 *
 * ## O que ele é
 *
 * A proteção do único caso perigoso. Num arquivo que mantém filtros no `nuqs`,
 * chamar `setSearchParams(novoObjeto)` — a forma NÃO funcional — substitui a
 * query inteira e apaga esses filtros. Em silêncio: a tela não quebra, ela só
 * perde o filtro que a pessoa tinha aplicado.
 *
 * A forma funcional `setSearchParams((prev) => …)` copia `prev` e preserva.
 * `traces.tsx:203` já fazia isso, com o comentário explicando por quê — este
 * guard é o que garante que o próximo também faça.
 *
 * ## A escapatória, e por que ela existe
 *
 * `traces.tsx:214` substitui a query inteira DE PROPÓSITO: aplicar uma visão
 * salva *é* trocar todos os filtros. Exigir a forma funcional ali seria pedir
 * que ele preservasse justamente o que o seu propósito é trocar.
 *
 * Então a substituição total é permitida quando DECLARADA com
 * `url-state: substituicao-total`. A declaração é o ponto: ela transforma uma
 * linha que parece igual à perigosa numa que diz que sabe o que faz.
 */

/** O marcador que declara uma substituição total intencional. */
const MARCADOR = 'url-state: substituicao-total';

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe('convenção de estado de URL (B-046 / ADR-0010)', () => {
  it('num arquivo com nuqs, toda escrita preserva os filtros ou declara que não', () => {
    const ofensores: string[] = [];

    for (const f of arquivos(SRC)) {
      const src = readFileSync(f, 'utf8');
      // Só arquivos onde o `nuqs` guarda estado — nos outros, substituir a query
      // inteira não apaga nada de ninguém.
      if (!src.includes("from 'nuqs'")) continue;

      const linhas = src.split('\n');
      linhas.forEach((linha, i) => {
        if (!/setSearchParams\(/.test(linha)) return;
        // A forma funcional preserva: `setSearchParams((prev) => …)`.
        if (/setSearchParams\(\s*\(/.test(linha)) return;
        // Declaração explícita de substituição total, na linha ou até 6 acima.
        const contexto = linhas.slice(Math.max(0, i - 6), i + 1).join('\n');
        if (contexto.includes(MARCADOR)) return;
        ofensores.push(`${relative(SRC, f).replace(/\\/g, '/')}:${i + 1}`);
      });
    }

    expect(
      ofensores,
      'Escrita de URL que apaga os filtros do `nuqs`, em silêncio.\n\n' +
        '`setSearchParams(novoObjeto)` substitui a query INTEIRA. Num arquivo onde o\n' +
        '`nuqs` guarda filtros, isso apaga o que a pessoa tinha aplicado — a tela não\n' +
        'quebra, ela só esquece.\n\n' +
        'Use a forma funcional, que copia o anterior:\n' +
        '    setSearchParams((prev) => { const next = new URLSearchParams(prev); … })\n\n' +
        `Se a substituição total for intencional (aplicar uma visão salva, por\n` +
        `exemplo), declare com o comentário \`${MARCADOR}\` — a declaração é o que\n` +
        'distingue a linha que sabe o que faz da que não sabe.\n\n' +
        'Ver docs/adr/0010 para quando usar `nuqs` e quando usar a primitiva.\n',
    ).toEqual([]);
  });

  it('as duas ferramentas coexistem — o guard NÃO proíbe isso', () => {
    const comNuqs = arquivos(SRC).filter((f) => readFileSync(f, 'utf8').includes("from 'nuqs'"));
    // A medição que originou o ADR: `nuqs` em 7 arquivos. Se este número for a
    // zero, alguém migrou tudo para a primitiva — o que o ADR-0010 rejeitou por
    // jogar fora parser e default de filtros tipados. O teste não impede; ele
    // faz a mudança ser deliberada em vez de acidental.
    expect(comNuqs.length).toBeGreaterThan(0);
  });
});
