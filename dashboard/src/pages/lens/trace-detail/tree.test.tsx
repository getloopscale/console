import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/render';
import type { TraceSpanNode } from '@/lib/trace-layout';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { SpanDetail } from './tree';

describe('M78 SpanDetail — evaluations section', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders each machine evaluation (name + score/label)', () => {
    const span: TraceSpanNode = {
      spanId: 'sp-1',
      traceId: 'tr-1',
      name: 'llm.call',
      evaluations: [
        { name: 'hallucination', score: 0.2 },
        { name: 'relevance', label: 'relevant' },
      ],
    };
    render(<SpanDetail span={span} />);
    const section = screen.getByTestId('span-evaluations');
    expect(within(section).getByText('hallucination')).toBeInTheDocument();
    expect(within(section).getByText('0.20')).toBeInTheDocument(); // formatScore
    expect(within(section).getByText('relevance')).toBeInTheDocument();
    expect(within(section).getByText('relevant')).toBeInTheDocument();
  });

  it('shows NO evaluations section when the span was never evaluated', () => {
    const span: TraceSpanNode = { spanId: 'sp-1', traceId: 'tr-1', name: 'llm.call' };
    render(<SpanDetail span={span} />);
    expect(screen.queryByTestId('span-evaluations')).not.toBeInTheDocument();
  });

  it('renders a real score of 0 honestly as "0.00" (not an em-dash — evaluated-to-0 is a real result)', () => {
    const span: TraceSpanNode = { spanId: 'sp-1', traceId: 'tr-1', name: 'llm.call', evaluations: [{ name: 'hallucination', score: 0 }] };
    render(<SpanDetail span={span} />);
    const section = screen.getByTestId('span-evaluations');
    expect(within(section).getByText('0.00')).toBeInTheDocument();
    expect(within(section).queryByText('—')).not.toBeInTheDocument();
  });

  it('shows BOTH the label and the score when an evaluation carries both', () => {
    const span: TraceSpanNode = { spanId: 'sp-1', traceId: 'tr-1', name: 'llm.call', evaluations: [{ name: 'faithful', score: 0.8, label: 'pass' }] };
    render(<SpanDetail span={span} />);
    const section = screen.getByTestId('span-evaluations');
    expect(within(section).getByText('pass')).toBeInTheDocument();
    expect(within(section).getByText('0.80')).toBeInTheDocument();
  });

  it('renders an em-dash for an evaluation with neither score nor label (never a fabricated 0)', () => {
    const span: TraceSpanNode = {
      spanId: 'sp-1',
      traceId: 'tr-1',
      name: 'llm.call',
      evaluations: [{ name: 'coherence' }],
    };
    render(<SpanDetail span={span} />);
    const section = screen.getByTestId('span-evaluations');
    expect(within(section).getByText('coherence')).toBeInTheDocument();
    expect(within(section).getByText('—')).toBeInTheDocument();
    expect(within(section).queryByText('0')).not.toBeInTheDocument();
  });
});
