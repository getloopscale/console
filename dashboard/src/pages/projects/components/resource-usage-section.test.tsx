import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { UseMetricsRangeOptions, UseMetricsRangeResult } from '@/hooks/projects/use-metrics-range';
import { ResourceUsageSection } from './resource-usage-section';

const MIB = 1024 * 1024;
const ok = (values: number[]): UseMetricsRangeResult => ({
  data: values.map((v, i) => ({ t: 1_800_000_000 + i * 60, v })),
  status: 'ok',
  loading: false,
  error: false,
});

const series = new Map<string, UseMetricsRangeResult>();
const calls: UseMetricsRangeOptions[] = [];

vi.mock('@/hooks/projects/use-metrics-range', () => ({
  useMetricsRange: (_project: string, options: UseMetricsRangeOptions) => {
    calls.push(options);
    return series.get(options.signal) ?? { data: [], status: 'collecting', loading: false, error: false };
  },
}));

beforeEach(() => {
  series.clear();
  calls.length = 0;
});

const card = (name: string) => within(screen.getByRole('group', { name }));

describe('ResourceUsageSection', () => {
  it('shows what the app uses now against its limit', () => {
    series.set('cpu_usage', ok([0.1, 0.3]));
    series.set('cpu_limit', ok([1.5]));
    series.set('memory_usage', ok([200 * MIB, 384 * MIB]));
    series.set('memory_limit', ok([512 * MIB]));
    series.set('restarts_1h', ok([0, 0]));

    render(<ResourceUsageSection projectName="shop" env="production" />);

    expect(card('CPU').getByText('0.3 vCPU', { selector: 'p' })).toBeInTheDocument();
    expect(card('CPU').getByText('20% of the 1.5 vCPU limit')).toBeInTheDocument();
    expect(card('CPU').getByRole('meter', { name: 'CPU used of the limit' })).toHaveAttribute('aria-valuenow', '20');
    expect(card('CPU').getByText('Within limit')).toBeInTheDocument();

    expect(card('Memory').getByText('384 MiB', { selector: 'p' })).toBeInTheDocument();
    expect(card('Memory').getByText('75% of the 512 MiB limit')).toBeInTheDocument();
    expect(card('Memory').getByText('High')).toBeInTheDocument();

    expect(card('Restarts').getByText('Stable')).toBeInTheDocument();
  });

  it('gives every drawn point to a screen reader as a table', () => {
    series.set('memory_usage', ok([200 * MIB, 384 * MIB]));

    render(<ResourceUsageSection projectName="shop" env="production" />);

    const rows = card('Memory').getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').at(-1)?.textContent);
    expect(rows).toEqual(['200 MiB', '384 MiB']);
  });

  it('says the limit is near when memory passes 90% of it', () => {
    series.set('memory_usage', ok([500 * MIB]));
    series.set('memory_limit', ok([512 * MIB]));

    render(<ResourceUsageSection projectName="shop" env="production" />);

    expect(card('Memory').getByText('Near limit')).toBeInTheDocument();
  });

  it('flags an app whose containers restarted', () => {
    series.set('restarts_1h', ok([0, 2.03]));

    render(<ResourceUsageSection projectName="shop" env="production" />);

    expect(card('Restarts').getByText('Restarting')).toBeInTheDocument();
    expect(card('Restarts').getAllByText('2').length).toBeGreaterThan(0);
  });

  it('says a series is still being collected and invents no number', () => {
    render(<ResourceUsageSection projectName="shop" env="production" />);

    expect(card('CPU').getByText('—', { selector: 'p' })).toBeInTheDocument();
    expect(card('CPU').getByText('No limit set')).toBeInTheDocument();
    expect(card('CPU').getByText(/Collecting data/)).toBeInTheDocument();
  });

  it('says so when the metrics backend is unreachable', () => {
    series.set('cpu_usage', { data: [], status: 'prometheus_unreachable', loading: false, error: true });

    render(<ResourceUsageSection projectName="shop" env="production" />);

    expect(card('CPU').getByText('Metrics are unavailable right now.')).toBeInTheDocument();
  });

  it('reads the chosen range for the environment of the page', () => {
    render(<ResourceUsageSection projectName="shop" env="preview" />);
    fireEvent.click(screen.getByRole('button', { name: 'Last 24 hours' }));

    const lastCpu = calls.filter((c) => c.signal === 'cpu_usage').at(-1);
    expect(lastCpu).toEqual({ signal: 'cpu_usage', range: '24h', env: 'preview' });
    expect(screen.getByRole('button', { name: 'Last 24 hours' })).toHaveAttribute('aria-pressed', 'true');
  });
});
