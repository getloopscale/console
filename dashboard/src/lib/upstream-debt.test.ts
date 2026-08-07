import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = join(__dirname, '..', '..');

/**
 * Guardas de sunset para divida de UPSTREAM.
 *
 * Duas decisoes deste repositorio existem apenas porque um bug em `@usetheo/ui`
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
   * B-085 — tokens CSS vendorizados em src/vendor/usetheo-ui/.
   *
   * Existem porque @usetheo/ui@0.22 parou de publicar os specifiers CSS que
   * src/index.css importava, quebrando o build de todo consumidor. A alternativa
   * (downgrade de 8 versoes) quebraria as APIs de componente que o dashboard
   * inteiro usa. O README do diretorio declara a condicao de saida: "quando
   * @usetheo/ui publicar CSS exports de novo (fixes #10), delete".
   */
  it('o vendor de tokens CSS ainda e necessario (senao: apague src/vendor/usetheo-ui)', () => {
    let resolveu: boolean;
    try {
      require_.resolve('@usetheo/ui/preset.css');
      resolveu = true;
    } catch {
      resolveu = false;
    }

    expect(
      resolveu,
      'ATENCAO: `@usetheo/ui/preset.css` voltou a resolver — upstream #10 foi corrigido.\n' +
        'A razao de src/vendor/usetheo-ui/ existir acabou. Acao: importar os CSS do pacote\n' +
        'em src/index.css, apagar src/vendor/usetheo-ui/ e este teste, e fechar B-085.',
    ).toBe(false);
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
  it('o guard de Alert e o ban de lint existem em par (nunca um sem o outro)', async () => {
    // B-093 — RESOLVE a regra, nao casa substring no texto do config.
    //
    // O predicado anterior era
    //   eslintCfg.includes('no-restricted-imports') && eslintCfg.includes('Alert')
    // e passava verde com o ban do Alert APAGADO: hoje existem outras duas regras
    // `no-restricted-imports` (as fronteiras de camada de B-070) e a palavra
    // "Alert" aparece em quatro comentarios. Um revisor deletou o bloco inteiro do
    // ban e este teste nao acusou — ele prometia guardar o PAR e so via metade.
    //
    // `calculateConfigForFile` devolve a config EFETIVA, ja resolvida pela cascata
    // do flat config. E o unico jeito de perguntar "esta regra vale para este
    // arquivo?" sem reimplementar a resolucao — que e o que a substring tentava
    // fazer, e errava.
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: ROOT });
    // Um arquivo de FEATURE, nao o proprio guard: `alert-guard.tsx` tem override
    // que desliga a regra, entao perguntar por ele responderia sempre "off".
    const cfg = await eslint.calculateConfigForFile(join(ROOT, 'src/pages/settings/billing.tsx'));
    const regra = cfg.rules?.['no-restricted-imports'];
    const opcoes = Array.isArray(regra) ? regra[1] : undefined;
    const paths = (opcoes as { paths?: { name?: string; importNames?: string[] }[] } | undefined)?.paths ?? [];
    const banAtivo =
      Array.isArray(regra) &&
      regra[0] !== 0 &&
      regra[0] !== 'off' &&
      paths.some((p) => p.name === '@usetheo/ui' && (p.importNames ?? []).includes('Alert'));

    let guardExiste = true;
    try {
      readFileSync(join(ROOT, 'src', 'components', 'ui', 'alert-guard.tsx'), 'utf8');
    } catch {
      guardExiste = false;
    }

    expect(
      banAtivo,
      guardExiste
        ? 'O guard alert-guard.tsx existe mas o ban de lint sumiu: o caminho inseguro\n' +
          '(`Alert` cru de @usetheo/ui) voltou a ser importavel e o guard vira opcional.'
        : 'O ban de lint existe mas o guard alert-guard.tsx sumiu: o lint proibe o Alert\n' +
          'cru sem oferecer a alternativa. Se upstream #175 foi corrigido, remova os DOIS\n' +
          'juntos (e este teste) — e feche B-086.',
    ).toBe(guardExiste);
  });
});
