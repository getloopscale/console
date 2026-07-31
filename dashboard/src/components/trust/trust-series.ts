/**
 * M23 — projeções puras do payload do theo-trust para o que a tela desenha.
 *
 * Vive separado da página, sem React e sem I/O, pelo mesmo motivo de `lens-series.ts`: a aritmética
 * de um painel é onde os erros silenciosos moram (divisão por zero virando `NaN`, campo ausente
 * virando `undefined` renderizado como "undefined"), e testá-la exige apenas dados — não um DOM.
 *
 * Contrato de honestidade desta camada: um campo que o upstream não mandou é `null`, nunca `0`.
 * Num painel de segurança, "zero violações" e "não sei quantas violações" levam a decisões opostas,
 * e o segundo disfarçado do primeiro é um falso negativo — o mesmo raciocínio que faz o BFF
 * devolver 502 em vez de 200-vazio.
 */

/** Um balde da série temporal devolvida por `GET /v1/trends`. */
export interface TrendBucket {
  readonly bucket?: string;
  readonly total?: number;
  readonly [k: string]: unknown;
}

export interface TrendsPayload {
  readonly buckets?: readonly TrendBucket[];
  readonly [k: string]: unknown;
}

/** Uma violação de política devolvida por `GET /v1/policy-violations`. */
export interface PolicyViolation {
  readonly id?: string;
  readonly messageId?: string;
  readonly conversationId?: string;
  readonly policy?: string;
  readonly severity?: string;
  readonly detectedAt?: string;
  readonly [k: string]: unknown;
}

export interface ViolationsPayload {
  readonly violations?: readonly PolicyViolation[];
  readonly [k: string]: unknown;
}

/** Ponto que o gráfico de tendência consome. */
export interface SeriesPoint {
  readonly label: string;
  readonly value: number;
}

/**
 * Converte os baldes do upstream em pontos do gráfico, descartando os malformados.
 *
 * Descartar em vez de coagir é deliberado: um balde sem `total` numérico coagido para 0 desenharia
 * um vale que nunca existiu, e o operador leria queda de violações onde houve lacuna de dados.
 */
export function toSeries(payload: TrendsPayload | null | undefined): SeriesPoint[] {
  const buckets = payload?.buckets;
  if (!Array.isArray(buckets)) return [];
  return buckets.flatMap((b) => {
    const value = b?.total;
    const label = b?.bucket;
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    if (typeof label !== 'string' || label === '') return [];
    return [{ label, value }];
  });
}

/**
 * Total de eventos na janela — `null` quando não há série, jamais `0`.
 */
export function totalInWindow(payload: TrendsPayload | null | undefined): number | null {
  const points = toSeries(payload);
  if (points.length === 0) return null;
  return points.reduce((acc, p) => acc + p.value, 0);
}

/**
 * Quantas violações a lista trouxe — `null` quando o payload não é uma lista.
 */
export function violationCount(payload: ViolationsPayload | null | undefined): number | null {
  const rows = payload?.violations;
  return Array.isArray(rows) ? rows.length : null;
}

/**
 * Contagem por política, ordenada da mais frequente para a menos.
 *
 * Empates saem em ordem alfabética para que a tela seja determinística entre renders — sem isso a
 * ordem depende da iteração do objeto e duas cargas iguais podem desenhar linhas trocadas.
 */
export function byPolicy(payload: ViolationsPayload | null | undefined): SeriesPoint[] {
  const rows = payload?.violations;
  if (!Array.isArray(rows)) return [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const p = typeof r?.policy === 'string' && r.policy !== '' ? r.policy : 'desconhecida';
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => (b.value - a.value) || a.label.localeCompare(b.label));
}

/**
 * A severidade mais alta presente — a ordem é a do domínio, não alfabética.
 * `null` quando não há linha alguma.
 */
const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'] as const;

export function peakSeverity(payload: ViolationsPayload | null | undefined): string | null {
  const rows = payload?.violations;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let peak = -1;
  for (const r of rows) {
    const s = typeof r?.severity === 'string' ? r.severity.toLowerCase() : '';
    const idx = SEVERITY_ORDER.indexOf(s as (typeof SEVERITY_ORDER)[number]);
    if (idx > peak) peak = idx;
  }
  return peak >= 0 ? SEVERITY_ORDER[peak] : null;
}

/** Um validator do catálogo mesclado plataforma+tenant. */
export interface Validator {
  readonly name?: string;
  readonly category?: string;
  readonly policy?: string;
  readonly [k: string]: unknown;
}

export interface ValidatorsPayload {
  readonly validators?: readonly Validator[];
  readonly items?: readonly Validator[];
  readonly [k: string]: unknown;
}

/** Uma política observada, com a informação que decide a ação: existe guardrail para ela? */
export interface PolicyCoverage {
  readonly policy: string;
  readonly observed: number;
  readonly enforced: boolean;
}

/**
 * A pergunta que a tela existe para responder: **o que o sistema vê e não bloqueia**.
 *
 * O plano de observação enxerga toda conversa ingerida; o plano inline só bloqueia o que tem
 * guardrail. A distância entre os dois é onde o risco mora, e nenhum número isolado a mostra —
 * "12 violações" não diz se elas continuam passando.
 *
 * Ordena o descoberto primeiro, e dentro dele o mais frequente: a linha de cima é sempre a decisão
 * mais urgente. Empate resolvido alfabeticamente para o render ser determinístico.
 */
export function coverageGap(
  violations: ViolationsPayload | null | undefined,
  validators: ValidatorsPayload | null | undefined,
): PolicyCoverage[] {
  const rows = validators?.validators ?? validators?.items;
  const enforcedPolicies = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((v) => (typeof v?.policy === 'string' ? v.policy : typeof v?.category === 'string' ? v.category : ''))
      .filter((p): p is string => p !== ''),
  );

  return byPolicy(violations).map((p) => ({
    policy: p.label,
    observed: p.value,
    enforced: enforcedPolicies.has(p.label),
  })).sort((a, b) =>
    Number(a.enforced) - Number(b.enforced) ||
    b.observed - a.observed ||
    a.policy.localeCompare(b.policy),
  );
}

/** Quantas políticas passam sem guardrail — o número que a tela abre. */
export function unenforcedCount(coverage: readonly PolicyCoverage[]): number {
  return coverage.filter((c) => !c.enforced).length;
}
