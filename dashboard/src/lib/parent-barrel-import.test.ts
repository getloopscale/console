// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, basename } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-001 — nenhum arquivo dentro de `X/` importa o barril pai `X`.
 *
 * ## O defeito
 *
 * `src/pages/lens/` tinha oito ciclos de import, e sete deles compartilhavam a
 * mesma forma: uma página exportava tipos e helpers do seu domínio, e os filhos
 * dentro da pasta homônima voltavam a importar do pai para consumi-los.
 *
 * `playground.tsx` importava `asChat` de `./trace-detail` — o shim pai — enquanto
 * `trace-detail/span-detail.tsx` importava de `../playground`. Cada um pegando o
 * atalho mais curto, e o laço fechando sem que ninguém decidisse por ele.
 *
 * Ciclo de import não é estilo: em ESM ele produz TDZ ("Cannot access X before
 * initialization"), e este repositório já documenta essa falha derrubando o SPA
 * inteiro para tela branca — ver o bloco de `manualChunks` em
 * `src/build/manual-chunks.ts`, escrito depois de acontecer.
 *
 * ## Por que um teste e não uma regra de ESLint
 *
 * O DoD do item pedia `import/no-internal-modules` ou `dependency-cruiser`.
 * Nenhum dos dois está instalado, e o `no-restricted-imports` nativo não
 * expressa esta regra: o alvo proibido depende do DIRETÓRIO DO PRÓPRIO ARQUIVO,
 * e a configuração é por glob de arquivo, não relativa. Expressá-la em ESLint
 * exigiria um bloco por diretório — N regras que envelhecem uma a uma.
 *
 * É a mesma conclusão que o `ADR-0001 D5` já tinha registrado para a regra de
 * residência, e o repositório tem o idioma pronto.
 *
 * ## O que ele NÃO cobre
 *
 * Ciclos que não passam pelo barril pai. Para esses, o instrumento é o madge —
 * e `.madgerc` liga `skipAsyncImports` para que ele responda "há ciclo de
 * INICIALIZAÇÃO?" em vez de "há laço no grafo?", que são perguntas diferentes
 * quando uma das arestas é um `import()` de code-splitting.
 */

function arquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) arquivos(full, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

describe('import do barril pai (B-001)', () => {
  it('nenhum arquivo dentro de X/ importa o módulo X', () => {
    const ofensores: string[] = [];

    for (const f of arquivos(SRC)) {
      const pasta = dirname(f);
      const nomeDaPasta = basename(pasta);
      const rel = relative(SRC, f).replace(/\\/g, '/');
      const src = readFileSync(f, 'utf8');

      for (const m of src.matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'/g)) {
        const spec = m[1] ?? m[2];
        if (!spec) continue;

        // `../<pasta>` a partir de dentro de `<pasta>/` é o pai homônimo.
        const alvoRelativo = spec === `../${nomeDaPasta}`;
        // `@/…/<pasta>` idem, quando o caminho absoluto termina no nome da pasta.
        const alvoAlias =
          spec.startsWith('@/') &&
          spec.replace(/\.(ts|tsx)$/, '').endsWith(`/${nomeDaPasta}`) &&
          relative(SRC, pasta).replace(/\\/g, '/').endsWith(nomeDaPasta);

        if (alvoRelativo || alvoAlias) ofensores.push(`${rel} → ${spec}`);
      }
    }

    expect(
      ofensores,
      'Arquivo dentro de `X/` importando o módulo `X` — o barril pai.\n\n' +
        'Foi essa a forma de sete dos oito ciclos de `pages/lens`: a página exporta\n' +
        'domínio e os filhos voltam ao pai para consumi-lo. Cada um pega o atalho\n' +
        'mais curto e o laço fecha sem ninguém decidir por ele.\n\n' +
        'Ciclo de import não é estilo: em ESM produz TDZ, e este repositório já\n' +
        'documenta essa falha derrubando o SPA para tela branca (ver o bloco de\n' +
        '`manualChunks`).\n\n' +
        'Correção: importe do LEAF, não do barril. `./trace-detail/helpers` em vez\n' +
        'de `./trace-detail`. Se o símbolo não estiver num leaf, ele precisa de um.\n',
    ).toEqual([]);
  });
});
