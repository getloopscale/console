import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SharedEventSource, __resetSharedEventSources, __setTransporte } from './shared-event-source';

/**
 * B-020 — uma conexão por URL, quantos consumidores quiserem.
 *
 * ## Por que no transporte e não no hook
 *
 * `useSSEStream` carrega lógica delicada que custou caro: recuperação de token,
 * backoff, e o conserto do B-014 (num erro HTTP não-2xx o browser FECHA o
 * EventSource, `onerror` roda uma vez só, e o limiar de 3 falhas nunca
 * disparava). Mover a criação da conexão para dentro de um registro
 * refcontado obrigaria a mover essa lógica junto.
 *
 * Trocar `new EventSource` por `new SharedEventSource` não obriga a nada: cada
 * consumidor continua com o seu `onopen`/`onmessage`/`close`/`readyState`, e a
 * multiplexação é invisível para ele. O raio da mudança é uma linha.
 *
 * ## O que a classe promete
 *
 * Mesma URL → uma conexão real. O último a fechar desliga. Quem chega depois
 * recebe o que já passou, senão a segunda aba renderiza vazia enquanto a
 * primeira mostra o build inteiro.
 */

class FakeEventSource {
  static criadas: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  fechada = false;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor(public url: string) {
    FakeEventSource.criadas.push(this);
  }
  addEventListener(t: string, fn: (e: unknown) => void) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]);
  }
  removeEventListener() {}
  close() {
    this.fechada = true;
    this.readyState = 2;
  }
  /** Dispara como o browser dispararia. */
  emitir(tipo: string, data: string, id = '1') {
    const ev = { data, lastEventId: id };
    if (tipo === 'message') this.onmessage?.(ev);
    for (const fn of this.listeners.get(tipo) ?? []) fn(ev);
  }
  abrir() {
    this.readyState = 1;
    this.onopen?.({});
  }
  falhar() {
    this.readyState = 2;
    this.onerror?.({});
  }
}

describe('SharedEventSource (B-020)', () => {
  beforeEach(() => {
    FakeEventSource.criadas = [];
    __resetSharedEventSources();
    // B-088 — o transporte e injetado, nao global: `FetchEventSource` fala por
    // `fetch` para que o JWT va no header. O fake expoe a mesma superficie.
    __setTransporte((url) => new FakeEventSource(url) as unknown as EventSource);
  });
  afterEach(() => {
    __setTransporte(null);
    vi.unstubAllGlobals();
  });

  it('dois consumidores da MESMA url abrem UMA conexão real', () => {
    new SharedEventSource('/stream?token=a');
    new SharedEventSource('/stream?token=a');
    expect(FakeEventSource.criadas).toHaveLength(1);
  });

  it('urls DIFERENTES continuam com conexões próprias', () => {
    new SharedEventSource('/stream/build-1');
    new SharedEventSource('/stream/build-2');
    // A deduplicação que ignorasse a URL entregaria os eventos do build errado
    // — pior que a conexão extra que ela economiza.
    expect(FakeEventSource.criadas).toHaveLength(2);
  });

  it('um evento chega a TODOS os consumidores', () => {
    const a = new SharedEventSource('/s');
    const b = new SharedEventSource('/s');
    const recebidoA: string[] = [];
    const recebidoB: string[] = [];
    a.onmessage = (e) => recebidoA.push((e as MessageEvent).data as string);
    b.onmessage = (e) => recebidoB.push((e as MessageEvent).data as string);

    FakeEventSource.criadas[0].emitir('message', 'oi');
    expect(recebidoA).toEqual(['oi']);
    expect(recebidoB).toEqual(['oi']);
  });

  it('eventos NOMEADOS chegam a quem os registrou', () => {
    const a = new SharedEventSource('/s');
    const b = new SharedEventSource('/s');
    const vistos: string[] = [];
    a.addEventListener('build.step.started', () => vistos.push('a'));
    b.addEventListener('build.step.started', () => vistos.push('b'));

    FakeEventSource.criadas[0].emitir('build.step.started', '{}');
    // A conexão real registra o tipo UMA vez; o fan-out é nosso. Registrar por
    // consumidor faria o browser chamar N vezes o mesmo handler compartilhado.
    expect(vistos).toEqual(['a', 'b']);
  });

  it('quem chega DEPOIS recebe o que já passou', async () => {
    const a = new SharedEventSource('/s');
    const recebidoA: string[] = [];
    a.onmessage = (e) => recebidoA.push((e as MessageEvent).data as string);
    FakeEventSource.criadas[0].abrir();
    FakeEventSource.criadas[0].emitir('message', 'passo-1');

    const b = new SharedEventSource('/s');
    const recebidoB: string[] = [];
    b.onmessage = (e) => recebidoB.push((e as MessageEvent).data as string);

    // O replay sai numa microtask, e TEM de sair: o consumidor atribui
    // `onmessage` depois que o construtor retorna, então entregar de dentro do
    // construtor entregaria a ninguém. A espera aqui reproduz o que acontece de
    // verdade — o hook termina de montar antes de o replay chegar.
    await Promise.resolve();

    // Sem o replay, a aba que monta depois renderiza vazia enquanto a outra
    // mostra o build inteiro — regressão visível, e o motivo pelo qual a
    // deduplicação ingênua é pior que a duplicação que ela corrige.
    expect(recebidoB).toEqual(['passo-1']);
  });

  it('quem chega depois de a conexão ABRIR recebe onopen', async () => {
    new SharedEventSource('/s');
    FakeEventSource.criadas[0].abrir();

    const b = new SharedEventSource('/s');
    let abriu = false;
    b.onopen = () => (abriu = true);
    await Promise.resolve();
    // `connected` do consumidor sai de `onopen`. Sem isto o segundo ficaria
    // "conectando" para sempre sobre uma conexão que está aberta.
    expect(abriu).toBe(true);
  });

  it('fechar UM não derruba o outro; fechar o último derruba a conexão', () => {
    const a = new SharedEventSource('/s');
    const b = new SharedEventSource('/s');
    const real = FakeEventSource.criadas[0];

    a.close();
    expect(real.fechada).toBe(false);
    b.close();
    expect(real.fechada).toBe(true);
  });

  it('depois do último fechar, uma nova assinatura abre conexão NOVA', () => {
    new SharedEventSource('/s').close();
    new SharedEventSource('/s');
    // Reaproveitar uma entrada já fechada entregaria um EventSource morto e o
    // stream ficaria em silêncio — o modo de falha mais caro, porque parece
    // "sem eventos" em vez de "quebrado".
    expect(FakeEventSource.criadas).toHaveLength(2);
  });

  it('um erro chega a todos e a entrada é DESPEJADA para a próxima abrir limpa', () => {
    const a = new SharedEventSource('/s');
    const b = new SharedEventSource('/s');
    let erroA = false;
    let erroB = false;
    a.onerror = () => (erroA = true);
    b.onerror = () => (erroB = true);

    FakeEventSource.criadas[0].falhar();
    expect(erroA).toBe(true);
    expect(erroB).toBe(true);

    // O despejo é o que torna a reconexão do useSSEStream correta sob
    // compartilhamento: ele reage ao erro fechando e reabrindo. Sem despejar,
    // o reabrir entraria na MESMA entrada morta e o stream nunca voltaria.
    a.close();
    new SharedEventSource('/s');
    expect(FakeEventSource.criadas).toHaveLength(2);
  });

  it('readyState espelha a conexão real', () => {
    const a = new SharedEventSource('/s');
    expect(a.readyState).toBe(0);
    FakeEventSource.criadas[0].abrir();
    expect(a.readyState).toBe(1);
    a.close();
    // Depois de fechar, o próprio consumidor está CLOSED mesmo que outro siga
    // ligado — `readyState` é o estado DELE, e o useSSEStream lê isso.
    expect(a.readyState).toBe(2);
  });
});
