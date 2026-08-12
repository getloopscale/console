// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { formatDeployError, PROMOTE, ROLLBACK } from './deploy-error-copy';

/**
 * B-226 — `formatRollbackError` não era exportada e NÃO TINHA TESTE NENHUM. As oito asserções
 * existentes cobriam só a gêmea, `formatPromoteError`. Metade de uma regra duplicada sem
 * cobertura é o pior arranjo: a metade coberta dá confiança sobre a que não é.
 */

describe('a forma é compartilhada', () => {
  it.each([
    [PROMOTE, 401, /session expired/i],
    [ROLLBACK, 401, /session expired/i],
    [PROMOTE, 403, /permission to promote/i],
    [ROLLBACK, 403, /permission to rollback/i],
    [PROMOTE, 400, /rejected/i],
    [ROLLBACK, 400, /rejected/i],
  ] as const)('%# status → frase da operação', (op, status, esperado) => {
    expect(formatDeployError(op, status, null)).toMatch(esperado);
  });
});

describe('as PALAVRAS continuam sendo de cada operação', () => {
  it('o 404 de rollback diz que o build pode ter sido apagado; o de promote não', () => {
    // Consolidar como se fossem cópias literais apagaria justamente esta diferença.
    expect(formatDeployError(ROLLBACK, 404, null)).toMatch(/may have been deleted/i);
    expect(formatDeployError(PROMOTE, 404, null)).not.toMatch(/may have been deleted/i);
  });

  it('o 5xx de cada uma diz o que CONTINUA valendo, e são coisas diferentes', () => {
    expect(formatDeployError(PROMOTE, 500, null)).toMatch(/production release remains active/i);
    expect(formatDeployError(ROLLBACK, 500, null)).toMatch(/current release remains active/i);
  });

  it('um sync que não terminou admite INCERTEZA, e o rollback diz "degraded"', () => {
    const b = { message: 'sync wait failed' };
    expect(formatDeployError(ROLLBACK, 500, b)).toMatch(/degraded state/i);
    expect(formatDeployError(PROMOTE, 500, b)).toMatch(/did not finish in time/i);
  });

  it('cada operação reconhece o SEU código próprio', () => {
    expect(formatDeployError(PROMOTE, 409, { code: 'SAME_ENVIRONMENT' })).toMatch(/already on production/i);
    expect(formatDeployError(ROLLBACK, 409, { code: 'NO_PREVIOUS_RELEASE' })).toMatch(/first deploy/i);
  });

  it('só promote tem conflito de concorrência; rollback cai no ramo geral', () => {
    expect(formatDeployError(PROMOTE, 409, null)).toMatch(/already in progress/i);
    expect(formatDeployError(ROLLBACK, 409, null)).toMatch(/HTTP 409/);
  });
});
