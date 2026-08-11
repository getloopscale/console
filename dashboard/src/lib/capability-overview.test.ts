// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * B-126 — toda overview de capacidade responde uma pergunta antes de listar.
 *
 * ## O defeito, medido
 *
 * Em 2026-08-11, das sete overviews de capacidade, `skills` abria num `<Card>` com
 * `<h2>Published skills</h2>` e um `DataTable`. Nenhum resumo, nenhum número, nenhum veredito —
 * quem chegava via uma LISTA. É a mesma classe do defeito que o `B-125` corrigiu um nível acima,
 * na Overview de plataforma.
 *
 * ## Por que quantificar, e não consertar as sete
 *
 * Consertar `skills` não impede a oitava tela de nascer sem resposta — e ela nasceria do mesmo
 * jeito que esta: alguém precisa de uma listagem, cria a tela, e a pergunta nunca é feita porque
 * nada a faz. Este arquivo é o que faz.
 *
 * ## O marcador é EXPLÍCITO de propósito
 *
 * A tela declara sua forma num comentário-marcador em vez de o teste adivinhar por heurística.
 * Uma heurística ("tem MetricCard? então é KPI") erraria nos dois sentidos — um `MetricCard` usado
 * dentro de uma tabela viraria falso positivo, e um veredito montado por um componente próprio
 * viraria falso negativo. Pior: ela deixaria a tela nova passar por acidente, que é exatamente o
 * que este guard existe para impedir.
 *
 * Declarar custa uma linha e força a pergunta da decisão D1 — KPI ou veredito? — no momento em que
 * ela ainda é barata de responder.
 */

/**
 * As overviews de capacidade, e o que cada uma declara.
 *
 * `workspace` está DE FORA, e a exclusão é a resposta a uma pergunta que o plano deixou aberta:
 * `workspace/overview.tsx` é um navegador de arquivos, não um painel de capacidade — ele abre numa
 * árvore que o usuário percorre, e "como está esta capacidade?" não é a pergunta que alguém leva
 * até lá. Ficar de fora por declaração é diferente de ficar de fora por omissão: se ele um dia
 * virar painel, esta linha é onde a mudança aparece.
 */
const CAPABILITY_OVERVIEWS = [
  'pages/lens/overview.tsx',
  'pages/memory/overview.tsx',
  'pages/rag/overview.tsx',
  'pages/promptly/overview.tsx',
  'pages/trust/overview.tsx',
  'pages/skills/overview.tsx',
] as const;

/** As duas formas que a decisão D1 reconhece, e o marcador de cada uma. */
const MARKERS = {
  kpi: '@overview-answers: kpi',
  verdict: '@overview-answers: verdict',
} as const;

function read(rel: string): string {
  const path = resolve(SRC, rel);
  if (!existsSync(path)) throw new Error(`overview declarada e ausente do disco: ${rel}`);
  return readFileSync(path, 'utf8');
}

describe('toda overview de capacidade responde uma pergunta', () => {
  it('cada uma declara SE responde com KPI ou com veredito', () => {
    const mudas = CAPABILITY_OVERVIEWS.filter((rel) => {
      const src = read(rel);
      return !src.includes(MARKERS.kpi) && !src.includes(MARKERS.verdict);
    });

    expect(
      [...mudas],
      'Overview de capacidade que não declara como responde.\n\n' +
        'Uma tela que abre numa lista não responde "como está esta capacidade?" — foi assim que\n' +
        '`skills` ficou mudo entre sete telas, e ninguém reparou até alguém abrir as sete.\n\n' +
        'Escolha a forma pela decisão D1 de `capability-overviews-answer-a-question-plan.md`:\n' +
        `  ${MARKERS.kpi}      quando o que existe é volume de atividade\n` +
        `  ${MARKERS.verdict}  quando existe uma REGRA contra a qual julgar o estado\n\n` +
        'E declare no arquivo, num comentário. O marcador força a pergunta enquanto ela ainda é\n' +
        'barata; uma heurística deixaria a tela nova passar por acidente.\n',
    ).toEqual([]);
  });

  it('nenhuma declara as duas formas ao mesmo tempo', () => {
    // Duas formas na mesma tela significa que a pergunta não foi respondida — foi adiada
    // renderizando os dois. A decisão D1 escolhe uma.
    const ambas = CAPABILITY_OVERVIEWS.filter((rel) => {
      const src = read(rel);
      return src.includes(MARKERS.kpi) && src.includes(MARKERS.verdict);
    });

    expect([...ambas], 'declara KPI e veredito ao mesmo tempo').toEqual([]);
  });

  it('o conjunto declarado bate com o que existe no disco', () => {
    // Guarda contra a lista envelhecer em silêncio: uma capacidade renomeada ou removida faria os
    // dois casos acima passarem sobre um arquivo que não existe mais.
    for (const rel of CAPABILITY_OVERVIEWS) {
      expect(() => read(rel), `${rel} sumiu do disco`).not.toThrow();
    }
    expect(CAPABILITY_OVERVIEWS.length).toBeGreaterThanOrEqual(6);
  });
});
