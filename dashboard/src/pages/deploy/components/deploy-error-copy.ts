/**
 * A frase que uma operação de deploy mostra quando o servidor a recusa (B-226).
 *
 * ## O que estava duplicado, e o que NÃO estava
 *
 * `formatPromoteError` e `formatRollbackError` compartilhavam a ESCADA inteira — mesma ordem de
 * códigos, mesmos ramos de status, mesmo preâmbulo de leitura do corpo — e diferiam nas PALAVRAS.
 * Consolidar como se fossem cópias literais teria apagado a diferença que importa: "a release de
 * produção continua ativa" e "a release atual está em estado degradado" descrevem situações
 * distintas, e quem lê age diferente.
 *
 * Então o que é extraído é a FORMA, e cada operação traz o próprio vocabulário. Acrescentar uma
 * terceira (um `redeploy`, digamos) é acrescentar um descritor — não editar a escada (OCP).
 *
 * ## Por que isso importava além de DRY
 *
 * `formatRollbackError` não era sequer exportada, e não tinha teste nenhum: as oito asserções
 * existiam só sobre a gêmea. Uma das duas metades de uma regra duplicada estava sem cobertura, o
 * que é o pior arranjo possível — a coberta dá confiança sobre a que não é.
 */
export interface OperacaoDeploy {
  /** Como a operação se chama na frase: `Promote`, `Rollback`. */
  readonly name: string;
  /** O que continua valendo quando ela falha — a informação que acalma quem está lendo. */
  readonly estadoPreservado: string;
  /** Códigos específicos desta operação, na ordem em que devem ser testados. */
  readonly codigos: readonly { readonly code?: string; readonly padrao?: RegExp; readonly frase: string }[];
  /** Copy para 403, que difere por operação. */
  readonly noPermission: string;
  /** Copy para 404, que difere por operação. */
  readonly notFound: string;
  /** Copy para 409; ausente quando a operação não tem conflito de concorrência. */
  readonly emAndamento?: string;
}

export const PROMOTE: OperacaoDeploy = {
  name: 'Promote',
  estadoPreservado: 'The current production release remains active.',
  codigos: [
    { code: 'NO_ACTIVE_RELEASE', padrao: /no active release/i, frase: 'No active release in the source environment yet. Wait for the build to finish and retry.' },
    { code: 'SAME_ENVIRONMENT', padrao: /same environment/i, frase: 'This deploy is already on production. Pick a preview deploy to promote.' },
  ],
  noPermission: 'You do not have permission to promote in this project.',
  notFound: 'Project or build not found. Refresh the page.',
  emAndamento: 'Another deploy is already in progress on production. Wait for it to finish and retry.',
};

export const ROLLBACK: OperacaoDeploy = {
  name: 'Rollback',
  estadoPreservado: 'The current release remains active.',
  codigos: [
    { code: 'NO_ACTIVE_RELEASE', padrao: /no active release/i, frase: 'No active release to rollback. Deploy something first, then try again.' },
    { code: 'NO_PREVIOUS_RELEASE', padrao: /no previous release/i, frase: 'No previous release available. This build is the first deploy — nothing to fall back to.' },
  ],
  noPermission: 'You do not have permission to rollback this project.',
  notFound: 'Project or build not found. The build may have been deleted — refresh the page.',
};

/** O que a regra recebe para decidir e para escrever. Uma leitura só do corpo, compartilhada. */
interface Contexto {
  readonly op: OperacaoDeploy;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  /** `op.nome`, que aparece em quase toda frase. */
  readonly n: string;
}

/**
 * A escada, como DADOS (B-182).
 *
 * A versão anterior media CCN 27 num único `if`-atrás-de-`if`. Não era complexidade acidental —
 * são mesmo doze situações distintas — mas cyclomatic complexity mede caminhos que interagem, e
 * aqui nenhum interage: é uma classificação plana, ordenada da mais específica para a mais geral.
 * Como tabela, cada regra é legível e testável sozinha, a ordem fica explícita em vez de implícita
 * na indentação, e acrescentar uma situação é acrescentar uma linha (OCP).
 */
const REGRAS: readonly {
  readonly when: (c: Contexto) => boolean;
  readonly frase: (c: Contexto) => string;
}[] = [
  {
    when: ({ op, code, detail }) =>
      op.codigos.some((r) => (r.code !== undefined && code === r.code) || (r.padrao?.test(detail) ?? false)),
    frase: ({ op, code, detail }) =>
      op.codigos.find((r) => (r.code !== undefined && code === r.code) || (r.padrao?.test(detail) ?? false))!.frase,
  },
  {
    // A infraestrutura aceitou e não terminou: o estado é INCERTO, e dizer isso é o ponto.
    when: ({ detail }) => /sync wait failed/i.test(detail) || /sync timeout/i.test(detail),
    frase: ({ op, n }) =>
      `${n} started but the deployment infrastructure did not finish in time. ${
        n === 'Rollback' ? 'The current release is in a degraded state' : op.estadoPreservado.replace(/\.$/, '')
      } — please retry in a few seconds. If the issue persists, contact support.`,
  },
  {
    when: ({ detail }) => /sync trigger failed/i.test(detail),
    frase: ({ op, n }) =>
      `${n} could not contact the deployment infrastructure. ${op.estadoPreservado} Retry, or contact support if it persists.`,
  },
  {
    when: ({ code, status }) => code === 'MISSING_FIELD' || status === 400,
    frase: ({ n, detail }) =>
      detail
        ? `${n} rejected: ${detail}. Refresh the page and retry.`
        : `${n} rejected: the request was malformed. Refresh the page and retry.`,
  },
  {
    when: ({ status }) => status === 401,
    frase: ({ n }) => `Session expired. Sign in again and retry the ${n.toLowerCase()}.`,
  },
  { when: ({ status }) => status === 403, frase: ({ op }) => op.noPermission },
  { when: ({ status }) => status === 404, frase: ({ op }) => op.notFound },
  {
    when: ({ status, op }) => status === 409 && op.emAndamento !== undefined,
    frase: ({ op }) => op.emAndamento!,
  },
  {
    when: ({ status }) => status >= 500,
    frase: ({ n, status, detail, op }) =>
      detail
        ? `${n} failed (HTTP ${String(status)}): ${detail}. ${op.estadoPreservado} Retry, or contact support if it persists.`
        : `${n} failed (HTTP ${String(status)}). ${op.estadoPreservado} Retry, or contact support if it persists.`,
  },
];

export function formatDeployError(
  op: OperacaoDeploy,
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  const detail = body?.message ?? body?.error ?? '';
  const contexto: Contexto = { op, status, code: body?.code ?? '', detail, n: op.name };

  const regra = REGRAS.find((r) => r.when(contexto));
  if (regra) return regra.frase(contexto);

  // O fundo da escada: nenhuma situação reconhecida. Ainda assim diz o status e o que o servidor
  // mandou — uma frase genérica sem nenhum dos dois não deixa ninguém agir.
  return detail
    ? `${op.name} failed (HTTP ${String(status)}): ${detail}`
    : `${op.name} failed (HTTP ${String(status)}). Please retry.`;
}
