#!/usr/bin/env node
/**
 * Prova que nenhum dos DOIS frameworks de mock embarca no bundle de produção.
 *
 * ## O defeito que isto corrige (B-067 / B-068)
 *
 * O `tree-shake-check` anterior era:
 *
 *     grep -q 'lib/mocks' dist/assets/*.js
 *
 * Ele procurava o **caminho do módulo**, e o empacotador apaga caminhos. Medido
 * em 2026-08-08: injetei `installAllMocks` em `main.tsx`, os mocks foram para o
 * bundle de produção, e o check imprimiu **PASS**. Uma verificação que não pode
 * falhar é pior que nenhuma — ela produz confiança sem cobertura, e ninguém
 * reabre um gate verde.
 *
 * ## Por que dois marcadores
 *
 * São dois frameworks com caminhos de eliminação **diferentes**:
 *
 * - `lib/mocks/` — importado dinamicamente em `main.tsx`, atrás do flag
 *   `VITE_USE_MOCKS`. Marcado por `MOCKS_BUNDLE_SENTINEL` (`fixtures.ts`).
 * - `lib/mocks/dev-mocks.ts` — importado **estaticamente** por
 *   `lib/auth/session.ts:22` (`getMockSession`), que é código de autenticação
 *   sempre carregado. Depende de `mocksEnabled()` ser estaticamente falso em
 *   produção. Marcado por `DEV_MOCKS_BUNDLE_SENTINEL`.
 *
 * Um sentinela só provava metade, e era a metade com o caminho mais fácil.
 *
 * ## Por que literais de string
 *
 * Nome de função é renomeado pela minificação; literal de string sobrevive. E o
 * sentinela tem efeito de módulo (atribui a `globalThis`) porque um `export
 * const` que ninguém lê é removido — a marca sumiria exatamente quando deveria
 * aparecer, e o check voltaria a ser tautologia por outro caminho.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist/assets';

const MARCAS = [
  {
    marca: '__theo_mocks_present_in_bundle__',
    framework: 'lib/mocks/ (handlers + fixtures)',
    entrada: 'import dinâmico em main.tsx, atrás de VITE_USE_MOCKS',
    // Sentinela injetado, com efeito de módulo. Funciona aqui porque o módulo é
    // importado DINAMICAMENTE: o efeito não impede a eliminação do chunk, ele só
    // garante que a marca sobreviva se o chunk entrar.
    fonte: 'src/lib/mocks/fixtures.ts',
  },
  {
    marca: 'choose_method',
    framework: 'lib/mocks/dev-mocks.ts (Kratos)',
    entrada: 'import ESTÁTICO em lib/auth/session.ts (getMockSession)',
    // AQUI NÃO PODE SER SENTINELA INJETADO, e a diferença custou uma medição
    // errada: um marcador com efeito de módulo num arquivo importado
    // ESTATICAMENTE impede a própria eliminação que ele deveria verificar. Ao
    // acrescentá-lo, o dev-mocks passou a vazar — o check acusou um vazamento
    // que ele mesmo tinha causado.
    //
    // A marca certa é um literal que JÁ EXISTE nos dados do mock:
    // `state: 'choose_method'` é um estado de fluxo do Kratos que só aparece
    // aqui. Ele some com o resto quando a eliminação funciona, e sobrevive à
    // minificação quando não funciona — que é exatamente a pergunta.
    fonte: 'src/lib/mocks/dev-mocks.ts',
  },
];

let arquivos;
try {
  arquivos = readdirSync(DIST).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`FAIL: ${DIST} não existe — rode o build antes.`);
  process.exit(1);
}

if (arquivos.length === 0) {
  // Sem esta guarda, um dist vazio passaria: nenhuma marca encontrada em zero
  // arquivos é o mesmo resultado de nenhuma marca em cem. É a forma mais fácil
  // de o check voltar a não poder falhar.
  console.error('FAIL: nenhum .js em dist/assets — o build não produziu saída.');
  process.exit(1);
}

// Cada marca tem de EXISTIR no fonte que ela representa. Sem isto, apagar o
// literal do mock faria o check parar de provar qualquer coisa e continuar
// verde — a mesma classe de tautologia que ele veio substituir, por outro
// caminho.
for (const { marca, fonte } of MARCAS) {
  let src;
  try {
    src = readFileSync(fonte, 'utf8');
  } catch {
    console.error(`FAIL: fonte da marca não existe: ${fonte}`);
    process.exit(1);
  }
  if (!src.includes(marca)) {
    console.error(`FAIL: a marca '${marca}' sumiu de ${fonte}.`);
    console.error('Sem ela este check não prova nada. Escolha outro literal que');
    console.error('só exista nesse arquivo e atualize MARCAS.');
    process.exit(1);
  }
}

const conteudo = arquivos.map((f) => ({ f, src: readFileSync(join(DIST, f), 'utf8') }));
const vazados = [];

for (const { marca, framework, entrada } of MARCAS) {
  const onde = conteudo.filter(({ src }) => src.includes(marca)).map(({ f }) => f);
  if (onde.length > 0) vazados.push({ marca, framework, entrada, onde });
}

if (vazados.length > 0) {
  console.error('FAIL: código de mock no bundle de produção.\n');
  for (const v of vazados) {
    console.error(`  ${v.framework}`);
    console.error(`    marca:   ${v.marca}`);
    console.error(`    entrada: ${v.entrada}`);
    console.error(`    em:      ${v.onde.join(', ')}\n`);
  }
  console.error('São 3.400 linhas de respostas falsas. No bundle, elas não só');
  console.error('pesam: um caminho que as alcance em produção serve dado inventado');
  console.error('a quem confia na tela.');
  process.exit(1);
}

console.log(`PASS: ${MARCAS.length} frameworks de mock ausentes de ${arquivos.length} arquivos do bundle.`);
