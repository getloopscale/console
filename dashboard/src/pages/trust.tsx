import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useQueryState, parseAsStringEnum } from 'nuqs';
import { RefreshCw, ShieldAlert, ShieldCheck, Activity } from 'lucide-react';
import { Card, MetricCard, PageShell, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useRequireAuth } from '@/hooks/use-auth';
import { cloudFetch } from '@/lib/api';
import {
  totalInWindow,
  violationCount,
  peakSeverity,
  byPolicy,
  type TrendsPayload,
  type ViolationsPayload,
} from '@/components/trust/trust-series';

/**
 * M23 — `/trust`, a visão geral da camada de confiança.
 *
 * Espelha `/memory` e `/observability`: KPIs no topo e um caminho claro para a lista de violações.
 * Os dados vêm do BFF `/v1/dashboard/trust/*`, que cunha uma chave `trust:read` por tenant — a tela
 * nunca vê credencial.
 *
 * A regra 5Q-3s do `DESIGN.md` mapeada nesta tela:
 *   Onde estou?            título "Trust" + descrição do que a página responde
 *   O que está havendo?    três KPIs no primeiro screen
 *   Ação principal?        um CTA dominante — "Ver violações"
 *   Existe risco?          o KPI de severidade some quando não há risco e aparece quando há
 *   O que faço agora?      o empty-state distingue "limpo" de "sem dado" e diz o próximo passo
 *
 * `throwOnError: true` é deliberado (mesmo motivo de `memory.tsx`): sem ele um erro do backend
 * resolveria para `null` e a tela desenharia zeros fabricados — um painel de segurança relatando
 * "nenhuma violação" durante uma indisponibilidade é pior que uma tela de erro honesta.
 */

const RANGES = ['24h', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];

/** `null` significa "não sei", e a tela diz isso em vez de desenhar um número inventado. */
function show(n: number | null): string {
  return n === null ? '—' : String(n);
}

export function TrustOverviewPage() {
  const { setPageTitle } = usePageMeta();
  useEffect(() => setPageTitle('Trust'), [setPageTitle]);
  useRequireAuth();
  const queryClient = useQueryClient();

  const [range] = useQueryState('range', parseAsStringEnum<Range>([...RANGES]).withDefault('24h'));

  const trendsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/trust/trends', range] as const,
    queryFn: () =>
      cloudFetch<TrendsPayload>(`/v1/dashboard/trust/trends?range=${range}`, {}, { throwOnError: true }),
  });

  const violationsQuery = useQuery({
    queryKey: ['cloud', '/v1/dashboard/trust/policy-violations'] as const,
    queryFn: () =>
      cloudFetch<ViolationsPayload>(
        '/v1/dashboard/trust/policy-violations?limit=100',
        {},
        { throwOnError: true },
      ),
  });

  const isLoading = trendsQuery.isLoading || violationsQuery.isLoading;
  const failed = Boolean(trendsQuery.error ?? violationsQuery.error);

  const events = totalInWindow(trendsQuery.data);
  const violations = violationCount(violationsQuery.data);
  const peak = peakSeverity(violationsQuery.data);
  const policies = byPolicy(violationsQuery.data);

  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cloud', '/v1/dashboard/trust/trends'] });
    void queryClient.invalidateQueries({
      queryKey: ['cloud', '/v1/dashboard/trust/policy-violations'],
    });
  };

  return (
    <PageShell
      title="Trust"
      description="O que a camada de confiança observou nas conversas dos seus agentes."
      primaryAction={{ label: 'Refresh', icon: RefreshCw, onClick: onRefresh }}
    >
      {/* Um erro de backend NUNCA é renderizado como "tudo limpo". */}
      {failed ? (
        <Alert
          intent="destructive"
          title="Não foi possível ler a camada de confiança"
          description="Os números abaixo não foram carregados — isto NÃO significa ausência de violações. Tente atualizar; se persistir, confira se o serviço trust está no ar na página de status."
        />
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            title="Eventos na janela"
            value={show(events)}
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          />
          <MetricCard
            title="Violações de política"
            value={show(violations)}
            icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
          />
          <MetricCard
            title="Severidade mais alta"
            value={peak ?? '—'}
            icon={
              peak ? (
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              )
            }
          />
        </div>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-medium">Violações por política</h2>
        {policies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {failed
              ? 'Sem dados — a leitura falhou.'
              : violations === 0
                ? 'Nenhuma violação registrada. As guardrails seguem ativas no caminho inline.'
                : 'Ainda não há conversas ingeridas para este workspace.'}
          </p>
        ) : (
          <ul className="divide-y">
            {policies.map((p) => (
              <li key={p.label} className="flex items-center justify-between py-2 text-sm">
                <span className="font-mono">{p.label}</span>
                <span className="tabular-nums">{p.value}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <Link to="/trust/violations" className="text-sm font-medium underline">
          Ver todas as violações →
        </Link>
      </Card>
    </PageShell>
  );
}
