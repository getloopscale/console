import {
  PHASE_ORDER,
  type DeployTimelineEventPayload,
  type Phase,
  type PhaseStatus,
} from '@/hooks/deploy/deploy-timeline-events';
import type { PhaseState } from '@/hooks/deploy/use-deploy-timeline';

/**
 * A máquina de estados da timeline de deploy, fora do React (B-181, B-182).
 *
 * ## Por que ela saiu do `useMemo`
 *
 * **B-181 — durabilidade.** O estado das fases era RE-DERIVADO a cada render, varrendo
 * `stream.events` do zero. Aquele buffer é um FIFO com teto de 60 eventos: quando o 61º chega, o
 * primeiro é descartado — e se o descartado for `deploy_timeline.build.completed`, a fase de build
 * volta a `pending` numa tela que já a mostrou concluída. Um deploy longo, ou uma reconexão que
 * reenvia eventos, e a timeline anda para trás sozinha.
 *
 * Estado durável não pode ser derivado de uma janela deslizante. Ele é ACUMULADO: cada evento é
 * aplicado uma vez, quando chega, e o que ele estabeleceu não depende de o evento continuar no
 * buffer. É o padrão que `hooks/projects/use-status-stream.ts` já usa.
 *
 * **B-182 — complexidade.** O mesmo `useMemo` media CCN 31, o mais alto do repositório (`lizard`,
 * medido 2026-08-11). Não era complexidade acidental: eram quatro responsabilidades num bloco só —
 * aplicar evento, herdar conclusão para trás, escolher a fase corrente e derivar o estado geral.
 * Separadas, cada uma cabe na cabeça e ganha teste próprio; juntas, nenhuma tinha.
 *
 * Fora do React também torna tudo testável sem montar componente — a mesma razão pela qual
 * `lib/list-state.ts` e `pages/skills/catalog-kpis.ts` moram fora do JSX.
 */

/** O estado acumulado da timeline. Imutável por convenção: cada função devolve um novo. */
export interface TimelineState {
  readonly phases: readonly PhaseState[];
  readonly aggregatorDegradedReason: string | null;
}

export function estadoInicial(): TimelineState {
  return {
    phases: PHASE_ORDER.map((phase) => ({
      phase,
      status: 'pending' as const,
      startedAt: null,
      endedAt: null,
      substateMessage: null,
      degradedReason: null,
      steps: [],
    })),
    aggregatorDegradedReason: null,
  };
}

/** O evento como chega do transporte: um tipo `deploy_timeline.<fase>.<status>` e um payload. */
export interface TimelineEvent {
  readonly type: string;
  readonly data: unknown;
}

/**
 * Aplica UM evento ao estado. Pura: mesmo estado + mesmo evento = mesmo resultado.
 *
 * Um evento que não reconhece devolve o estado INTACTO — e por identidade, para que o consumidor
 * consiga distinguir "nada mudou" sem comparar campo a campo.
 */
export function aplicarEvento(estado: TimelineState, ev: TimelineEvent): TimelineState {
  if (ev.type === 'deploy_timeline.aggregator.degraded') {
    const payload = ev.data as { degraded_reason?: string };
    return {
      ...estado,
      aggregatorDegradedReason: payload.degraded_reason ?? 'Timeline temporarily unavailable.',
    };
  }

  const parts = ev.type.split('.');
  if (parts.length !== 3 || parts[0] !== 'deploy_timeline') return estado;
  const phase = parts[1] as Phase;
  const status = parts[2] as PhaseStatus;
  if (!PHASE_ORDER.includes(phase)) return estado;

  const payload = ev.data as DeployTimelineEventPayload;
  const phases = estado.phases.map((cell) =>
    cell.phase === phase ? aplicarNaFase(cell, status, payload) : cell,
  );
  return { ...estado, phases: inheritCompletionBackwards(phases) };
}

function aplicarNaFase(
  cell: PhaseState,
  status: PhaseStatus,
  payload: DeployTimelineEventPayload,
): PhaseState {
  const terminal = status === 'completed' || status === 'failed' || status === 'canceled';
  return {
    ...cell,
    status,
    startedAt: cell.startedAt ?? payload.timestamp ?? null,
    endedAt: terminal ? (payload.timestamp ?? cell.endedAt) : cell.endedAt,
    substateMessage: payload.substate_message ?? cell.substateMessage,
    degradedReason: payload.degraded_reason ?? cell.degradedReason,
  };
}

/**
 * Uma fase ANTERIOR a uma concluída herda `completed` (B-174).
 *
 * Defesa contra chegada fora de ordem numa reconexão: se `deploy.completed` chega antes de
 * `build.completed`, a fase de build não pode ficar `pending` para sempre. Aqui havia um laço cujo
 * único corpo era um `if` vazio, sob um comentário afirmando que a defesa existia.
 */
function inheritCompletionBackwards(phases: readonly PhaseState[]): PhaseState[] {
  const saida = [...phases];
  let concluidaAdiante = false;
  for (let i = saida.length - 1; i >= 0; i -= 1) {
    if (saida[i].status === 'completed') { concluidaAdiante = true; continue; }
    if (concluidaAdiante && saida[i].status === 'pending') {
      saida[i] = { ...saida[i], status: 'completed' };
    }
  }
  return saida;
}

/**
 * A fase que a tela deve destacar.
 *
 * Primeiro a que está viva; sem nenhuma viva, a última que saiu de `pending` (o deploy terminou);
 * sem nenhuma, a primeira (estado inicial, antes de qualquer evento).
 */
export function faseCorrente(phases: readonly PhaseState[]): PhaseState {
  const viva = phases.find((c) => c.status === 'in_progress' || c.status === 'degraded');
  if (viva) return viva;
  const ultimaTocada = [...phases].reverse().find((c) => c.status !== 'pending');
  return ultimaTocada ?? phases[0];
}
