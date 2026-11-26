// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require_ = createRequire(import.meta.url);

/**
 * Guardas de sunset para divida de UPSTREAM.
 *
 * Duas decisoes deste repositorio existem apenas porque um bug em `@getloopscale/ui`
 * ainda nao foi corrigido. Ambas sao corretas hoje e bem documentadas — e ambas
 * tem a mesma falha de projeto: nada avisa quando a razao delas deixa de existir.
 *
 * Foi assim que o orcamento de 500 LoC virou folclore, citado por tres modulos e
 * definido em lugar nenhum. Uma regra sobrevive a propria justificativa quando a
 * justificativa nao e verificavel.
 *
 * Estes testes falham **quando o upstream for corrigido**. Falhar aqui nao e
 * regressao: e o sinal de que ha codigo a remover, chegando no dia em que passa a
 * ser removivel em vez de na proxima auditoria.
 */
describe('divida de upstream — guardas de sunset', () => {
  /**
   * B-085 — CSS tokens vendored in src/vendor/loopscale-ui/.
   *
   * They were vendored when @getloopscale/ui stopped publishing its CSS files. The package
   * publishes them again, and they now carry another palette: its `tokens.css` declares a
   * different `--primary` from the one this dashboard ships. Importing the package's file
   * would repaint the product, which is a design decision and not a cleanup.
   *
   * This guard fails on the day the two files agree. That day the vendored copy has no
   * reason to exist: import the package's CSS in src/index.css and delete the directory.
   */
  it('the vendored tokens still differ from the ones the package publishes', () => {
    const primaryOf = (file: string): string[] =>
      Array.from(readFileSync(file, 'utf-8').matchAll(/^\s*--primary:\s*([^;]+);/gm)).map((m) =>
        m[1].replace(/\/\*.*$/, '').trim(),
      );
    const published = primaryOf(require_.resolve('@getloopscale/ui/tokens.css'));
    const vendored = primaryOf(resolve(__dirname, '../vendor/loopscale-ui/tokens.css'));

    expect(published.length).toBeGreaterThan(0);
    expect(vendored.length).toBeGreaterThan(0);
    expect(
      published,
      'The package publishes the same `--primary` values as the vendored copy. Import its CSS in ' +
        'src/index.css, delete src/vendor/loopscale-ui/ and this test.',
    ).not.toEqual(vendored);
  });

  /**
   * B-086 — o guard local `src/components/ui/alert-guard.tsx`.
   *
   * O `Alert` do design system descarta `children` em silencio, entao
   * `<Alert>{corpo}</Alert>` embarcava erros so com titulo. O guard reencaminha
   * `children` como `description`. Um `no-restricted-imports` em eslint.config.js
   * proibe importar o `Alert` cru para que o caminho seguro seja o default.
   *
   * O par so funciona junto: o guard sem o ban e contornavel, e o ban sem o guard
   * proibe sem oferecer alternativa. Este teste falha se alguem remover um dos
   * dois sozinho — inclusive quando #175 for corrigido e a remocao correta for
   * dos DOIS.
   */
  // O caso "o guard de Alert e o ban de lint existem em par" MUDOU DE CASA (B-101).
  //
  // Ele vive agora em `scripts/check-guard-pairs.mjs`, chamado pelo `npm run lint`.
  // O motivo é medido, não estético: aqui dentro ele custava **10.676 ms isolado** contra um
  // `testTimeout` de 20.000 — margem de 1,87×, e qualquer contenção de worker acima disso o
  // reprovava numa execução completa enquanto ele passava sozinho. `new ESLint()` +
  // `calculateConfigForFile` carrega o flat config inteiro e o grafo de plugins junto: é um
  // processo de análise estática subindo dentro de um worker do vitest.
  //
  // Subir o timeout teria escondido a causa até a suíte crescer de novo. O que estava errado
  // era o lugar — a afirmação é sobre a CONFIGURAÇÃO DE LINT, não sobre comportamento da
  // aplicação, e pertence ao gate onde o custo do ESLint já está pago.
});
