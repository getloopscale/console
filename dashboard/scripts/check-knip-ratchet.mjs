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

/** Congelado em 2026-08-11, medido com `npx knip --no-progress`. */
const TETO_TIPOS = 85;

/** Estas classes foram zeradas e não voltam: uma dependência não declarada quebra o build de
 *  quem clona; um export duplicado é uma segunda porta para a mesma coisa. */
const DEVEM_SER_ZERO = ['Unlisted dependencies', 'Unlisted binaries', 'Duplicate exports', 'Unused files', 'Unused exports'];

function contar(saida, rotulo) {
  const m = saida.match(new RegExp(`^${rotulo} \\((\\d+)\\)`, 'm'));
  return m ? Number(m[1]) : 0;
}

function rodarKnip() {
  try {
    return execFileSync('npx', ['knip', '--no-progress'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // knip sai != 0 quando encontra qualquer coisa; a saída é o que interessa.
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
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
