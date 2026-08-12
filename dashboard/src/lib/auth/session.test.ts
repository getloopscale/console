import { describe, it, expect, vi } from 'vitest';
import { isEmailVerified, logout } from './session';
import { safeNavigator } from '@/lib/navigation';
import type { Session } from './session';

// Helper to build a minimal session object for testing.
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    active: true,
    identity: {
      id: 'test-id',
      traits: { email: 'user@example.com' },
    },
    ...overrides,
  };
}

describe('isEmailVerified', () => {
  // Scenario 1: Password user with unverified email → should return false
  it('returns false for password user with unverified email', () => {
    const session = makeSession({
      identity: {
        id: 'pwd-user',
        traits: { email: 'user@example.com' },
        verifiable_addresses: [
          { value: 'user@example.com', verified: false, via: 'email' },
        ],
      },
    });
    expect(isEmailVerified(session)).toBe(false);
  });

  // Scenario 2: Password user with verified email → should return true
  it('returns true for password user with verified email', () => {
    const session = makeSession({
      identity: {
        id: 'pwd-user',
        traits: { email: 'user@example.com' },
        verifiable_addresses: [
          { value: 'user@example.com', verified: true, via: 'email' },
        ],
      },
    });
    expect(isEmailVerified(session)).toBe(true);
  });

  // Scenario 3: OIDC user with NO verifiable_addresses → should return true
  // (current behavior — OIDC users without verifiable_addresses are treated as verified)
  it('returns true for OIDC user with no verifiable_addresses', () => {
    const session = makeSession({
      identity: {
        id: 'oidc-user',
        traits: { email: 'user@gmail.com' },
        // No verifiable_addresses field at all
      },
    });
    expect(isEmailVerified(session)).toBe(true);
  });

  // Scenario 4: OIDC user (Google) with verifiable_addresses marked false
  // → should return true because provider already verified the email.
  // THIS IS THE BUG: currently returns false because it only checks verifiable_addresses.
  it('returns true for Google OIDC user even with unverified verifiable_addresses', () => {
    const session = makeSession({
      identity: {
        id: 'google-user',
        traits: { email: 'user@gmail.com' },
        verifiable_addresses: [
          { value: 'user@gmail.com', verified: false, via: 'email' },
        ],
      },
      authentication_methods: [
        { method: 'oidc', provider: 'google', completed_at: '2026-04-06T00:00:00Z' },
      ],
    });
    expect(isEmailVerified(session)).toBe(true);
  });

  // Scenario 5: GitHub OIDC user with verifiable_addresses marked false
  // → should return true (same as Google)
  it('returns true for GitHub OIDC user even with unverified verifiable_addresses', () => {
    const session = makeSession({
      identity: {
        id: 'github-user',
        traits: { email: 'user@github.com' },
        verifiable_addresses: [
          { value: 'user@github.com', verified: false, via: 'email' },
        ],
      },
      authentication_methods: [
        { method: 'oidc', provider: 'github', completed_at: '2026-04-06T00:00:00Z' },
      ],
    });
    expect(isEmailVerified(session)).toBe(true);
  });

  // Scenario 6: Untrusted OIDC provider with unverified email → should return false
  // Security: only explicitly trusted providers (github, google) bypass verification.
  it('returns false for untrusted OIDC provider with unverified email', () => {
    const session = makeSession({
      identity: {
        id: 'untrusted-user',
        traits: { email: 'user@evil.com' },
        verifiable_addresses: [
          { value: 'user@evil.com', verified: false, via: 'email' },
        ],
      },
      authentication_methods: [
        { method: 'oidc', provider: 'some-random-provider', completed_at: '2026-04-06T00:00:00Z' },
      ],
    });
    expect(isEmailVerified(session)).toBe(false);
  });

  // Scenario 7: Password-only auth with unverified email (no OIDC in methods)
  // → should return false (password users must verify)
  it('returns false for password-only user with unverified email and authentication_methods', () => {
    const session = makeSession({
      identity: {
        id: 'pwd-user-2',
        traits: { email: 'user@example.com' },
        verifiable_addresses: [
          { value: 'user@example.com', verified: false, via: 'email' },
        ],
      },
      authentication_methods: [
        { method: 'password', completed_at: '2026-04-06T00:00:00Z' },
      ],
    });
    expect(isEmailVerified(session)).toBe(false);
  });
});

describe('logout — B-055: o cache do service worker sai junto', () => {
  it('logout() apaga o cache de dados do tenant', async () => {
    const deletadas: string[] = [];
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['theo-api', 'theo-assets']),
      delete: (n: string) => {
        deletadas.push(n);
        return Promise.resolve(true);
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const location = { href: '' };
    vi.stubGlobal('location', location);
    Object.defineProperty(window, 'location', { value: location, writable: true });

    const { logout } = await import('./session');
    await logout();

    // Este teste prova o WIRE, e não o módulo — `logout-cache-purge.test.ts` já
    // cobre a função isolada. A distinção importa: hoje mesmo, três invalidações
    // de cache ficaram apontando para chaves que ninguém mais lia, e o que
    // faltava em todas era exatamente um teste do wire.
    expect(deletadas).toContain('theo-api');
    expect(deletadas).not.toContain('theo-assets');
    vi.unstubAllGlobals();
  });
});

describe('B-139 — um logout que o servidor não confirmou não se parece com um que funcionou', () => {
  it('leva para /login DIZENDO que o encerramento não foi confirmado', async () => {
    // Antes: um Kratos que recusa, um `logout_url` ausente e um destino recusado caíam TODOS no
    // mesmo `/login`, indistinguíveis de sucesso. A pessoa via a tela de login e concluía que
    // tinha saído — com a sessão viva no servidor.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    const ir = vi.spyOn(safeNavigator, 'goTo').mockReturnValue(true);

    await logout();

    expect(ir).toHaveBeenCalledWith('/login?reason=logout-incomplete');
  });

  it('uma queda de rede é tratada com a mesma cautela', async () => {
    // "Não sabemos se encerrou" e "não encerrou" pedem a mesma leitura de quem está no terminal.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const ir = vi.spyOn(safeNavigator, 'goTo').mockReturnValue(true);

    await logout();

    expect(ir).toHaveBeenCalledWith('/login?reason=logout-incomplete');
  });

  it('um logout CONFIRMADO segue para o destino do serviço, sem faixa', async () => {
    // A correção não pode virar "sempre avisa": isso ensinaria a ignorar o aviso.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ logout_url: 'https://auth.example/logout' }), { status: 200 }),
    );
    const ir = vi.spyOn(safeNavigator, 'goTo').mockReturnValue(true);

    await logout();

    expect(ir).toHaveBeenCalledWith('https://auth.example/logout');
  });
});
