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

/**
 * B-242 — a métrica AFIADA, ao lado da contagem por arquivo.
 *
 * A catraca por arquivo conta uma FORMA. O defeito que este arquivo descreve é uma propriedade
 * de cada ASSERÇÃO: `queryBy…` só prova algo quando o elemento consultado EXISTE no caso que
 * passa. Isso é mensurável — basta perguntar se o mesmo seletor é asserido PRESENTE em algum
 * caso do arquivo.
 *
 * Medido 2026-08-12 sobre os 373 arquivos de teste:
 *
 *   327  asserções de ausência
 *   211  ancoradas — o seletor é asserido presente em algum caso, logo a asserção PODE falhar
 *   116  SEM ÂNCORA, em 58 arquivos  <- o número que importa
 *
 * A contagem por arquivo (98) é quase o dobro do defeito: mais da metade das asserções já era
 * sólida pelo critério que o docstring acima enuncia.
 *
 * POR QUE AS DUAS COEXISTEM: a de arquivo impede que um arquivo NOVO entre despercebido; esta
 * mede o que realmente falta corrigir, e faz o trabalho aparecer. Ancorar uma asserção não
 * remove o arquivo da primeira contagem, então sem esta métrica um dia inteiro de correções
 * legítimas se reporta como zero progresso.
 *
 * HEURÍSTICA, e erra nos dois sentidos: compara o núcleo literal do seletor dentro do MESMO
 * arquivo. Um seletor montado a partir de variável conta como sem âncora sem ser; dois
 * seletores que compartilham prefixo contam como ancorados sem ser. Serve para dimensionar e
 * para mostrar progresso — NÃO para reescrever nada mecanicamente. Cada uma das 116 tem de ser
 * lida, e a prova de que uma migração é real é apagar a guarda que ela protege e ver o teste
 * ficar VERMELHO.
 */
const TETO_SEM_ANCORA = 116;

const CONSULTA = /(?:screen\.|within\([^)]*\)\.)?queryBy([A-Za-z]+)\(\s*([^)]*?)\s*\)/g;

/** O núcleo literal de um seletor: o primeiro trecho citado com pelo menos 4 caracteres. */
function nucleo(seletor: string): string | null {
  const m = /[/'"`]([^/'"`]{4,})/.exec(seletor);
  return m ? m[1].slice(0, 18) : null;
}

function asserçõesSemAncora(): number {
  const escapar = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let sem = 0;
  for (const f of testFiles(SRC)) {
    const fonte = readFileSync(f, 'utf-8');
    if (!ABSENCE_ONLY.test(fonte)) continue;
    for (const m of fonte.matchAll(CONSULTA)) {
      const tipo = m[1];
      const seletor = m[2].trim();
      if (!seletor) continue;
      const n = nucleo(seletor);
      const ancorada =
        n !== null &&
        new RegExp(`(?:get|find)(?:All)?By${tipo}\\([^)]*${escapar(n)}`).test(fonte);
      if (!ancorada) sem++;
    }
  }
  return sem;
}

describe('catraca das asserções SEM ÂNCORA (B-242)', () => {
  it('o número só desce — uma asserção nova nasce ancorada', () => {
    expect(
      asserçõesSemAncora(),
      `\nAsserções de ausência cujo seletor NUNCA é asserido presente no arquivo: ` +
        `${String(asserçõesSemAncora())} (teto ${String(TETO_SEM_ANCORA)}).\n\n` +
        'Se SUBIU: uma asserção nova consulta algo que nenhum caso do arquivo mostra, então ela\n' +
        'é satisfeita pelo comportamento certo e pelo defeito igualmente. Ancore-a: assere o\n' +
        'MESMO seletor presente no caso que o renderiza.\n\n' +
        'Se DESCEU: é progresso, e o teto acima deve acompanhar.\n',
    ).toBeLessThanOrEqual(TETO_SEM_ANCORA);
  });

  it('o teto bate com o disco', () => {
    expect(asserçõesSemAncora()).toBe(TETO_SEM_ANCORA);
  });

  it('DETECTA uma asserção sem âncora, e NÃO acusa uma ancorada', () => {
    // O auto-teste que impede este guarda de virar enfeite: se `nucleo` ou a comparação
    // pararem de discriminar, este caso fica vermelho.
    const semAncora = "expect(screen.queryByText(/nada aqui/i)).toBeNull();";
    const ancorada =
      "expect(await screen.findByText(/nada aqui/i)).toBeInTheDocument();\n" + semAncora;
    const escapar = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const testar = (fonte: string) => {
      for (const m of fonte.matchAll(CONSULTA)) {
        const n = nucleo(m[2].trim());
        return (
          n !== null &&
          new RegExp(`(?:get|find)(?:All)?By${m[1]}\\([^)]*${escapar(n)}`).test(fonte)
        );
      }
      return false;
    };

    expect(testar(semAncora)).toBe(false);
    expect(testar(ancorada)).toBe(true);
  });
});

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
