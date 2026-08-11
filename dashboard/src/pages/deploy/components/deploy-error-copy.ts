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
  readonly nome: string;
  /** O que continua valendo quando ela falha — a informação que acalma quem está lendo. */
  readonly estadoPreservado: string;
  /** Códigos específicos desta operação, na ordem em que devem ser testados. */
  readonly codigos: readonly { readonly code?: string; readonly padrao?: RegExp; readonly frase: string }[];
  /** Copy para 403, que difere por operação. */
  readonly semPermissao: string;
  /** Copy para 404, que difere por operação. */
  readonly naoEncontrado: string;
  /** Copy para 409; ausente quando a operação não tem conflito de concorrência. */
  readonly emAndamento?: string;
}

export const PROMOTE: OperacaoDeploy = {
  nome: 'Promote',
  estadoPreservado: 'The current production release remains active.',
  codigos: [
    { code: 'NO_ACTIVE_RELEASE', padrao: /no active release/i, frase: 'No active release in the source environment yet. Wait for the build to finish and retry.' },
    { code: 'SAME_ENVIRONMENT', padrao: /same environment/i, frase: 'This deploy is already on production. Pick a preview deploy to promote.' },
  ],
  semPermissao: 'You do not have permission to promote in this project.',
  naoEncontrado: 'Project or build not found. Refresh the page.',
  emAndamento: 'Another deploy is already in progress on production. Wait for it to finish and retry.',
};

export const ROLLBACK: OperacaoDeploy = {
  nome: 'Rollback',
  estadoPreservado: 'The current release remains active.',
  codigos: [
    { code: 'NO_ACTIVE_RELEASE', padrao: /no active release/i, frase: 'No active release to rollback. Deploy something first, then try again.' },
    { code: 'NO_PREVIOUS_RELEASE', padrao: /no previous release/i, frase: 'No previous release available. This build is the first deploy — nothing to fall back to.' },
  ],
  semPermissao: 'You do not have permission to rollback this project.',
  naoEncontrado: 'Project or build not found. The build may have been deleted — refresh the page.',
};

export function formatDeployError(
  op: OperacaoDeploy,
  status: number,
  body: { message?: string; code?: string; error?: string } | null,
): string {
  const code = body?.code ?? '';
  const detail = body?.message ?? body?.error ?? '';
  const n = op.nome;

  for (const c of op.codigos) {
    if ((c.code !== undefined && code === c.code) || (c.padrao?.test(detail) ?? false)) return c.frase;
  }
  if (/sync wait failed/i.test(detail) || /sync timeout/i.test(detail)) {
    // A infraestrutura aceitou e não terminou: o estado é INCERTO, e dizer isso é o ponto.
    return `${n} started but the deployment infrastructure did not finish in time. ${
      n === 'Rollback' ? 'The current release is in a degraded state' : op.estadoPreservado.replace(/\.$/, '')
    } — please retry in a few seconds. If the issue persists, contact support.`;
  }
  if (/sync trigger failed/i.test(detail)) {
    return `${n} could not contact the deployment infrastructure. ${op.estadoPreservado} Retry, or contact support if it persists.`;
  }
  if (code === 'MISSING_FIELD' || status === 400) {
    return detail
      ? `${n} rejected: ${detail}. Refresh the page and retry.`
      : `${n} rejected: the request was malformed. Refresh the page and retry.`;
  }
  if (status === 401) return `Session expired. Sign in again and retry the ${n.toLowerCase()}.`;
  if (status === 403) return op.semPermissao;
  if (status === 404) return op.naoEncontrado;
  if (status === 409 && op.emAndamento !== undefined) return op.emAndamento;
  if (status >= 500) {
    return detail
      ? `${n} failed (HTTP ${String(status)}): ${detail}. ${op.estadoPreservado} Retry, or contact support if it persists.`
      : `${n} failed (HTTP ${String(status)}). ${op.estadoPreservado} Retry, or contact support if it persists.`;
  }
  return detail
    ? `${n} failed (HTTP ${String(status)}): ${detail}`
    : `${n} failed (HTTP ${String(status)}). Please retry.`;
}
