import { describe, it, expect } from 'vitest';

import { violationColumns } from './violations';

// #347 (1) — o passo 5 da âncora do loopguardrails exige "mostra data e botão Abrir funcional".
// O botão funcionava; a data não existia.
//
// A coluna tinha sido REMOVIDA de propósito, com medição: "o /policy-violations do deploy não
// devolve detectedAt, e uma coluna permanentemente vazia é ruído". A decisão estava certa —
// e a evidência VENCEU: o LT-001 corrigiu justamente essa omissão e está validado, então o
// campo chega.
//
// Sem data, duas violações iguais em política e severidade são indistinguíveis, e "isso é de
// agora ou de semanas atrás?" é a primeira pergunta de quem abre a tela.
describe('violations — coluna de data (#347)', () => {
  it('declara uma coluna para detectedAt', () => {
    const keys = violationColumns().map((c) => c.key);
    expect(keys).toContain('detectedAt');
  });

  // A metade que impede o retorno do ruído que motivou a remoção: linha sem data não pode
  // renderizar "undefined" nem quebrar — mostra ausência, que é a leitura honesta.
  it('linha sem detectedAt rende ausencia, nao undefined', () => {
    const col = violationColumns().find((c) => c.key === 'detectedAt');
    const out = col?.render?.({ policy: 'p', severity: 'high' } as never);
    expect(String(out ?? '')).not.toContain('undefined');
  });
});
