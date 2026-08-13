import type { SignalName } from '@/hooks/projects/signals';
import type { ReadinessStatus } from '@/hooks/projects/status-icons';

/**
 * As oito regras de readiness, como DADOS (B-225).
 *
 * ## Por que elas saíram do hook
 *
 * O `useMemo` de `use-readiness-signals.ts` media CCN 30 — a maior do repositório depois que a
 * timeline de deploy foi separada. Não era um algoritmo difícil: eram oito derivações
 * INDEPENDENTES empilhadas num literal de objeto, cada uma com seu próprio ternário aninhado. A
 * complexidade era de acúmulo, não de lógica.
 *
 * Como tabela, cada regra é uma função pura de `Medidas` e ganha teste próprio sem montar
 * componente nem mockar três hooks — que era exatamente o que impedia testar a regra do
 * `logs_healthy` (três faixas de 5xx) em isolamento.
 *
 * ## O que NÃO mudou, de propósito
 *
 * A semântica tristate continua: `unknown` significa "não deu para medir" e é excluído do
 * numerador E do denominador do score. Um hook composto que falha não colore a linha de vermelho —
 * a causa seria a nossa camada de medição, e não o projeto de quem está lendo.
 */

/** O que as regras têm para decidir: o resultado já lido dos três hocks compostos. */
export interface Medidas {
  /** A linha do projeto não resolveu (sonda cross-tenant, 401). */
  readonly projetoIndisponivel: boolean;
  /** `useProjectStatus` falhou ou não trouxe corpo. */
  readonly statusIndisponivel: boolean;
  /** `useDeployments` falhou. */
  readonly deploysIndisponiveis: boolean;
  readonly ultimoDeploy: unknown;
  readonly replicasDesejadas: number;
  readonly replicasProntas: number;
  readonly alertasAtivos: number;
  readonly pct5xx1h: number;
  readonly totalBuilds: number;
}

/**
 * Adapta a saída dos três hooks compostos para `Medidas`.
 *
 * Vive aqui, com nome, porque é uma responsabilidade própria — traduzir três formatos de resposta
 * (cada um com o próprio jeito de dizer "não sei") num vocabulário único — e porque assim é
 * testável sem montar componente. A densidade de `??` é inerente: são nove leituras que podem
 * faltar, e um default silencioso em cada uma seria pior escondido dentro do hook.
 */
export function lerMedidas(entrada: {
  projeto: { last_deploy?: unknown } | undefined;
  statusError: unknown;
  status: {
    replicas_desired?: number;
    replicas_ready?: number;
    alerts_active?: number;
    traffic_5xx_pct_1h?: number;
  } | null | undefined;
  deploysError: unknown;
  builds: readonly unknown[] | undefined;
}): Medidas {
  return {
    projetoIndisponivel: !entrada.projeto,
    statusIndisponivel: Boolean(entrada.statusError) || !entrada.status,
    deploysIndisponiveis: Boolean(entrada.deploysError),
    ultimoDeploy: entrada.projeto?.last_deploy ?? null,
    replicasDesejadas: entrada.status?.replicas_desired ?? 0,
    replicasProntas: entrada.status?.replicas_ready ?? 0,
    alertasAtivos: entrada.status?.alerts_active ?? 0,
    pct5xx1h: entrada.status?.traffic_5xx_pct_1h ?? 0,
    totalBuilds: entrada.builds?.length ?? 0,
  };
}

type Regra = (m: Medidas) => ReadinessStatus;

export const REGRAS: Readonly<Record<SignalName, Regra>> = {
  // Proxy de auto-deploy: um `last_deploy` não-nulo significa que o repositório construiu ao menos
  // uma vez — logo, a cadeia de auto-deploy está ligada.
  auto_deploy: (m) => (m.projetoIndisponivel ? 'unknown' : m.ultimoDeploy ? 'pass' : 'fail'),

  // HPA configurado = mais de uma réplica desejada (alguém escolheu uma postura de escala
  // não-trivial).
  hpa_configured: (m) => (m.statusIndisponivel ? 'unknown' : m.replicasDesejadas > 1 ? 'pass' : 'fail'),

  // Duas ou mais réplicas EFETIVAMENTE servindo — desejar não basta.
  two_plus_replicas: (m) => (m.statusIndisponivel ? 'unknown' : m.replicasProntas >= 2 ? 'pass' : 'fail'),

  // A contagem de secrets ainda não vem na resposta de status. Enquanto não vier, o sinal fica
  // `unknown` — que é a superfície honesta de "não conseguimos medir isto agora", e não um `fail`
  // que culparia o projeto por uma lacuna nossa.
  secrets_rotated: () => 'unknown',

  // Domínios (J-11) não foram lançados.
  custom_domain: () => 'unknown',

  // `alerts_active > 0` prova que existem alertas configurados — eles dispararam. Zero é ambíguo
  // (nenhum alerta configurado OU tudo saudável) e por isso continua `unknown`.
  alerts_configured: (m) =>
    m.statusIndisponivel ? 'unknown' : m.alertasAtivos > 0 ? 'warn' : 'unknown',

  // Faixas de 5xx em 1h, alinhadas ao SLO canônico do Theo.
  logs_healthy: (m) => {
    if (m.statusIndisponivel) return 'unknown';
    if (m.pct5xx1h < 0.01) return 'pass';
    if (m.pct5xx1h < 0.05) return 'warn';
    return 'fail';
  },

  // Taxa de cache não existe na API v1. Um projeto sem nenhum deploy também não tem o que medir.
  cache_hit_rate: (m) => (m.deploysIndisponiveis || m.totalBuilds === 0 ? 'unknown' : 'pass'),
};
