import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, PageShell, type DataTableColumn } from '@usetheo/ui';

import { Alert } from '@/components/ui/alert-guard';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api';
import {
  frasePreRollback,
  resultadoDoRollback,
  labelsOferecidos,
  mensagemDeRecusa,
  type RespostaRollback,
  type ResultadoRollback,
} from '@/components/promptly/rollback';
import {
  fetchLabels,
  fetchPolicy,
  fetchPrompt,
  fetchRevisions,
  promoteLabel,
  rollbackPrompt,
} from '@/components/promptly/promptly-api';
import {
  labelRows,
  policySummary,
  promotionConsequence,
  revisionRows,
  revisionsWindow,
  type LabelPointer,
  type PromotionPolicy,
  type RevisionRow,
} from '@/components/promptly/projections';

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

  const labelsKey = ['cloud', '/v1/dashboard/promptly/prompts', promptName, 'labels'] as const;

  // Qual é a ÚLTIMA revisão? A pergunta parece supérflua e não é: a rota de revisões ordena da
  // mais ANTIGA para a mais nova, então sem cursor a página traz o começo do histórico. Sem este
  // número não há como pedir o FIM dele — e esta é a tela de onde sai a promoção (#364).
  const prompt = useQuery({
    queryKey: ['cloud', '/v1/dashboard/promptly/prompts', promptName],
    queryFn: () => fetchPrompt<{ version?: number }>(promptName),
    enabled: promptName !== '',
  });
  const latestVersion = prompt.data?.version ?? null;
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

  const linhas = revisionRows(revisions.data);
  const ponteiros = labelRows(labels.data);
  const revisionsFailed = Boolean(revisions.error);
  const labelsFailed = Boolean(labels.error);

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

  const columns: DataTableColumn<RevisionRow>[] = [
    {
      key: 'version',
      label: 'Revisão',
      render: (row) => <span className="font-mono text-xs">v{row.version}</span>,
    },
    {
      key: 'preview',
      // M12: o corpo INTEIRO, não o trecho. Truncar servia para reconhecer a revisão numa lista;
      // decidir se ela é a certa exige ler o que o modelo de fato recebe. As variáveis vêm de
      // `variables`, que o serviço DECLARA — nunca de um regex nosso sobre o texto.
      label: 'Conteúdo da revisão',
      render: (row) => (
        <div className="space-y-1">
          <pre className="max-w-xl whitespace-pre-wrap font-mono text-xs text-muted-foreground">
            {row.content || '(vazio)'}
          </pre>
          {row.variables.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.variables.map((v) => (
                <Badge key={v} variant="accent" className="font-mono text-[10px]">
                  {v}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'reverter',
      label: 'Reverter',
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Reverter para a revisão v${row.version}`}
          onClick={() => {
            setRollbackErro(null);
            setRollbackResultado(null);
            // Um único label ⇒ já se sabe qual move. Vários ⇒ o serviço recusa com a lista, e a
            // recusa vira a escolha. Zero ⇒ segue sem label, e o resultado dirá que nada mudou.
            setLabelRollback(ponteiros.length === 1 ? ponteiros[0].label : null);
            setLabelsParaEscolher([]);
            setRevAlvo(row.version);
          }}
        >
          Reverter
        </Button>
      ),
    },
    {
      key: 'acoes',
      label: 'Promover',
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          {ponteiros.length === 0 ? (
            <span className="text-xs text-muted-foreground">nenhum label neste prompt</span>
          ) : (
            ponteiros.map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant="secondary"
                aria-label={`Promover ${p.label} para a revisão v${row.version}`}
                onClick={() => {
                  setPromoteError(null);
                  setLabelAlvo(p.label);
                  setAlvo(row.version);
                }}
              >
                {p.label}
              </Button>
            ))
          )}
        </div>
      ),
    },
  ];

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

      <Card>
        <Card.Header>
          <Card.Title asChild>
            <h2>Ambientes</h2>
          </Card.Title>
          <Card.Description>Qual revisão cada label serve neste momento</Card.Description>
        </Card.Header>
        <div className="flex flex-wrap gap-2 p-4 pt-0">
          {ponteiros.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              {labelsFailed
                ? 'Sem dados — a leitura falhou.'
                : 'Nenhum label de ambiente aponta para este prompt.'}
            </span>
          ) : (
            ponteiros.map((p: LabelPointer) => (
              // Texto, nunca só cor: o par label→revisão é o dado que a promoção altera.
              <Badge key={p.label} variant="outline">{`${p.label} → v${p.version}`}</Badge>
            ))
          )}
        </div>
      </Card>

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
