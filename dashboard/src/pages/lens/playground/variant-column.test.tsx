import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { userEvent } from '@testing-library/user-event';

import { render, screen, within } from '@/test/render';
import type { TraceSpanNode } from '@/lib/lens/trace-layout';
import { BaselineColumn } from './baseline-column';
import { VariantColumn, errorMessage } from './variant-column';
import { newVariant, type Variant } from './variant-model';

const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/api')>();
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

// A controlled harness so onChange + onRan updates propagate (needed for the stale-after-edit test).
function Harness({ initial }: { initial: Variant }) {
  const [v, setV] = useState(initial);
  return (
    <VariantColumn
      variant={v}
      span={span}
      onChange={setV}
      onRan={(ranKey) => setV((prev) => ({ ...prev, lastRunKey: ranKey }))}
      onRemove={() => {}}
      canRemove
    />
  );
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

describe('M89 BaselineColumn — no fabricated-zero tokens', () => {
  it('test_baseline_tokens_em_dash_when_never_measured', () => {
    // A span whose token counts were NEVER recorded (both undefined) must render
    // "—", not a fabricated "0 tok" that is indistinguishable from a real zero.
    render(<BaselineColumn span={{ ...span, inputTokens: undefined, outputTokens: undefined }} />);
    const col = screen.getByTestId('baseline-metrics');
    expect(within(col).getByText('— tok')).toBeInTheDocument();
    expect(within(col).queryByText('0 tok')).toBeNull();
  });

  it('test_baseline_tokens_zero_when_measured_zero', () => {
    // A genuinely measured zero stays "0 tok" — the fix must NOT erase real zeros.
    render(<BaselineColumn span={{ ...span, inputTokens: 0, outputTokens: 0 }} />);
    const col = screen.getByTestId('baseline-metrics');
    expect(within(col).getByText('0 tok')).toBeInTheDocument();
  });

  it('test_baseline_tokens_partial_sum_when_one_half_measured', () => {
    // At least one component measured → the sum is a real (partial) measurement.
    render(<BaselineColumn span={{ ...span, inputTokens: 5, outputTokens: undefined }} />);
    const col = screen.getByTestId('baseline-metrics');
    expect(within(col).getByText('5 tok')).toBeInTheDocument();
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

  it('M72 — a failed save-as-dataset surfaces a write-error Alert (not silent)', async () => {
    mockCloudFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/v1/dashboard/lens/datasets' && (!init || init.method === undefined))
        return Promise.resolve({ datasets: [{ id: 'ds_1', name: 'golden' }] });
      if (/\/datasets\/ds_1\/items$/.test(url) && init?.method === 'POST')
        return Promise.reject(Object.assign(new Error('boom'), { status: 403 }));
      // the replay POST (…/replay) succeeds so the save control appears
      return Promise.resolve({ output: 'variant answer', promptTokens: 1, completionTokens: 1, totalTokens: 2, latencyMs: 10, model: 'm' });
    });
    render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }], 'm')} />);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await screen.findByText('variant answer');
    await userEvent.click(screen.getByRole('button', { name: /save as dataset item/i }));
    expect(await screen.findByTestId('variant-save-error')).toBeInTheDocument();
    expect(screen.getByText(/could not save to the dataset/i)).toBeInTheDocument();
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

  it('test_variant_output_greys_when_stale_and_edit_is_not_billable', async () => {
    mockCloudFetch.mockResolvedValue({ output: 'ran', promptTokens: 1, completionTokens: 1, totalTokens: 2, latencyMs: 1, model: 'm' });
    render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }])} />);
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    const card = await screen.findByTestId('variant-output');
    expect(card).toHaveAttribute('data-stale', 'false'); // fresh run
    // edit a message after the run → the shown output is now stale (greyed) AND no extra billable call
    await userEvent.type(screen.getAllByRole('textbox')[0], ' more');
    expect(screen.getByTestId('variant-output')).toHaveAttribute('data-stale', 'true');
    // editing never auto-fires a replay — exactly one billable /replay POST (the datasets GET is separate)
    expect(mockCloudFetch.mock.calls.filter((c) => String(c[0]).endsWith('/replay'))).toHaveLength(1);
  });

  it('test_variant_forwards_valid_responseSchema_in_the_post_body', async () => {
    mockCloudFetch.mockResolvedValue({ output: '{}', promptTokens: 1, completionTokens: 1, totalTokens: 2, latencyMs: 1, model: 'm' });
    render(<Harness initial={newVariant([{ role: 'user', content: 'hi' }])} />);
    await userEvent.click(screen.getByRole('button', { name: /structured output/i }));
    // set a valid schema via the native setter (a controlled Textarea) then run
    const ta = screen.getByLabelText(/json schema/i) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, '{"type":"object"}');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await userEvent.click(screen.getByRole('button', { name: /^run$/i }));
    await screen.findByTestId('variant-output');
    const body = JSON.parse((mockCloudFetch.mock.calls[0][1] as { body: string }).body) as { responseSchema?: unknown };
    expect(body.responseSchema).toEqual({ type: 'object' }); // valid schema forwarded (not a dead input)
  });

  it('test_errorMessage_maps_each_status_to_typed_copy', () => {
    expect(errorMessage({ status: 503 })).toMatch(/not configured/i);
    expect(errorMessage({ status: 502 })).toMatch(/failed to answer/i);
    expect(errorMessage({ status: 429 })).toMatch(/rate limit/i);
    expect(errorMessage({ status: 404 })).toMatch(/another workspace/i);
    expect(errorMessage(new Error('x'))).toMatch(/unavailable/i); // unknown → generic
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
