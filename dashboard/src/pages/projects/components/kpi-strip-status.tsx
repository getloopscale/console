import { Card } from '@usetheo/ui';
import { SLO, sloTone } from '@/pages/projects/components/slo-tones';
import { Activity, AlertTriangle, Cpu, Clock, TrendingUp } from 'lucide-react';
import { formatLatencyMs, formatRps } from '@/pages/projects/components/metric-format';

/**
 * KPIStripStatus — Plan J-18 T3.1.
 *
 * 5-card horizontal KPI strip for the project Status page (Vercel-style).
 * Each card shows: label, big tabular-nums value, optional delta arrow,
 * optional spark-line (placeholder; chart rendering deferred to T3.3.b).
 *
 * Honest empty state: `null`/`undefined` values render as em-dash "—" not 0
 * (per ADR D1 of plan v1.1 + EC-8 absorption — never pretend 0 means no
 * traffic vs no data).
 *
 * Signals shown (subset of 8 SignalGrid pills):
 *   - Replicas (count, tabular)
 *   - Uptime % over 24h (tabular)
 *   - p95 latency (ms, tabular)
 *   - Error rate % (tabular)
 *   - RPS (rate, tabular)
 *
 * The remaining 3 signals (status, alerts_active, last_deploy_time) are
 * rendered in the SignalGrid (T3.2) as pills rather than KPI cards because
 * they are categorical/timestamp display, not numeric KPIs.
 */
export interface KPIStripStatusProps {
  /** Number of ready replicas; null → "—" honest. */
  replicas?: number | null;
  /** Uptime % over 24h (0..100); null → "—". */
  uptime24h?: number | null;
  /** p95 latency in ms; null → "—". */
  p95LatencyMs?: number | null;
  /** Error rate % over 5min window (0..100); null → "—". */
  errorRate?: number | null;
  /** Requests per second over 1min window; null → "—". */
  rps?: number | null;
  /** Signals whose series the API says is still being collected: shown as "Collecting…". */
  collecting?: Partial<Record<'replicas' | 'uptime24h' | 'p95LatencyMs' | 'errorRate' | 'rps', boolean>>;
}

const COLLECTING = 'Collecting…';

type Tone = 'success' | 'warning' | 'destructive' | 'muted';

const TONE_CLASSES: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
};

interface KPICardProps {
  icon: typeof Cpu;
  label: string;
  value: string;
  tone: Tone;
}

function KPICard({ icon: Icon, label, value, tone }: KPICardProps) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <Icon className={`size-4 shrink-0 ${TONE_CLASSES[tone]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-label uppercase text-muted-foreground">{label}</p>
        <p className={`mt-1 font-mono text-body-lg font-semibold tabular-nums ${TONE_CLASSES[tone]}`}>
          {value}
        </p>
      </div>
    </Card>
  );
}

// B-194 — os três limiares moravam aqui E em `signal-grid.tsx`, byte a byte. Números duplicados
// não divergem no dia da cópia; divergem no dia em que alguém muda um.
const uptimeTone = (v: number | null | undefined): Tone => sloTone(v, SLO.uptime);
const errorRateTone = (v: number | null | undefined): Tone => sloTone(v, SLO.errorRatePct);
const p95Tone = (v: number | null | undefined): Tone => sloTone(v, SLO.p95LatencyMs);

export function KPIStripStatus(props: KPIStripStatusProps) {
  const { replicas, uptime24h, p95LatencyMs, errorRate, rps, collecting = {} } = props;
  // A missing value reads "Collecting…" when the API said so, and "—" otherwise.
  const orEmpty = (key: keyof NonNullable<KPIStripStatusProps['collecting']>, text: string | null) =>
    text ?? (collecting[key] ? COLLECTING : '—');
  const finite = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v);

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      role="group"
      aria-label="Project KPI strip"
    >
      <KPICard
        icon={Cpu}
        label="Replicas"
        value={orEmpty('replicas', finite(replicas) ? String(replicas) : null)}
        tone={typeof replicas !== 'number' || !Number.isFinite(replicas) ? 'muted' : replicas === 0 ? 'destructive' : 'success'}
      />
      <KPICard
        icon={Activity}
        label="Uptime 24h"
        value={orEmpty('uptime24h', finite(uptime24h) ? `${uptime24h.toFixed(2)}%` : null)}
        tone={uptimeTone(uptime24h)}
      />
      <KPICard
        icon={Clock}
        label="p95 Latency"
        value={orEmpty('p95LatencyMs', formatLatencyMs(p95LatencyMs))}
        tone={p95Tone(p95LatencyMs)}
      />
      <KPICard
        icon={AlertTriangle}
        label="Error Rate"
        value={orEmpty('errorRate', finite(errorRate) ? `${errorRate.toFixed(2)}%` : null)}
        tone={errorRateTone(errorRate)}
      />
      <KPICard
        icon={TrendingUp}
        label="RPS"
        value={orEmpty('rps', formatRps(rps))}
        tone={typeof rps !== 'number' || !Number.isFinite(rps) ? 'muted' : 'success'}
      />
    </div>
  );
}
