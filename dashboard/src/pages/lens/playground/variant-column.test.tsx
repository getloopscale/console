import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { userEvent } from '@testing-library/user-event';

import { render, screen, within } from '@/test/render';
import type { TraceSpanNode } from '@/lib/trace-layout';
import { BaselineColumn } from './baseline-column';
import { VariantColumn } from './variant-column';
import { newVariant, type Variant } from './variant-model';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) };
});

const span: TraceSpanNode = {
  spanId: 's1',
  traceId: 't1',
  name: 'llm.call',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  inputTokens: 40,
  outputTokens: 12,
  inputValue: JSON.stringify([{ role: 'user', content: 'hi' }]),
  outputValue: 'original answer',
  startTimeUnixNano: '1000000000',
  endTimeUnixNano: '1005800000', // 5.8s
};

// A controlled harness so onChange updates propagate (needed for the stale-after-edit test).
function Harness({ initial }: { initial: Variant }) {
  const [v, setV] = useState(initial);
  return <VariantColumn variant={v} span={span} onChange={setV} onRemove={() => {}} canRemove />;
}

describe('M62 BaselineColumn', () => {
  it('test_baseline_renders_original_metrics_readonly', () => {
    render(<BaselineColumn span={span} />);
    // shows the original output + model + tokens via M57 formatting
    expect(screen.getByTestId('baseline-output')).toHaveTextContent('original answer');
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
    // read-only: no editable control anywhere in the baseline column
    const col = screen.getByTestId('baseline-column');
    expect(within(col).queryByRole('textbox')).toBeNull();
    expect(within(col).queryByRole('combobox')).toBeNull();
    expect(within(col).queryByRole('button')).toBeNull();
  });
});

describe('M62 VariantColumn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('test_variant_run_shows_model_latency_tokens_cost', async () => {
    mockCloudFetch.mockResolvedValue({
      output: 'variant answer',
      promptTokens: 30,
      completionTokens: 8,
      totalTokens: 38,
      latencyMs: 846,
      model: 'openai/gpt-4o-mini',
      costUsd: 0.0009,
    });
    render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }], 'openai/gpt-4o-mini')} />);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await screen.findByText('variant answer');
    const card = screen.getByTestId('variant-output');
    expect(within(card).getByText('openai/gpt-4o-mini')).toBeInTheDocument();
    expect(within(card).getByText('846ms')).toBeInTheDocument(); // formatDuration
    expect(within(card).getByText('38 tok')).toBeInTheDocument(); // formatTokens
    expect(within(card).getByText('$0.0009')).toBeInTheDocument(); // formatCost — real cost
  });

  it('test_variant_cost_renders_em_dash_when_absent (never $0)', async () => {
    mockCloudFetch.mockResolvedValue({ output: 'a', promptTokens: 1, completionTokens: 1, totalTokens: 2, latencyMs: 10, model: 'm' });
    render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }])} />);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await screen.findByText('a');
    const card = screen.getByTestId('variant-output');
    expect(within(card).getByTestId('variant-cost')).toHaveTextContent('—');
    expect(within(card).queryByText('$0')).toBeNull();
  });

  it('test_variant_output_is_plaintext_xss_safe', async () => {
    mockCloudFetch.mockResolvedValue({ output: '<img src=x onerror=alert(1)>', promptTokens: 1, completionTokens: 1, totalTokens: 2, latencyMs: 1, model: 'm' });
    const { container } = render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }])} />);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await screen.findByText('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull(); // rendered as literal text, no img node
  });

  it('test_variant_output_greys_when_stale', async () => {
    mockCloudFetch.mockResolvedValue({ output: 'ran', promptTokens: 1, completionTokens: 1, totalTokens: 2, latencyMs: 1, model: 'm' });
    render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }])} />);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    const card = await screen.findByTestId('variant-output');
    expect(card).toHaveAttribute('data-stale', 'false'); // fresh run
    // edit a message after the run → the shown output is now stale (greyed)
    await userEvent.type(screen.getAllByRole('textbox')[0], ' more');
    expect(screen.getByTestId('variant-output')).toHaveAttribute('data-stale', 'true');
  });

  it('test_variant_provider_error_shows_typed_alert (no output, one POST)', async () => {
    mockCloudFetch.mockRejectedValue(new Error('replay 502'));
    render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }])} />);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    expect(await screen.findByTestId('variant-error')).toBeInTheDocument();
    expect(screen.queryByTestId('variant-output')).toBeNull();
    expect(mockCloudFetch).toHaveBeenCalledTimes(1); // retry:false — no billable loop
  });

  it('test_variant_invalid_schema_blocks_run (client-side, no POST)', async () => {
    render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }])} />);
    // open the structured-output field and type invalid JSON
    await userEvent.click(screen.getByRole('button', { name: /structured output/i }));
    await userEvent.type(screen.getByLabelText(/json schema/i), '{{not json'); // {{ types a literal {
    expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled();
    expect(mockCloudFetch).not.toHaveBeenCalled();
  });
});
