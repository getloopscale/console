import { describe, it, expect } from 'vitest';
import { FlowSubmitError } from './kratos';
import { recoveryErrorMessage, SERVICE_UNAVAILABLE_MESSAGE } from './recovery-errors';

describe('B-233 — as duas causas deixam de receber a mesma frase', () => {
  it('um 502 diz para tentar de novo', () => {
    expect(recoveryErrorMessage(new FlowSubmitError(502))).toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });

  it('uma rejeição de rede diz para tentar de novo', () => {
    expect(recoveryErrorMessage(new TypeError('Failed to fetch'))).toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });

  it('um fluxo expirado (410) NÃO diz para tentar de novo — mandaria repetir o que vai falhar', () => {
    const msg = recoveryErrorMessage(new FlowSubmitError(410));
    expect(msg).not.toBe(SERVICE_UNAVAILABLE_MESSAGE);
    expect(msg).toMatch(/no longer valid/i);
  });

  it('um CSRF recusado (403) manda recomeçar', () => {
    expect(recoveryErrorMessage(new FlowSubmitError(403))).toMatch(/start again/i);
  });

  it('um erro que não é nenhum dos dois cai no lado que pede recomeço, não no de tentar de novo', () => {
    // O default importa: mandar tentar de novo quando não se sabe a causa é o conselho que custa
    // mais, porque a pessoa repete e nada muda.
    expect(recoveryErrorMessage(new Error('unparseable'))).toMatch(/start again/i);
  });
});

describe('B-233 — o chamador que já tinha a frase certa a mantém', () => {
  it('usa a frase específica do chamador no lado não-serviço', () => {
    // Dos três `if`, só o do código tinha ramos que de fato diferiam. Uniformizar os três teria
    // apagado a única distinção que já estava correta.
    const especifica = 'Invalid or expired code. Request a new recovery email.';
    expect(recoveryErrorMessage(new FlowSubmitError(410), especifica)).toBe(especifica);
  });

  it('mas um 5xx continua dizendo para tentar de novo, mesmo com frase específica', () => {
    expect(recoveryErrorMessage(new FlowSubmitError(503), 'Invalid code.')).toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });
});
