import { temProximaPagina } from '@/hooks/promptly/link-header';

// Re-export: B-052 desceu a DECLARACAO para junto do transporte — ler o header
// `Link rel="next"` e assunto de quem faz o request, nao de quem projeta a
// tela. O caminho de import das paginas continua valendo.
export { temProximaPagina };
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
  /**
   * M16 — as tags do prompt. Opcional NO FIO: um serviço anterior ao milestone não as emite, e
   * a tela tem de abrir contra ele em vez de quebrar.
   */
  readonly tags?: unknown;
  readonly updatedAt: string;
}

export interface CatalogRow extends CatalogEntry {
  /** Os labels na forma que o operador lê — `prod → v4, staging → v8`, ou `nenhum`. */
  readonly labelsResumo: string;
  /**
   * M16 — as tags já normalizadas. Sempre um array: a tabela itera sobre isto, e um `undefined`
   * vindo de um serviço antigo quebraria a linha inteira em vez de mostrá-la sem tag.
   */
  readonly tags: readonly string[];
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
export function maiorVersaoServida(labels: CatalogEntry['labels'] | undefined): number {
  if (!Array.isArray(labels) || labels.length === 0) return 0;
  return labels.reduce((maior, l) => (Number.isFinite(l.version) && l.version > maior ? l.version : maior), 0);
}

/**
 * O balde dos prompts que existem e não servem ninguém. Ordenado por último, sempre.
 *
 * B-146 — chamava-se `not promoted`, que é TAMBÉM o nome de um card de KPI na mesma tela contando
 * outro predicado: o card conta prompts cuja última versão está acima da maior versão que algum
 * label serve; este balde conta prompts sem label algum. Duas quantidades, uma palavra, uma tela —
 * quem lê não tem como saber em qual número está. `catalogo.tsx:51-54` já nomeava a fatia sem
 * label de `No environment`; o balde passa a concordar com ela.
 */
export const SEM_AMBIENTE = 'No environment';

/**
 * Os nomes de ambiente que um prompt de fato serve.
 *
 * ## Por que uma função e não `labels.map(l => l.label)` nos dois lugares
 *
 * B-147 — os dois lugares faziam exatamente isso, e nenhum validava. Em `promptsPorAmbiente` o
 * `undefined` resultante chegava ao desempate `a.label.localeCompare(b.label)` e derrubava a
 * /promptly inteira; em `resumoCatalogo` ele entrava num `Set` e virava um ambiente a mais na
 * contagem — silencioso, e por isso pior. Consertar só o barulhento é como o próximo leitor
 * encontra o outro ainda aqui.
 *
 * `CatalogEntry['labels']` declara `label: string`, mas uma interface do TypeScript é uma
 * afirmação em tempo de COMPILAÇÃO sobre um payload que o browser recebe em tempo de EXECUÇÃO, de
 * um serviço que pode ser mais velho que este build. A fronteira valida (Regra 8).
 *
 * Um label em branco não derruba nada — ele ordena. O que ele produz é uma barra sem nome, que é
 * uma leitura sobre a qual ninguém consegue agir, então também não é um ambiente.
 */
function ambientesServidos(labels: CatalogEntry['labels'] | undefined): Set<string> {
  const nomes = new Set<string>();
  if (!Array.isArray(labels)) return nomes;
  for (const l of labels) {
    if (typeof l?.label !== 'string') continue;
    const nome = l.label.trim();
    if (nome !== '') nomes.add(nome);
  }
  return nomes;
}

/**
 * Quantos prompts cada ambiente serve, para o gráfico de barras sob os contadores (B-129).
 *
 * O card `Environments` diz `2`. Ele não diz QUAIS, nem que um deles serve tudo enquanto o outro
 * serve um prompt — e é essa assimetria que diz ao operador onde uma promoção ruim de fato cairia.
 *
 * Barras e não linha: o catálogo tem `updatedAt`, mas "prompts atualizados por dia" responde uma
 * pergunta que ninguém faz e fica esparso em qualquer workspace pequeno. A distribuição por
 * ambiente é a leitura que os números ao lado não dão.
 */
export function promptsPorAmbiente(
  linhas: readonly CatalogRow[],
): { label: string; value: number }[] {
  const counts = new Map<string, number>();

  for (const linha of linhas) {
    // Um Set por prompt: um payload malformado com `prod → v1` duas vezes não pode inflar `prod`
    // para 2. A barra conta PROMPTS; contar linhas de label superestimaria o alcance em silêncio.
    const ambientes = ambientesServidos(linha.labels);

    // Servir ninguém é um ESTADO, não uma ausência — e `semAmbiente` já é um KPI na mesma tela.
    // Esconder estes daqui faria as barras discordarem de um número logo acima delas.
    const chaves = ambientes.size > 0 ? [...ambientes] : [SEM_AMBIENTE];
    for (const chave of chaves) counts.set(chave, (counts.get(chave) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => {
      // `No environment` é resíduo, não destino. Deixá-lo encabeçar o gráfico responderia "onde
      // meus prompts rodam?" com "em lugar nenhum", enterrando os ambientes que de fato existem.
      if (a.label === SEM_AMBIENTE) return 1;
      if (b.label === SEM_AMBIENTE) return -1;
      return b.value - a.value || a.label.localeCompare(b.label);
    });
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
    const servidos = ambientesServidos(labels);
    for (const nome of servidos) ambientes.add(nome);
    // B-147 — a contagem era `labels.length === 0`, então um prompt carregando UM label inutilizável
    // se reportava como promovido em algum lugar enquanto não servia ninguém. O predicado é "quantos
    // ambientes ele de fato serve", que é o que `ambientesServidos` responde.
    if (servidos.size === 0) semAmbiente += 1;
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
  /** M17 — aditivos e opcionais no FIO: um serviço anterior ao milestone não os emite. */
  readonly changeDescription?: unknown;
  readonly modelConfig?: unknown;
}

export interface RevisionRow {
  readonly version: number;
  readonly createdAt: string;
  /** O corpo INTEGRAL. O trecho serve para reconhecer a revisão na lista; ler o que o modelo
   *  de fato recebe exige o texto inteiro, e a DoD do M12 pede exatamente isso. */
  readonly content: string;
  /** As variáveis que o serviço DECLARA nesta revisão — nunca derivadas por regex nosso. */
  readonly variables: readonly string[];
  /**
   * M17 — por que esta revisão existe. `null` nas revisões anteriores ao milestone, e a
   * tela diz "sem descrição": nunca uma descrição inventada retroativamente, pela mesma
   * razão que o `createdBy` do M7 é `null` no passado.
   */
  readonly changeDescription: string | null;
  /** M17 — a config com que a revisão foi testada. `null`, nunca `{}`. */
  readonly modelConfig: { readonly temperature?: number; readonly model?: string } | null;
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
    // Só strings entram: um serviço que emitisse `[null]` renderizaria uma tag em branco
    // clicável, que filtraria por nada e pareceria um defeito da busca.
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string') : [],
  }));
}

function resumirLabels(labels: CatalogEntry['labels']): string {
  if (!Array.isArray(labels) || labels.length === 0) {
    // "none" é um FATO sobre o prompt (ele não serve ambiente algum), não ausência de dado.
    //
    // Minúscula e sem espaço: o guard de idioma NÃO a enxerga, por desenho — a heurística que
    // separa rótulo de identificador (`estado: 'carregando'`) custa exatamente este falso
    // negativo, e ele está declarado no docblock do guard. Quem a pegou foi a varredura de tela
    // em navegador, a segunda rede. É o caso concreto de por que duas redes que erram por
    // motivos diferentes valem mais que uma sozinha.
    return 'none';
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

/** Extrai a config de uma revisão, tolerando forma inválida (vira `null`). */
function configDaRevisao(r: unknown): { temperature?: number; model?: string } | null {
  const raw = (r as { modelConfig?: unknown }).modelConfig;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const cfg: { temperature?: number; model?: string } = {};
  // `typeof === 'number'` e não truthiness: `temperature: 0` é válida e significativa.
  if (typeof v['temperature'] === 'number') cfg.temperature = v['temperature'];
  if (typeof v['model'] === 'string' && v['model'] !== '') cfg.model = v['model'];
  return Object.keys(cfg).length === 0 ? null : cfg;
}

export function revisionRows(payload: unknown): RevisionRow[] {
  return asArray<Revision>(payload)
    .map((r) => ({
      version: r.version,
      createdAt: r.createdAt,
      content: typeof r.content === 'string' ? r.content : '',
      variables: variaveisDeclaradas(r),
      // Defensivo: um campo malformado vindo do serviço vira `null` em vez de derrubar
      // a lista inteira. O conteúdo da revisão é o valor central desta tela.
      changeDescription: typeof r.changeDescription === 'string' ? r.changeDescription : null,
      modelConfig: configDaRevisao(r),
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
    return `Label "${label}" does not point at any revision yet; it starts serving v${alvo}.`;
  }
  if (atual === alvo) {
    return `Label "${label}" already serves v${alvo} — this promotion changes nothing.`;
  }
  return `Label "${label}" stops serving v${atual} and starts serving v${alvo}. Every agent that resolves "${label}" receives v${alvo} on the next call, with no redeploy.`;
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
    return { livre: true, texto: 'No rule governs this label — promotion is unrestricted.' };
  }
  return {
    livre: false,
    texto: `Promotion requires an evaluation on dataset ${policy.datasetId} with a minimum score of ${policy.minScore}.`,
  };
}

/**
 * M18 — um comentário como a tela o lê.
 *
 * `author` anulável, e a tela DIZ a ausência: uma credencial sem identidade humana não tem autor,
 * e inventar um apareceria numa auditoria como fato — mesma razão do `createdBy` do M7.
 */
export interface ComentarioRow {
  readonly id: string;
  readonly body: string;
  readonly author: string | null;
  readonly createdAt: string;
  /**
   * O carimbo COMO SE LÊ. Separado do `createdAt` cru porque os dois têm consumidores
   * diferentes: ordenar e comparar querem o ISO; a tela quer a frase.
   *
   * `''` quando não há data ou ela não parseia — a mesma disciplina do autor ausente: dizer que
   * não sabe, nunca imprimir "Invalid Date" nem cair para "agora", que apareceria ao leitor como
   * um fato.
   */
  readonly quando: string;
}

/**
 * Projeta a discussão de uma revisão.
 *
 * `null` (falha de leitura) e `[]` (ninguém comentou) chegam aqui como coisas diferentes e saem
 * como a MESMA lista vazia — de propósito: quem distingue os dois é a tela, olhando o `error` da
 * consulta. Esta função não pode inventar a distinção, e fingir que pode é o que faria a tela
 * confiar num sinal que não existe.
 */
export function comentarioRows(payload: unknown): ComentarioRow[] {
  return asArray<{ id?: unknown; body?: unknown; author?: unknown; createdAt?: unknown }>(payload)
    .filter((c) => typeof c.id === 'string' && typeof c.body === 'string')
    .map((c) => ({
      id: c.id as string,
      body: c.body as string,
      author: typeof c.author === 'string' ? c.author : null,
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
      quando: quandoLegivel(c.createdAt),
    }));
}

/**
 * O ISO vira frase — ou vira nada.
 *
 * A aceitação do M18 no app-dev mostrou `autor não registrado · 2026-08-04T17:13:42.848Z`. O
 * carimbo é o único eixo temporal de quem lê a discussão; se ele exige decodificar um ISO de
 * cabeça, ele não está sendo lido, está sendo pulado.
 */
function quandoLegivel(bruto: unknown): string {
  if (typeof bruto !== 'string' || bruto === '') return '';
  const d = new Date(bruto);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
