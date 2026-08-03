/**
 * M25 — a lógica de projeção das telas de prompts, FORA do React.
 *
 * Aqui vive tudo que decide o que a tela AFIRMA: como o catálogo é lido, o que a lista de revisões
 * mostra (e o que ela deliberadamente não mostra), e — a parte que mais importa — a frase que a
 * confirmação da promoção usa. Fora do React porque essas decisões precisam ser testadas sem
 * browser, e porque a frase de uma ação que muda produção não deve estar embutida num JSX.
 */

/** Uma linha do índice, como o serviço a devolve (`GET /prompts`). Sem `content`, por contrato. */
export interface CatalogEntry {
  readonly name: string;
  readonly latestVersion: number;
  readonly labels: ReadonlyArray<{ label: string; version: number }>;
  readonly updatedAt: string;
}

export interface CatalogRow extends CatalogEntry {
  /** Os labels na forma que o operador lê — `prod → v4, staging → v8`, ou `nenhum`. */
  readonly labelsResumo: string;
}

/**
 * M13 — o que o painel afirma sobre o catálogo, e o que ele admite não saber.
 *
 * `parcial` é o campo que carrega o milestone. Ele vem do sinal de continuação do serviço
 * (`Link … rel="next"`), NUNCA do tamanho da página: o serviço devolve no máximo `limit` linhas,
 * então um catálogo de exatamente `limit` prompts satisfaria `linhas.length >= limit` sem ter
 * próxima página — e marcar de parcial um número correto ensina o operador a desconfiar dele,
 * que é pior do que não marcar.
 */
export interface ResumoCatalogo {
  readonly prompts: number;
  readonly revisoesPublicadas: number;
  readonly ambientes: number;
  /** Escritos e não servindo ninguém: `latestVersion` acima da maior versão que algum label aponta. */
  readonly naoPromovidos: number;
  /** Nunca promovidos: sem label algum. */
  readonly semAmbiente: number;
  /** Os números acima são de UMA página, e há mais páginas — são limites inferiores, não totais. */
  readonly parcial: boolean;
}

/** A maior versão que algum label serve; `0` quando nenhum serve (nunca `-Infinity`). */
function maiorVersaoServida(labels: CatalogEntry['labels'] | undefined): number {
  if (!Array.isArray(labels) || labels.length === 0) return 0;
  return labels.reduce((maior, l) => (Number.isFinite(l.version) && l.version > maior ? l.version : maior), 0);
}

/**
 * Deriva os números do painel de UMA página de catálogo.
 *
 * `temContinuacao` vem do serviço e é o único insumo de `parcial` — ver o docstring de
 * `ResumoCatalogo`. Campos ausentes numa linha (dado parcial de uma versão anterior da API) não
 * podem virar `NaN` silencioso: um número errado exibido com a confiança de um certo é pior que a
 * ausência dele.
 */
export function resumoCatalogo(linhas: readonly CatalogRow[], temContinuacao: boolean): ResumoCatalogo {
  const ambientes = new Set<string>();
  let revisoesPublicadas = 0;
  let naoPromovidos = 0;
  let semAmbiente = 0;

  for (const linha of linhas) {
    const ultima = Number.isFinite(linha.latestVersion) ? linha.latestVersion : 0;
    revisoesPublicadas += ultima;

    const labels = Array.isArray(linha.labels) ? linha.labels : [];
    for (const l of labels) ambientes.add(l.label);
    if (labels.length === 0) semAmbiente += 1;
    if (ultima > maiorVersaoServida(labels)) naoPromovidos += 1;
  }

  return {
    prompts: linhas.length,
    revisoesPublicadas,
    ambientes: ambientes.size,
    naoPromovidos,
    semAmbiente,
    parcial: temContinuacao,
  };
}

/** Uma revisão como o serviço a devolve (`/revisions`) — inclui o `content` integral. */
export interface Revision {
  readonly version: number;
  readonly content: string;
  readonly createdAt: string;
}

export interface RevisionRow {
  readonly version: number;
  readonly createdAt: string;
  /** O corpo INTEGRAL. O trecho serve para reconhecer a revisão na lista; ler o que o modelo
   *  de fato recebe exige o texto inteiro, e a DoD do M12 pede exatamente isso. */
  readonly content: string;
  /** As variáveis que o serviço DECLARA nesta revisão — nunca derivadas por regex nosso. */
  readonly variables: readonly string[];
}

export interface LabelPointer {
  readonly label: string;
  readonly version: number;
}

export interface PromotionPolicy {
  readonly datasetId: string;
  readonly minScore: number;
}


function asArray<T>(payload: unknown): T[] {
  return Array.isArray(payload) ? (payload as T[]) : [];
}

/** Projeta o índice. Payload que não é lista vira lista vazia — quem decide a frase é a tela. */
export function catalogRows(payload: unknown): CatalogRow[] {
  return asArray<CatalogEntry>(payload).map((e) => ({
    ...e,
    labels: Array.isArray(e.labels) ? e.labels : [],
    labelsResumo: resumirLabels(e.labels),
  }));
}

function resumirLabels(labels: CatalogEntry['labels']): string {
  if (!Array.isArray(labels) || labels.length === 0) {
    // "nenhum" é um FATO sobre o prompt (ele não serve ambiente algum), não ausência de dado.
    return 'nenhum';
  }
  return labels.map((l) => `${l.label} → v${l.version}`).join(', ');
}

/**
 * Projeta as revisões, da mais nova para a mais antiga.
 *
 * Quem abre um prompt quer ver o que está valendo agora; a arqueologia vem depois. O `content`
 * integral chega (a rota do serviço não oferece recorte — medido) e é truncado AQUI: renderizar o
 * corpo inteiro de cada revisão numa lista é o editor que este milestone exclui.
 */
/** Lê `variables` do corpo do serviço. Ausente ou malformado ⇒ lista vazia — nunca adivinhado. */
function variaveisDeclaradas(r: unknown): string[] {
  const bruto = (r as { variables?: unknown }).variables;
  return Array.isArray(bruto) ? bruto.filter((v): v is string => typeof v === 'string') : [];
}

export function revisionRows(payload: unknown): RevisionRow[] {
  return asArray<Revision>(payload)
    .map((r) => ({
      version: r.version,
      createdAt: r.createdAt,
      content: typeof r.content === 'string' ? r.content : '',
      variables: variaveisDeclaradas(r),
    }))
    .sort((a, b) => b.version - a.version);
}


/**
 * Qual JANELA de revisões pedir ao servidor para obter as MAIS RECENTES (#364).
 *
 * A rota de revisões ordena da mais antiga para a mais nova e corta com `limit` — medido em
 * `prompt-repository.pg.ts` (`orderBy(asc(version))` seguido de `.limit()`). Portanto pedir
 * `limit=10` num prompt de 30 revisões devolve **v1..v10**, e a tela as rotulava "as 10 mais
 * recentes". Numa tela de PROMOÇÃO isso não é cosmético: quem promove "a mais recente da lista"
 * reaponta produção para uma revisão velha, e o diálogo confirma com convicção a revisão errada.
 *
 * A correção usa o cursor que a rota já oferece, sem inventar API: começar `limit` posições antes
 * do fim. `latestVersion` vem do catálogo, que já o devolve.
 *
 * **Por que isto é seguro mesmo se as versões não forem contíguas:** a aritmética assume
 * numeração sem buracos (o serviço atribui `max+1` a cada revisão imutável, então hoje ela é
 * contígua). Se algum dia houver buraco, o cursor cai um pouco antes do ideal e a página traz
 * MENOS linhas do que caberia — nunca linhas antigas rotuladas como recentes. O modo de falha
 * degrada para "mostro menos", não para "minto".
 */
export function revisionsWindow(latestVersion: number | null | undefined, limit: number): { after: number } {
  if (!latestVersion || latestVersion <= limit) return { after: 0 };
  return { after: latestVersion - limit };
}

export function labelRows(payload: unknown): LabelPointer[] {
  return asArray<LabelPointer>(payload);
}

/**
 * A frase da confirmação: o que DEIXA DE VALER quando a promoção acontece.
 *
 * Três formas, porque três estados distintos existem no dado que a API devolve — e a frase muda
 * com o dado em vez de o dado ser inventado para sustentar a frase:
 *
 *  - o label serve outra revisão → nomeia QUAL sai ("prod deixa de servir a v4");
 *  - o label não existe ainda    → não há revisão que saia, e a frase diz isso;
 *  - o label já serve o alvo     → o clique não muda nada, e dizer isso evita que o operador
 *    interprete a ausência de mudança como falha.
 *
 * O número da revisão atual vem de `GET /prompts/:name/labels`, que devolve `{label, version}`.
 * Nada aqui é inferido.
 */
export function promotionConsequence(args: {
  label: string;
  atual: number | null;
  alvo: number;
}): string {
  const { label, atual, alvo } = args;
  if (atual === null) {
    return `O label "${label}" ainda não aponta para nenhuma revisão; ele passa a servir a v${alvo}.`;
  }
  if (atual === alvo) {
    return `O label "${label}" já serve a v${alvo} — esta promoção não muda nada.`;
  }
  return `O label "${label}" deixa de servir a v${atual} e passa a servir a v${alvo}. Todo agente que resolve "${label}" recebe a v${alvo} na próxima chamada, sem redeploy.`;
}

export interface PolicySummary {
  readonly livre: boolean;
  readonly texto: string;
}

/**
 * Resume a regra que governa a promoção — lida ANTES do ato.
 *
 * `null` significa o `404 policy_not_found` do serviço: não há regra, a promoção é livre. É um
 * FATO, e a tela precisa dizê-lo com todas as letras; renderizá-lo igual a uma falha de leitura
 * faria o operador procurar defeito onde não há.
 */
export function policySummary(policy: PromotionPolicy | null | undefined): PolicySummary {
  if (!policy) {
    return { livre: true, texto: 'Nenhuma regra governa este label — a promoção é livre.' };
  }
  return {
    livre: false,
    texto: `A promoção exige avaliação no dataset ${policy.datasetId} com score mínimo de ${policy.minScore}.`,
  };
}
