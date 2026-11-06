import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button, PageShell } from '@usetheo/ui';
import {
  dependentRows,
  hasComposition,
  displayedText,
  type TextMode,
} from '@/pages/promptly/components/composicao';
import { abaDaRota } from './detail-tabs';
import { revisionColumns } from './revision-columns';
import { PromptCardText } from './detail/texto-card';
import { USAGE_WINDOW_DAYS } from './detail/constantes';
import { ConfirmacoesDePonteiro } from './detail/confirmacoes-de-ponteiro';
import { PromptHeader } from './detail/cabecalho';
import { PainelDeAbas } from './detail/painel-de-abas';
import { TagsCard } from './detail/tags-card';
import { DiscussaoCard } from './detail/discussao-card';
import { EnvironmentsCard } from './detail/ambientes-card';
import { RevisionsCard } from './detail/revisoes-card';

import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/http/api';
import {
  resultadoDoRollback,
  labelsOferecidos,
  rejectionMessage,
  type RespostaRollback,
  type ResultadoRollback,
} from '@/pages/promptly/components/rollback';
import {
  promoteLabel,
  rollbackPrompt,
  setTags,
  addComment,
} from '@/hooks/promptly/promptly-api';
import {
  catalogRows,
  comentarioRows,
  labelRows,
  policySummary,
  revisionRows,
  revisionsWindow,
  type PromotionPolicy,
} from '@/pages/promptly/components/projections';
import { projectUsage, type UsageAggregate, type UsageRow } from '@/pages/promptly/components/usage';
import {
  useInvalidatePrompt,
  usePrompt,
  usePromptlyCatalog,
  usePromptRevisions,
  usePromptLabels,
  usePromptPolicy,
  usePromptUsage,
  useResolvedPrompt,
  usePromptDependentes,
  usePromptComments,
} from '@/hooks/promptly/use-promptly';

/**
 * M25 — `/promptly/:promptName`: as revisões de um prompt e a promoção de um label.
 *
 * Duas coisas acontecem aqui, e a segunda é a razão da tela existir: o operador vê o histórico e
 * decide **qual revisão serve produção**. Promover é o ato central do produto — repontar um label
 * troca, sem redeploy, o prompt que agentes em execução resolvem. Não derruba nada; muda
 * comportamento em silêncio, que é pior de diagnosticar.
 *
 * Por isso a confirmação faz duas coisas que um "tem certeza?" não faz:
 *
 *  1. mostra a POLÍTICA vigente **antes** do ato — a regra que pode barrar a promoção, lida do
 *     serviço (`/policies/:label`), não adivinhada. Sem ela o operador só descobriria a regra
 *     pela recusa;
 *  2. nomeia **qual revisão deixa de servir aquele label** — número que vem de `/labels`. Quando
 *     o label ainda não existe, não há revisão que saia e a FRASE MUDA (ver
 *     `promotionConsequence`): não se inventa o dado para sustentar a frase.
 *
 * A lista de revisões pagina **no servidor**, com limite pequeno e explícito: cada item carrega o
 * `content` integral da revisão (medido) e o serviço aplica default 100 quando ninguém pede.
 */

/** Pequeno e EXPLÍCITO — ver o comentário acima. Nunca o default do serviço. */
const REVISIONS_LIMIT = 10;


/**
 * O endereço público da capacidade na borda — a base que o trecho de consumo publica (M21 DoD-2).
 *
 * Derivado do `window.location` e NÃO fixo: um trecho com `app-dev` gravado apontaria o consumidor
 * de produção para desenvolvimento, e ele só descobriria em produção. `/v1/promptly` é o caminho
 * que o Caddy roteia para o serviço — o mesmo por onde o SDK entra.
 */
/**
 * Os nomes que significam "produção" aqui.
 *
 * Um conjunto, e não um `===`, porque os dois convivem no catálogo real deste ambiente — há prompts
 * servindo `production` e outros servindo `prod`.
 */



/** A linha crua do agregado, como o BFF a repassa do `theo-lens`. */
interface RawAggregateRow {
  readonly revision: number;
  readonly resolutions: number;
  readonly totalTokens: number;
  readonly costUsd: number | null;
  readonly p50LatencyMs: number | null;
}

export function PromptDetailPage() {
  const { promptName = '' } = useParams();
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle(`Prompt — ${promptName}`), [setPageTitle, promptName]);
  useRequireAuth();
  const invalidarPrompt = useInvalidatePrompt();

  /** A revisão escolhida para promoção; `null` = nenhum diálogo aberto. */
  const [target, setTarget] = useState<number | null>(null);
  const [targetLabel, setTargetLabel] = useState<string>('');
  const [promoteError, setPromoteError] = useState<string | null>(null);
  // M16 — as tags. O rascunho do campo é local; o conjunto vem do servidor.
  const [newTag, setNewTag] = useState('');
  const [tagError, setErroDeTag] = useState<string | null>(null);

  /**
   * As tags do prompt vêm do CATÁLOGO — a projeção que já as carrega, filtrada por este nome.
   *
   * Um endpoint dedicado seria trabalho antes da necessidade: o dado já existe a um `search` de
   * distância, e criar uma segunda rota para lê-lo duplicaria a projeção sem comprar alcance.
   */
// B-052 — chaves da factory. As onze leituras desta tela escreviam a tupla a
  // mao, e tres delas caiam sob o prefixo da CATALOG_QUERY_KEY por acidente.
  //
  // Esta e uma BUSCA NO CATALOGO, nao um recurso "tags": ela chama
  // `fetchCatalogPage(1, {search})` e le as tags da linha. A chave antiga dizia
  // `...promptName, 'tags'`, prometendo um recurso que nao existe — e uma chave
  // que descreve errado o que guarda e a forma mais barata de invalidar o alvo
  // errado depois.
  const tagsQuery = usePromptlyCatalog<unknown>({ search: promptName }, 1);
  const tags = catalogRows(tagsQuery.data?.data).find((r) => r.name === promptName)?.tags ?? [];

  const marcando = useMutation({
    mutationFn: (upcoming: readonly string[]) => setTags<unknown>(promptName, upcoming),
    onMutate: () => { setErroDeTag(null); },
    onSuccess: async () => {
      setNewTag('');
      // Reler em vez de otimizar: o serviço normaliza (ordena, deduplica), e pintar a tela com o
      // que EU mandei mostraria uma ordem que o servidor não tem.
      // B-052 — invalida o PROMPT inteiro. As chaves literais listadas aqui
      // deixaram de existir quando as leituras migraram; a hierarquia
      // `['promptly','prompt',name,...]` alcanca todas elas de uma vez, sem
      // tocar no catalogo nem nos outros prompts.
      invalidarPrompt(promptName);
    },
    // A recusa TIPADA chega ao operador: `too_many_tags` e `empty_tag` dizem o que fazer;
    // "erro ao salvar" não diz nada.
    onError: (err: unknown) => { setErroDeTag(refusalMessage(err)); },
  });

  // B-052 — o prompt em si. `latestVersion`/`promptContent`/`janela` derivam
  // daqui, e o regex que removeu as chaves literais levou estas tres linhas
  // junto — restauradas.
  const prompt = usePrompt<{
    version?: number;
    content?: string;
    // M21 — a aba de config lê a afinação declarada (M17) e o contrato de
    // entrada. Ambos já vinham nesta resposta e eram descartados pela tipagem
    // estreita.
    modelConfig?: { model?: string; temperature?: number; maxTokens?: number } | null;
    variables?: string[];
  }>(promptName);
  const latestVersion = prompt.data?.version ?? null;
  const promptContent = prompt.data?.content ?? null;
  // NOT `window`: that shadows the DOM global for the rest of this component, and this file's own
  // docblock at :91 reasons about `window.location`. Nothing inside the shadowed scope used the
  // global today, so it was latent — but a future `window.location.href = …` here would silently
  // resolve against a revisions window. Found by adversarial review 2026-08-13 (B-241).
  const revisionsRange = revisionsWindow(latestVersion, REVISIONS_LIMIT);

  const revisions = usePromptRevisions<unknown>(
    promptName,
    REVISIONS_LIMIT,
    revisionsRange.after,
    // Só depois de saber a última versão: pedir antes traria a janela errada e a
    // tela piscaria do histórico velho para o novo, com o operador podendo
    // clicar no intervalo.
    !prompt.loading,
  );

  const labels = usePromptLabels<unknown>(promptName);

  // A política é lida por LABEL, e só quando há um diálogo aberto: perguntá-la para todos os
  // labels ao abrir a tela gastaria requisições que ninguém pediu.
  const policy = usePromptPolicy<PromotionPolicy>(promptName, targetLabel);

  // M15 — o uso observado por revisão. Janela CURTA por padrão e DITA na tela: um agregado
  // "desde sempre" varre a tabela de spans do ecossistema inteiro, e uma janela implícita faz
  // o operador atribuir o número ao período errado.
  const usage = usePromptUsage<{ rows: RawAggregateRow[] }>(promptName, USAGE_WINDOW_DAYS);

  // M20 DoD-2 — os DOIS textos. A resolução é pedida SÓ quando o prompt de fato compõe: um
  // alternador entre dois textos idênticos é ruído, e a travessia do grafo custaria em toda
  // abertura de prompt que não referencia nada (a outra metade do DoD-5).
  const [textMode, setTextMode] = useState<TextMode>('escrito');
  const compoe = hasComposition(promptContent);

  const resolved = useResolvedPrompt<{ resolvedContent?: string }>(
    promptName,
    // A leitura só acontece quando o operador PEDE o texto resolvido. Antes
    // disso, a tela não paga a travessia do grafo.
    compoe && textMode === 'resolvido',
  );

  // M20 DoD-4 — quem depende de mim. Lido sempre: é a informação que muda a decisão de promover, e
  // saber que ninguém depende é tão útil quanto a lista.
  const dependentes = usePromptDependentes<unknown>(promptName);

  const text = displayedText(textMode, promptContent, {
    loading: resolved.loading,
    failure: Boolean(resolved.error),
    text: resolved.data?.resolvedContent ?? null,
  });
  const dependentsRows = dependentRows(dependentes.data);

  // M21 DoD-1 — a aba vem da ROTA, nunca de estado. O endereço fica compartilhável, o botão voltar
  // volta uma aba, e recarregar não perde o lugar. Numa tela de onde sai uma promoção, perder o
  // lugar é perder contexto de decisão.
  const { pathname } = useLocation();
  const abaAtiva = abaDaRota(pathname) ?? 'conteudo';

  const rows = revisionRows(revisions.data);
  const ponteiros = labelRows(labels.data);
  const revisionsFailed = Boolean(revisions.error);
  // Três estados, nunca colapsados — a projeção é quem decide, e ela é testada fora do React.
  const agregado: UsageAggregate = usage.error
    ? { estado: 'nao-lido', rationale: 'could not read this prompt usage' }
    : { estado: 'lido', rows: usage.data?.rows ?? [] };
  const usageByRevision = new Map<number, UsageRow>(
    projectUsage(agregado, rows.map((l) => l.version)).map((l) => [l.revision, l]),
  );
  const labelsFailed = Boolean(labels.error);

  // ── M18: a discussão da revisão ────────────────────────────────────────────────────────
  //
  // A revisão discutida por padrão é a MAIS RECENTE — é dela que se fala quando alguém abre o
  // prompt. O `alvo` de uma promoção em curso a substitui, porque nesse momento a pergunta é
  // sobre a revisão que está prestes a ir ao ar.
  const discussedRevision = target ?? rows[0]?.version ?? null;
  const [newComment, setNewComment] = useState('');
  const [commentError, setErroDeComentario] = useState<string | null>(null);

  const comentariosQuery = usePromptComments<unknown>(promptName, discussedRevision ?? 0);
  // `null` e `[]` NÃO são a mesma coisa: o primeiro é "não consegui ler", o segundo é "ninguém
  // comentou". Levam a ações opostas, e colapsá-los é o defeito que o M13 pagou caro.
  const comentarios = comentarioRows(comentariosQuery.data);
  const comentariosFalharam = Boolean(comentariosQuery.error);

  const comentando = useMutation({
    mutationFn: (body: string) => addComment<unknown>(promptName, discussedRevision ?? 0, body),
    onMutate: () => { setErroDeComentario(null); },
    onSuccess: async () => {
      setNewComment('');
      invalidarPrompt(promptName);
    },
    // A recusa TIPADA chega inteira: `secret_in_comment` cita o TIPO de credencial e diz o que
    // fazer. "Erro ao salvar" não diz nada.
    onError: (err: unknown) => { setErroDeComentario(refusalMessage(err)); },
  });

  // ── M12: reverter ──────────────────────────────────────────────────────────────────────
  // O resultado que a tela afirma vem de `labelsMoved`, NUNCA do status: medido, um prompt sem
  // label algum devolve 201 tendo movido nada, e ler aquilo como "revertido" daria falsa
  // segurança exatamente durante um incidente.
  const [targetRevision, setTargetRevision] = useState<number | null>(null);
  const [labelRollback, setLabelRollback] = useState<string | null>(null);
  const [rollbackResultado, setRollbackResultado] = useState<ResultadoRollback | null>(null);
  const [rollbackErro, setRollbackError] = useState<string | null>(null);
  const [labelsParaEscolher, setLabelsToChoose] = useState<string[]>([]);
  // A versão que a recusa referia. Sem guardá-la, escolher o label reabriria o diálogo sobre
  // `null` — o operador escolheria o ambiente e reverteria para lugar nenhum.
  const [revAlvoPendente, setRevAlvoPendente] = useState<number | null>(null);

  const rollback = useMutation({
    mutationFn: (args: { toVersion: number; label: string | null }) =>
      rollbackPrompt<RespostaRollback>(promptName, args.toVersion, args.label ?? undefined),
    onSuccess: (resposta) => {
      setTargetRevision(null);
      setRollbackError(null);
      setLabelsToChoose([]);
      if (resposta) setRollbackResultado(resultadoDoRollback(resposta));
      invalidarPrompt(promptName);
    },
    onError: (err: unknown) => {
      setRevAlvoPendente(targetRevision);
      setTargetRevision(null);
      setRollbackResultado(null);
      // A recusa vira ESCOLHA: `400 label_required` traz `availableLabels`, e a tela pergunta
      // qual em vez de repetir o erro. Um label digitado errado seria respondido como
      // "prompt não encontrado" — por isso ele nunca é digitado.
      const oferecidos = labelsOferecidos(err instanceof ApiError ? err : null, ponteiros);
      if (oferecidos.length > 0 && err instanceof ApiError && err.status === 400) {
        setLabelsToChoose(oferecidos);
        setRollbackError(null);
        return;
      }
      setRollbackError(rejectionMessage(err));
    },
  });

  const promote = useMutation({
    mutationFn: (args: { label: string; version: number }) =>
      promoteLabel<unknown>(promptName, args.label, args.version),
    onSuccess: () => {
      setPromoteError(null);
      setTarget(null);
      setTargetLabel('');
      invalidarPrompt(promptName);
    },
    onError: (err: unknown) => {
      // A mensagem TIPADA do serviço chega à tela; o texto genérico é só o fallback. Uma recusa
      // da política carrega o limiar exigido e o obtido — sem eles o operador tenta de novo igual.
      setPromoteError(refusalMessage(err));
      setTarget(null);
    },
  });

  const atualDoLabel = (label: string): number | null => {
    const p = ponteiros.find((x) => x.label === label);
    return p ? p.version : null;
  };

  const policySummaryText = policySummary(policy.data ?? null);
  const unreadablePolicy = Boolean(policy.error);

  const columns = revisionColumns({
    usageByRevision,
    ponteiros,
    setTarget,
    windowDays: USAGE_WINDOW_DAYS,
    setTargetRevision,
    setTargetLabel,
    setPromoteError,
    setRollbackError,
    setRollbackResultado,
    setLabelRollback,
    setLabelsToChoose,
  });

  return (
    <PageShell
      title={promptName}
      description="The revisions of this prompt and the environment label each one serves."
    >
      <PromptHeader promptName={promptName} latestVersion={latestVersion} abaAtiva={abaAtiva} />

      {rollbackResultado ? (
        <Alert
          intent={rollbackResultado.tom === 'sucesso' ? 'success' : 'warning'}
          title={rollbackResultado.tom === 'sucesso' ? 'Rolled back' : 'Revision created — but nothing changed in production'}
          description={rollbackResultado.text}
        />
      ) : null}

      {labelsParaEscolher.length > 0 ? (
        <Alert
          intent="destructive"
          title="Which environment do you want to roll back?"
          description={
            <span className="flex flex-wrap items-center gap-2">
              This prompt serves more than one environment; choose which one starts pointing at the new revision.
              {labelsParaEscolher.map((l) => (
                <Button
                  key={l}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setLabelRollback(l);
                    setLabelsToChoose([]);
                    setTargetRevision(revAlvoPendente);
                  }}
                >
                  {l}
                </Button>
              ))}
            </span>
          }
        />
      ) : null}

      {rollbackErro ? (
        <Alert intent="destructive" title="The rollback did not happen" description={rollbackErro} />
      ) : null}

      {revisionsFailed ? (
        <Alert
          intent="destructive"
          title="Could not load the revisions"
          description="The list below is empty because the read failed — this does NOT mean this prompt has no revisions."
        />
      ) : null}

      {labelsFailed ? (
        <Alert
          intent="destructive"
          title="Could not load the environment labels"
          description="Without them there is no way to know which revision serves production — promotion stays unavailable until the read recovers."
        />
      ) : null}

      {promoteError ? (
        <Alert intent="destructive" title="The promotion was not applied" description={promoteError} />
      ) : null}

      {/* M20 DoD-2 — os dois textos. Fica ACIMA de tudo porque é o próprio prompt: as tags, a
          discussão e os ambientes são sobre ELE, e vinham antes dele na tela.

          O par existe porque *"sem ele, composição vira mágica que ninguém depura"*. O alternador
          só aparece quando o prompt de fato referencia alguém — dois textos idênticos lado a lado
          seriam ruído, e a leitura resolvida custa a travessia do grafo. */}
      {compoe && abaAtiva === 'conteudo' ? <PromptCardText text={text} textMode={textMode} setTextMode={setTextMode} /> : null}

      <PainelDeAbas usageByRevision={usageByRevision} labels={labels} dependentsRows={dependentsRows} dependentes={dependentes} abaAtiva={abaAtiva} prompt={prompt} promptName={promptName} promptContent={promptContent} latestVersion={latestVersion} compoe={compoe} ponteiros={ponteiros} />


      {/* M16 — as tags do prompt, lidas e ESCRITAS aqui.
          O DoD pede "tags criadas e filtradas na tela" e "a tag aparece no detalhe". A primeira
          entrega do milestone fez só a leitura no catálogo: o `PUT` existia na API e parava no
          BFF, e a tela não tinha como marcar nada. Um produto onde só a API sabe marcar não tem
          a jornada que o milestone promete. */}
      <TagsCard newTag={newTag} setNewTag={setNewTag} tagError={tagError} marcando={marcando} tags={tags} />

      {/* M18 — a discussão. O DoD pede que quem promove a veja ANTES de confirmar, e é por isso
          que o cartão fica ACIMA de Ambientes: a ordem da tela é a ordem da decisão.
          M21 — vive na aba de CONTEÚDO: "por que esta revisão existe" é sobre o que ele diz. */}
      {abaAtiva === 'conteudo' ? <DiscussaoCard discussedRevision={discussedRevision} comentando={comentando} comentarios={comentarios} comentariosFalharam={comentariosFalharam} commentError={commentError} newComment={newComment} setNewComment={setNewComment} /> : null}

      <EnvironmentsCard ponteiros={ponteiros} latestVersion={latestVersion} setTarget={setTarget} setTargetLabel={setTargetLabel} labelsFailed={labelsFailed} setPromoteError={setPromoteError} />

      {/* M21 — o histórico é sobre O QUE ELE DIZ: vive na aba de conteúdo. */}
      {abaAtiva === 'conteudo' ? <RevisionsCard revisions={revisions} latestVersion={latestVersion} REVISIONS_LIMIT={REVISIONS_LIMIT} columns={columns} rows={rows} revisionsFailed={revisionsFailed} /> : null}

      <ConfirmacoesDePonteiro target={target} setTarget={setTarget} targetLabel={targetLabel} promote={promote} targetRevision={targetRevision} setTargetRevision={setTargetRevision} labelRollback={labelRollback} rollback={rollback} latestVersion={latestVersion} promptName={promptName} atualDoLabel={atualDoLabel} policySummary={policySummaryText} unreadablePolicy={unreadablePolicy} />
    </PageShell>
  );
}

/**
 * Extrai a mensagem que o SERVIÇO deu para a recusa.
 *
 * `409 promotion_blocked` carrega `message`, `required` e `actual` — o texto que diz POR QUE a
 * promoção foi barrada. O genérico é só o fallback de quando não há corpo tipado.
 */
function refusalMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // M12: a guarda de 5xx que faltava aqui. `4xx` é decisão de NEGÓCIO e o corpo explica a
    // razão — repassá-lo é o que evita "erro" sobre uma regra que o operador consegue atender.
    // `5xx` é falha de INFRAESTRUTURA e o corpo pode carregar host, porta e stack; repassá-lo
    // vazaria topologia interna para o navegador do cliente. Sem este contraste, o repasse de
    // 4xx vira matcher cego — foi por isto que a cópia nova nasceu com a guarda e esta, não.
    if (err.status >= 500) return 'The prompts service did not respond. Try again in a moment.';
    const body = err.body as { message?: string; error?: string } | undefined;
    if (body?.message) return body.message;
    if (body?.error) return body.error;
  }
  return 'The prompts service refused the promotion and gave no reason.';
}
