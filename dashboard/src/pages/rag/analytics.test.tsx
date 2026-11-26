import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));

import { RagAnalyticsPage } from './analytics';

describe('RagAnalyticsPage (/rag/analytics)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the M5 summary metrics from the BFF (no collection selected)', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (path.startsWith('/v1/dashboard/rag/collections'))
        return Promise.resolve({ items: [] });
      return Promise.resolve({
        window: { since: '2026-07-01' },
        totals: { retrievals: 12, answers: 7, empty_retrieval_rate: 0.1 },
        latency: { p50_ms: 40, p95_ms: 120 },
        confidence: { high: 5, medium: 1, low: 1 },
      });
    });
    render(<RagAnalyticsPage />);
    expect(await screen.findByText('12')).toBeInTheDocument(); // retrievals
    expect(screen.getByText('7')).toBeInTheDocument(); // answers
    // The M5 fetch MUST be the base URL (no collection_id yet).
    // The contract is part of the assertion, not incidental to it: without it a refused
    // request resolves `null` and this page shows the same thing it shows for a workspace with
    // no traffic yet (B-235/B-244).
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/analytics',
      {},
      { throwOnError: true },
    );
  });

  it('renders an error alert when the BFF is unavailable', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (path.startsWith('/v1/dashboard/rag/collections'))
        return Promise.resolve({ items: [] });
      return Promise.resolve(null);
    });
    render(<RagAnalyticsPage />);
    expect(await screen.findByText(/could not load analytics/i)).toBeInTheDocument();
  });

  // v8-M7 — the picker + scale render section is the whole point of the T3 slice.
  it('after picking a collection, fetches with collection_id and renders the scale block', async () => {
    mockCloudFetch.mockImplementation((path: string) => {
      if (path.startsWith('/v1/dashboard/rag/collections'))
        return Promise.resolve({ items: [{ id: 'col_docs', name: 'docs' }] });
      if (path.includes('collection_id=col_docs')) {
        return Promise.resolve({
          window: { since: '2026-07-01' },
          totals: { retrievals: 0, answers: 0, empty_retrieval_rate: 0 },
          latency: { p50_ms: 0, p95_ms: 0 },
          confidence: { high: 0, medium: 0, low: 0 },
          scale: {
            collection_id: 'col_docs',
            corpus: { documents: 3, chunks: 42, size_bytes: 8192 },
            communities: { total: 5, max_level: 2, per_level: { '0': 3, '1': 2 } },
            extraction: { tokens: 12345 },
          },
        });
      }
      // Base (no collection_id) — M5 summary only, no scale.
      return Promise.resolve({
        window: { since: '2026-07-01' },
        totals: { retrievals: 0, answers: 0, empty_retrieval_rate: 0 },
        latency: { p50_ms: 0, p95_ms: 0 },
        confidence: { high: 0, medium: 0, low: 0 },
      });
    });
    render(<RagAnalyticsPage />);

    // The scale section is NOT rendered until the user picks a collection (backward-compat).
    expect(screen.queryByText(/extraction tokens/i)).toBeNull();

    // Pick the collection via the Select combobox (same Radix pattern as documents.tsx).
    await userEvent.click(await screen.findByRole('combobox', { name: /collection/i }));
    await userEvent.click(await screen.findByRole('option', { name: 'docs' }));

    // Extraction tokens, community totals, corpus figures — all visible.
    // B-242 — the LABEL, by the same selector the denial above uses. This case asserted only the
    // VALUE (`12,345`), so `queryByText(/extraction tokens/i)` up there was satisfied by the section
    // being gated AND by the label disappearing from the section entirely — leaving a bare number
    // on screen with nothing saying what it counts.
    expect(await screen.findByText(/extraction tokens/i)).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument(); // extraction tokens
    // Per-level rows — a Level N label + its count share the same list item.
    const perLevelItems = await screen.findAllByRole('listitem');
    const rowTexts = perLevelItems.map((el) => el.textContent ?? '');
    // looprag emits per_level as { "0": 3, "1": 2 } — the LI renders the two.
    expect(rowTexts).toEqual(expect.arrayContaining([expect.stringMatching(/Level 0.*3/), expect.stringMatching(/Level 1.*2/)]));
    // Corpus figures.
    expect(screen.getByText('42')).toBeInTheDocument(); // corpus.chunks
    expect(screen.getAllByText('3').length).toBeGreaterThan(0); // corpus.documents (also per-level 0)

    // The BFF received the collection_id (proves T3a passthrough is wired end-to-end here).
    expect(mockCloudFetch).toHaveBeenCalledWith(
      '/v1/dashboard/rag/analytics?collection_id=col_docs',
      {},
      { throwOnError: true },
    );
  });
});
