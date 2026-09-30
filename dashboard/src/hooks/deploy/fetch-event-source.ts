import { streamEndEvent, type StreamEndReason } from './stream-end-reason';

/**
 * B-088 — SSE sobre `fetch`, para que o JWT de sessão saia da URL.
 *
 * usetheoai/theo#477 step 3 (2026-09-30) — the stream now carries NO token at all: theo-cloud
 * authenticates it from the Kratos session cookie. Option (a) below was rejected at the time
 * because the API did not read cookies and accepting them would trade exposure for CSRF; the
 * backend now reads them, and refuses cross-origin unsafe requests (`auth.RequireCaller`). The
 * `fetch` transport stays: it is what carries `Last-Event-ID` and reports the HTTP status.
 *
 * ## O achado
 *
 * `useSSEStream` montava `${API_URL}${path}?token=${jwt}`, e o token era o
 * bearer completo da sessão — o mesmo da API, sem TTL próprio nem escopo de
 * stream. Um JWT em query string chega a log de servidor, log de proxy,
 * histórico do navegador e header `Referer`. O dashboard versiona um
 * `nginx.conf` com access log e roda atrás de Cloudflare: nenhum dos quatro é
 * hipotético.
 *
 * ## Por que esta saída, e não as outras duas
 *
 * A razão técnica original é legítima: `EventSource` não aceita headers. O
 * ADR-0009 mediu as três saídas contra o código:
 *
 * - **(a) cookie httpOnly** — o middleware da API cloud aceita
 *   `Authorization: Bearer` OU `?token=` e **não lê cookie**
 *   (`internal/auth/middleware.go:143`). Exigiria mudança de backend, e aceitar
 *   cookie numa API hoje imune a CSRF por usar Bearer trocaria uma exposição
 *   por outra.
 * - **(b) token efêmero de uso único** — mitiga sem eliminar: o token continua
 *   na URL e continua nos mesmos quatro lugares, só vale menos quando alguém o
 *   lê. Exige um endpoint novo.
 * - **(c) esta.** A objeção clássica — "perde a reconexão nativa do
 *   EventSource" — não se sustenta aqui: a primitiva **já** reimplementa
 *   reconexão, com backoff exponencial, teto de 30s e jitter. O único recurso
 *   herdado do nativo era o resume por `Last-Event-ID`, e esse é um header que
 *   o cliente manda sozinho.
 *
 * ## O que a classe é
 *
 * Exatamente a superfície de `EventSource` que `useSSEStream` consome —
 * `onopen`, `onmessage`, `onerror`, `addEventListener`, `close`, `readyState`.
 * Nada além. Implementar a interface inteira seria trabalho para um consumidor
 * hipotético; esta é a fatia que existe.
 *
 * ## A regra que preserva o B-014
 *
 * Numa resposta não-2xx o `readyState` vai para `CLOSED` **antes** de `onerror`
 * disparar. `useSSEStream` lê exatamente isso para decidir que o token expirou e
 * recuperar de imediato, em vez de esperar três falhas que nunca viriam — foi o
 * defeito B-014, e ele volta se este contrato mudar.
 */

interface Opcoes {
  /** Resume cursor; it travels in a header, as the protocol says. */
  lastEventId?: string | null;
}

type Ouvinte = (event: MessageEvent) => void;

/** Um frame do fio SSE, já parseado. */
interface Frame {
  tipo: string;
  data: string;
  id: string;
}

export class FetchEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  onopen: ((event: Event) => void) | null = null;
  onmessage: Ouvinte | null = null;
  onerror: ((event: Event) => void) | null = null;

  readyState: number = FetchEventSource.CONNECTING;

  private ouvintes = new Map<string, Ouvinte[]>();
  private abort = new AbortController();
  private fechado = false;
  /** Resto de um chunk que terminou no meio de um frame. */
  private resto = '';

  constructor(
    readonly url: string,
    private readonly opcoes: Opcoes,
  ) {
    void this.open();
  }

  addEventListener(tipo: string, fn: Ouvinte): void {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) ?? []), fn]);
  }

  removeEventListener(tipo: string, fn: Ouvinte): void {
    const atuais = this.ouvintes.get(tipo);
    if (atuais) this.ouvintes.set(tipo, atuais.filter((f) => f !== fn));
  }

  close(): void {
    if (this.fechado) return;
    this.fechado = true;
    this.readyState = FetchEventSource.CLOSED;
    // Sem abortar, o `fetch` seguiria lendo o corpo depois de o componente
    // desmontar — o vazamento que `EventSource.close()` evitava de graça.
    this.abort.abort();
  }

  private falhar(reason: StreamEndReason): void {
    if (this.fechado) return;
    // A ORDEM importa: `useSSEStream` lê `readyState` DENTRO do `onerror` para
    // decidir se o token expirou (B-014). Disparar antes de fechar entregaria
    // CONNECTING e a recuperação de token não aconteceria.
    this.readyState = FetchEventSource.CLOSED;
    // Numa microtask porque o consumidor atribui `onerror` DEPOIS que o
    // construtor retorna. A falha síncrona — sem token, o caminho mais curto —
    // disparava para um handler que ainda não existia, e o stream ficava morto
    // sem ninguém saber. Foi um teste que pegou isto, não uma revisão.
    queueMicrotask(() => this.onerror?.(streamEndEvent(reason)));
  }

  private async open(): Promise<void> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (this.opcoes.lastEventId) headers['Last-Event-ID'] = this.opcoes.lastEventId;

    let resposta: Response;
    try {
      resposta = await fetch(this.url, {
        headers,
        signal: this.abort.signal,
        // usetheoai/theo#477 step 3: the stream is authenticated by the session
        // cookie, like every other dashboard call. No credential in the URL or
        // in a header the page could read.
        credentials: 'same-origin',
      });
    } catch {
      // Inclui o abort do próprio `close()`, que não é falha: `falhar()` já
      // ignora quando fechado.
      this.falhar({ kind: 'network-error' });
      return;
    }

    if (this.fechado) return;
    if (!resposta.ok || !resposta.body) {
      // B-172 — o status era conhecido aqui e descartado na linha seguinte, e sem ele o
      // consumidor so conseguia escrever "qualquer nao-2xx e a credencial".
      // Um corpo ausente num 2xx nao tem status util a reportar: `0` e o valor que `ApiError` ja
      // usa para "sem resposta", e a mesma leitura vale aqui.
      this.falhar({ kind: 'http-error', status: resposta.ok ? 0 : resposta.status });
      return;
    }

    this.readyState = FetchEventSource.OPEN;
    this.onopen?.(new Event('open'));

    const leitor = resposta.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (this.fechado) return;
        if (done) break;
        this.consumir(decoder.decode(value, { stream: true }));
      }
    } catch {
      this.falhar({ kind: 'network-error' });
      return;
    }

    // O servidor encerrou. O `EventSource` nativo reconectaria sozinho; aqui
    // quem reconecta é o `useSSEStream`, e ele só sabe fazê-lo quando vê
    // `onerror`. Sem isto, um stream encerrado ficaria morto em silêncio.
    this.falhar({ kind: 'server-closed' });
  }

  /** Acumula o chunk e despacha cada frame completo. */
  private consumir(chunk: string): void {
    this.resto += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Um frame termina em linha em branco. O que sobra depois do último
    // separador é o começo do próximo — a rede parte onde quiser, e um evento
    // grande (o caso comum num log) chegaria cortado sem este buffer.
    const partes = this.resto.split('\n\n');
    this.resto = partes.pop() ?? '';
    for (const raw of partes) {
      const frame = this.parsear(raw);
      if (frame) this.despachar(frame);
    }
  }

  private parsear(raw: string): Frame | null {
    const dados: string[] = [];
    let tipo = 'message';
    let id = '';
    for (const row of raw.split('\n')) {
      // Comentário de keep-alive. Proxies mandam a cada poucos segundos;
      // tratá-lo como evento entregaria lixo ao reducer o tempo todo.
      if (row.startsWith(':') || row === '') continue;
      const sep = row.indexOf(':');
      const field = sep === -1 ? row : row.slice(0, sep);
      // Um único espaço depois do `:` é do protocolo e não do valor.
      const value = sep === -1 ? '' : row.slice(sep + 1).replace(/^ /, '');
      if (field === 'data') dados.push(value);
      else if (field === 'event') tipo = value;
      else if (field === 'id') id = value;
      // `retry` é ignorado: quem controla o backoff aqui é o useSSEStream.
    }
    if (dados.length === 0) return null;
    // Regra do protocolo: linhas de `data` se juntam com quebra de linha. Sem
    // isso um JSON formatado chegaria inválido e um log com quebras chegaria
    // colado numa linha só.
    return { tipo, data: dados.join('\n'), id };
  }

  private despachar({ tipo, data, id }: Frame): void {
    if (this.fechado) return;
    const event = { data, lastEventId: id, type: tipo } as unknown as MessageEvent;
    // O nativo separa nomeado de genérico. Entregar um nomeado também no
    // `onmessage` duplicaria todo evento para quem usa os dois.
    if (tipo === 'message') this.onmessage?.(event);
    for (const fn of this.ouvintes.get(tipo) ?? []) fn(event);
  }
}
