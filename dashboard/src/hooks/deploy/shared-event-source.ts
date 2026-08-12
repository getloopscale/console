/**
 * B-020 — uma conexão SSE por URL, quantos consumidores quiserem.
 *
 * ## O defeito
 *
 * A aba Timeline de um deploy abria TRÊS `EventSource`, duas para a mesma URL:
 * `DeployTimelineHero` (montado pelo layout) e `BuildTimelineLive` (dentro do
 * `<Outlet/>`) assinam o mesmo build no caso normal. O browser concede ~6
 * conexões por domínio; gastar duas com o mesmo stream tira uma do resto da
 * página e dobra o trabalho do servidor por espectador.
 *
 * ## Por que no transporte
 *
 * As duas saídas óbvias mexiam em composição — passar os steps por prop desde o
 * layout, ou deduplicar dentro de `useSSEStream` com refcount. A segunda
 * obrigaria a mover para dentro de um registro toda a lógica de recuperação de
 * token, backoff e o conserto do B-014 (num erro HTTP não-2xx o browser fecha o
 * EventSource, `onerror` roda uma única vez e o limiar de 3 falhas nunca
 * disparava). Código delicado, e a única razão para mexer nele seria a
 * deduplicação — que não é assunto dele.
 *
 * Esta classe implementa a superfície de `EventSource` que o hook usa e
 * compartilha a conexão real por URL. Do lado do consumidor nada muda: ele tem o
 * seu `onopen`, o seu `onmessage`, o seu `close()`, o seu `readyState`. A troca
 * no hook é de uma linha.
 *
 * ## As duas regras que não são óbvias
 *
 * **Replay.** Quem assina depois recebe o que já passou. Sem isso a aba que
 * monta depois renderiza vazia enquanto a outra mostra o build inteiro — uma
 * deduplicação ingênua seria pior que a duplicação que ela corrige.
 *
 * **Despejo no erro.** `useSSEStream` reage a `onerror` fechando e reabrindo.
 * Sob compartilhamento, o reabrir cairia na MESMA entrada morta e o stream
 * ficaria em silêncio para sempre — a falha mais cara, porque parece "sem
 * eventos" e não "quebrado". Por isso a entrada sai do registro assim que a
 * conexão real falha: quem reabrir cria uma nova.
 */

import { FetchEventSource } from '@/hooks/deploy/fetch-event-source';

type Ouvinte = (event: MessageEvent) => void;

interface Entrada {
  real: EventSource;
  handles: Set<SharedEventSource>;
  /** Tipos nomeados já ligados na conexão real — ligamos uma vez por tipo. */
  tiposLigados: Set<string>;
  /** O que já passou, para quem chegar depois. */
  buffer: { tipo: string; event: MessageEvent }[];
  aberta: boolean;
}

/**
 * Teto do replay. Um stream de build longo não pode virar um vazamento de
 * memória por causa de um consumidor hipotético que talvez nunca chegue.
 * Perder o começo de um stream gigantesco é aceitável; segurá-lo inteiro na
 * memória de quem já o consumiu não é.
 */
const REPLAY_MAX = 1000;

const registro = new Map<string, Entrada>();

/**
 * A identidade de uma assinatura: o endereço MAIS o ponto de retomada (B-220).
 *
 * O separador é um caractere que não aparece numa URL nem num id de evento, para que
 * `('/a', 'b')` e `('/a\u0000b', null)` não colidam — uma colisão de chave aqui entrega a
 * um assinante o stream de outro.
 */
function chaveDe(url: string, lastEventId: string | null | undefined): string {
  return `${url}\u0000${lastEventId ?? ''}`;
}

/**
 * Fabrica do transporte. Existe como variavel — e nao como `new FetchEventSource`
 * inline — por um motivo de teste que vale declarar em voz alta.
 *
 * Ate 2026-08-07 o transporte era o `EventSource` global, e os nove arquivos de
 * teste de SSE o substituiam com `vi.stubGlobal`. O B-088 trocou o transporte
 * por `fetch` (para tirar o JWT da URL) e esse seam sumiu junto. As opcoes eram
 * reescrever os nove fakes para servir um corpo SSE de verdade, ou expor o ponto
 * de troca.
 *
 * A segunda ganhou porque os testes daqueles arquivos NAO sao sobre o fio: eles
 * cobrem reducer, cap FIFO, reconexao e contagem de conexoes. Faze-los passar
 * por um parser de SSE acrescentaria uma fonte de falha que nao tem a ver com o
 * que eles afirmam. O parser tem os seus proprios doze testes em
 * `fetch-event-source.test.ts`, e la o fio e o assunto.
 */
type Transporte = (url: string, opcoes: { token: string | null; lastEventId?: string | null }) => EventSource;

let criarTransporte: Transporte = (url, opcoes) =>
  new FetchEventSource(url, opcoes) as unknown as EventSource;

/** So para teste — troca o transporte. Ver o bloco acima para o porque. */
export function __setTransporte(t: Transporte | null): void {
  criarTransporte = t ?? ((url, opcoes) => new FetchEventSource(url, opcoes) as unknown as EventSource);
}

/** Só para teste — o registro é global por natureza e precisa zerar entre casos. */
export function __resetSharedEventSources(): void {
  for (const e of registro.values()) e.real.close();
  registro.clear();
}

export class SharedEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  onopen: ((event: Event) => void) | null = null;
  onmessage: Ouvinte | null = null;
  onerror: ((event: Event) => void) | null = null;

  private ouvintes = new Map<string, Ouvinte[]>();
  private entrada: Entrada;
  private readonly chave: string;
  private fechado = false;

  constructor(
    public readonly url: string,
    private readonly opcoes: { token: string | null; lastEventId?: string | null } = { token: null },
  ) {
    // B-220 — a chave passou a incluir o CURSOR DE RETOMADA.
    //
    // No acerto do registro, `this.opcoes` era construído e nunca lido: um segundo assinante
    // pedindo retomada de outro ponto recebia silenciosamente o ponto do primeiro. Dois cursores
    // diferentes são dois pedidos de DADOS diferentes, e uma conexão só não serve os dois —
    // `recuperarAtraso()` reproduz um buffer limitado, então um cursor mais antigo que ele não
    // tem como ser atendido, e fingir que sim é o mesmo silêncio.
    //
    // O TOKEN continua fora da chave, de propósito e por assimetria real: ele é credencial para o
    // MESMO dado, e duas abas que renovaram em instantes diferentes não devem abrir duas conexões
    // para um build — ver `abrirNova` logo abaixo.
    const chave = chaveDe(url, this.opcoes.lastEventId);
    this.chave = chave;
    const existente = registro.get(chave);
    if (existente) {
      this.entrada = existente;
      existente.handles.add(this);
      // O consumidor ainda vai atribuir `onmessage`/`addEventListener` DEPOIS
      // do construtor. Entregar o replay agora chegaria antes dos handlers
      // existirem — por isso ele sai numa microtask.
      queueMicrotask(() => this.recuperarAtraso());
      return;
    }
    this.entrada = this.abrirNova(url, chave);
  }

  private abrirNova(url: string, chave: string): Entrada {
    // B-088 — o transporte e `FetchEventSource`, nao `EventSource`: o token vai
    // em `Authorization` e some da URL. Efeito colateral util: a chave do
    // registro passa a ser a URL LIMPA, entao dois consumidores do mesmo stream
    // compartilham mesmo que tenham obtido o token em instantes diferentes.
    const real = criarTransporte(url, {
      token: this.opcoes.token,
      lastEventId: this.opcoes.lastEventId,
    });
    const entrada: Entrada = {
      real,
      handles: new Set([this]),
      tiposLigados: new Set(),
      buffer: [],
      aberta: false,
    };
    registro.set(chave, entrada);

    real.onopen = (event) => {
      entrada.aberta = true;
      for (const h of entrada.handles) h.onopen?.(event);
    };
    real.onmessage = (event) => this.distribuir(entrada, 'message', event);
    real.onerror = (event) => {
      // Despeja ANTES de avisar: o consumidor reage fechando e reabrindo, e o
      // reabrir precisa encontrar o registro limpo.
      if (registro.get(chave) === entrada) registro.delete(chave);
      entrada.aberta = false;
      for (const h of entrada.handles) h.onerror?.(event);
    };
    return entrada;
  }

  private distribuir(entrada: Entrada, tipo: string, event: MessageEvent): void {
    entrada.buffer.push({ tipo, event });
    if (entrada.buffer.length > REPLAY_MAX) entrada.buffer.shift();
    for (const h of entrada.handles) h.entregar(tipo, event);
  }

  /** Entrega ao consumidor deste handle, respeitando o que ele registrou. */
  private entregar(tipo: string, event: MessageEvent): void {
    if (this.fechado) return;
    if (tipo === 'message') this.onmessage?.(event);
    for (const fn of this.ouvintes.get(tipo) ?? []) fn(event);
  }

  /** Replay + `onopen` retroativo para quem assinou com a conexão já viva. */
  private recuperarAtraso(): void {
    if (this.fechado) return;
    if (this.entrada.aberta) this.onopen?.(new Event('open'));
    for (const { tipo, event } of this.entrada.buffer) this.entregar(tipo, event);
  }

  addEventListener(tipo: string, fn: Ouvinte): void {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) ?? []), fn]);
    // Liga o tipo na conexão real UMA vez. Ligar por consumidor faria o browser
    // chamar o mesmo handler compartilhado N vezes e duplicar todo evento.
    if (!this.entrada.tiposLigados.has(tipo)) {
      this.entrada.tiposLigados.add(tipo);
      const entrada = this.entrada;
      entrada.real.addEventListener(tipo, ((event: MessageEvent) => {
        this.distribuir(entrada, tipo, event);
      }) as EventListener);
    }
    // Um tipo registrado depois de o evento já ter passado ainda o recebe: o
    // buffer é por conexão, não por handle.
    queueMicrotask(() => {
      if (this.fechado) return;
      for (const { tipo: t, event } of this.entrada.buffer) {
        if (t === tipo) fn(event);
      }
    });
  }

  removeEventListener(tipo: string, fn: Ouvinte): void {
    const atuais = this.ouvintes.get(tipo);
    if (atuais) this.ouvintes.set(tipo, atuais.filter((f) => f !== fn));
  }

  close(): void {
    if (this.fechado) return;
    this.fechado = true;
    this.entrada.handles.delete(this);
    if (this.entrada.handles.size === 0) {
      this.entrada.real.close();
      if (registro.get(this.chave) === this.entrada) registro.delete(this.chave);
    }
  }

  /** O estado DESTE consumidor: fechado é fechado, mesmo com outros ligados. */
  get readyState(): number {
    if (this.fechado) return SharedEventSource.CLOSED;
    return this.entrada.real.readyState;
  }
}
