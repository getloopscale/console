import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, within } from '@/test/render';

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

    // The create form is a centered modal — open it from the PageShell primary action first.
    await userEvent.click(screen.getByRole('button', { name: /new evaluator/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'nonempty');
    await userEvent.type(screen.getByLabelText(/rule predicate/i), 'status:error'); // real span-query DSL
    await userEvent.click(screen.getByRole('button', { name: /create evaluator/i }));

    const call = mockCloudFetch.mock.calls.find(
      (c) => c[0] === '/v1/dashboard/lens/evaluators' && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.kind).toBe('rule');
    expect(body.config).toEqual({ predicate: 'status:error' });
  });

  // M76 (E-1) — the llm_judge evaluator class is reachable from the UI: selecting it swaps the config
  // fields (predicate → prompt + model) and POSTs the matching theo-lens discriminated-union body.
  it('M76 — selecting the LLM-judge kind swaps fields and POSTs {kind:llm_judge, config:{prompt,model}}', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [] });
    render(<LensEvaluatorsPage />);
    await screen.findByText(/no evaluators yet/i);

    // Open the create modal (PageShell primary action) before filling the form.
    await userEvent.click(screen.getByRole('button', { name: /new evaluator/i }));
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
    // The predicate hint lives inside the create modal — open it first.
    await userEvent.click(screen.getByRole('button', { name: /new evaluator/i }));
    expect(await screen.findByText(/field:value/i)).toBeInTheDocument(); // names the real span-query DSL
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

  it('M82 — rename an evaluator inline via PUT {name}', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [{ id: 'ev_1', name: 'r', kind: 'rule' }] });
    render(<LensEvaluatorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /rename evaluator r/i }));
    const input = await screen.findByRole('textbox', { name: /rename evaluator r/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed{Enter}');
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/lens/evaluators/ev_1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'renamed' }) }),
      expect.anything(),
    );
  });

  it('M82 — a rename to a duplicate name (409) shows a name-conflict message', async () => {
    mockCloudFetch.mockImplementation((_url: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return Promise.reject(Object.assign(new Error('conflict'), { status: 409 }));
      return Promise.resolve({ evaluators: [{ id: 'ev_1', name: 'r', kind: 'rule' }] });
    });
    render(<LensEvaluatorsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /rename evaluator r/i }));
    const input = await screen.findByRole('textbox', { name: /rename evaluator r/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'taken{Enter}');
    expect(await screen.findByText(/already (exists|in use|taken)|name.*already/i)).toBeInTheDocument();
  });

  // M75 (audit E-3) — the delete button announces the human name, not the raw id.
  it('M75 — the delete button aria-label uses the evaluator name, not the raw id', async () => {
    mockCloudFetch.mockResolvedValue({ evaluators: [{ id: 'e92e0cf9-1234', name: 'Answer relevance', kind: 'rule' }] });
    render(<LensEvaluatorsPage />);
    expect(await screen.findByRole('button', { name: /delete evaluator answer relevance/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete evaluator e92e0cf9/i })).not.toBeInTheDocument();
  });

  // M90 — score-over-time chart. cloudFetch is discriminated by URL so the evaluators
  // list and the scores series resolve independently.
  const byUrl = (scores: unknown) => (url: string) =>
    url.startsWith('/v1/dashboard/lens/metrics/scores')
      ? Promise.resolve(scores)
      : Promise.resolve({ evaluators: [] });

  it('M90 — renders a mean-score trend for numeric evaluators over the selected range', async () => {
    mockCloudFetch.mockImplementation(
      byUrl({
        range: '7d',
        scores: [
          { periodStart: '2026-07-08T00:00:00.000Z', name: 'hallucination', sampleCount: 2, avgScore: 0.3, labels: {} },
          { periodStart: '2026-07-08T01:00:00.000Z', name: 'hallucination', sampleCount: 1, avgScore: 0.8, labels: {} },
        ],
      }),
    );
    render(<LensEvaluatorsPage />);
    const section = await screen.findByTestId('scores-over-time');
    // the trend chart rendered (not the empty state) and the evaluator surfaces in its legend/a11y table
    expect(await within(section).findByLabelText(/scores over time trend/i)).toBeInTheDocument();
    expect(within(section).getAllByText('hallucination').length).toBeGreaterThan(0);
    expect(within(section).queryByText(/no evaluations yet/i)).not.toBeInTheDocument();
  });

  it('M90 — an empty range shows an honest empty state, not a fabricated zero line', async () => {
    mockCloudFetch.mockImplementation(byUrl({ range: '7d', scores: [] }));
    render(<LensEvaluatorsPage />);
    const section = await screen.findByTestId('scores-over-time');
    expect(await within(section).findByText(/no evaluations yet/i)).toBeInTheDocument();
    expect(within(section).queryByLabelText(/scores over time trend/i)).not.toBeInTheDocument();
  });

  it('M90 — discloses truncation when more numeric evaluators exist than are plotted (no silent drop)', async () => {
    // 7 numeric evaluators in one period; the chart caps at top 6 → an honest "top 6 of 7" note.
    const scores = Array.from({ length: 7 }, (_, i) => ({
      periodStart: '2026-07-08T00:00:00.000Z',
      name: `ev${i}`,
      sampleCount: 7 - i, // distinct volumes so the top-N ranking is deterministic
      avgScore: 0.5,
      labels: {},
    }));
    mockCloudFetch.mockImplementation(byUrl({ range: '7d', scores }));
    render(<LensEvaluatorsPage />);
    const note = await screen.findByTestId('scores-truncation-note');
    expect(note).toHaveTextContent(/top 6 of 7 evaluators/i);
  });

  it('M90 — a scores backend failure surfaces a fail-closed error Alert (no chart)', async () => {
    mockCloudFetch.mockImplementation((url: string) =>
      url.startsWith('/v1/dashboard/lens/metrics/scores')
        ? Promise.reject(new Error('backend 502'))
        : Promise.resolve({ evaluators: [] }),
    );
    render(<LensEvaluatorsPage />);
    expect(await screen.findByTestId('scores-error')).toBeInTheDocument();
    expect(screen.queryByLabelText(/scores over time trend/i)).not.toBeInTheDocument();
  });
});
