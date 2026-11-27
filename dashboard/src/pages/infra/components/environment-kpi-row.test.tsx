import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EnvironmentKPIRow } from './environment-kpi-row';

const NOW = Date.parse('2026-11-27T17:00:00Z');

describe('EnvironmentKPIRow', () => {
  it('shows a dash for each value the API did not answer, never a zero', () => {
    render(<EnvironmentKPIRow nowMs={NOW} />);
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('shows the ready replicas the API answered', () => {
    render(<EnvironmentKPIRow nowMs={NOW} replicasReady={2} replicasReadyAt="2026-11-27T16:59:40Z" />);
    expect(screen.getByText('2 replicas')).toBeInTheDocument();
  });

  it('shows zero ready replicas as zero', () => {
    render(<EnvironmentKPIRow nowMs={NOW} replicasReady={0} replicasReadyAt="2026-11-27T16:59:40Z" />);
    expect(screen.getByText('0 replicas')).toBeInTheDocument();
  });

  it('writes one replica in the singular', () => {
    render(<EnvironmentKPIRow nowMs={NOW} replicasReady={1} replicasReadyAt="2026-11-27T16:59:40Z" />);
    expect(screen.getByText('1 replica')).toBeInTheDocument();
  });

  it('shows a dash for a reading older than five minutes', () => {
    render(<EnvironmentKPIRow nowMs={NOW} replicasReady={2} replicasReadyAt="2026-11-27T16:54:00Z" />);
    expect(screen.getByTitle('Ready replicas: no reading in the last 5 minutes')).toHaveTextContent('—');
  });

  it('has two cells, the ready replicas and the last deploy', () => {
    const { container } = render(
      <EnvironmentKPIRow nowMs={NOW} replicasReady={2} replicasReadyAt="2026-11-27T16:59:40Z" lastDeploy="2026-11-27T16:58:00Z" />,
    );
    const titles = [...container.querySelectorAll('[title]')].map((cell) => cell.getAttribute('title'));
    expect(titles).toHaveLength(2);
    expect(titles[0]).toBe('Ready replicas');
    expect(titles[1]).toMatch(/^Last deploy: /);
  });

  it('writes the last deploy relative to the given time, with a seven character commit', () => {
    render(<EnvironmentKPIRow nowMs={NOW} lastDeploy="2026-11-27T16:58:00Z" lastDeploySha="abcdef1234567890" />);
    expect(screen.getByText('2m ago (abcdef1)')).toBeInTheDocument();
  });

  it('follows the given time, not the time of the first render', () => {
    const { rerender } = render(<EnvironmentKPIRow nowMs={NOW} lastDeploy="2026-11-27T16:58:00Z" />);
    rerender(<EnvironmentKPIRow nowMs={NOW + 3 * 60_000} lastDeploy="2026-11-27T16:58:00Z" />);
    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('shows a dash for a last deploy that is not a date', () => {
    render(<EnvironmentKPIRow nowMs={NOW} lastDeploy="not-a-date" />);
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});
