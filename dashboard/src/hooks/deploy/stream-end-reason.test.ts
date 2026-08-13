// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchEventSource } from './fetch-event-source';
import { credentialIsSuspect, shouldReopen } from './stream-end-reason';
import type { StreamEndReason } from './stream-end-reason';

/**
 * B-160 · T1 — the transport reports WHY the stream ended.
 *
 * `readyState` is a state, and the defect is that one state now has several causes. When
 * the native EventSource was replaced (B-088), `CLOSED` stopped meaning "the browser gave
 * up on an HTTP error" and started meaning that OR "the server finished cleanly" — while
 * `use-sse-stream.ts:228` still read it as the former and cleared the application-wide JWT
 * on every clean end.
 *
 * The transport is the only layer that knows which branch it took. These tests pin that it
 * says so.
 */
function endReasonOf(setup: () => void): Promise<StreamEndReason | undefined> {
  return new Promise((resolve) => {
    let seen: StreamEndReason | undefined;
    const es = new FetchEventSource('/stream', { token: 't' });
    es.onerror = (e) => {
      seen = (e as unknown as { reason?: StreamEndReason }).reason;
      resolve(seen);
    };
    setup();
    setTimeout(() => resolve(seen), 60);
  });
}

describe('FetchEventSource — end reason', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports server-closed when the body ends without an error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
    });
    await expect(endReasonOf(() => {})).resolves.toEqual({ kind: 'server-closed' });
  });

  it('reports http-error on a non-2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, body: null });
    // B-172 — o status vem junto. Antes ele era conhecido nesta exata linha do transporte e
    // descartado na seguinte, e sem ele o consumidor so conseguia escrever "qualquer nao-2xx e a
    // credencial" — que foi como um 503 passou a apagar o JWT de todas as telas abertas.
    await expect(endReasonOf(() => {})).resolves.toEqual({ kind: 'http-error', status: 401 });
  });

  it('reports network-error when the request itself throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(endReasonOf(() => {})).resolves.toEqual({ kind: 'network-error' });
  });
});

describe('B-172 — a política lê o status, não a classe', () => {
  it('um 401 faz suspeitar da credencial', () => {
    expect(credentialIsSuspect({ kind: 'http-error', status: 401 })).toBe(true);
  });

  it('um 403 também — um token válido para outra coisa é tão inútil quanto um expirado', () => {
    expect(credentialIsSuspect({ kind: 'http-error', status: 403 })).toBe(true);
  });

  it('um 503 NÃO faz suspeitar da credencial', () => {
    // O defeito medido: um serviço de log sobrecarregado apagava o JWT de todas as telas abertas.
    expect(credentialIsSuspect({ kind: 'http-error', status: 503 })).toBe(false);
  });

  it('um 404 NÃO faz suspeitar da credencial', () => {
    // Um caminho que não existe não diz nada sobre quem está pedindo.
    expect(credentialIsSuspect({ kind: 'http-error', status: 404 })).toBe(false);
  });

  it('a ausência de credencial faz suspeitar dela, obviamente', () => {
    expect(credentialIsSuspect({ kind: 'no-token' })).toBe(true);
  });

  it('um fim limpo não diz nada sobre a credencial', () => {
    expect(credentialIsSuspect({ kind: 'server-closed' })).toBe(false);
  });

  it('uma falha de rede não diz nada sobre a credencial', () => {
    expect(credentialIsSuspect({ kind: 'network-error' })).toBe(false);
  });
});

describe('B-173 — todo fim que não foi nosso pede reabertura', () => {
  it('uma falha de rede reabre', () => {
    // O defeito severo que nenhum título nomeava: `network-error` não era nem suspeita de
    // credencial nem fim limpo, então o consumidor retornava sem agendar nada — e o stream ficava
    // morto até o componente remontar.
    expect(shouldReopen({ kind: 'network-error' })).toBe(true);
  });

  it('um 503 reabre', () => {
    expect(shouldReopen({ kind: 'http-error', status: 503 })).toBe(true);
  });

  it('um fim limpo reabre — o servidor terminou, o stream continua', () => {
    expect(shouldReopen({ kind: 'server-closed' })).toBe(true);
  });

  it('um abort NÃO reabre — fomos nós que fechamos', () => {
    expect(shouldReopen({ kind: 'aborted' })).toBe(false);
  });
});
