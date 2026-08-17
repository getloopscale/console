/**
 * "Tem algo errado agora?" — a pergunta que nenhuma outra tela do produto responde (B-125).
 *
 * ## Por que ela não tem dono
 *
 * Cada capacidade só enxerga a si mesma. A tela do Lens sabe da taxa de erro, a do Trust sabe do
 * que foi barrado, a do RAG sabe dos retrievals vazios — e ninguém junta. O operador só descobre
 * um problema abrindo a capacidade certa, o que exige já suspeitar de qual é. Esta é a única
 * superfície do produto de onde a pergunta é respondível.
 *
 * ## O que este módulo recusa fazer
 *
 * Inventar um sinal que o dado não sustenta. O desenho que originou este item mostrava uma linha
 * de "deploys falhos"; medido em `hooks/overview/use-build-stats.ts:14`, `BuildStatsDay` é
 * `{ date, count }` — **não há contagem de falha**. Aquela linha teria sido fabricação com
 * aparência de dado, que é o defeito mais caro deste repositório porque tudo a jusante trata como
 * fato.
 *
 * `ATTENTION_SOURCES` é a declaração do que existe, e `attention.test.ts` quantifica sobre ela:
 * uma quarta fonte não entra sem passar por aqui, e a ausência de `deploys` é travada por um caso
 * próprio para não voltar por engano.
 *
 * ## Por que limiares, e não "qualquer valor acima de zero"
 *
 * Uma faixa que sempre tem linhas é uma faixa que ninguém lê — e aí ela deixa de mostrar o caso
 * real. Os limiares são declarados por fonte, com o motivo de cada número ao lado, porque um
 * limiar sem justificativa é opinião que ninguém consegue revisar depois.
 */

/** A leitura de uma consulta, no mesmo formato que `capabilities.ts` já usa. */
export interface SignalReading {
  readonly failed: boolean;
  readonly loading: boolean;
  readonly dados: unknown;
}

export interface AttentionReading {
  readonly observability: SignalReading;
  readonly rag: SignalReading;
  readonly trust: SignalReading;
}

/**
 * A severidade de um item.
 *
 * Discriminada no TIPO e nunca deduzida do texto — a lição do `B-111`, onde um código decidia
 * comportamento lendo a mensagem humana e quebrou em silêncio quando as frases mudaram.
 */
type AttentionSeverity = 'critical' | 'warning';

export interface AttentionItem {
  readonly id: string;
  readonly severity: AttentionSeverity;
  /** A frase que o operador lê primeiro. Carrega o número, porque "há erros" não é acionável. */
  readonly headline: string;
  /** O que a frase não coube dizer: onde olhar, ou o que ela implica. */
  readonly detail: string;
  /** Para onde o operador vai agir. Uma linha que não leva a lugar nenhum informa e não resolve. */
  readonly path: string;
  readonly cta: string;
}

/** As capacidades de onde um item pode nascer, e o destino de cada uma. */
export const ATTENTION_SOURCES = [
  { id: 'agent-errors', capability: 'observability', path: '/observability' },
  { id: 'empty-retrievals', capability: 'rag', path: '/rag' },
  { id: 'blocked', capability: 'trust', path: '/trust' },
] as const;

/**
 * Limiares, com o motivo de cada número.
 *
 * `AGENT_ERROR_WARN` a 2%: abaixo disso o ruído de timeouts e retries domina, e uma faixa que
 * acende com um erro em cem passa a acender sempre.
 *
 * `AGENT_ERROR_CRIT` a 10%: um em dez é a fronteira em que o operador precisa agir agora, e não
 * na próxima manhã.
 *
 * `EMPTY_RETRIEVAL_WARN` a 5%: a base foi perguntada e não tinha resposta. Acima disso o problema
 * é da base, não da pergunta.
 *
 * Bloqueios não têm limiar percentual — qualquer bloqueio é um evento que alguém quis fazer e o
 * produto impediu, e o operador precisa saber que aconteceu.
 */
const AGENT_ERROR_WARN = 0.02;
const AGENT_ERROR_CRIT = 0.1;
const EMPTY_RETRIEVAL_WARN = 0.05;

function readSuccessfully(r: SignalReading): boolean {
  // Uma consulta assentada sem dado é uma leitura que FALHOU, não um sistema saudável — o mesmo
  // raciocínio de `capabilities.ts`. Um "nada a reportar" derivado de ignorância é pior que
  // silêncio: ele afirma saúde.
  return !r.failed && !r.loading && r.dados != null;
}

function porcentagem(v: number): string {
  return `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

function errorRate(dados: unknown): { total: number; failures: number } | null {
  if (typeof dados !== 'object' || dados === null) return null;
  const traffic = (dados as { traffic?: unknown }).traffic;
  if (!Array.isArray(traffic) || traffic.length === 0) return null;

  let total = 0;
  let failures = 0;
  for (const b of traffic) {
    if (typeof b !== 'object' || b === null) continue;
    const bucket = b as { traceCount?: unknown; errorCount?: unknown };
    if (typeof bucket.traceCount === 'number') total += bucket.traceCount;
    if (typeof bucket.errorCount === 'number') failures += bucket.errorCount;
  }
  return total === 0 ? null : { total, failures };
}

function emptyRetrievalRate(dados: unknown): { taxa: number; retrievals: number } | null {
  if (typeof dados !== 'object' || dados === null) return null;
  const totals = (dados as { totals?: unknown }).totals;
  if (typeof totals !== 'object' || totals === null) return null;
  const t = totals as { empty_retrieval_rate?: unknown; retrievals?: unknown };
  if (typeof t.empty_retrieval_rate !== 'number') return null;
  return {
    taxa: t.empty_retrieval_rate,
    retrievals: typeof t.retrievals === 'number' ? t.retrievals : 0,
  };
}

function bloqueios(dados: unknown): { total: number; principal: string | null } | null {
  if (typeof dados !== 'object' || dados === null) return null;
  const events = (dados as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;

  // Só `block`. Contar `modify` e `allow` junto produziria um número maior e sem significado:
  // "eventos de enforcement" inclui o que passou.
  const barrados = events.filter(
    (e) => typeof e === 'object' && e !== null && (e as { decision?: unknown }).decision === 'block',
  );
  if (barrados.length === 0) return null;

  const porGuardrail = new Map<string, number>();
  for (const e of barrados) {
    const name = (e as { validatorName?: unknown }).validatorName;
    if (typeof name === 'string') porGuardrail.set(name, (porGuardrail.get(name) ?? 0) + 1);
  }
  const principal = [...porGuardrail.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { total: barrados.length, principal };
}

const ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1 };

/**
 * Os itens que precisam do operador, mais severo primeiro.
 *
 * A ordenação é por severidade e não pela ordem em que as fontes foram declaradas: quem lê a
 * faixa lê de cima, e um aviso acima de um crítico seria um acidente de código decidindo o que a
 * pessoa vê primeiro.
 */
export function attentionItems(leitura: AttentionReading): AttentionItem[] {
  const itens: AttentionItem[] = [];

  if (readSuccessfully(leitura.observability)) {
    const failure = errorRate(leitura.observability.dados);
    if (failure !== null) {
      const taxa = failure.failures / failure.total;
      if (taxa >= AGENT_ERROR_WARN) {
        itens.push({
          id: 'agent-errors',
          severity: taxa >= AGENT_ERROR_CRIT ? 'critical' : 'warning',
          headline: `${porcentagem(taxa)} of agent runs failed`,
          detail: `${String(failure.failures)} of ${String(failure.total)} runs returned an error.`,
          path: '/observability',
          cta: 'Open Observability',
        });
      }
    }
  }

  if (readSuccessfully(leitura.rag)) {
    const empty = emptyRetrievalRate(leitura.rag.dados);
    if (empty !== null && empty.taxa >= EMPTY_RETRIEVAL_WARN) {
      itens.push({
        id: 'empty-retrievals',
        severity: 'warning',
        headline: `${porcentagem(empty.taxa)} of retrievals came back empty`,
        detail:
          empty.retrievals > 0
            ? `Your knowledge base was asked ${String(empty.retrievals)} times and had nothing to answer with.`
            : 'Your knowledge base was asked and had nothing to answer with.',
        path: '/rag',
        cta: 'Open Knowledge Base',
      });
    }
  }

  if (readSuccessfully(leitura.trust)) {
    const barrado = bloqueios(leitura.trust.dados);
    if (barrado !== null) {
      itens.push({
        id: 'blocked',
        severity: 'critical',
        headline: `${String(barrado.total)} requests blocked`,
        detail:
          barrado.principal === null
            ? 'A guardrail stopped content before it reached a model.'
            : `Mostly ${barrado.principal}. Someone is sending content a guardrail refuses.`,
        path: '/trust',
        cta: 'Review in Trust',
      });
    }
  }

  return itens.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
