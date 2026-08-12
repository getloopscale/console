import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reportError, resetErrorReporter } from './error-reporter';

describe('reportError', () => {
  beforeEach(() => {
    resetErrorReporter();
  });

  it('test_reports_first_error_without_throwing', () => {
    expect(() => reportError(new Error('first'), { routePath: '/x' })).not.toThrow();
  });

  it('test_does_not_throw_when_self_fails', () => {
    // Even if internal transport breaks, reportError must never throw — would
    // cascade boundary into infinite loop.
    const original = global.fetch;
    global.fetch = vi.fn(() => {
      throw new Error('network exploded');
    }) as unknown as typeof global.fetch;
    try {
      expect(() => reportError(new Error('cascade test'), {})).not.toThrow();
    } finally {
      global.fetch = original;
    }
  });

  it('para de despachar depois de 10 erros na sessão', () => {
    // B-215 — este teste terminava em `expect(true).toBe(true)`, justificado por "nenhum contador
    // público exposto". O limite SEMPRE foi observável: cada relato aceito produz um despacho, e
    // em desenvolvimento o despacho é um `console.error`. Contar 15 chamadas e afirmar 10
    // despachos é a asserção que o teste dizia não ser possível — e ela reprova tanto um limite
    // trocado quanto um limite removido.
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {});

    for (let i = 0; i < 15; i++) {
      reportError(new Error(`err ${i}`), { routePath: '/x' });
    }

    expect(espiao).toHaveBeenCalledTimes(10);
    espiao.mockRestore();
  });

  it('o contador reinicia com resetErrorReporter', () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 12; i++) reportError(new Error('x'), {});
    resetErrorReporter();
    reportError(new Error('depois do reset'), {});

    // 10 antes do teto + 1 depois do reinício. Sem o reinício, o 13º relato seria descartado e a
    // contagem pararia em 10.
    expect(espiao).toHaveBeenCalledTimes(11);
    espiao.mockRestore();
  });

  it('uma falha DENTRO do reporter é dita em desenvolvimento, não engolida', () => {
    // A camada externa era um `catch` vazio: um bug do próprio reporter — payload malformado,
    // `JSON.stringify` circular — desaparecia sem rastro, no único componente do sistema cujo
    // trabalho é justamente não deixar erro desaparecer.
    const espiao = vi.spyOn(console, 'error').mockImplementationOnce(() => {
      throw new Error('o despacho explodiu');
    }).mockImplementation(() => {});

    expect(() => reportError(new Error('gatilho'), {})).not.toThrow();

    const ditas = espiao.mock.calls.map((c) => String(c[0]));
    expect(ditas).toContain('[error-reporter] failed to report');
    espiao.mockRestore();
  });

  // T3.3: verify the dev-mode dispatch goes through console.error (prod path
  // uses sendBeacon → tested only via shape/contract since vitest defaults to
  // import.meta.env.DEV=true and stubbing PROD globally would leak between
  // tests). The prod payload contract is documented in the source comment.
  it('test_dev_mode_logs_error_with_payload_shape', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError(new Error('demo'), { routePath: '/foo', componentStack: 'StackTrace' });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = consoleSpy.mock.calls[0];
    expect(tag).toBe('[error-reporter]');
    expect(payload).toMatchObject({
      type: 'react-error',
      message: 'demo',
      routePath: '/foo',
      componentStack: 'StackTrace',
    });
    expect(typeof (payload as { timestamp: number }).timestamp).toBe('number');
    consoleSpy.mockRestore();
  });
});
