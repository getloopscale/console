import { Card, Histogram, Skeleton } from '@usetheo/ui';
import { Alert } from '@/components/ui/alert-guard';
import { useTracesSample, DURATION_SAMPLE } from '@/hooks/lens/use-traces-sample';
import { formatDuration } from '@/lib/formatting/format';
import type { Trace } from '../traces/columns';

/**
 * M11 — the trace-duration DISTRIBUTION histogram for the dashboards board. Reuses the existing
 * traces read (`GET /v1/dashboard/lens/traces` via `cloudFetch`) and bins each trace's `durationMs`
 * client-side into the design system's `Histogram` (which owns its own binning + empty state). A
 * trace with no finite `durationMs` is DROPPED — never binned as 0 (M59 R2 data-honesty).
 */


/** The finite `durationMs` values from the traces list (drops absent / NaN / ±Infinity — no fabricated 0). */
export function durationsFromTraces(traces: Trace[]): number[] {
  const out: number[] = [];
  for (const t of traces) {
    if (typeof t.durationMs === 'number' && Number.isFinite(t.durationMs)) out.push(t.durationMs);
  }
  return out;
}

/** How many equal-width bins the duration histogram uses (Histogram degrades gracefully below this). */
const DURATION_BIN_COUNT = 12;


export function DurationHistogram() {
  // The current-view traces (the board's default window). Reuses the shared traces read — no new endpoint.
  const query = useTracesSample<Trace>();

  if (query.isPending) {
    return <Skeleton className="h-44 w-full" aria-label="Loading trace durations" />;
  }
  if (query.isError) {
    return (
      <Alert
        intent="warning"
        title="Could not load trace durations"
        description="The traces list is unavailable — the duration histogram has no data to show."
        data-testid="duration-histogram-error"
      />
    );
  }

  const durations = durationsFromTraces(query.data?.traces ?? []);
  return (
    <Card>
      <Card.Body>
        <Histogram
          title="Trace duration"
          values={durations}
          binCount={DURATION_BIN_COUNT}
          valueFormatter={(ms) => formatDuration(ms)}
        />
        {durations.length === DURATION_SAMPLE ? (
          /*
           * B-024 (classe) — a leitura tem teto (ver DURATION_SAMPLE). Um
           * histograma sobre amostra sem declarar o n convida a leitura errada:
           * quem olha a distribuição assume que ela cobre tudo.
           *
           * O aviso vive AQUI e não no `title` porque o title alimenta o nome
           * acessível do gráfico — a primeira tentativa enfiou a amostra ali e
           * renomeou o elemento para leitores de tela. O texto é um irmão, não
           * um pedaço do rótulo.
           */
          <p className="pt-2 text-body-sm text-muted-foreground">
            Based on the {DURATION_SAMPLE} most recent traces.
          </p>
        ) : null}
      </Card.Body>
    </Card>
  );
}
