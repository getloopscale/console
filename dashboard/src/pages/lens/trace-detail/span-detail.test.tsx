import { describe, it, expect, vi } from 'vitest';
import { within } from '@testing-library/react';
import { render, screen } from '@/test/render';

import { SpanDetail } from './span-detail';
import type { TraceSpanNode } from './helpers';

vi.mock('@/lib/api', () => ({ cloudFetch: vi.fn(() => Promise.resolve({})) }));

/** An LLM span carrying real token + cost fields (M15 TokenCostBreakdown adoption). */
function llmSpan(overrides: Partial<TraceSpanNode> = {}): TraceSpanNode {
  return {
    spanId: 'child',
    traceId: 't1',
    name: 'claude_code.llm_request',
    model: 'claude-haiku-4-5',
    provider: 'anthropic',
    inputTokens: 501,
    outputTokens: 13,
    cacheReadTokens: 40,
    cacheCreationTokens: 20,
    costUsd: 0.0234,
    outputValue: '{"answer":"hi"}',
    ...overrides,
  };
}

describe('SpanDetail — TokenCostBreakdown (M15)', () => {
  it('renders the consolidated token/cost breakdown from the span real fields', () => {
    render(<SpanDetail span={llmSpan()} />);
    const detail = screen.getByTestId('span-detail');
    const tcb = detail.querySelector('[data-slot="token-cost-breakdown"]');
    expect(tcb).not.toBeNull();
    expect(within(tcb as HTMLElement).getByTestId('tcb-input')).toHaveTextContent('501');
    expect(within(tcb as HTMLElement).getByTestId('tcb-output')).toHaveTextContent('13');
    // cacheReadTokens + cacheCreationTokens = 60
    expect(within(tcb as HTMLElement).getByTestId('tcb-cache')).toHaveTextContent('60');
    // real per-span cost renders (default $0.0000 format)
    expect(within(tcb as HTMLElement).getByTestId('tcb-cost')).toHaveTextContent('$0.0234');
  });

  it('renders an honest em-dash for absent token/cost fields (never a fabricated zero)', () => {
    // a span with output tokens only — input/cache/cost are absent
    render(<SpanDetail span={llmSpan({ inputTokens: undefined, cacheReadTokens: undefined, cacheCreationTokens: undefined, costUsd: undefined })} />);
    const tcb = screen.getByTestId('span-detail').querySelector('[data-slot="token-cost-breakdown"]');
    expect(tcb).not.toBeNull();
    expect(within(tcb as HTMLElement).getByTestId('tcb-output')).toHaveTextContent('13');
    // absent → em-dash (U+2014), not 0
    expect(within(tcb as HTMLElement).getByTestId('tcb-input')).toHaveTextContent('—');
    expect(within(tcb as HTMLElement).getByTestId('tcb-cache')).toHaveTextContent('—');
    expect(within(tcb as HTMLElement).getByTestId('tcb-cost')).toHaveTextContent('—');
  });

  it('renders an em-dash (not $0.0000) for a span with no individually-computed cost (costUsd 0)', () => {
    // M52 / theo-lens#71 Finding 3: cost is a trace-level aggregate. A per-span costUsd of 0 means
    // "no individually-computed cost" — it renders `—`, never a misleading fabricated "$0.0000".
    render(<SpanDetail span={llmSpan({ costUsd: 0 })} />);
    const tcb = screen.getByTestId('span-detail').querySelector('[data-slot="token-cost-breakdown"]');
    expect(within(tcb as HTMLElement).getByTestId('tcb-cost')).toHaveTextContent('—');
    expect(within(tcb as HTMLElement).getByTestId('tcb-cost')).not.toHaveTextContent('$0.0000');
  });
});
