#!/usr/bin/env node
/**
 * Catraca do knip (B-166).
 *
 * ## O que já é gate e o que não era
 *
 * `knip.json` existe e o projeto roda knip, mas nada FALHAVA com o resultado. Medido em
 * 2026-08-11: zero arquivos mortos e zero exports de runtime mortos — o codebase é limpo
 * nessa dimensão — e 85 TIPOS exportados sem nenhum importador, além de dependências usadas
 * e não declaradas.
 *
 * As duas últimas classes acabaram de ser zeradas. Esta catraca existe para que continuem
 * zeradas, e para que os 85 tipos só desçam.
 *
 * ## Por que tipo morto não é erro e mesmo assim conta
 *
 * Um tipo exportado sem importador não vai para o bundle e não quebra nada em produção. O
 * custo é de leitura: `lib/api/types.ts` tem 861 linhas e a maior parte descreve payloads
 * que ninguém consome, então quem procura o contrato de um endpoint lê o dobro do que
 * precisa e não sabe qual metade vale. Proibir produziria 85 supressões; congelar produz
 * uma direção.
 *
 * O teto só desce, como o orçamento de LoC (B-009/B-033) e a catraca de asserções (B-162).
 */
import { execFileSync } from 'node:child_process';

/**
 * Congelado em 2026-08-11, medido com `npx knip --no-progress`.
 *
 * 85 -> 84 em 2026-08-11 (fatia charts-primitive-honesty). Uma catraca que nunca aperta não é
 * catraca: o próprio erro abaixo instrui a baixar o teto quando o número desce, e este é o
 * primeiro registro disso acontecendo.
 *
 * 79 -> 31 em 2026-08-12 (B-245). Os 79 foram classificados um a um, e a maioria não era
 * dívida de desenho — era a palavra `export` sobrando:
 *
 *   54  tipos usados DENTRO do próprio módulo e exportados sem que ninguém agisse nisso.
 *       Tirar o `export` não muda comportamento, e o `tsc` é prova total sobre a afirmação:
 *       se algum tivesse importador, a compilação quebrava na hora. Três quebraram — e por
 *       isso o `tsc` roda antes de qualquer commit desta classe.
 *   2   `VerifiableAddress` e `AuthenticationMethod` estavam sendo contados DUAS VEZES: a
 *       declaração em `lib/api/types.ts` e o re-export em `lib/auth/session.ts:31`. São o
 *       mesmo tipo, e tirar o `export` da declaração quebra o re-export. O número 79 nunca
 *       foi de 79 tipos distintos.
 *
 * O QUE SOBRA NÃO É DA MESMA NATUREZA, e é por isso que o teto para em 31 e não em 0: vinte
 * dos 31 são `*Input`/`*Response` — o contrato de REQUISIÇÃO das escritas que o dashboard faz
 * de fato, com o corpo montado inline e sem tipo no call site. Apagá-los remove a única
 * descrição daqueles payloads; deixá-los exportados mantém uma descrição que nada confere.
 * A saída é usá-los, e isso é uma fatia própria (B-260), não uma linha nesta catraca.
 */
// 30 desde 2026-08-12: `ProjectCreateInput` ganhou importador quando
// `use-create-project.ts` passou a tipar o corpo do POST com ele (B-244/B-260).
// É a forma de resolver esta classe que o B-245 recomendou — usar o tipo, e não
// apagá-lo: apagar remove a única descrição do payload; usá-lo faz o compilador
// conferi-la contra o que é enviado.
const TETO_TIPOS = 30;

/** Estas classes foram zeradas e não voltam: uma dependência não declarada quebra o build de
 *  quem clona; um export duplicado é uma segunda porta para a mesma coisa. */
const DEVEM_SER_ZERO = ['Unlisted dependencies', 'Unlisted binaries', 'Duplicate exports', 'Unused files', 'Unused exports'];

function contar(saida, rotulo) {
  const m = saida.match(new RegExp(`^${rotulo} \\((\\d+)\\)`, 'm'));
  return m ? Number(m[1]) : 0;
}

// knip exits 0 with no findings and 1 with findings; any other outcome means it did not
// run. That used to read as a report with every count at zero — "OK" — so a knip that
// failed to install passed the gate while measuring nothing (getloopscale/loop-console#491).
// It runs from the pinned devDependency (`--no`: never install at run time), so every
// run measures with the same knip — an unpinned `npx knip` moved 30 to 31 on its own.
function rodarKnip() {
  try {
    return execFileSync('npx', ['--no', 'knip', '--no-progress'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const saida = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    if (e.status === 1 && /^[A-Z][A-Za-z ]+ \(\d+\)$/m.test(saida)) return saida;
    console.error('\nknip ratchet — knip did NOT run (status ' + e.status + '); nothing was measured:\n');
    console.error(saida.slice(0, 2000));
    process.exit(2);
  }
}

const saida = rodarKnip();
const falhas = [];
for (const rotulo of DEVEM_SER_ZERO) {
  const n = contar(saida, rotulo);
  if (n > 0) falhas.push(`${rotulo}: ${n} (deve ser 0)`);
}

const tipos = contar(saida, 'Unused exported types');
if (tipos > TETO_TIPOS) {
  falhas.push(
    `Unused exported types: ${tipos} (teto ${TETO_TIPOS}).\n` +
      '  Um tipo exportado sem importador custa leitura, não bytes. Se você adicionou um,\n' +
      '  a pergunta é se ele precisa ser exportado — a maioria destes não precisava.',
  );
}

if (falhas.length > 0) {
  console.error('\ncatraca do knip — FALHOU\n');
  for (const f of falhas) console.error(`  ${f}`);
  console.error(
    '\nSe o número DESCEU, é progresso: baixe TETO_TIPOS em scripts/check-knip-ratchet.mjs.\n',
  );
  process.exit(1);
}

console.log(`catraca do knip OK — tipos sem importador: ${tipos}/${TETO_TIPOS}, demais classes em zero`);
