import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, PageShell } from '@usetheo/ui';
import {
  dependentRows,
  temComposicao,
  textoExibido,
  type ModoDeTexto,
} from '@/pages/promptly/components/composicao';
import { ABAS, abaDaRota, rotaDaAba } from './detail-tabs';
import { revisionColumns } from './revision-columns';
import { ConsumoTab } from './tabs/consumo';
import { ConfigTab } from './tabs/config';
import { ProducaoTab } from './tabs/producao';

import { Alert } from '@/components/ui/alert-guard';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/http/api';
import {
  frasePreRollback,
  resultadoDoRollback,
  labelsOferecidos,
  mensagemDeRecusa,
  type RespostaRollback,
  type ResultadoRollback,
} from '@/pages/promptly/components/rollback';
import {
  fetchLabels,
  fetchPolicy,
  fetchPrompt,
  fetchPromptUsage,
  fetchRevisions,
  promoteLabel,
  rollbackPrompt,
  fetchCatalogPage,
  setTags,
  fetchComments,
  addComment,
  fetchPromptResolvido,
  fetchDependentes,
} from '@/pages/promptly/components/promptly-api';
import {
  catalogRows,
  comentarioRows,
  labelRows,
  policySummary,
  promotionConsequence,
  revisionRows,
  revisionsWindow,
  type LabelPointer,
  type PromotionPolicy,
} from '@/pages/promptly/components/projections';
import { projetarUso, type AgregadoDeUso, type LinhaDeUso } from '@/pages/promptly/components/usage';

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

// M15 — a janela do agregado de uso. Curta por padrão e DITA na tela (ver a coluna "Uso"):
// implícita, o operador atribuiria o número ao período errado.
const USAGE_WINDOW_DAYS = 7;

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
const AMBIENTES_DE_PRODUCAO = new Set(['production', 'prod']);

/**
 * Qual ambiente o trecho de consumo publica.
 *
 * Produção vence; na ausência dela, o primeiro declarado. O `/review` mediu que o fallback é
 * DETERMINÍSTICO (o repositório ordena por label) mas **arbitrário**: um prompt com `canary` e
 * `staging` publica `canary` porque C vem antes de S. A escolha em si é defensável — publicar
 * versão fixa seria pior —, e o que faltava era a tela DIZER que não é produção. Ver
 * `ambienteEProducao`.
 */
function ambienteDoTrecho(
  ponteiros: readonly { readonly label: string; readonly version: number }[],
): string | null {
  return (
    ponteiros.find((p) => AMBIENTES_DE_PRODUCAO.has(p.label))?.label ?? ponteiros[0]?.label ?? null
  );
}

const BASE_DE_CONSUMO =
  typeof window === 'undefined' ? '/v1/promptly' : `${window.location.origin}/v1/promptly`;

/** A linha crua do agregado, como o BFF a repassa do `theo-lens`. */
interface LinhaDoAgregadoBruta {
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
  const queryClient = useQueryClient();

  /** A revisão escolhida para promoção; `null` = nenhum diálogo aberto. */
  const [alvo, setAlvo] = useState<number | null>(null);
  const [labelAlvo, setLabelAlvo] = useState<string>('');
  const [promoteError, setPromoteError] = useState<string | null>(null);
  // M16 — as tags. O rascunho do campo é local; o conjunto vem do servidor.
  const [novaTag, setNovaTag] = useState('');
  const [erroDeTag, setErroDeTag] = useState<string | null>(null);

  /**
   * As tags do prompt vêm do CATÁLOGO — a projeção que já as carrega, filtrada por este nome.
   *
   * Um endpoint dedicado seria trabalho antes da necessidade: o dado já existe a um `search` de
   * distância, e criar uma segunda rota para lê-lo duplicaria a projeção sem comprar alcance.
   */
  const tagsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/promptly/prompts', promptName, 'tags'] as const,
    queryFn: () => fetchCatalogPage<unknown>(1, { search: promptName }),
    enabled: promptName !== '',
  });
  const tags = catalogRows(tagsQuery.data?.data).find((r) => r.name === promptName)?.tags ?? [];

  const marcando = useMutation({
    mutationFn: (proximo: readonly string[]) => setTags<unknown>(promptName, proximo),
    onMutate: () => { setErroDeTag(null); },
    onSuccess: async () => {
      setNovaTag('');
      // Reler em vez de otimizar: o serviço normaliza (ordena, deduplica), e pintar a tela com o
      // que EU mandei mostraria uma ordem que o servidor não tem.
      await queryClient.invalidateQueries({
        queryKey: ['cloud', '/v1/dashboard/promptly/prompts', promptName, 'tags'],
      });
    },
    // A recusa TIPADA chega ao operador: `too_many_tags` e `empty_tag` dizem o que fazer;
    // "erro ao salvar" não diz nada.
    onError: (err: unknown) => { setErroDeTag(mensagemDaRecusa(err)); },
  });

  const labelsKey = ['cloud', '/v1/dashboard/promptly/prompts', promptName, 'labels'] as const;

  // Qual é a ÚLTIMA revisão? A pergunta parece supérflua e não é: a rota de revisões ordena da
  // mais ANTIGA para a mais nova, então sem cursor a página traz o começo do histórico. Sem este
  // número não há como pedir o FIM dele — e esta é a tela de onde sai a promoção (#364).
  const prompt = useQuery({
    queryKey: ['cloud', '/v1/dashboard/promptly/prompts', promptName],
    queryFn: () =>
      fetchPrompt<{
        version?: number;
        content?: string;
        // M21 — a aba de config lê a afinação declarada (M17) e o contrato de entrada. Ambos já
        // vinham nesta resposta e eram descartados pela tipagem estreita.
        modelConfig?: { model?: string; temperature?: number; maxTokens?: number } | null;
        variables?: string[];
      }>(promptName),
    enabled: promptName !== '',
  });
  const latestVersion = prompt.data?.version ?? null;
  const promptContent = prompt.data?.content ?? null;
  const janela = revisionsWindow(latestVersion, REVISIONS_LIMIT);

  const revisionsKey = [
    'cloud', '/v1/dashboard/promptly/prompts', promptName, 'revisions', janela.after,
  ] as const;

  const revisions = useQuery({
    queryKey: revisionsKey,
    queryFn: () => fetchRevisions<unknown>(promptName, REVISIONS_LIMIT, janela.after),
    // Só depois de saber a última versão: pedir antes traria a janela errada e a tela piscaria
    // do histórico velho para o novo, com o operador podendo clicar no intervalo.
    enabled: promptName !== '' && !prompt.isLoading,
  });

  const labels = useQuery({
    queryKey: labelsKey,
    queryFn: () => fetchLabels<unknown>(promptName),
    enabled: promptName !== '',
  });

  // A política é lida por LABEL, e só quando há um diálogo aberto: perguntá-la para todos os
  // labels ao abrir a tela gastaria requisições que ninguém pediu.
  const policy = useQuery({
    queryKey: ['cloud', '/v1/dashboard/promptly/prompts', promptName, 'policies', labelAlvo],
    queryFn: () => fetchPolicy<PromotionPolicy>(promptName, labelAlvo),
    enabled: promptName !== '' && labelAlvo !== '',
    // Ausência de política responde 404 por CONTRATO, não por falha; repetir não muda a resposta.
    retry: false,
  });

  // M15 — o uso observado por revisão. Janela CURTA por padrão e DITA na tela: um agregado
  // "desde sempre" varre a tabela de spans do ecossistema inteiro, e uma janela implícita faz
  // o operador atribuir o número ao período errado.
  const uso = useQuery({
    queryKey: ['cloud', '/v1/dashboard/promptly/prompts', promptName, 'usage', USAGE_WINDOW_DAYS],
    queryFn: () => fetchPromptUsage<{ rows: LinhaDoAgregadoBruta[] }>(promptName, USAGE_WINDOW_DAYS),
    enabled: promptName !== '',
    retry: false,
  });

  // M20 DoD-2 — os DOIS textos. A resolução é pedida SÓ quando o prompt de fato compõe: um
  // alternador entre dois textos idênticos é ruído, e a travessia do grafo custaria em toda
  // abertura de prompt que não referencia nada (a outra metade do DoD-5).
  const [modoDeTexto, setModoDeTexto] = useState<ModoDeTexto>('escrito');
  const compoe = temComposicao(promptContent);

  const resolvido = useQuery({
    queryKey: ['cloud', '/v1/dashboard/promptly/prompts', promptName, 'resolved'] as const,
    queryFn: () => fetchPromptResolvido<{ resolvedContent?: string }>(promptName),
    // A leitura só acontece quando o operador PEDE o texto resolvido. Antes disso, a tela não paga.
    enabled: promptName !== '' && compoe && modoDeTexto === 'resolvido',
    retry: false,
  });

  // M20 DoD-4 — quem depende de mim. Lido sempre: é a informação que muda a decisão de promover, e
  // saber que ninguém depende é tão útil quanto a lista.
  const dependentes = useQuery({
    queryKey: ['cloud', '/v1/dashboard/promptly/prompts', promptName, 'dependents'] as const,
    queryFn: () => fetchDependentes<unknown>(promptName),
    enabled: promptName !== '',
    retry: false,
  });

  const texto = textoExibido(modoDeTexto, promptContent, {
    carregando: resolvido.isLoading,
    erro: Boolean(resolvido.error),
    texto: resolvido.data?.resolvedContent ?? null,
  });
  const dependentesLinhas = dependentRows(dependentes.data);

  // M21 DoD-1 — a aba vem da ROTA, nunca de estado. O endereço fica compartilhável, o botão voltar
  // volta uma aba, e recarregar não perde o lugar. Numa tela de onde sai uma promoção, perder o
  // lugar é perder contexto de decisão.
  const { pathname } = useLocation();
  const abaAtiva = abaDaRota(pathname) ?? 'conteudo';

  const linhas = revisionRows(revisions.data);
  const ponteiros = labelRows(labels.data);
  const revisionsFailed = Boolean(revisions.error);
  // Três estados, nunca colapsados — a projeção é quem decide, e ela é testada fora do React.
  const agregado: AgregadoDeUso = uso.error
    ? { estado: 'nao-lido', razao: 'não consegui ler o uso deste prompt' }
    : { estado: 'lido', rows: uso.data?.rows ?? [] };
  const usoPorRevisao = new Map<number, LinhaDeUso>(
    projetarUso(agregado, linhas.map((l) => l.version)).map((l) => [l.revision, l]),
  );
  const labelsFailed = Boolean(labels.error);

  // ── M18: a discussão da revisão ────────────────────────────────────────────────────────
  //
  // A revisão discutida por padrão é a MAIS RECENTE — é dela que se fala quando alguém abre o
  // prompt. O `alvo` de uma promoção em curso a substitui, porque nesse momento a pergunta é
  // sobre a revisão que está prestes a ir ao ar.
  const revisaoDiscutida = alvo ?? linhas[0]?.version ?? null;
  const [novoComentario, setNovoComentario] = useState('');
  const [erroDeComentario, setErroDeComentario] = useState<string | null>(null);

  const comentariosKey = [
    'cloud', '/v1/dashboard/promptly/prompts', promptName, 'comments', revisaoDiscutida,
  ] as const;
  const comentariosQuery = useQuery({
    queryKey: comentariosKey,
    queryFn: () => fetchComments<unknown>(promptName, revisaoDiscutida ?? 0),
    enabled: promptName !== '' && revisaoDiscutida !== null,
  });
  // `null` e `[]` NÃO são a mesma coisa: o primeiro é "não consegui ler", o segundo é "ninguém
  // comentou". Levam a ações opostas, e colapsá-los é o defeito que o M13 pagou caro.
  const comentarios = comentarioRows(comentariosQuery.data);
  const comentariosFalharam = Boolean(comentariosQuery.error);

  const comentando = useMutation({
    mutationFn: (corpo: string) => addComment<unknown>(promptName, revisaoDiscutida ?? 0, corpo),
    onMutate: () => { setErroDeComentario(null); },
    onSuccess: async () => {
      setNovoComentario('');
      await queryClient.invalidateQueries({ queryKey: comentariosKey });
    },
    // A recusa TIPADA chega inteira: `secret_in_comment` cita o TIPO de credencial e diz o que
    // fazer. "Erro ao salvar" não diz nada.
    onError: (err: unknown) => { setErroDeComentario(mensagemDaRecusa(err)); },
  });

  // ── M12: reverter ──────────────────────────────────────────────────────────────────────
  // O resultado que a tela afirma vem de `labelsMoved`, NUNCA do status: medido, um prompt sem
  // label algum devolve 201 tendo movido nada, e ler aquilo como "revertido" daria falsa
  // segurança exatamente durante um incidente.
  const [revAlvo, setRevAlvo] = useState<number | null>(null);
  const [labelRollback, setLabelRollback] = useState<string | null>(null);
  const [rollbackResultado, setRollbackResultado] = useState<ResultadoRollback | null>(null);
  const [rollbackErro, setRollbackErro] = useState<string | null>(null);
  const [labelsParaEscolher, setLabelsParaEscolher] = useState<string[]>([]);
  // A versão que a recusa referia. Sem guardá-la, escolher o label reabriria o diálogo sobre
  // `null` — o operador escolheria o ambiente e reverteria para lugar nenhum.
  const [revAlvoPendente, setRevAlvoPendente] = useState<number | null>(null);

  const rollback = useMutation({
    mutationFn: (args: { toVersion: number; label: string | null }) =>
      rollbackPrompt<RespostaRollback>(promptName, args.toVersion, args.label ?? undefined),
    onSuccess: (resposta) => {
      setRevAlvo(null);
      setRollbackErro(null);
      setLabelsParaEscolher([]);
      if (resposta) setRollbackResultado(resultadoDoRollback(resposta));
      void queryClient.invalidateQueries({ queryKey: labelsKey });
      void queryClient.invalidateQueries({ queryKey: revisionsKey });
    },
    onError: (err: unknown) => {
      setRevAlvoPendente(revAlvo);
      setRevAlvo(null);
      setRollbackResultado(null);
      // A recusa vira ESCOLHA: `400 label_required` traz `availableLabels`, e a tela pergunta
      // qual em vez de repetir o erro. Um label digitado errado seria respondido como
      // "prompt não encontrado" — por isso ele nunca é digitado.
      const oferecidos = labelsOferecidos(err instanceof ApiError ? err : null, ponteiros);
      if (oferecidos.length > 0 && err instanceof ApiError && err.status === 400) {
        setLabelsParaEscolher(oferecidos);
        setRollbackErro(null);
        return;
      }
      setRollbackErro(mensagemDeRecusa(err));
    },
  });

  const promote = useMutation({
    mutationFn: (args: { label: string; version: number }) =>
      promoteLabel<unknown>(promptName, args.label, args.version),
    onSuccess: () => {
      setPromoteError(null);
      setAlvo(null);
      setLabelAlvo('');
      void queryClient.invalidateQueries({ queryKey: labelsKey });
    },
    onError: (err: unknown) => {
      // A mensagem TIPADA do serviço chega à tela; o texto genérico é só o fallback. Uma recusa
      // da política carrega o limiar exigido e o obtido — sem eles o operador tenta de novo igual.
      setPromoteError(mensagemDaRecusa(err));
      setAlvo(null);
    },
  });

  const atualDoLabel = (label: string): number | null => {
    const p = ponteiros.find((x) => x.label === label);
    return p ? p.version : null;
  };

  const resumoPolitica = policySummary(policy.data ?? null);
  const politicaIlegivel = Boolean(policy.error);

  const columns = revisionColumns({
    usoPorRevisao,
    ponteiros,
    setAlvo,
    janelaDias: USAGE_WINDOW_DAYS,
    setRevAlvo,
    setLabelAlvo,
    setPromoteError,
    setRollbackErro,
    setRollbackResultado,
    setLabelRollback,
    setLabelsParaEscolher,
  });

  return (
    <PageShell
      title={promptName}
      description="As revisões deste prompt e o label de ambiente que cada uma serve."
    >
      {/* Caminho de VOLTA explícito: sem ele o detalhe é uma sala sem porta. */}
      <div className="flex flex-wrap items-center gap-4">
        <Link to="/promptly" className="text-sm underline-offset-4 hover:underline">
          ← Catálogo de prompts
        </Link>
        {/* M12: as duas ações POR PROMPT ficam aqui, não no menu — uma entrada de menu para elas
            exigiria um nome que o menu não tem e levaria a lugar nenhum. */}
        {/* M14: o playground e alcancado DAQUI, nao do submenu — ele e sempre de UM prompt, e um
            item de menu levaria a uma tela que nao sabe de qual. */}
        <Link
          to={`/promptly/${encodeURIComponent(promptName)}/playground`}
          className="text-sm underline-offset-4 hover:underline"
        >
          Playground
        </Link>
        <Link
          to={`/promptly/${encodeURIComponent(promptName)}/diff`}
          className="text-sm underline-offset-4 hover:underline"
        >
          Comparar revisões
        </Link>
        <Link
          to={`/promptly/new?name=${encodeURIComponent(promptName)}&next=${(latestVersion ?? 0) + 1}`}
          className="text-sm underline-offset-4 hover:underline"
        >
          Nova revisão deste prompt
        </Link>
      </div>

      {/* M21 DoD-1 — as quatro perguntas. São quatro coisas diferentes sobre o mesmo objeto, e
          empilhá-las numa coluna fazia o operador rolar por três respostas que não pediu para
          chegar na que pediu. */}
      <nav aria-label="Seções do prompt" className="flex flex-wrap gap-1 border-b">
        {ABAS.map((aba) => (
          <Link
            key={aba.id}
            to={rotaDaAba(promptName, aba.id)}
            aria-current={abaAtiva === aba.id ? 'page' : undefined}
            title={aba.pergunta}
            className={
              abaAtiva === aba.id
                ? 'border-b-2 border-primary px-3 py-2 text-sm font-medium'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {aba.rotulo}
          </Link>
        ))}
      </nav>

      {rollbackResultado ? (
        <Alert
          intent={rollbackResultado.tom === 'sucesso' ? 'success' : 'warning'}
          title={rollbackResultado.tom === 'sucesso' ? 'Revertido' : 'Revisão criada — mas nada mudou em produção'}
          description={rollbackResultado.texto}
        />
      ) : null}

      {labelsParaEscolher.length > 0 ? (
        <Alert
          intent="destructive"
          title="Qual ambiente você quer reverter?"
          description={
            <span className="flex flex-wrap items-center gap-2">
              Este prompt serve mais de um ambiente; escolha qual passa a apontar para a revisão nova.
              {labelsParaEscolher.map((l) => (
                <Button
                  key={l}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setLabelRollback(l);
                    setLabelsParaEscolher([]);
                    setRevAlvo(revAlvoPendente);
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
        <Alert intent="destructive" title="A reversão não aconteceu" description={rollbackErro} />
      ) : null}

      {revisionsFailed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar as revisões"
          description="A lista abaixo está vazia porque a leitura falhou — isto NÃO significa que este prompt não tem revisões."
        />
      ) : null}

      {labelsFailed ? (
        <Alert
          intent="destructive"
          title="Não foi possível carregar os labels de ambiente"
          description="Sem eles não é possível saber qual revisão serve produção — a promoção fica indisponível até a leitura voltar."
        />
      ) : null}

      {promoteError ? (
        <Alert intent="destructive" title="A promoção não foi aplicada" description={promoteError} />
      ) : null}

      {/* M20 DoD-2 — os dois textos. Fica ACIMA de tudo porque é o próprio prompt: as tags, a
          discussão e os ambientes são sobre ELE, e vinham antes dele na tela.

          O par existe porque *"sem ele, composição vira mágica que ninguém depura"*. O alternador
          só aparece quando o prompt de fato referencia alguém — dois textos idênticos lado a lado
          seriam ruído, e a leitura resolvida custa a travessia do grafo. */}
      {compoe && abaAtiva === 'conteudo' ? (
        <Card>
          <Card.Header>
            <Card.Title asChild>
              <h2>Texto do prompt</h2>
            </Card.Title>
            <Card.Description>
              Este prompt referencia outros. <strong>Como foi escrito</strong> mostra os marcadores;{' '}
              <strong>resolvido</strong> mostra o texto que o modelo de fato recebe.
            </Card.Description>
          </Card.Header>
          <div className="space-y-3 p-4 pt-0">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Qual texto exibir">
              <Button
                variant={modoDeTexto === 'escrito' ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={modoDeTexto === 'escrito'}
                onClick={() => { setModoDeTexto('escrito'); }}
              >
                Como foi escrito
              </Button>
              <Button
                variant={modoDeTexto === 'resolvido' ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={modoDeTexto === 'resolvido'}
                onClick={() => { setModoDeTexto('resolvido'); }}
              >
                Resolvido
              </Button>
            </div>
            {texto.estado === 'falhou' ? (
              // NUNCA cair para o texto escrito aqui: seria mostrar um texto correto sob um rótulo
              // errado, e o operador leria marcadores literais achando ver a composição.
              <Alert
                intent="destructive"
                title="Não foi possível resolver a composição"
                description="O texto resolvido não pôde ser lido. Alterne de volta para ver o texto como foi escrito."
              />
            ) : texto.estado === 'carregando' ? (
              <p className="text-sm text-muted-foreground">Resolvendo as referências…</p>
            ) : (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs">
                {texto.texto || '(vazio)'}
              </pre>
            )}
          </div>
        </Card>
      ) : null}

      {/* M21 — as três abas que não são a de conteúdo. `Tags` e `Ambientes` ficam FORA delas, no
          corpo do layout, porque o DoD-3 pede promover e etiquetar SEM SAIR DA TELA: numa aba, a
          ação sumiria em três dos quatro estados. */}
      {abaAtiva === 'config' ? (
        <ConfigTab
          ilegivel={Boolean(prompt.error)}
          versao={latestVersion}
          modelConfig={prompt.data?.modelConfig ?? null}
          variaveis={prompt.data?.variables ?? []}
        />
      ) : null}

      {abaAtiva === 'producao' ? (
        <ProducaoTab
          promptName={promptName}
          janelaDias={USAGE_WINDOW_DAYS}
          linhas={[...usoPorRevisao.values()]}
          dependentes={dependentesLinhas}
          dependentesIlegiveis={Boolean(dependentes.error)}
          dependentesCarregando={dependentes.isLoading}
        />
      ) : null}

      {abaAtiva === 'consumo' ? (
        <ConsumoTab
          ambientesIlegiveis={Boolean(labels.error)}
          promptIlegivel={Boolean(prompt.error)}
          alvo={
            // `latestVersion === null` é ausência de dado, não "versão 1". Cair para `1` fabricaria
            // um número que PODE existir e ser a revisão errada — num trecho feito para ser copiado.
            promptContent === null || latestVersion === null
              ? null
              : {
                  nome: promptName,
                  compoe,
                  ultimaVersao: latestVersion,
                  label: ambienteDoTrecho(ponteiros),
                  ambienteEProducao:
                    ambienteDoTrecho(ponteiros) === null
                      ? true // sem ambiente, o trecho usa versão e não afirma nada sobre produção
                      : AMBIENTES_DE_PRODUCAO.has(ambienteDoTrecho(ponteiros) as string),
                  variaveis: prompt.data?.variables ?? [],
                  baseUrl: BASE_DE_CONSUMO,
                }
          }
        />
      ) : null}


      {/* M16 — as tags do prompt, lidas e ESCRITAS aqui.
          O DoD pede "tags criadas e filtradas na tela" e "a tag aparece no detalhe". A primeira
          entrega do milestone fez só a leitura no catálogo: o `PUT` existia na API e parava no
          BFF, e a tela não tinha como marcar nada. Um produto onde só a API sabe marcar não tem
          a jornada que o milestone promete. */}
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Tags</h2>
          </Card.Title>
          <Card.Description>
            Como este prompt é encontrado no catálogo. A marcação é do PROMPT, não da revisão —
            criar a revisão seguinte não a perde.
          </Card.Description>
        </Card.Header>
        <div className="space-y-3 p-4 pt-0">
          {erroDeTag !== null ? (
            <Alert intent="destructive" title="A marcação não foi salva" description={erroDeTag} />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {tags.length === 0 ? (
              // Dito, nunca em branco: um espaço vazio lê como "não carregou". A ausência é um
              // fato sobre o prompt — mesma razão do "sem descrição" do M17.
              <span className="text-sm text-muted-foreground">Nenhuma tag neste prompt.</span>
            ) : (
              tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                  {t}
                  <button
                    type="button"
                    aria-label={`Remover a tag ${t}`}
                    disabled={marcando.isPending}
                    onClick={() => { marcando.mutate(tags.filter((x) => x !== t)); }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={novaTag}
              onChange={(e) => { setNovaTag(e.target.value); }}
              aria-label="Nova tag"
              placeholder="suporte"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={novaTag.trim() === '' || marcando.isPending}
              onClick={() => {
                // O conjunto INTEIRO, nunca só a nova: o contrato do serviço é substituição, e
                // mandar só a tag nova apagaria as antigas do outro lado.
                const t = novaTag.trim();
                marcando.mutate(tags.includes(t) ? tags : [...tags, t]);
              }}
            >
              Marcar
            </Button>
          </div>
        </div>
      </Card>

      {/* M18 — a discussão. O DoD pede que quem promove a veja ANTES de confirmar, e é por isso
          que o cartão fica ACIMA de Ambientes: a ordem da tela é a ordem da decisão.
          M21 — vive na aba de CONTEÚDO: "por que esta revisão existe" é sobre o que ele diz. */}
      {abaAtiva === 'conteudo' ? (
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Discussão {revisaoDiscutida !== null ? `da v${String(revisaoDiscutida)}` : ''}</h2>
          </Card.Title>
          <Card.Description>
            Por que esta revisão existe, foi rejeitada ou está pronta. O comentário é da REVISÃO —
            criar a próxima não o move.
          </Card.Description>
        </Card.Header>
        <div className="space-y-3 p-4 pt-0">
          {comentariosFalharam ? (
            <Alert
              intent="destructive"
              title="Não foi possível ler a discussão"
              description="A ausência abaixo é ignorância, não silêncio: pode haver comentários que esta tela não conseguiu carregar."
            />
          ) : null}
          {erroDeComentario !== null ? (
            <Alert intent="destructive" title="O comentário não foi salvo" description={erroDeComentario} />
          ) : null}
          {comentarios.length === 0 && !comentariosFalharam ? (
            <p className="text-sm text-muted-foreground">Nenhum comentário nesta revisão.</p>
          ) : (
            <ul className="space-y-2">
              {comentarios.map((c) => (
                <li key={c.id} className="rounded-md border p-3 text-sm">
                  <p className="whitespace-pre-wrap">{c.body}</p>
                  <p className="pt-1 text-xs text-muted-foreground">
                    {/* Autor ausente é DITO: uma credencial sem identidade humana não tem autor,
                        e inventar um apareceria numa auditoria como fato. */}
                    {c.author ?? 'autor não registrado'}{c.quando === '' ? '' : ` · ${c.quando}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-start gap-2">
            <textarea
              value={novoComentario}
              onChange={(e) => { setNovoComentario(e.target.value); }}
              aria-label="Comentar esta revisão"
              placeholder="por que esta revisão existe, ou por que não deve ir ao ar"
              rows={2}
              className="min-w-[18rem] flex-1 rounded-md border border-input bg-background p-2 text-sm"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={novoComentario.trim() === '' || comentando.isPending || revisaoDiscutida === null}
              onClick={() => { comentando.mutate(novoComentario.trim()); }}
            >
              Comentar
            </Button>
          </div>
        </div>
      </Card>
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Ambientes</h2>
          </Card.Title>
          <Card.Description>
            Qual revisão cada label serve neste momento — e a promoção para a{' '}
            <strong>última</strong> revisão, que é o ato comum. Para promover uma revisão anterior,
            a tabela em <em>Conteúdo</em> tem uma ação por linha.
          </Card.Description>
        </Card.Header>
        <div className="flex flex-wrap items-center gap-2 p-4 pt-0">
          {ponteiros.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              {labelsFailed
                ? 'Sem dados — a leitura falhou.'
                : 'Nenhum label de ambiente aponta para este prompt.'}
            </span>
          ) : (
            ponteiros.map((p: LabelPointer) => (
              <span key={p.label} className="inline-flex items-center gap-1">
                {/* Texto, nunca só cor: o par label→revisão é o dado que a promoção altera. */}
                <Badge variant="outline">{`${p.label} → v${p.version}`}</Badge>
                {/* M21 DoD-3 — a AÇÃO, e não só a leitura.
                    O `/review` mediu que este cartão ficava fora das abas mas era somente leitura:
                    a promoção inteira vivia na tabela de revisões, que está na aba de conteúdo. O
                    teste que dizia cobrir o DoD-3 só verificava dois cabeçalhos, e passava com ZERO
                    botões — e o CHANGELOG afirmava publicamente o que a tela não fazia.
                    Promover a ÚLTIMA revisão é o ato comum; promover uma anterior continua na
                    tabela, e a descrição diz isso em vez de deixar o operador procurar. */}
                {latestVersion !== null && p.version !== latestVersion ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    // O rótulo diz "para a ÚLTIMA revisão", e não só o número: existem duas formas de promover
                    // na tela (esta e a da tabela por linha), e um rótulo idêntico as tornaria
                    // indistinguíveis para leitor de tela e para teste. A diferença não é cosmética —
                    // esta promove a última; aquela, a linha que o operador escolheu.
                    aria-label={`Promover ${p.label} para a última revisão, v${String(latestVersion)}`}
                    onClick={() => {
                      setPromoteError(null);
                      setLabelAlvo(p.label);
                      setAlvo(latestVersion);
                    }}
                  >
                    → v{latestVersion}
                  </Button>
                ) : null}
              </span>
            ))
          )}
        </div>
      </Card>

      {/* M21 — o histórico é sobre O QUE ELE DIZ: vive na aba de conteúdo. */}
      {abaAtiva === 'conteudo' ? (
      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Revisões</h2>
          </Card.Title>
          <Card.Description>
            {latestVersion === null
              ? `As ${REVISIONS_LIMIT} primeiras — a página vem do servidor.`
              : `As ${REVISIONS_LIMIT} mais recentes (até a v${latestVersion}) — a página vem do servidor, e o histórico completo continua na API.`}
          </Card.Description>
        </Card.Header>

        <DataTable
          columns={columns}
          data={linhas}
          rowKey={(row) => String(row.version)}
          loading={revisions.isLoading}
          emptyState={
            <EmptyState
              icon={History}
              title={revisionsFailed ? 'Sem dados — a leitura falhou' : 'Nenhuma revisão'}
              description={
                revisionsFailed
                  ? 'Tente novamente em instantes. Enquanto isso, não é possível saber quais revisões existem.'
                  : 'Este prompt ainda não tem revisões publicadas.'
              }
            />
          }
        />
      </Card>
      ) : null}

      <ConfirmDialog
        open={alvo !== null}
        onOpenChange={(open) => {
          // O erro NÃO é limpo aqui: o diálogo fecha ao confirmar, inclusive quando o serviço
          // recusa, e limpar neste ponto apagaria no mesmo ciclo a mensagem que explica por que o
          // label continua onde estava. Ele é limpo ao ABRIR um novo diálogo.
          if (!open) {
            setAlvo(null);
          }
        }}
        intent="destructive"
        title={`Promover "${labelAlvo}" para a revisão v${alvo ?? ''}?`}
        description={
          <>
            <p>{promotionConsequence({ label: labelAlvo, atual: atualDoLabel(labelAlvo), alvo: alvo ?? 0 })}</p>
            <p className="mt-2">
              {/* A regra vigente, ANTES do ato. Ilegível ≠ ausente: o primeiro manda investigar, o
                  segundo diz que a promoção é livre. Confundi-los é o defeito que a tela evita. */}
              <strong>Política: </strong>
              {politicaIlegivel
                ? 'não foi possível ler a política deste label — a promoção pode ser recusada pelo serviço.'
                : resumoPolitica.texto}
            </p>
          </>
        }
        confirmLabel="Promover"
        cancelLabel="Cancelar"
        confirmationPhrase={labelAlvo}
        loading={promote.isPending}
        onConfirm={() => {
          if (alvo === null || labelAlvo === '') return;
          promote.mutate({ label: labelAlvo, version: alvo });
        }}
      />

      {/* M12 — a confirmação de reverter. Nomeia a revisão que será CRIADA: um texto de "volta
          para a v1" faria o operador esperar o histórico encolher, e ele nunca encolhe. */}
      <ConfirmDialog
        open={revAlvo !== null}
        onOpenChange={(aberto) => !aberto && setRevAlvo(null)}
        title={`Reverter ${promptName} para a v${revAlvo ?? 0}`}
        description={
          <p className="text-sm">
            {frasePreRollback({
              nome: promptName,
              paraVersao: revAlvo ?? 0,
              ultimaVersao: latestVersion ?? 0,
              label: labelRollback,
            })}
          </p>
        }
        confirmLabel="Reverter"
        cancelLabel="Cancelar"
        confirmationPhrase={promptName}
        loading={rollback.isPending}
        onConfirm={() => {
          if (revAlvo === null) return;
          rollback.mutate({ toVersion: revAlvo, label: labelRollback });
        }}
      />
    </PageShell>
  );
}

/**
 * Extrai a mensagem que o SERVIÇO deu para a recusa.
 *
 * `409 promotion_blocked` carrega `message`, `required` e `actual` — o texto que diz POR QUE a
 * promoção foi barrada. O genérico é só o fallback de quando não há corpo tipado.
 */
function mensagemDaRecusa(err: unknown): string {
  if (err instanceof ApiError) {
    // M12: a guarda de 5xx que faltava aqui. `4xx` é decisão de NEGÓCIO e o corpo explica a
    // razão — repassá-lo é o que evita "erro" sobre uma regra que o operador consegue atender.
    // `5xx` é falha de INFRAESTRUTURA e o corpo pode carregar host, porta e stack; repassá-lo
    // vazaria topologia interna para o navegador do cliente. Sem este contraste, o repasse de
    // 4xx vira matcher cego — foi por isto que a cópia nova nasceu com a guarda e esta, não.
    if (err.status >= 500) return 'O serviço de prompts não respondeu. Tente novamente em instantes.';
    const body = err.body as { message?: string; error?: string } | undefined;
    if (body?.message) return body.message;
    if (body?.error) return body.error;
  }
  return 'O serviço de prompts recusou a promoção e não informou o motivo.';
}
