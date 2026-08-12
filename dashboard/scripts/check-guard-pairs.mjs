#!/usr/bin/env node
/**
 * O guard `alert-guard.tsx` e o ban de lint do `Alert` cru existem em PAR — nunca um sem o
 * outro. Este arquivo é o gate que verifica isso.
 *
 * ## Por que isto não é um teste (B-101)
 *
 * Era. Vivia em `src/lib/upstream-debt.test.ts` e falhava de forma intermitente: reprovava
 * numa execução completa e passava isolado, com o detector de árvore instável (B-099)
 * silencioso — a árvore estava estável, então não era aquilo.
 *
 * **A causa, medida em 2026-08-10:** o caso gasta **10.676 ms ISOLADO**, sem contenção
 * nenhuma, contra um `testTimeout` de 20.000 ms. A margem é de 1,87× — qualquer contenção
 * de worker acima desse fator vira vermelho. Não era misteriosa: `new ESLint()` +
 * `calculateConfigForFile` carrega o flat config inteiro e, com ele, todo o grafo de
 * plugins. Um processo de análise estática subindo dentro de um worker do vitest, junto com
 * outros 2763 testes disputando os mesmos núcleos.
 *
 * Subir o timeout teria feito o vermelho sumir sem tirar a causa — e o vermelho voltaria no
 * dia em que a suíte crescesse mais. O que estava errado era o LUGAR: isto afirma uma
 * propriedade da **configuração de lint**, não do comportamento da aplicação. Sai do gate de
 * testes e entra no gate de lint, onde o custo de carregar o ESLint já está pago e onde a
 * afirmação pertence.
 *
 * Efeito colateral bem-vindo: a suíte unitária fica ~10,7 s mais rápida.
 *
 * ## O que ele afirma, e por que não casa substring
 *
 * O predicado original era `cfg.includes('no-restricted-imports') && cfg.includes('Alert')`
 * — e passava verde com o ban APAGADO, porque hoje existem outras duas regras
 * `no-restricted-imports` (as fronteiras de camada de B-070) e a palavra "Alert" aparece em
 * quatro comentários. Alguém deletou o bloco inteiro do ban e nada acusou.
 *
 * `calculateConfigForFile` devolve a config EFETIVA, já resolvida pela cascata do flat
 * config. É o único jeito de perguntar "esta regra vale para este arquivo?" sem
 * reimplementar a resolução — que é o que a substring tentava fazer, e errava (Regra 9).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const eslint = new ESLint({ cwd: ROOT });

// Um arquivo de FEATURE, não o próprio guard: `alert-guard.tsx` tem override que desliga a
// regra, então perguntar por ele responderia sempre "off".
const cfg = await eslint.calculateConfigForFile(
  join(ROOT, 'src/pages/settings/billing.tsx'),
);

const regra = cfg.rules?.['no-restricted-imports'];
const opcoes = Array.isArray(regra) ? regra[1] : undefined;
const paths = opcoes?.paths ?? [];
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

if (banAtivo !== guardExiste) {
  console.error(
    guardExiste
      ? 'O guard alert-guard.tsx existe mas o ban de lint sumiu: o caminho inseguro\n' +
          '(`Alert` cru de @usetheo/ui) voltou a ser importável e o guard vira opcional.'
      : 'O ban de lint existe mas o guard alert-guard.tsx sumiu: o lint proíbe o Alert\n' +
          'cru sem oferecer a alternativa. Se upstream #175 foi corrigido, remova os DOIS\n' +
          'juntos (e este gate) — e feche B-086.',
  );
  process.exit(1);
}
