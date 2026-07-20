import { describe, it, expect, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { DataTable } from '@usetheo/ui';

import { render, screen } from '@/test/render';
import { formatCost, formatDuration, formatTokens } from '@/lib/format';
import { tracesColumns, type Trace } from './columns';

/**
 * M59 P1 T1.1 — the consensus-spine columns render latency/tokens/cost from `format.ts`, an absent
 * field renders `—` (never a fabricated value — R2), and the `@usetheo/ui` `Checkbox` toggles the
 * compare selection. Rendered through the real `DataTable` so the column config is exercised as shipped.
 */

const full: Trace = {
  traceId: 'trace-aaaaaaaaaaaa',
  name: 'agent.turn',
  model: 'claude-sonnet-4-6',
  statusCode: 'error',
  startTimeUnixNano: '1000000000',
  durationMs: 5800,
  costUsd: 0.0123,
  totalTokens: 1620,
};

const bare: Trace = { traceId: 'trace-bbbbbbbbbbbb', name: 'bare.span' };

function renderTable(opts: {
  selected?: Set<string>;
  toggleSelected?: (id: string) => void;
  onOpen?: (id: string) => void;
  onAsk?: (id: string) => void;
  data?: Trace[];
}) {
  const columns = tracesColumns({
    selected: opts.selected ?? new Set(),
    toggleSelected: opts.toggleSelected ?? (() => {}),
    onOpen: opts.onOpen ?? (() => {}),
    onAsk: opts.onAsk ?? (() => {}),
  });
  return render(<DataTable columns={columns} data={opts.data ?? [full, bare]} rowKey={(r) => r.traceId} />);
}

describe('M59 P1 tracesColumns — spine columns', () => {
  it('labels the trace wall-clock column "Duration", not "Latency" (M53 / #74)', () => {
    // The column renders the trace wall-clock (durationMs). For interaction traces that is the whole
    // session (minutes), NOT request latency — so the honest header is "Duration". Request latency
    // lives in the Overview metric, computed from llm_request spans.
    renderTable({ data: [full] });
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.queryByText('Latency')).toBeNull();
  });

  it('renders latency/tokens/cost cells via format.ts for a full row', () => {
    renderTable({ data: [full] });
    expect(screen.getByText(formatDuration(5800))).toBeInTheDocument(); // "5.8s"
    expect(screen.getByText(formatTokens(1620))).toBeInTheDocument(); // "1,620"
    expect(screen.getByText(formatCost(0.0123))).toBeInTheDocument(); // "$0.0123"
  });

  it('renders "—" for a row missing latency/tokens/cost (no fabricated value — R2)', () => {
    renderTable({ data: [bare] });
    // latency, tokens, cost all absent → three em-dashes in the row's spine cells.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
    // never a "0"/"0ms"/"$0.00" fabricated for a missing field.
    expect(screen.queryByText('0ms')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('M78 — renders an Evals count badge when a trace was scored, em-dash when not', () => {
    renderTable({ data: [{ ...full, evaluationsCount: 3 }, bare] });
    // the scored trace shows its evaluation count (findable in the list without opening it)
    expect(screen.getByLabelText('3 evaluations')).toHaveTextContent('3');
    // the unscored trace (no evaluationsCount) shows an em-dash in the Evals cell, never a fabricated 0
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('M78 — an explicit evaluationsCount of 0 shows an em-dash, not a "0" (0 evaluations = unscored)', () => {
    renderTable({ data: [{ ...bare, evaluationsCount: 0 }] });
    expect(screen.queryByLabelText(/evaluations/i)).not.toBeInTheDocument(); // no count badge for 0
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a StatusDot on the status cell (error → failed dot)', () => {
    renderTable({ data: [full] });
    expect(screen.getByLabelText('failed')).toBeInTheDocument();
  });

  it('flags an OTLP statusCode error as failed (2 / STATUS_CODE_ERROR), not just the string "error" (#176)', () => {
    // The previous `=== 'error'` predicate silently showed an error trace as non-error.
    renderTable({ data: [{ ...full, statusCode: '2' }] });
    expect(screen.getByLabelText('failed')).toBeInTheDocument();
  });

  it('does NOT flag an OK statusCode as failed (STATUS_CODE_OK / 1)', () => {
    renderTable({ data: [{ ...full, statusCode: 'STATUS_CODE_OK' }] });
    expect(screen.queryByLabelText('failed')).not.toBeInTheDocument();
  });

  it('toggles the compare selection through the @usetheo/ui Checkbox', async () => {
    const toggleSelected = vi.fn();
    renderTable({ data: [full], toggleSelected });
    await userEvent.click(screen.getByLabelText(`Select ${full.traceId} for compare`));
    expect(toggleSelected).toHaveBeenCalledWith(full.traceId);
  });

  it('reflects the selected state on the Checkbox (checked)', () => {
    renderTable({ data: [full], selected: new Set([full.traceId]) });
    expect(screen.getByLabelText(`Select ${full.traceId} for compare`)).toBeChecked();
  });
});
