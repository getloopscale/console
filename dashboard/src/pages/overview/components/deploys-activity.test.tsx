// deploys-activity.test.tsx — the Overview 7-day deploys activity bars (T-P1).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';
import { DeploysActivity } from './deploys-activity';
import type { BuildStatsDay } from '@/hooks/overview/use-build-stats';

const week: BuildStatsDay[] = [
  { date: '2026-07-13', count: 0 },
  { date: '2026-07-14', count: 3 },
  { date: '2026-07-15', count: 1 },
  { date: '2026-07-16', count: 0 },
  { date: '2026-07-17', count: 5 },
  { date: '2026-07-18', count: 2 },
  { date: '2026-07-19', count: 1 },
];

describe('DeploysActivity — real 7-day stats bars', () => {
  it('renders one accessible bar per day reflecting the real counts', () => {
    render(<DeploysActivity byDay={week} loading={false} error={false} />);
    // One bar per day, each labelled with its count + date (real data, no fabrication).
    expect(screen.getByLabelText('3 deploys on 2026-07-14')).toBeInTheDocument();
    expect(screen.getByLabelText('5 deploys on 2026-07-17')).toBeInTheDocument();
    expect(screen.getByLabelText('0 deploys on 2026-07-13')).toBeInTheDocument();
    // Total across the window is surfaced (3+1+5+2+1 = 12).
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('shows an empty state when there were no deploys', () => {
    const empty = week.map((d) => ({ ...d, count: 0 }));
    render(<DeploysActivity byDay={empty} loading={false} error={false} />);
    expect(screen.getByText(/no deploys in the last 7 days/i)).toBeInTheDocument();
  });

  it('shows a loading skeleton while stats are in flight', () => {
    const { container } = render(<DeploysActivity byDay={[]} loading error={false} />);
    expect(container.querySelector('[data-testid="deploys-activity-skeleton"]')).toBeInTheDocument();
  });

  it('shows an honest error line (never fabricated zeros) on failure', () => {
    render(<DeploysActivity byDay={[]} loading={false} error />);
    expect(screen.getByText(/couldn.t load deploy activity/i)).toBeInTheDocument();
  });
});
