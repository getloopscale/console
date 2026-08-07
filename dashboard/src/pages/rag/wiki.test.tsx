// wiki.test.tsx
//
// M14 T3 — the Wiki's action screens are modals; reading stays in the split.
//   - New page opens a modal (AppModal), not the detail pane; the browser stays behind it
//   - New folder opens a modal
//   - opening an existing page uses the master-detail split (NO modal)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/render';

vi.mock('@/hooks/use-auth', () => ({ useRequireAuth: () => ({ active: true }) }));
const mockCloudFetch = vi.fn();
vi.mock('@/lib/http/api', () => ({ cloudFetch: (...a: unknown[]) => mockCloudFetch(...a) }));
// KbEditor wraps TipTap (heavy in jsdom) — swap for a plain textarea; not under test here.
vi.mock('@/pages/rag/components/kb-editor', () => ({
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

  it('creates a folder with a .keep marker whose content is UNIQUE per folder (dedup guard)', async () => {
    // The RAG store is content-addressed (dedups by sha256); a fixed marker string would
    // collapse every folder onto the first one created. The content MUST include the path.
    render(<RagWikiPage />);
    await selectCollection();
    await userEvent.click(screen.getByRole('button', { name: /new folder/i }));
    await userEvent.type(screen.getByLabelText(/folder name/i), 'runbooks');
    await userEvent.click(screen.getByRole('button', { name: /create folder/i }));

    const post = mockCloudFetch.mock.calls.find(
      ([url, opts]) => url === '/v1/dashboard/rag/wiki/pages' && (opts as { method?: string })?.method === 'POST',
    );
    expect(post).toBeTruthy();
    const body = JSON.parse((post![1] as { body: string }).body);
    expect(body.name).toBe('runbooks/.keep');
    // Unique content: must contain the folder path, not a fixed string.
    expect(body.content).toContain('runbooks');
    expect(body.content).not.toBe('folder marker');
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

  it('keeps the New page modal open and shows an error when create fails (EC3)', async () => {
    // Reject the create POST; keep the collection + list branches working.
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
      if (url === '/v1/dashboard/rag/wiki/pages' && opts?.method === 'POST') return Promise.reject(new Error('boom'));
      if (url.startsWith('/v1/dashboard/rag/wiki/pages?')) return Promise.resolve({ items: [{ id: 'p1', name: 'Overview.md', status: 'ready' }] });
      return Promise.resolve({ items: [] });
    });

    render(<RagWikiPage />);
    await selectCollection();
    await userEvent.click(screen.getByRole('button', { name: /new page/i }));
    await userEvent.type(screen.getByTestId('new-page-title'), 'auth.md');
    await userEvent.type(screen.getByLabelText(/page content/i), '# body');
    await userEvent.click(screen.getByRole('button', { name: /create page/i }));

    // Modal STAYS open with an inline error — never silently closes (no lost content).
    expect(await screen.findByText(/could not create the page/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('replaces the open split reader with the newly created page (EC5)', async () => {
    // p1 exists; creating returns p2; opening a page fetches /wiki/pages/{id}.
    mockCloudFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/v1/dashboard/rag/collections') return Promise.resolve({ items: [{ id: 'col_1', name: 'docs' }] });
      if (url === '/v1/dashboard/rag/wiki/pages' && opts?.method === 'POST') return Promise.resolve({ id: 'p2' });
      if (url.startsWith('/v1/dashboard/rag/wiki/pages?')) return Promise.resolve({ items: [{ id: 'p1', name: 'Overview.md', status: 'ready' }] });
      if (url === '/v1/dashboard/rag/wiki/pages/p2') return Promise.resolve({ id: 'p2', name: 'auth.md', content: '# a', status: 'ready' });
      if (url.startsWith('/v1/dashboard/rag/wiki/pages/')) return Promise.resolve({ id: 'p1', name: 'Overview.md', content: '# hi', status: 'ready' });
      return Promise.resolve({ items: [] });
    });

    render(<RagWikiPage />);
    await selectCollection();
    await userEvent.click(screen.getByText('Overview.md')); // split open on p1
    await screen.findByRole('button', { name: /close/i }); // reader mounted

    await userEvent.click(screen.getByRole('button', { name: /new page/i })); // modal overlays the split
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('new-page-title'), 'auth.md');
    await userEvent.type(screen.getByLabelText(/page content/i), '# a');
    await userEvent.click(screen.getByRole('button', { name: /create page/i }));

    // Modal closes and the split reader now reflects the NEW page (fetch for p2).
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(mockCloudFetch).toHaveBeenCalledWith('/v1/dashboard/rag/wiki/pages/p2', expect.anything(), expect.objectContaining({ throwOnError: true })));
  });
});
