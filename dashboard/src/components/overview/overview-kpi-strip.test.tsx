import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-overview-kpis', () => ({ useOverviewKPIs: vi.fn() }));

import { OverviewKPIStrip, formatPlanPrice } from './overview-kpi-strip';
import { useOverviewKPIs } from '@/hooks/use-overview-kpis';

const mocked = vi.mocked(useOverviewKPIs);

beforeEach(() => vi.clearAllMocks());

// J-06 T2.1 — the four Overview KPI cards. "Plan" is the honest label (recurring
// list price, not spend); null KPIs render "—", never a fake 0.
describe('OverviewKPIStrip (J-06 T2.1)', () => {
  it('test_renders_four_kpis_with_real_data', () => {
    mocked.mockReturnValue({
      projects: 4,
      activeEnvs: 3,
      deploys7d: 12,
      planPrice: { amount_minor: 2900, currency: 'usd', interval: 'month' },
      loading: false,
    });
    render(<OverviewKPIStrip />);
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Deploys (7d)')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Active envs')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('$29/mo')).toBeInTheDocument();
  });

  it('test_label_is_Plan_not_Spend', () => {
    mocked.mockReturnValue({ projects: 0, activeEnvs: 0, deploys7d: 0, planPrice: null, loading: false });
    render(<OverviewKPIStrip />);
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.queryByText(/spend/i)).not.toBeInTheDocument();
  });

  it('test_null_planPrice_renders_dash', () => {
    mocked.mockReturnValue({ projects: 1, activeEnvs: 0, deploys7d: 0, planPrice: null, loading: false });
    render(<OverviewKPIStrip />);
    // Plan card shows "—" (honest, never $0 for enterprise/not-yet-persisted).
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('test_null_deploys_renders_dash', () => {
    mocked.mockReturnValue({
      projects: 1,
      activeEnvs: 0,
      deploys7d: null,
      planPrice: { amount_minor: 0, currency: 'usd', interval: 'month' },
      loading: true,
    });
    render(<OverviewKPIStrip />);
    expect(screen.getByText('—')).toBeInTheDocument(); // Deploys (7d) → —
    expect(screen.getByText('$0/mo')).toBeInTheDocument(); // starter still shows $0
  });
});

describe('formatPlanPrice', () => {
  it('test_whole_dollars', () => {
    expect(formatPlanPrice({ amount_minor: 2900, currency: 'usd', interval: 'month' })).toBe('$29/mo');
  });
  it('test_zero_starter', () => {
    expect(formatPlanPrice({ amount_minor: 0, currency: 'usd', interval: 'month' })).toBe('$0/mo');
  });
  it('test_fractional_dollars', () => {
    expect(formatPlanPrice({ amount_minor: 2999, currency: 'usd', interval: 'month' })).toBe('$29.99/mo');
  });
  it('test_null_yields_dash', () => {
    expect(formatPlanPrice(null)).toBe('—');
  });
  it('test_non_usd_currency', () => {
    expect(formatPlanPrice({ amount_minor: 9900, currency: 'eur', interval: 'month' })).toBe('EUR 99/mo');
  });
});
