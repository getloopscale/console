// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { faseDaOperacao } from './operation-state';

/**
 * M31 — a leitura do estado de uma operação de publicação.
 *
 * MEDIDO no app-dev em 2026-08-04. A tela publicou uma skill, a ingestão gerou o vetor (a skill
 * apareceu no catálogo como DESCOBRÍVEL) e a tela de autoria continuou dizendo **"Em andamento"**
 * indefinidamente. A oferta de "Testar a descoberta" — que é o que o critério do M31 exige do
 * sucesso — nunca apareceu.
 *
 * A causa: a derivação comparava com `'succeeded'` / `'failed'`, um vocabulário que o registro
 * nunca emitiu. O contrato é explícito (`packages/core/src/contract/index.ts:5-15`):
 *
 *   > In-progress states reflect the job type (CREATING/UPDATING/DELETING);
 *   > terminal states are ACTIVE (succeeded) / FAILED.
 *
 * `ACTIVE` é o SUCESSO — a skill está ativa. Ler `ACTIVE` como "em andamento" inverte o
 * significado do estado terminal mais comum que existe.
 *
 * A falha de caixa (`'failed'` vs `'FAILED'`) é a mais perigosa das duas: uma ingestão que
 * MORREU seria exibida como "em andamento" para sempre, e o autor esperaria por algo que já
 * acabou — sem erro, sem aviso, sem fim.
 *
 * Esta função existe fora do React porque foi exatamente isso que faltou: enquanto a derivação
 * vivia dentro do JSX, nenhum teste a alcançava, e o defeito só apareceu publicando de verdade.
 */

describe('faseDaOperacao', () => {
  it('ACTIVE é SUCESSO — a skill está ativa, não "em andamento"', () => {
    expect(faseDaOperacao('ACTIVE')).toBe('concluida');
  });

  it('FAILED é falha, em MAIÚSCULAS como o registro emite', () => {
    expect(faseDaOperacao('FAILED')).toBe('falhou');
  });

  it('os três estados de trabalho refletem o tipo do job', () => {
    expect(faseDaOperacao('CREATING')).toBe('em_andamento');
    expect(faseDaOperacao('UPDATING')).toBe('em_andamento');
    expect(faseDaOperacao('DELETING')).toBe('em_andamento');
  });

  it('estado ausente é "aguardando", que NÃO é o mesmo que em andamento', () => {
    // Antes do primeiro poll responder não sabemos nada. Dizer "em andamento" afirmaria que o
    // trabalho começou; dizer "aguardando" admite que ainda não houve resposta.
    expect(faseDaOperacao(undefined)).toBe('aguardando');
    expect(faseDaOperacao(null)).toBe('aguardando');
  });

  it('um estado desconhecido NÃO vira sucesso nem falha', () => {
    // Um registro mais novo pode inventar um estado. Chutar "concluída" ofereceria testar a
    // descoberta de uma skill que talvez não exista; chutar "falhou" diria que morreu algo que
    // talvez esteja vivo. Nenhuma das duas é honesta.
    expect(faseDaOperacao('QUEUED')).toBe('em_andamento');
    expect(faseDaOperacao('succeeded')).toBe('em_andamento');
  });
});
