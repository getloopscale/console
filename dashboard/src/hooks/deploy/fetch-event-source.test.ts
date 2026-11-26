// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FetchEventSource } from './fetch-event-source';

/**
 * B-088 — o JWT de sessão sai da URL.
 *
 * ## O achado
 *
 * `useSSEStream` montava `${API_URL}${path}?token=${jwt}`, e o token era o
 * bearer completo da sessão — o mesmo da API, sem TTL próprio nem escopo de
 * stream. Um JWT em query string chega a log de servidor, log de proxy,
 * histórico do navegador e header `Referer`: quatro lugares onde um bearer não
 * deveria estar. O dashboard tem `nginx.conf` versionado com access log e roda
 * atrás de Cloudflare, então nenhum dos quatro é hipotético.
 *
 * A razão técnica original é legítima: `EventSource` não aceita headers. O
 * ADR-0009 mediu as três saídas contra o código e escolheu a (c) — SSE sobre
 * `fetch` + `ReadableStream` — porque as outras duas não sobreviveram à
 * medição: o middleware da API não lê cookie (`internal/auth/middleware.go:143`),
 * e a objeção clássica à (c), "perde a reconexão nativa", é falsa aqui: a
 * primitiva JÁ reimplementa reconexão com backoff e jitter.
 *
 * ## O que esta classe é
 *
 * A superfície de `EventSource` que o hook usa — `onopen`, `onmessage`,
 * `onerror`, `addEventListener`, `close`, `readyState` — sobre `fetch`. A troca
 * é de uma linha em `SharedEventSource`. Since getloopscale/loopscale#477 step 3 the
 * stream carries no token at all — the session cookie authenticates it.
 */

function stream(...pedacos: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of pedacos) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

function respostaOk(body: ReadableStream<Uint8Array>) {
  return { ok: true, status: 200, body } as unknown as Response;
}

describe('FetchEventSource (B-088)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('carries no credential of its own — the session cookie authenticates the stream', async () => {
    // getloopscale/loopscale#477 step 3: no token in the URL (access logs, Referer), none in a header.
    fetchMock.mockResolvedValue(respostaOk(stream('')));
    const es = new FetchEventSource('/api/stream?env=prod', {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('/api/stream?env=prod');
    expect(init.headers as Record<string, string>).not.toHaveProperty('Authorization');
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');
    expect(init.credentials).toBe('same-origin');
    es.close();
  });

  it('Last-Event-ID vai por header, nao por query', async () => {
    fetchMock.mockResolvedValue(respostaOk(stream('')));
    const es = new FetchEventSource('/s', { lastEventId: '42' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('last_event_id');
    // Era o outro motivo de a URL crescer: o EventSource não deixa mandar
    // header, então o resume também tinha virado query. Aqui é o header padrão.
    expect((init.headers as Record<string, string>)['Last-Event-ID']).toBe('42');
    es.close();
  });

  it('um frame simples vira onmessage com data e lastEventId', async () => {
    fetchMock.mockResolvedValue(respostaOk(stream('id: 7\ndata: ola\n\n')));
    const es = new FetchEventSource('/s', {});
    const recebidos: { data: string; id: string }[] = [];
    es.onmessage = (e) => recebidos.push({ data: e.data as string, id: e.lastEventId });

    await vi.waitFor(() => expect(recebidos).toHaveLength(1));
    expect(recebidos[0]).toEqual({ data: 'ola', id: '7' });
    es.close();
  });

  it('um frame NOMEADO chega a quem registrou o tipo, e nao ao onmessage', async () => {
    fetchMock.mockResolvedValue(
      respostaOk(stream('event: build.step.started\ndata: {"a":1}\n\n')),
    );
    const es = new FetchEventSource('/s', {});
    const nomeados: string[] = [];
    let genericos = 0;
    es.addEventListener('build.step.started', (e) => nomeados.push(e.data as string));
    es.onmessage = () => (genericos += 1);

    await vi.waitFor(() => expect(nomeados).toHaveLength(1));
    expect(nomeados[0]).toBe('{"a":1}');
    // O EventSource nativo separa os dois. Entregar um evento nomeado também no
    // onmessage duplicaria todo evento para consumidores que usam os dois.
    expect(genericos).toBe(0);
    es.close();
  });

  it('data em MULTIPLAS linhas e juntado com quebra de linha', async () => {
    fetchMock.mockResolvedValue(respostaOk(stream('data: linha1\ndata: linha2\n\n')));
    const es = new FetchEventSource('/s', {});
    const recebidos: string[] = [];
    es.onmessage = (e) => recebidos.push(e.data as string);

    await vi.waitFor(() => expect(recebidos).toHaveLength(1));
    // Regra do protocolo, e não detalhe: um log com quebras chegaria colado
    // numa linha só, e um JSON formatado chegaria inválido.
    expect(recebidos[0]).toBe('linha1\nlinha2');
    es.close();
  });

  it('um frame partido entre dois chunks e remontado', async () => {
    fetchMock.mockResolvedValue(respostaOk(stream('data: par', 'tido\n\n')));
    const es = new FetchEventSource('/s', {});
    const recebidos: string[] = [];
    es.onmessage = (e) => recebidos.push(e.data as string);

    await vi.waitFor(() => expect(recebidos).toHaveLength(1));
    // A rede parte onde quiser. Sem o buffer entre leituras, um evento grande —
    // que é o caso comum num log — chegaria cortado ao meio.
    expect(recebidos[0]).toBe('partido');
    es.close();
  });

  it('CRLF e comentario de keep-alive nao viram eventos', async () => {
    fetchMock.mockResolvedValue(respostaOk(stream(': keep-alive\r\n\r\ndata: real\r\n\r\n')));
    const es = new FetchEventSource('/s', {});
    const recebidos: string[] = [];
    es.onmessage = (e) => recebidos.push(e.data as string);

    await vi.waitFor(() => expect(recebidos).toHaveLength(1));
    // Proxies mandam comentário para manter a conexão viva. Tratá-lo como
    // evento entregaria lixo ao reducer a cada 15 segundos.
    expect(recebidos[0]).toBe('real');
    es.close();
  });

  it('abre: onopen dispara e readyState ja esta OPEN nesse instante', async () => {
    fetchMock.mockResolvedValue(respostaOk(stream('')));
    const es = new FetchEventSource('/s', {});
    let estadoNoOnopen: number | null = null;
    es.onopen = () => (estadoNoOnopen = es.readyState);

    // Assertar `readyState` DEPOIS do waitFor media o estado errado: o stream
    // deste teste fecha sozinho (o servidor encerra), entao a leitura tardia
    // pega CLOSED. O que importa e o estado no momento em que o consumidor e
    // avisado — e o `connected` dele sai dai.
    await vi.waitFor(() => expect(estadoNoOnopen).not.toBeNull());
    expect(estadoNoOnopen).toBe(FetchEventSource.OPEN);
    es.close();
  });

  it('resposta NAO-2xx: onerror e readyState CLOSED — o caminho do B-014', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, body: null } as unknown as Response);
    const es = new FetchEventSource('/s', {});
    let erro = false;
    es.onerror = () => (erro = true);

    await vi.waitFor(() => expect(erro).toBe(true));
    // CLOSED é o que dispara a recuperação de token no useSSEStream. Se ficasse
    // em CONNECTING, o 401 de token expirado esperaria três falhas que nunca
    // viriam — que foi exatamente o defeito B-014.
    expect(es.readyState).toBe(FetchEventSource.CLOSED);
  });

  it('o servidor encerrar o stream vira onerror — o hook reconecta com backoff', async () => {
    fetchMock.mockResolvedValue(respostaOk(stream('data: um\n\n')));
    const es = new FetchEventSource('/s', {});
    let erro = false;
    es.onerror = () => (erro = true);

    // O EventSource nativo reconecta sozinho; aqui quem reconecta é o
    // useSSEStream, e ele só sabe reconectar quando vê `onerror`. Sem isto, um
    // stream encerrado pelo servidor ficaria morto em silêncio.
    await vi.waitFor(() => expect(erro).toBe(true));
    expect(es.readyState).toBe(FetchEventSource.CLOSED);
  });

  it('close() aborta a requisicao e cala os handlers', async () => {
    let sinal: AbortSignal | undefined;
    fetchMock.mockImplementation((_u: string, init: RequestInit) => {
      sinal = init.signal as AbortSignal;
      return Promise.resolve(respostaOk(stream('data: tarde\n\n')));
    });
    const es = new FetchEventSource('/s', {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const recebidos: string[] = [];
    es.onmessage = (e) => recebidos.push(e.data as string);
    es.close();

    expect(sinal?.aborted).toBe(true);
    expect(es.readyState).toBe(FetchEventSource.CLOSED);
    // Sem abortar, o fetch seguiria lendo o corpo depois de o componente
    // desmontar — o vazamento que o EventSource.close() evitava de graça.
    await new Promise((r) => setTimeout(r, 10));
    expect(recebidos).toEqual([]);
  });
});
