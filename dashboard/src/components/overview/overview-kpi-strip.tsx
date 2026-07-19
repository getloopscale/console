import { Link } from 'react-router-dom';
import { Card } from '@usetheo/ui';
import { CreditCard, FolderKanban, Layers, Rocket } from 'lucide-react';

import { useOverviewKPIs, type OverviewPlanPrice } from '@/hooks/use-overview-kpis';

/**
 * OverviewKPIStrip (J-06 T2.1) — the four Overview KPI cards: Projects,
 * Deploys (7d), Active envs, Plan. Reads the single useOverviewKPIs aggregator.
 *
 * "Plan" (NOT "Spend MTD") is the honest label — the value is the recurring plan
 * list price observed from Stripe (MEET-2026-07-03-003 D1), not metered spend.
 * A null KPI renders "—" (EC-1) — never a fabricated 0.
 */
export function formatPlanPrice(pp: OverviewPlanPrice | null): string {
  if (!pp) return '—';
  const amount = pp.amount_minor / 100;
  const symbol = pp.currency === 'usd' ? '$' : `${pp.currency.toUpperCase()} `;
  const perInterval = pp.interval === 'month' ? '/mo' : pp.interval === 'year' ? '/yr' : '';
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${symbol}${formatted}${perInterval}`;
}

interface KPICardProps {
  icon: typeof FolderKanban;
  label: string;
  value: string;
  /** T-P3: when set, the whole card is a drill-down link to its detail surface. */
  href?: string;
}

function KPICard({ icon: Icon, label, value, href }: KPICardProps) {
  const inner = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-label uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-body-lg font-semibold tabular-nums text-foreground">{value}</p>
      </div>
    </>
  );
  if (href) {
    return (
      <Link to={href} aria-label={label} className="block rounded-lg">
        <Card className="flex items-start gap-3 p-4 transition-colors hover:bg-muted/40">{inner}</Card>
      </Link>
    );
  }
  return <Card className="flex items-start gap-3 p-4">{inner}</Card>;
}

export function OverviewKPIStrip() {
  const kpis = useOverviewKPIs();
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      role="group"
      aria-label="Overview KPIs"
    >
      <KPICard icon={FolderKanban} label="Projects" value={String(kpis.projects)} href="/projects" />
      <KPICard
        icon={Rocket}
        label="Deploys (7d)"
        value={kpis.deploys7d === null ? '—' : String(kpis.deploys7d)}
      />
      <KPICard icon={Layers} label="Active envs" value={String(kpis.activeEnvs)} href="/environments" />
      <KPICard icon={CreditCard} label="Plan" value={formatPlanPrice(kpis.planPrice)} href="/billing" />
    </div>
  );
}
