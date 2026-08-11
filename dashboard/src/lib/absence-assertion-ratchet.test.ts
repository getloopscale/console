// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Catraca das asserções de AUSÊNCIA (B-162 · família F4).
 *
 * ## O defeito que isto trava
 *
 * `expect(queryBy…).toBeNull()` só prova alguma coisa quando o elemento consultado EXISTE no
 * caso que passa e SOME no que falha. Quando ele está ausente nos dois, a asserção é
 * satisfeita pelo comportamento correto e pelo defeito igualmente — e nenhuma mudança no
 * código pode torná-la vermelha.
 *
 * Não é hipótese. Medido em 2026-08-11, por execução, em quatro casos:
 *
 *   - o guard inteiro do gráfico de skills foi APAGADO e os 10 testes seguiram verdes,
 *     porque `CategoryBars` devolve um `<p>` e nenhuma tabela quando as barras estão vazias,
 *     e toda página deriva barras vazias numa leitura falha: `queryByRole('table')` é nulo
 *     nos dois mundos;
 *   - o piso do sliver de zero foi RESTAURADO e 18 testes seguiram verdes;
 *   - o `rendered()` de `capability-overview.test.ts` casa uma tag JSX dentro de um
 *     comentário — o buraco que o docblock dele diz ter fechado;
 *   - o gráfico de trust vinha verde com o catálogo QUEBRADO (B-227, já corrigido).
 *
 * ## Por que uma catraca e não uma proibição
 *
 * A forma não é errada em si: contra um elemento que existe no caso feliz ela é a asserção
 * certa. Proibi-la produziria 97 supressões e nenhuma leitura. O que é errado é a POPULAÇÃO
 * crescer sem ninguém olhar — então o número congela e só desce, como o orçamento de LoC
 * (B-009/B-033) já faz neste repositório.
 *
 * Ao corrigir um arquivo, baixe o teto. Ao adicionar um teste novo, prefira asserir a
 * ausência de um elemento que ESTÁ presente no caso que passa (um heading, um rótulo), e não
 * de um que some nos dois.
 */

const SRC = resolve(__dirname, '..');

/** `expect(queryBy…(…)).toBeNull()` / `.not.toBeInTheDocument()` e variantes. */
const ABSENCE_ONLY =
  /expect\(\s*(?:await\s+)?(?:screen\.|within\([^)]*\)\.)?queryBy[A-Za-z]+\(/;

/**
 * Congelado em 2026-08-11 com 98 arquivos, medido com este mesmo detector.
 *
 * O número só desce. Se subiu, um teste novo escolheu a forma que não falha — e a pergunta
 * a fazer não é "como faço o teto caber", é "existe um elemento presente no caso feliz que
 * eu possa asserir ausente?".
 */
const TETO = 98;

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'vendor') continue;
      out.push(...testFiles(full));
    } else if (/\.test\.tsx?$/.test(entry) && entry !== 'absence-assertion-ratchet.test.ts') {
      // Este arquivo cita as formas como literais no auto-teste; contar-se seria ruído.
      out.push(full);
    }
  }
  return out;
}

function arquivosComAusenciaSozinha(): string[] {
  return testFiles(SRC)
    .filter((f) => ABSENCE_ONLY.test(readFileSync(f, 'utf-8')))
    .map((f) => relative(SRC, f))
    .sort();
}

describe('catraca das asserções de ausência (F4)', () => {
  it('a população não cresce — o número só desce', () => {
    const atuais = arquivosComAusenciaSozinha();
    expect(
      atuais.length,
      `Arquivos usando \`expect(queryBy…)\` para afirmar ausência: ${atuais.length} (teto ${TETO}).\n\n` +
        'Se SUBIU: um teste novo escolheu uma forma que pode não conseguir falhar. Ela só prova\n' +
        'algo quando o elemento consultado existe no caso que PASSA. Prefira asserir a ausência\n' +
        'de um heading ou rótulo que o caso feliz renderiza.\n\n' +
        'Se DESCEU: é progresso, e o teto acima deve acompanhar.\n',
    ).toBeLessThanOrEqual(TETO);
  });

  it('o teto bate com o disco — sem folga onde crescer', () => {
    // Sem este caso o teto poderia ficar acima do real e a catraca viraria enfeite.
    expect(arquivosComAusenciaSozinha().length).toBe(TETO);
  });

  it('o detector consegue falhar', () => {
    // Um guard que ninguém viu falhar é um guard que ninguém sabe se funciona — e este
    // repositório embarcou quatro testes assim antes da revisão de 2026-08-11.
    for (const forma of [
      `expect(screen.queryByRole('table')).toBeNull();`,
      `expect(queryByText(/x/)).not.toBeInTheDocument();`,
      `expect(within(card).queryByLabelText('y')).toBeNull();`,
      `expect(await screen.queryByTestId('z')).toBeNull();`,
    ]) {
      expect(ABSENCE_ONLY.test(forma), `deveria ter marcado: ${forma}`).toBe(true);
    }
    for (const benigno of [
      `expect(screen.getByRole('table')).toBeInTheDocument();`,
      `const el = screen.queryByRole('table');`,
      `await screen.findByText(/x/);`,
    ]) {
      expect(ABSENCE_ONLY.test(benigno), `NÃO deveria ter marcado: ${benigno}`).toBe(false);
    }
  });
});
