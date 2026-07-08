import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { LensEvaluatorsPage } from './evaluators';

describe('LensEvaluatorsPage (/observability/evaluators)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an evaluator via POST with {kind,config}', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [] });
    render(<LensEvaluatorsPage />);
    await screen.findByText(/no evaluators yet/i);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'nonempty');
    await userEvent.type(screen.getByLabelText(/rule predicate/i), 'output.length > 0');
    await userEvent.click(screen.getByRole('button', { name: /create evaluator/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/evaluators' && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.kind).toBe('rule');
    expect(body.config).toEqual({ predicate: 'output.length > 0' });
  });

  // M76 (E-1) — the llm_judge evaluator class is reachable from the UI: selecting it swaps the config
  // fields (predicate → prompt + model) and POSTs the matching theo-lens discriminated-union body.
  it('M76 — selecting the LLM-judge kind swaps fields and POSTs {kind:llm_judge, config:{prompt,model}}', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [] });
    render(<LensEvaluatorsPage />);
    await screen.findByText(/no evaluators yet/i);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'faithfulness');
    await userEvent.click(screen.getByRole('combobox', { name: /evaluator kind/i }));
    await userEvent.click(await screen.findByRole('option', { name: /llm judge/i }));
    // the predicate field is gone; prompt + model appear
    expect(screen.queryByLabelText(/rule predicate/i)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/judge prompt/i), 'Grade for accuracy. PASS or FAIL.');
    await userEvent.type(screen.getByLabelText(/judge model/i), 'gpt-4o-mini');
    await userEvent.click(screen.getByRole('button', { name: /create evaluator/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/evaluators' && (c[1] as { method?: string })?.method === 'POST',
    );
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.kind).toBe('llm_judge');
    expect(body.config).toEqual({ prompt: 'Grade for accuracy. PASS or FAIL.', model: 'gpt-4o-mini' });
  });

  // M76 (E-2) — the Rule predicate field carries a concrete example so it is not a blank mystery box.
  it('M76 — the rule predicate field shows an example hint', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [] });
    render(<LensEvaluatorsPage />);
    await screen.findByText(/no evaluators yet/i);
    expect(screen.getByText(/A boolean expression over the trace/i)).toBeInTheDocument();
  });

  it('runs an evaluator via POST /run', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [{ id: 'ev_1', name: 'r', kind: 'rule' }] });
    render(<LensEvaluatorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /run r/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/evaluators/ev_1/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('delete opens ConfirmDialog then calls DELETE on confirm', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [{ id: 'ev_1', name: 'r', kind: 'rule' }] });
    render(<LensEvaluatorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /delete evaluator r/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete evaluator$/i }));
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/evaluators/ev_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  // M75 (audit E-3) — the delete button announces the human name, not the raw id.
  it('M75 — the delete button aria-label uses the evaluator name, not the raw id', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [{ id: 'e92e0cf9-1234', name: 'Answer relevance', kind: 'rule' }] });
    render(<LensEvaluatorsPage />);
    expect(await screen.findByRole('button', { name: /delete evaluator answer relevance/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete evaluator e92e0cf9/i })).not.toBeInTheDocument();
  });
});
