import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { History, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageShell,
  type Severity,
  SeverityBadge,
  Skeleton,
  Timestamp,
} from '@usetheo/ui';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';
import { ListSkeleton } from '@/components/lens/list-skeleton';
import { AlertCreateForm } from '@/components/lens/alert-create-form';
import type { AlertDraft, AlertField } from '@/components/lens/alert-draft';
import {
  EMPTY_ALERT_DRAFT,
  METRICA_DE_PROMPT,
  alertProblems,
  visibleAlertProblems,
  exigeNomeDePrompt,
  toCreateBody,
} from '@/components/lens/alert-draft';
import { Alert } from '@/components/ui/alert-guard';

import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { ApiError, cloudFetch } from '@/lib/http/api';

/**
 * M53 — /observability/alerts. Threshold alert rules on observability metrics. A rule
 * (metric + comparator + threshold + window + target webhook) is evaluated per-tenant by the background
 * lens_alert_evaluator; on a breach it dispatches a notification through the J-16 webhook delivery worker
 * (fire-once-until-cleared — no storm). CRUD via `/v1/dashboard/lens/alert-rules`.
 */

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  comparator: string;
  threshold: number;
  window_seconds: number;
  webhook_id: string;
  enabled: boolean;
  status: string;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
}
/**
 * The honest status→severity map (issue #alerts-badge): a badge must reflect the rule's TRUE state,
 * not "TRIGGERED-or-green". A disabled rule is paused (inert, neutral), a cleared rule is ok, a firing
 * rule is alert, and any other status is unknown — never a misleading green "ok". SeverityBadge maps
 * these to Badge variants (alert→destructive, ok→success, warning→warning, else outline).
 */
export function alertSeverity(status: string, enabled: boolean): Severity {
  if (!enabled) return 'paused'; // a disabled rule is not "OK/success" — it is inert
  if (status === 'TRIGGERED') return 'alert';
  if (status === 'OK') return 'ok';
  return 'unknown'; // unknown / pending → neutral, never a fabricated success
}

interface AlertRulesResult {
  alert_rules: AlertRule[];
}

/** M84 — one firing in a rule's history (metric value at fire time vs threshold, when). */
interface FiredAlert {
  id: string;
  metric: string;
  comparator: string;
  threshold: number;
  value: number;
  fired_at: string;
}
interface FiredAlertsResult {
  firings: FiredAlert[];
  total: number;
}

/**
 * M84 — the expandable per-rule firing history. Reads the paginated `…/{id}/history` endpoint; honest
 * empty ("never fired") when there are zero firings, and a fail-closed typed alert on a load error (an
 * error must NEVER render as "never fired"). Loaded lazily (only when the row is expanded).
 */
function RuleHistory({ ruleId, comparatorLabel }: { ruleId: string; comparatorLabel: (c: string) => string }) {
  const history = useQuery({
    queryKey: ['cloud', '/v1/dashboard/lens/alert-rules', ruleId, 'history'] as const,
    queryFn: () =>
      cloudFetch<FiredAlertsResult>(`/v1/dashboard/lens/alert-rules/${encodeURIComponent(ruleId)}/history`, {}, { throwOnError: true }),
    retry: false,
  });
  if (history.isPending) return <Skeleton className="h-16 w-full" aria-label="Loading firing history" />;
  if (history.isError) {
    return <Alert intent="warning" title="Could not load the firing history" description="Retry, or check your access to this workspace." data-testid="history-error" />;
  }
  const firings = history.data?.firings ?? [];
  if (firings.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Never fired — no threshold breaches recorded for this rule yet.</p>;
  }
  return (
    <DataTable
      data={firings}
      rowKey={(f) => f.id}
      columns={[
        {
          key: 'value',
          label: 'Value at fire',
          render: (f) => (
            <span className="font-mono text-xs">
              {f.value} {comparatorLabel(f.comparator)} {f.threshold}
            </span>
          ),
        },
        { key: 'fired_at', label: 'When', render: (f) => <Timestamp value={f.fired_at} /> },
      ]}
    />
  );
}
interface WorkspaceWebhook {
  id: string;
  url?: string;
  label?: string;
}
interface WebhooksResult {
  webhooks: WorkspaceWebhook[];
}

const METRICS = [
  { value: 'error_rate', label: 'Error rate (%)' },
  { value: 'cost', label: 'Cost (USD)' },
  { value: 'p95_latency', label: 'Latency p95 (ms)' },
  // M22 — a metrica escopada a UM prompt. As tres acima medem o workspace inteiro, e "o erro
  // subiu" nao diz QUAL prompt piorou. Ver `usetheoai/theo-cloud#459`.
  { value: METRICA_DE_PROMPT, label: 'Prompt resolutions' },
] as const;
const COMPARATORS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
] as const;
/**
 * Segundos → dias INTEIROS, arredondando para cima.
 *
 * É a MESMA conta do avaliador (`cmd/main.go`: `(windowSeconds + 86399) / 86400`), e a igualdade
 * é o ponto. O agregado de prompt só é endereçável em dias; se a tela consultasse uma janela e a
 * regra medisse outra, o operador dimensionaria o limiar por um número e a regra violaria por
 * outro — reintroduzindo o alerta mal calibrado que esta tela existe para evitar.
 *
 * "Last hour" (3600 s) vira 1 dia, e é por isso que a tela DIZ a janela consultada em vez de
 * repetir o rótulo escolhido: o sistema mede 24 h, e esconder isso seria mentir sobre o período.
 */
function janelaEmDias(windowSeconds: number): number {
  return Math.max(1, Math.ceil(windowSeconds / 86400));
}

const WINDOWS = [
  { value: '3600', label: 'Last hour' },
  { value: '86400', label: 'Last 24h' },
  { value: '604800', label: 'Last 7 days' },
  { value: '2592000', label: 'Last 30 days' },
] as const;

export function LensAlertsPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Observability · Alerts'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  // M22 DoD-3 — o CONSUMIDOR do deep-link que `promptly/tabs/producao.tsx` produz.
  //
  // Escrever `?prompt=<nome>` do outro lado e não lê-lo aqui faz o operador cair num formulário
  // vazio, em `error_rate`, com o campo Prompt nem renderizado — exatamente a fricção que o DoD
  // existe para remover. Um contrato de deep-link com produtor e sem consumidor não é um caminho:
  // é um link que finge levar a algum lugar.
  const [searchParams] = useSearchParams();
  const promptDoLink = searchParams.get('prompt')?.trim() ?? '';

  const [name, setName] = useState('');
  const [metric, setMetric] = useState<string>(promptDoLink !== '' ? METRICA_DE_PROMPT : 'error_rate');
  const [comparator, setComparator] = useState<string>('gt');
  const [threshold, setThreshold] = useState('');
  const [windowSeconds, setWindowSeconds] = useState<string>('3600');
  const [webhookId, setWebhookId] = useState('');
  // M22 — so significa algo na metrica de prompt; `toCreateBody` o omite nas demais, porque o
  // CHECK de pareamento do banco vale nos DOIS sentidos.
  const [promptName, setPromptName] = useState(promptDoLink);
  // Campos que o operador já tocou. Governa só a EXIBIÇÃO do problema — `alertProblems` continua
  // sendo quem libera o submit. Sem isto a tela abre acusando campos que ninguém viu ainda.
  const [touched, setTouched] = useState<ReadonlySet<AlertField>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<AlertRule | null>(null);
  const [openHistory, setOpenHistory] = useState<AlertRule | null>(null); // M84 — expanded rule's history

  const rulesKey = ['cloud', '/v1/dashboard/lens/alert-rules'] as const;
  const rules = useQuery({
    queryKey: rulesKey,
    queryFn: () => cloudFetch<AlertRulesResult>('/v1/dashboard/lens/alert-rules', {}, { throwOnError: true }),
  });
  const webhooks = useQuery({
    queryKey: ['cloud', '/v1/settings/webhooks/list'] as const,
    queryFn: () => cloudFetch<WebhooksResult>('/v1/settings/webhooks/list', {}, { throwOnError: true }),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: rulesKey });

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      cloudFetch<AlertRule>('/v1/dashboard/lens/alert-rules', { method: 'POST', body: JSON.stringify(input) }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      setName('');
      setThreshold('');
      setWebhookId('');
      setPromptName('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      cloudFetch<unknown>(`/v1/dashboard/lens/alert-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }, { throwOnError: true }),
    retry: false,
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });
  // M98 (D-H3) — the On/Off toggle flips OPTIMISTICALLY (the binary interaction where optimism clearly
  // pays: no stale RTT gap). onMutate flips the cached rule immediately; onError rolls back to the
  // snapshot so a failed PATCH never leaves the UI diverged from the server (the M83 no-silent-
  // divergence pattern); onSettled re-syncs. The button is disabled while its own toggle is pending
  // (no double-fire).
  const toggle = useMutation({
    mutationFn: (r: AlertRule) =>
      cloudFetch<unknown>(
        `/v1/dashboard/lens/alert-rules/${encodeURIComponent(r.id)}`,
        { method: 'PATCH', body: JSON.stringify({ enabled: !r.enabled }) },
        { throwOnError: true },
      ),
    retry: false,
    onMutate: async (r: AlertRule) => {
      await queryClient.cancelQueries({ queryKey: rulesKey });
      const prev = queryClient.getQueryData<AlertRulesResult>(rulesKey);
      queryClient.setQueryData<AlertRulesResult>(rulesKey, (old) =>
        old
          ? { ...old, alert_rules: old.alert_rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) }
          : old,
      );
      return { prev };
    },
    onError: (_e, _r, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(rulesKey, ctx.prev); // rollback — never diverge from server
    },
    onSettled: invalidate,
  });

  // M72 — a write-action must not fail silently. Surface the first failing mutation's error.
  const writeError = create.isError ? 'create' : toggle.isError ? 'toggle' : remove.isError ? 'delete' : null;

  // A mensagem TIPADA do serviço, quando existe. O backend recusa com texto acionável
  // (`INVALID_PROMPT` diz exatamente o que falta); colapsar tudo num verbo e renderizar "check
  // your access" anuncia um 400 de VALIDAÇÃO como problema de PERMISSÃO — e manda o operador
  // investigar o lado errado. O genérico continua sendo o fallback, para o 500 sem corpo.
  const razaoDoServico = ((create.error ?? toggle.error ?? remove.error) as ApiError | null)?.body;
  const mensagemDoServico =
    razaoDoServico && typeof razaoDoServico === 'object' && 'message' in razaoDoServico
      ? String((razaoDoServico as { message: unknown }).message)
      : null;

  const availableWebhooks = webhooks.data?.webhooks ?? [];
  // M22 — a validacao passou a vir do rascunho puro, que e quem conhece o PAREAMENTO
  // metrica<->prompt. Deixa-la aqui em linha faria a tela permitir montar um estado que o banco
  // torna irrepresentavel, e a recusa chegaria como erro de servidor em vez de orientacao.
  const draft = {
    ...EMPTY_ALERT_DRAFT,
    name,
    metric,
    promptName,
    comparator,
    threshold,
    windowSeconds,
    webhookId,
  };
  const canCreate = alertProblems(draft).length === 0 && !create.isPending;
  const problemasVisiveis = visibleAlertProblems(draft, touched);

  /**
   * Um ponto de mudança para todo campo do formulário.
   *
   * Espelhar sete pares `value`/`onX` duplicava um tipo que já existe (`AlertDraft`) e espalhava a
   * marcação de `touched` por sete lugares — três dos quais eu havia esquecido, deixando o botão
   * desabilitar sem dizer por quê em `name`, `threshold` e `webhookId`.
   */
  function aoMudarCampo(campo: keyof AlertDraft, valor: string) {
    const setters: Record<keyof AlertDraft, (v: string) => void> = {
      name: setName,
      metric: setMetric,
      promptName: setPromptName,
      comparator: setComparator,
      threshold: setThreshold,
      windowSeconds: setWindowSeconds,
      webhookId: setWebhookId,
    };
    setters[campo](valor);
    // Só os campos que o módulo puro modela como problema entram em `touched` — os demais não
    // têm mensagem a exibir, e marcá-los seria estado sem consumidor.
    if (campo === 'name' || campo === 'promptName' || campo === 'threshold' || campo === 'webhookId') {
      setTouched((t) => new Set(t).add(campo));
    }
  }

  // O valor MEDIDO agora, ao lado do campo de limiar. Risco #2 do milestone: um limite escolhido
  // as cegas e o alerta mal calibrado, e alerta que dispara sem motivo ensina o time a ignorar o
  // canal. Le o MESMO agregado que a aba de producao do prompt mostra.
  const promptAlvo = exigeNomeDePrompt(metric) ? promptName.trim() : '';
  const janelaDoValorMedido = janelaEmDias(Number(windowSeconds));
  const usoAtual = useQuery({
    queryKey: ['cloud', 'promptly-usage', promptAlvo, janelaDoValorMedido] as const,
    enabled: promptAlvo !== '',
    retry: false,
    queryFn: () =>
      cloudFetch<{ rows?: { resolutions?: number }[] } | null>(
        `/v1/dashboard/promptly/prompts/${encodeURIComponent(promptAlvo)}/usage?windowDays=${janelaDoValorMedido}`,
        {},
        { throwOnError: true },
      ),
  });
  // Ausente NÃO é zero. Um 200 cujo corpo não traz `rows`, ou uma linha sem `resolutions`, é
  // contrato quebrado — e devolver um número aqui imprimiria "Hoje: undefined resoluções", ou pior,
  // um total plausível calculado sobre linhas incompletas. É o mesmo motivo pelo qual o avaliador
  // Go usa ponteiros (`prompt_metric.go`): a distinção entre ausente e zero é a única que importa.
  const linhas = usoAtual.data?.rows;
  const resolucoesAgora =
    linhas === undefined || linhas.some((r) => typeof r.resolutions !== 'number')
      ? undefined
      : linhas.reduce((t, r) => t + (r.resolutions as number), 0);

  const columns: DataTableColumn<AlertRule>[] = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    {
      key: 'rule',
      label: 'Rule',
      render: (r) => (
        <span className="font-mono text-xs">
          {r.metric} {COMPARATORS.find((c) => c.value === r.comparator)?.label ?? r.comparator} {r.threshold}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <SeverityBadge severity={alertSeverity(r.status, r.enabled)} label={r.enabled ? r.status : 'Disabled'} />,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggle.mutate(r)}
          disabled={toggle.isPending && toggle.variables?.id === r.id}
          aria-label={`Toggle ${r.name}`}
          aria-pressed={r.enabled}
        >
          {r.enabled ? 'On' : 'Off'}
        </Button>
      ),
    },
    {
      // M22 DoD-4 — "ainda não avaliado" NÃO é "sem dados".
      //
      // O avaliador roda a cada 60 s. Uma regra recém-criada mostrada como um travessão faz o
      // operador concluir que falhou e criar a segunda, passando a ter duas regras sobre a mesma
      // coisa. É a regra do M13/M15 aplicada ao ciclo de vida da própria regra: uma leitura que
      // ainda não aconteceu é um fato diferente de uma leitura que não achou nada.
      key: 'last_evaluated_at',
      label: 'Last evaluated',
      render: (r) =>
        r.last_evaluated_at === null ? (
          <span className="text-xs italic text-muted-foreground">Not evaluated yet</span>
        ) : (
          <span className="text-xs text-muted-foreground">{r.last_evaluated_at}</span>
        ),
    },
    {
      key: 'last_triggered_at',
      label: 'Last triggered',
      render: (r) => <span className="text-xs text-muted-foreground">{r.last_triggered_at ?? '—'}</span>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpenHistory((cur) => (cur?.id === r.id ? null : r))}
            aria-label={`History for ${r.name}`}
            aria-expanded={openHistory?.id === r.id}
          >
            <History className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPendingDelete(r)} aria-label={`Delete ${r.name}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const comparatorLabel = (c: string) => COMPARATORS.find((x) => x.value === c)?.label ?? c;

  const rows = rules.data?.alert_rules ?? [];

  return (
    <>
      <PageShell title="Alerts" description="Get notified when a metric crosses a threshold.">
        <div className="space-y-6">
          {writeError ? (
            <Alert
              intent="destructive"
              title={`Could not ${writeError} the alert rule`}
              description={
                mensagemDoServico ??
                'The change was not saved — try again, or check your access to this workspace.'
              }
              data-testid="alerts-write-error"
            />
          ) : null}
          <Card>
            <Card.Header>
              <h2 className="text-sm font-medium">Create an alert rule</h2>
            </Card.Header>
            <Card.Body>
              {availableWebhooks.length === 0 ? (
                <Alert intent="warning" title="Register a webhook first">
                  Alerts are delivered to a registered webhook. Add one under{' '}
                  <Link to="/observability/webhooks" className="font-medium text-primary underline underline-offset-2">
                    Observability › Webhooks →
                  </Link>
                  , then create a rule here.
                </Alert>
              ) : (
                <AlertCreateForm
                  draft={draft}
                  onChange={aoMudarCampo}
                  problems={problemasVisiveis}
                  webhooks={availableWebhooks}
                  metrics={METRICS}
                  comparators={COMPARATORS}
                  windows={WINDOWS}
                  canCreate={canCreate}
                  onSubmit={() => create.mutate(toCreateBody(draft))}
                  usoAtual={
                    promptAlvo !== ''
                      ? {
                          carregando: usoAtual.isLoading,
                          // Contrato quebrado é leitura falha, não medição — mesmo com 200.
                          erro: usoAtual.isError || (!usoAtual.isLoading && resolucoesAgora === undefined),
                          resolucoes: resolucoesAgora,
                          janelaDias: janelaDoValorMedido,
                        }
                      : undefined
                  }
                />
              )}
            </Card.Body>
          </Card>

          {rules.isLoading ? (
            <ListSkeleton label="alert rules" />
          ) : rules.isError ? (
            <Alert intent="warning" title="Could not load alert rules">
              The lens service is unavailable. Try again shortly.
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState title="No alert rules yet" description="Create a rule above to get notified on a threshold breach." />
          ) : (
            <Card>
              <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
            </Card>
          )}

          {openHistory !== null ? (
            <Card data-testid="rule-history">
              <Card.Header>
                <h2 className="text-sm font-medium">Firing history — {openHistory.name}</h2>
                <Button variant="ghost" size="sm" onClick={() => setOpenHistory(null)} aria-label="Close history">
                  Close
                </Button>
              </Card.Header>
              <Card.Body>
                <RuleHistory ruleId={openHistory.id} comparatorLabel={comparatorLabel} />
              </Card.Body>
            </Card>
          ) : null}
        </div>
      </PageShell>

      {pendingDelete !== null ? (
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={`Delete rule "${pendingDelete.name}"?`}
          description={<p className="text-sm">This removes the alert rule. No further notifications will fire for it.</p>}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete rule'}
          cancelLabel="Cancel"
          intent="destructive"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(pendingDelete.id)}
        />
      ) : null}
    </>
  );
}
