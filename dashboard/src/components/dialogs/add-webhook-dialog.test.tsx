// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { canRegisterWebhook } from './add-webhook-dialog';

/**
 * B-193 — a regra que estava escrita duas vezes.
 *
 * `memory/webhooks.tsx` e `settings/webhooks.tsx` traziam o mesmo predicado literal. Regra de
 * negócio duplicada é o caso em que DRY deixa de ser preferência: as duas respondem à mesma
 * pergunta, e no dia em que uma passar a exigir `https` a outra não vai passar — sem que nada
 * acuse, porque cada uma continua consistente consigo mesma.
 */
const entrada = (over: Partial<{ url: string; label: string; eventos: Set<string> }> = {}) => ({
  url: 'https://hook.example.com/x',
  label: 'prod',
  eventos: new Set(['memory.created']),
  ...over,
});

describe('podeCadastrarWebhook', () => {
  it('aceita uma URL absoluta em http ou https', () => {
    expect(canRegisterWebhook(entrada({ url: 'https://h.example/x' }))).toBe(true);
    expect(canRegisterWebhook(entrada({ url: 'HTTP://h.example/x' }))).toBe(true);
  });

  it('recusa o que não é uma URL absoluta', () => {
    // O destino de um webhook é chamado pelo SERVIDOR: um caminho relativo não tem para onde
    // apontar, e um esquema que não seja http(s) não é entregável.
    for (const url of ['', '/hooks/x', 'hook.example.com', 'ftp://h.example/x', 'javascript:1']) {
      expect(canRegisterWebhook(entrada({ url })), url).toBe(false);
    }
  });

  it('exige rótulo — e espaço em branco não é rótulo', () => {
    // O rótulo é como o webhook aparece na lista; um em branco produz uma linha que não se
    // distingue das outras.
    expect(canRegisterWebhook(entrada({ label: '' }))).toBe(false);
    expect(canRegisterWebhook(entrada({ label: '   ' }))).toBe(false);
    expect(canRegisterWebhook(entrada({ label: ' prod ' }))).toBe(true);
  });

  it('exige ao menos um evento', () => {
    // Um webhook sem evento nenhum nunca dispara: cadastrá-lo é cadastrar silêncio.
    expect(canRegisterWebhook(entrada({ eventos: new Set() }))).toBe(false);
  });
});
