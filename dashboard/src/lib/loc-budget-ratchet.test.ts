import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAIZ = resolve(__dirname, '../..');
const CONFIG = resolve(RAIZ, 'eslint.config.js');

/**
 * B-009 / B-033 — a allowlist de `max-lines` é uma lista de NOMES, não de
 * orçamentos. Este teste a transforma numa catraca.
 *
 * ## O que foi medido
 *
 * `eslint.config.js` tem `max-lines: 500` com 18 arquivos isentos, cada um com
 * o seu tamanho anotado em comentário e a regra escrita ali: *"cada linha sai
 * daqui quando o arquivo for decomposto; nenhuma linha nova entra sem ADR"*.
 *
 * A regra cobre quem ENTRA. Não cobre quem já está dentro — e em 2026-08-07,
 * **oito dos dezoito tinham crescido** desde que entraram:
 *
 * - `lib/mocks/handlers.ts` +78
 * - `lib/api/types.ts` +48
 * - `pages/memory/graph.tsx` +26
 * - `app.tsx` +22
 * - e mais quatro por 1 linha cada
 *
 * A dívida estava registrada e ilimitada. Um arquivo entra a 757 linhas e chega
 * a 1500 sem que nada acuse, porque a isenção não tem número.
 *
 * ## O que este teste faz
 *
 * O número no comentário vira **teto**. Ele só desce: decompor um arquivo baixa
 * o número e o teste segue verde; deixá-lo crescer falha, nomeando o arquivo e a
 * diferença.
 *
 * ## Por que congelar no valor de hoje em vez de exigir que encolham já
 *
 * Exigir agora bloquearia todo trabalho até dezoito decomposições terminarem —
 * um custo que ninguém pediu, para um débito que já estava registrado. Congelar
 * no valor real de hoje para o sangramento imediatamente, e cada decomposição
 * futura fica mensurável em vez de declarada.
 *
 * O risco de "subir e congelar" é real, e a mitigação é o segundo caso abaixo: o
 * número anotado tem de bater com o disco EXATAMENTE. Não há folga onde crescer.
 */

interface Isento {
  caminho: string;
  teto: number;
}

/** Lê a allowlist do `eslint.config.js` — a fonte é o config, não uma cópia. */
export function isentos(): Isento[] {
  const cfg = readFileSync(CONFIG, 'utf8');
  const inicio = cfg.indexOf('Divida registrada (B-033)');
  if (inicio === -1) throw new Error('bloco da allowlist de max-lines não encontrado');
  const fim = cfg.indexOf('rules: {', inicio);
  const bloco = cfg.slice(inicio, fim);

  const out: Isento[] = [];
  for (const m of bloco.matchAll(/'(src\/[^']+)',\s*\/\/\s*(\d+)\s*LOC/g)) {
    out.push({ caminho: m[1], teto: Number(m[2]) });
  }
  return out;
}

function linhas(caminho: string): number {
  const src = readFileSync(resolve(RAIZ, caminho), 'utf8');
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
}

describe('catraca do orçamento de LoC (B-009/B-033)', () => {
  it('todo arquivo isento respeita o teto anotado — o número só desce', () => {
    const estourados = isentos()
      .map((i) => ({ ...i, real: linhas(i.caminho) }))
      .filter((i) => i.real > i.teto)
      .map((i) => `${i.caminho}: ${i.real} linhas, teto ${i.teto} (+${i.real - i.teto})`);

    expect(
      estourados,
      'Arquivo isento de `max-lines` que CRESCEU.\n\n' +
        'A isenção existe para dívida registrada, não para dívida livre. O comentário\n' +
        'no `eslint.config.js` é o teto: ele só desce.\n\n' +
        'Se você precisou acrescentar linhas a um destes arquivos, a pergunta é se\n' +
        'elas pertencem a ele. Um arquivo que já passou do orçamento e continua\n' +
        'crescendo é o que torna a decomposição mais cara a cada dia.\n\n' +
        'Ao decompor, baixe o número no comentário — este teste fica verde e o\n' +
        'progresso passa a ser medido em vez de declarado.\n',
    ).toEqual([]);
  });

  it('o número anotado bate com o disco — sem folga onde crescer', () => {
    const desatualizados = isentos()
      .map((i) => ({ ...i, real: linhas(i.caminho) }))
      .filter((i) => i.real !== i.teto)
      .map((i) => `${i.caminho}: anotado ${i.teto}, real ${i.real}`);

    expect(
      desatualizados,
      'O número anotado não bate com o arquivo.\n\n' +
        'Este caso é o que impede o "subir e congelar": se o teto pudesse ficar acima\n' +
        'do real, sobraria espaço para crescer sem falhar, e a catraca do outro caso\n' +
        'viraria enfeite.\n\n' +
        'Se o arquivo encolheu, atualize o comentário para baixo — é progresso e vale\n' +
        'ser registrado. Se cresceu, o outro caso já falhou e o comentário não é a\n' +
        'correção.\n',
    ).toEqual([]);
  });

  it('a allowlist não cresce em silêncio', () => {
    // Congelado em 2026-08-07 com 18 entradas. Acrescentar uma é decisão que o
    // próprio comentário do config já exige ADR — o teste é o que faz a exigência
    // ser cobrada em vez de lembrada.
    expect(isentos().length).toBeLessThanOrEqual(18);
  });
});
