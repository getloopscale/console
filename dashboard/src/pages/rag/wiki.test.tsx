// wiki.test.tsx
//
// M14 T3 — the Wiki's action screens are modals; reading stays in the split.
//   - New page opens a modal (AppModal), not the detail pane; the browser stays behind it
//   - New folder opens a modal
//   - opening an existing page uses the master-detail split (NO modal)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));
// KbEditor wraps TipTap (heavy in jsdom) — swap for a plain textarea; not under test here.
vi.mock('@/components/rag/kb-editor', () => ({
  KbEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="page content" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { RagWikiPage } from './wiki';

function routeCloudFetch() {
  mockCloudFetch.mockImplementation((url: string) => {
    if (url === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
    if (url.startsWith('/v1/dashboard/rag/wiki/pages?')) {
      return Promise.resolve({ items: [{ id: 'p1', name: 'Overview.md', status: 'ready' }] });
    }
    if (url.startsWith('/v1/dashboard/rag/wiki/pages/')) {
      return Promise.resolve({ id: 'p1', name: 'Overview.md', content: '# hi', status: 'ready' });
    }
    return Promise.resolve({ items: [] });
  });
}

async function selectCollection() {
  await userEvent.click(screen.getByRole('combobox', { name: /collection/i }));
  await userEvent.click(await screen.findByRole('option', { name: /docs/i }));
  await screen.findByText('Overview.md'); // wiki pages loaded
}

describe('RagWikiPage (/rag/wiki) — action screens are modals, reading is the split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeCloudFetch();
  });

  it('opens New page in a modal (not the detail pane); the browser stays behind it', async () => {
    render(<RagWikiPage />);
    await selectCollection();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // no modal yet
    await userEvent.click(screen.getByRole('button', { name: /new page/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(/new page/i);
    // The browser (master) is still mounted behind the modal — creation did NOT take the pane.
    expect(screen.getByTestId('wiki-browser')).toBeInTheDocument();
  });

  it('opens New folder in a modal', async () => {
    render(<RagWikiPage />);
    await selectCollection();
    await userEvent.click(screen.getByRole('button', { name: /new folder/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(/new folder/i);
  });

  it('opens an existing page in the split — NOT a modal', async () => {
    render(<RagWikiPage />);
    await selectCollection();

    // Click the page row in the browser (click bubbles from the label to the button).
    await userEvent.click(screen.getByText('Overview.md'));

    // The reader is the split pane (has a Close control), and no modal was opened.
    expect(await screen.findByRole('button', { name: /close/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
