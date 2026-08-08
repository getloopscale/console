import { describe, it, expect, beforeEach } from 'vitest';
import { recordAttempt, takePendingAttempt, PENDING_ATTEMPT_KEY } from './auth-attempt';

/**
 * B-096 — a tentativa de login precisa sobreviver à navegação.
 *
 * ## Por que o outcome nunca foi emitido
 *
 * `auth.method.success` e `auth.method.failure` estão declarados em `rum.ts`
 * desde 2026-05-29 e **nunca saíram do código de produção**. Oito testes foram
 * escritos para eles e, em 2026-06-05, esvaziados para `it.skip` com um
 * comentário honesto: o login passou a usar `form.submit()` (exigência do
 * Kratos para seguir o redirect OIDC), a página navega, e o `correlation_id`
 * vivia num `useRef` — que a navegação apaga.
 *
 * O resultado é um funil de autenticação cego: dá para contar quantas pessoas
 * *tentaram* entrar e nenhuma para saber quantas *entraram*. Numa tela de
 * login, essa é exatamente a métrica que importa.
 *
 * ## O contrato
 *
 * `sessionStorage`, não `localStorage`: a tentativa morre com a aba. Uma
 * tentativa de ontem ressuscitando amanhã emitiria um sucesso correlacionado ao
 * login errado.
 *
 * `takePendingAttempt` é de leitura ÚNICA. O outcome é emitido no primeiro
 * render autenticado, que acontece em toda navegação — sem o consumo, um F5 no
 * dashboard emitiria um novo sucesso para uma tentativa que já foi contada, e a
 * métrica passaria a medir recarregamentos.
 */
describe('tentativa de login que atravessa a navegação (B-096)', () => {
  beforeEach(() => sessionStorage.clear());

  it('grava e devolve a tentativa com o correlation_id intacto', () => {
    recordAttempt({ method: 'password', correlation_id: 'c-1', started_at: 1000 });
    expect(takePendingAttempt()).toEqual({
      method: 'password',
      correlation_id: 'c-1',
      started_at: 1000,
    });
  });

  it('a leitura CONSOME — a segunda chamada não devolve nada', () => {
    recordAttempt({ method: 'password', correlation_id: 'c-1', started_at: 1000 });
    takePendingAttempt();
    // Sem isto, um F5 no dashboard emitiria um segundo `auth.method.success`
    // para a mesma tentativa e a métrica contaria recarregamentos.
    expect(takePendingAttempt()).toBeNull();
  });

  it('sem tentativa pendente devolve null em vez de um objeto vazio', () => {
    expect(takePendingAttempt()).toBeNull();
  });

  it('uma tentativa corrompida é descartada, não propagada', () => {
    // O storage é editável pelo usuário e sobrevive a deploys: uma entrada de um
    // formato antigo não pode virar um evento com campos indefinidos, que
    // poluiria a métrica de forma silenciosa e difícil de rastrear.
    sessionStorage.setItem(PENDING_ATTEMPT_KEY, '{isto nao e json');
    expect(takePendingAttempt()).toBeNull();
    expect(sessionStorage.getItem(PENDING_ATTEMPT_KEY)).toBeNull();
  });

  it('uma tentativa sem correlation_id é descartada', () => {
    sessionStorage.setItem(PENDING_ATTEMPT_KEY, JSON.stringify({ method: 'password' }));
    // Um evento de outcome sem correlation_id não liga em nada — é ruído que
    // parece dado. Melhor perder o evento do que emitir um órfão.
    expect(takePendingAttempt()).toBeNull();
  });

  it('sobrevive a sessionStorage indisponível sem derrubar o login', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('bloqueado pela política de cookies');
      },
    });
    try {
      // Safari em modo privado e políticas corporativas bloqueiam o storage.
      // Telemetria NUNCA impede alguém de entrar: falha em silêncio aqui e o
      // login segue. É o único lugar deste repositório onde engolir o erro é a
      // decisão certa, e por isso está dito em voz alta.
      expect(() => recordAttempt({ method: 'password', correlation_id: 'c', started_at: 1 })).not.toThrow();
      expect(takePendingAttempt()).toBeNull();
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});
